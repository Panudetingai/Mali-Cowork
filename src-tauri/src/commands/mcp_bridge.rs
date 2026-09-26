//! CLI agents inside Mali get the user's connectors from Mali's `mali`
//! gateway, for that run only — never from entries written into their own
//! config. And the entries Mali wrote there before are taken back out.
//!
//! - OpenCode: `mali` in the config Mali starts its server with
//!   (`OPENCODE_CONFIG_CONTENT`), the user's own servers switched off there.
//! - Codex: `-c mcp_servers.mali…` on the command line, the user's own
//!   servers switched off the same way; the token travels in an env var.
//! - Cursor: a private plugin (`--plugin-dir`) whose one MCP server is
//!   `mali`. Cursor has no per-run way to leave out `~/.cursor/mcp.json`, so
//!   the user's own servers there still load.
//! - Antigravity: nothing per-run exists, so `mali` is in its file only while
//!   a run inside Mali needs it, and taken out when the last one ends.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};
use toml_edit::DocumentMut;

use super::mcp::{codex_config_path, opencode_config_path};
use super::mcp_clients::{self, antigravity_settings_path, manifest_path, merge, merge_allow_rules, read_manifest};
use super::secure_fs::write_private;
use crate::mcp_hub::gateway::{self, Gateway, SERVER_NAME};

/// Manifest keys for what the Antigravity lease wrote.
const AGY_LEASE: &str = "antigravity:mali";
const AGY_LEASE_RULES: &str = "antigravity:mali:permissions";
/// Env var Codex reads the gateway token from.
pub const CODEX_TOKEN_ENV: &str = "MALI_MCP_TOKEN";

fn backup(path: &Path) {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return };
    let copy = path.with_file_name(format!("{name}.mali-backup"));
    if path.is_file() && !copy.exists() {
        let _ = std::fs::copy(path, &copy);
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    if raw.trim().is_empty() {
        return Some(json!({}));
    }
    serde_json::from_str(&raw).ok()
}

fn save_manifest(manifest: &mcp_clients::Manifest) -> Result<(), String> {
    let json = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    write_private(&manifest_path(), &json)
}

// ---------------------------------------------------------------- releasing

/// Remove `ids` from OpenCode's `mcp`; true when something was removed.
fn release_opencode(ids: &HashSet<String>) -> Result<bool, String> {
    release_opencode_at(&opencode_config_path()?, ids)
}

fn release_opencode_at(path: &Path, ids: &HashSet<String>) -> Result<bool, String> {
    let path = path.to_path_buf();
    let Some(mut config) = read_json(&path) else { return Ok(false) };
    let Some(mcp) = config.get_mut("mcp").and_then(Value::as_object_mut) else { return Ok(false) };
    let before = mcp.len();
    mcp.retain(|id, _| !ids.contains(id));
    if mcp.len() == before {
        return Ok(false);
    }
    backup(&path);
    write_private(&path, &serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?)?;
    Ok(true)
}

/// Remove `ids` from Codex's `[mcp_servers]`.
fn release_codex(ids: &HashSet<String>) -> Result<bool, String> {
    release_codex_at(&codex_config_path()?, ids)
}

fn release_codex_at(path: &Path, ids: &HashSet<String>) -> Result<bool, String> {
    let path = path.to_path_buf();
    let Ok(raw) = std::fs::read_to_string(&path) else { return Ok(false) };
    let Ok(mut doc) = raw.parse::<DocumentMut>() else { return Ok(false) };
    let Some(table) = doc.get_mut("mcp_servers").and_then(|t| t.as_table_like_mut()) else { return Ok(false) };
    let owned: Vec<String> = table.iter().map(|(k, _)| k.to_string()).filter(|k| ids.contains(k)).collect();
    if owned.is_empty() {
        return Ok(false);
    }
    for id in &owned {
        table.remove(id);
    }
    if table.is_empty() {
        doc.remove("mcp_servers");
    }
    backup(&path);
    write_private(&path, &doc.to_string())?;
    Ok(true)
}

/// Take Mali's connectors back out of every other app's config. `ids` are the
/// connectors Mali knows (OpenCode and Codex got all of them); Cursor and
/// Antigravity entries come from the manifest of what Mali wrote there.
pub fn release_other_apps(ids: &[String]) -> Vec<String> {
    let ids: HashSet<String> = ids.iter().cloned().collect();
    let mut warnings = Vec::new();
    for (name, result) in [("OpenCode", release_opencode(&ids)), ("Codex", release_codex(&ids))] {
        if let Err(e) = result {
            warnings.push(format!("{name}: {e}"));
        }
    }
    // Cursor + Antigravity: writing "no connectors" removes exactly what the
    // manifest says Mali added, and nothing of the user's.
    let manifest = read_manifest();
    let owned_somewhere = ["cursor", "antigravity", "antigravity:permissions"]
        .iter()
        .any(|k| manifest.get(*k).is_some_and(|v| !v.is_empty()));
    if owned_somewhere {
        if let Some(home) = dirs::home_dir() {
            backup(&home.join(".cursor").join("mcp.json"));
            backup(&home.join(".gemini").join("config").join("mcp_config.json"));
        }
        if let Some(path) = antigravity_settings_path() {
            backup(&path);
        }
        warnings.extend(mcp_clients::write_all(&[], |argv| argv.to_vec(), None));
    }
    // A lease left behind by a run that never finished (the app was closed).
    if manifest.get(AGY_LEASE).is_some_and(|v| !v.is_empty()) {
        if let Err(e) = write_antigravity_lease(None) {
            warnings.push(format!("Antigravity: {e}"));
        }
    }
    warnings
}

#[tauri::command]
pub fn mcp_release_other_apps(ids: Vec<String>) -> Vec<String> {
    let warnings = release_other_apps(&ids);
    for w in &warnings {
        eprintln!("[mcp] {w}");
    }
    warnings
}

// ---------------------------------------------------------------- OpenCode

/// The `mcp` block for OpenCode's startup config: `mali`, and every server the
/// user set up in OpenCode themselves, switched off for Mali's runs.
pub async fn opencode_mcp() -> Option<Value> {
    let gw = gateway::ensure().await.ok()?;
    let mut mcp = serde_json::Map::new();
    if let Some(own) = opencode_config_path().ok().and_then(|p| read_json(&p)).and_then(|c| c.get("mcp").cloned()) {
        for (id, entry) in own.as_object().into_iter().flatten() {
            if id == SERVER_NAME || !entry.is_object() {
                continue;
            }
            let mut off = entry.clone();
            off["enabled"] = json!(false);
            mcp.insert(id.clone(), off);
        }
    }
    mcp.insert(
        SERVER_NAME.into(),
        json!({
            "type": "remote",
            "url": gw.url(),
            "headers": { "Authorization": gw.authorization() },
            "enabled": true,
            // Listing can start a connector for the first time (npx, uvx).
            "timeout": 120_000,
        }),
    );
    Some(Value::Object(mcp))
}

// ---------------------------------------------------------------- Codex

/// `-c` overrides that give one Codex run `mali` and switch off the user's own
/// servers; set [`CODEX_TOKEN_ENV`] to the returned token on the process.
pub async fn codex_overrides() -> Option<(Vec<String>, String)> {
    let gw = gateway::ensure().await.ok()?;
    let mut args = Vec::new();
    let mut set = |key: &str, value: String| {
        args.push("-c".to_string());
        args.push(format!("{key}={value}"));
    };
    set(&format!("mcp_servers.{SERVER_NAME}.url"), format!("\"{}\"", gw.url()));
    set(&format!("mcp_servers.{SERVER_NAME}.bearer_token_env_var"), format!("\"{CODEX_TOKEN_ENV}\""));
    set(&format!("mcp_servers.{SERVER_NAME}.startup_timeout_sec"), "120".into());
    set(&format!("mcp_servers.{SERVER_NAME}.tool_timeout_sec"), "600".into());
    let own: Vec<String> = codex_config_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| raw.parse::<DocumentMut>().ok())
        .and_then(|doc| doc.get("mcp_servers").and_then(|t| t.as_table_like()).map(|t| t.iter().map(|(k, _)| k.to_string()).collect()))
        .unwrap_or_default();
    for id in own.iter().filter(|id| id.as_str() != SERVER_NAME && valid_key(id)) {
        set(&format!("mcp_servers.{id}.enabled"), "false".into());
    }
    Some((args, gw.token))
}

/// A bare TOML key: anything else would need quoting in a dotted `-c` path.
fn valid_key(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ---------------------------------------------------------------- Cursor

/// Cursor names a plugin's servers after its folder (`plugin-<folder>-<server>`),
/// so the folder is called `mali-cowork`: its tools read `plugin-mali-cowork-mali`.
fn cursor_plugin_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("mali-cowork");
    // The first version lived in `cursor-plugin`, which Cursor showed as `plugin-cursor-plugin-mali`.
    let _ = std::fs::remove_dir_all(base.join("cursor-plugin"));
    base.join("cursor").join("mali-cowork")
}

/// A Cursor plugin, passed with `--plugin-dir` to Cursor runs inside Mali
/// only, whose one MCP server is `mali`. Cursor reads MCP from
/// `~/.cursor/mcp.json` wherever its config lives, so a plugin is the only
/// per-run way in; the user's own servers there still load.
pub async fn cursor_plugin() -> Result<PathBuf, String> {
    let gw = gateway::ensure().await?;
    let dir = cursor_plugin_dir();
    std::fs::create_dir_all(dir.join(".cursor-plugin")).map_err(|e| format!("Can't prepare Cursor's plugin: {e}"))?;
    let manifest = json!({
        "name": "mali-cowork",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "The user's connectors, from Mali Cowork (only while Mali runs Cursor).",
    });
    write_private(&dir.join(".cursor-plugin").join("plugin.json"), &manifest.to_string())?;
    write_private(&dir.join("mcp.json"), &cursor_mcp_json(&gw))?;
    Ok(dir)
}

fn cursor_mcp_json(gw: &Gateway) -> String {
    serde_json::to_string_pretty(&json!({
        SERVER_NAME: { "type": "http", "url": gw.url(), "headers": { "Authorization": gw.authorization() } }
    }))
    .unwrap_or_default()
}

// ---------------------------------------------------------------- Antigravity

fn leases() -> &'static Mutex<usize> {
    static LEASES: Mutex<usize> = Mutex::new(0);
    &LEASES
}

fn agy_mcp_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".gemini").join("config").join("mcp_config.json"))
}

/// Put `mali` into Antigravity's config (`Some`), or take it out (`None`).
fn write_antigravity_lease(gw: Option<&Gateway>) -> Result<(), String> {
    let Some(path) = agy_mcp_path() else { return Ok(()) };
    let mut manifest = read_manifest();
    let owned: HashSet<String> = manifest.get(AGY_LEASE).cloned().unwrap_or_default().into_iter().collect();
    if gw.is_none() && owned.is_empty() {
        return Ok(());
    }
    let mut config = match std::fs::read_to_string(&path) {
        Ok(raw) if raw.trim().is_empty() => json!({}),
        Ok(raw) => serde_json::from_str(&raw).map_err(|_| format!("{} isn't plain JSON; not changed", path.display()))?,
        Err(_) if gw.is_none() => return Ok(()),
        Err(_) => json!({}),
    };
    let entries: Vec<(String, Value)> = gw
        .map(|gw| vec![(SERVER_NAME.to_string(), json!({ "serverUrl": gw.url(), "headers": { "Authorization": gw.authorization() } }))])
        .unwrap_or_default();
    let now_owned = merge(&mut config, &entries, &owned)?;
    write_private(&path, &serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?)?;
    manifest.insert(AGY_LEASE.into(), now_owned.clone());

    // A headless run can't prompt: let it call `mali`'s tools, and only while it has them.
    if let Some(settings_path) = antigravity_settings_path() {
        if let Some(mut settings) = read_json(&settings_path) {
            let before = manifest.get(AGY_LEASE_RULES).cloned().unwrap_or_default();
            if let Ok(rules) = merge_allow_rules(&mut settings, &now_owned, &before) {
                if write_private(&settings_path, &serde_json::to_string_pretty(&settings).unwrap_or_default()).is_ok() {
                    manifest.insert(AGY_LEASE_RULES.into(), rules);
                }
            }
        }
    }
    save_manifest(&manifest)
}

/// While held, Antigravity runs see `mali`; the last one to end takes it out.
pub struct AntigravityLease(());

impl Drop for AntigravityLease {
    fn drop(&mut self) {
        let mut count = leases().lock().unwrap();
        *count = count.saturating_sub(1);
        if *count == 0 {
            if let Err(e) = write_antigravity_lease(None) {
                eprintln!("[mcp] couldn't take mali out of Antigravity's config: {e}");
            }
        }
    }
}

/// `mali` for the Antigravity runs from now until the lease is dropped.
pub async fn antigravity_lease() -> Option<AntigravityLease> {
    // Only when Antigravity is set up on this computer.
    let installed = dirs::home_dir().is_some_and(|h| h.join(".gemini").join("antigravity-cli").is_dir());
    if !installed {
        return None;
    }
    let gw = gateway::ensure().await.ok()?;
    let mut count = leases().lock().unwrap();
    if *count == 0 {
        if let Err(e) = write_antigravity_lease(Some(&gw)) {
            eprintln!("[mcp] couldn't give Antigravity the mali connector: {e}");
            return None;
        }
    }
    *count += 1;
    Some(AntigravityLease(()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mali-release-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn opencode_keeps_the_users_own_servers_and_settings() {
        let path = temp(
            "opencode.json",
            r#"{"theme":"dark","mcp":{"custom-notion":{"type":"remote","url":"x"},"mine":{"type":"local","command":["m"]}}}"#,
        );
        let ids: HashSet<String> = ["custom-notion".to_string(), "word".to_string()].into();
        assert!(release_opencode_at(&path, &ids).unwrap());
        let after: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["theme"], "dark");
        assert!(after["mcp"].get("custom-notion").is_none());
        assert!(after["mcp"].get("mine").is_some());
        // Backed up before the first change; nothing to do the second time.
        assert!(path.with_file_name("opencode.json.mali-backup").is_file());
        assert!(!release_opencode_at(&path, &ids).unwrap());
    }

    #[test]
    fn codex_keeps_the_users_own_servers_and_comments() {
        let path = temp(
            "config.toml",
            "model = \"gpt-5\"\n# mine\n[mcp_servers.mine]\ncommand = \"m\"\n\n[mcp_servers.word]\ncommand = \"w\"\n",
        );
        let ids: HashSet<String> = ["word".to_string()].into();
        assert!(release_codex_at(&path, &ids).unwrap());
        let after = std::fs::read_to_string(&path).unwrap();
        assert!(after.contains("model = \"gpt-5\""));
        assert!(after.contains("[mcp_servers.mine]"));
        assert!(!after.contains("[mcp_servers.word]"));
        assert!(path.with_file_name("config.toml.mali-backup").is_file());
    }

    #[test]
    fn only_bare_toml_keys_are_overridden() {
        assert!(valid_key("custom-notion"));
        assert!(!valid_key("my server"));
        assert!(!valid_key("a.b"));
    }

    #[test]
    fn cursor_plugin_has_only_mali() {
        // The shape Cursor's own plugins use (e.g. notion-workspace's mcp.json).
        let gw = Gateway { port: 4321, token: "t0k".into() };
        let servers: Value = serde_json::from_str(&cursor_mcp_json(&gw)).unwrap();
        assert_eq!(servers.as_object().unwrap().len(), 1);
        assert_eq!(servers["mali"]["type"], "http");
        assert_eq!(servers["mali"]["url"], "http://127.0.0.1:4321/mcp");
        assert_eq!(servers["mali"]["headers"]["Authorization"], "Bearer t0k");
    }
}
