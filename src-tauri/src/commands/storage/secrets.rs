//! API keys and tokens in the OS credential store (macOS Keychain, Windows
//! Credential Manager) instead of plain text in the webview's localStorage.
//!
//! All secrets live in one small JSON "vault", read once at startup and
//! written only when it actually changes.
//!
//! macOS asks for the login password whenever an app touches a keychain item
//! it didn't create with its *current* code signature. So the vault is one
//! item, updated in place: at most one prompt per new build ("Always Allow"
//! covers the rest). Earlier versions split the vault over several items and
//! made new ones on every save, which meant a prompt per item per save; that
//! layout is read once and folded into the single item.
//!
//! Development builds (`tauri dev`) are re-signed on every rebuild, so they
//! would prompt after each change; they keep the vault in an owner-only file
//! instead (importing the keychain copy once). Release builds always use the
//! keychain.
//!
//! Windows caps a credential at 2560 bytes, so there the vault is split into
//! chunks, written as a new generation before the header points at it.
//! Linux has no credential store wired up and uses the owner-only file.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::Serialize;

/// Names are short identifiers like `provider:openai`; values are keys.
pub type Vault = BTreeMap<String, String>;

const MAX_NAME_LEN: usize = 200;
const MAX_VALUE_LEN: usize = 16 * 1024;
const MAX_ENTRIES: usize = 500;

/// The vault as last read or written, so an unchanged save doesn't touch the keychain.
static LAST: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    pub values: Vault,
    /// `keychain` or `file`, shown in Settings.
    pub backend: &'static str,
}

fn validate(values: &Vault) -> Result<(), String> {
    if values.len() > MAX_ENTRIES {
        return Err("Too many saved keys".into());
    }
    for (name, value) in values {
        if name.is_empty() || name.len() > MAX_NAME_LEN || name.chars().any(char::is_control) {
            return Err(format!("Invalid key name: {name:?}"));
        }
        if value.len() > MAX_VALUE_LEN {
            return Err(format!("The value for {name} is too long"));
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod keychain {
    use keyring::{Entry, Error};

    pub const SERVICE: &str = "com.panudet.mali-cowork";

    pub fn entry(user: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, user).map_err(describe)
    }

    pub fn describe(error: Error) -> String {
        match error {
            Error::NoStorageAccess(_) | Error::PlatformFailure(_) => {
                format!("The system keychain is not available: {error}")
            }
            other => other.to_string(),
        }
    }

    pub fn get(user: &str) -> Result<Option<String>, String> {
        match entry(user)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(describe(e)),
        }
    }

    pub fn delete(user: &str) {
        if let Ok(e) = entry(user) {
            let _ = e.delete_credential();
        }
    }

    /// The chunked layout: header `vault` = `<generation> <count>`, chunks `vault.<generation>.<i>`.
    pub mod chunked {
        use super::{delete, entry, get};

        const HEADER: &str = "vault";
        /// Characters per chunk: Windows stores UTF-16, 2560 bytes at most.
        const CHUNK_CHARS: usize = 1000;

        fn header() -> Result<Option<(String, usize)>, String> {
            Ok(get(HEADER)?.and_then(|raw| {
                let mut parts = raw.split_whitespace();
                let generation = parts.next().unwrap_or_default().to_string();
                let count = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
                (!generation.is_empty()).then_some((generation, count))
            }))
        }

        fn chunk_user(generation: &str, index: usize) -> String {
            format!("{HEADER}.{generation}.{index}")
        }

        pub fn read() -> Result<Option<String>, String> {
            let Some((generation, count)) = header()? else {
                return Ok(None);
            };
            let mut json = String::new();
            for index in 0..count {
                json.push_str(&get(&chunk_user(&generation, index))?.unwrap_or_default());
            }
            Ok(Some(json))
        }

        #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
        pub fn write(json: &str) -> Result<(), String> {
            let previous = header()?;
            let generation = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
            let chars: Vec<char> = json.chars().collect();
            let chunks: Vec<String> = chars.chunks(CHUNK_CHARS).map(|c| c.iter().collect()).collect();
            for (index, chunk) in chunks.iter().enumerate() {
                entry(&chunk_user(&generation, index))?
                    .set_password(chunk)
                    .map_err(super::describe)?;
            }
            entry(HEADER)?
                .set_password(&format!("{generation} {}", chunks.len()))
                .map_err(super::describe)?;
            if let Some((old, count)) = previous {
                (0..count).for_each(|index| delete(&chunk_user(&old, index)));
            }
            Ok(())
        }

        /// Remove every item of the chunked layout.
        #[cfg_attr(any(target_os = "windows", debug_assertions), allow(dead_code))]
        pub fn remove() -> Result<(), String> {
            if let Some((generation, count)) = header()? {
                (0..count).for_each(|index| delete(&chunk_user(&generation, index)));
            }
            delete(HEADER);
            Ok(())
        }
    }
}

/// macOS release builds: the whole vault in one keychain item.
#[cfg(all(target_os = "macos", not(debug_assertions)))]
mod backend {
    use super::keychain::{self, chunked};

    pub const NAME: &str = "keychain";
    const ITEM: &str = "secrets";

    pub fn read() -> Result<Option<String>, String> {
        if let Some(json) = keychain::get(ITEM)? {
            return Ok(Some(json));
        }
        // Fold the old multi-item layout into the single item, once.
        let Some(json) = chunked::read()? else {
            return Ok(None);
        };
        write(&json)?;
        chunked::remove()?;
        Ok(Some(json))
    }

    pub fn write(json: &str) -> Result<(), String> {
        keychain::entry(ITEM)?.set_password(json).map_err(keychain::describe)
    }
}

#[cfg(target_os = "windows")]
mod backend {
    pub use super::keychain::chunked::{read, write};

    pub const NAME: &str = "keychain";
}

/// Linux, and development builds on macOS: an owner-only file.
#[cfg(any(all(target_os = "macos", debug_assertions), not(any(target_os = "macos", target_os = "windows"))))]
mod backend {
    use crate::commands::secure_fs::write_private;
    use std::path::PathBuf;

    pub const NAME: &str = "file";

    fn path() -> PathBuf {
        let name = if cfg!(debug_assertions) { "secrets-dev.json" } else { "secrets.json" };
        dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("mali-cowork")
            .join(name)
    }

    pub fn read() -> Result<Option<String>, String> {
        match std::fs::read_to_string(path()) {
            Ok(raw) => Ok(Some(raw)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => import_from_keychain(),
            Err(e) => Err(format!("Cannot read saved keys: {e}")),
        }
    }

    /// A development build starting for the first time takes over the keys a
    /// previous one kept in the keychain (one prompt, then never again).
    #[cfg(target_os = "macos")]
    fn import_from_keychain() -> Result<Option<String>, String> {
        use super::keychain::{self, chunked};
        let found = keychain::get("secrets").ok().flatten().or_else(|| chunked::read().ok().flatten());
        if let Some(json) = &found {
            write(json)?;
        }
        Ok(found)
    }

    #[cfg(not(target_os = "macos"))]
    fn import_from_keychain() -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn write(json: &str) -> Result<(), String> {
        write_private(&path(), json)
    }
}

pub fn load() -> Result<VaultSnapshot, String> {
    let raw = backend::read()?;
    let values: Vault = match &raw {
        Some(json) => serde_json::from_str(json).map_err(|_| "Saved keys are unreadable".to_string())?,
        None => Vault::new(),
    };
    *LAST.lock().unwrap_or_else(|p| p.into_inner()) = Some(serde_json::to_string(&values).map_err(|e| e.to_string())?);
    Ok(VaultSnapshot { values, backend: backend::NAME })
}

pub fn store(values: &Vault) -> Result<(), String> {
    validate(values)?;
    let json = serde_json::to_string(values).map_err(|e| e.to_string())?;
    let mut last = LAST.lock().unwrap_or_else(|p| p.into_inner());
    // Nothing changed: don't touch the keychain (every write can prompt on macOS).
    if last.as_deref() == Some(json.as_str()) {
        return Ok(());
    }
    backend::write(&json)?;
    *last = Some(json);
    Ok(())
}

// Keychain calls block (and may show a system prompt), so they run off the
// async runtime's worker threads.
#[tauri::command]
pub async fn secrets_load() -> Result<VaultSnapshot, String> {
    tokio::task::spawn_blocking(load).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn secrets_save(values: Vault) -> Result<(), String> {
    tokio::task::spawn_blocking(move || store(&values))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_names_and_huge_values() {
        let mut values = Vault::new();
        values.insert("provider:openai".into(), "sk-test".into());
        assert!(validate(&values).is_ok());
        values.insert("bad\nname".into(), "x".into());
        assert!(validate(&values).is_err());

        let mut huge = Vault::new();
        huge.insert("provider:x".into(), "a".repeat(MAX_VALUE_LEN + 1));
        assert!(validate(&huge).is_err());
    }
}
