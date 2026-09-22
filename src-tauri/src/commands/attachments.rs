//! Files and pictures attached to a prompt.
//!
//! Each attachment is copied into the app's own folder, so it outlives the
//! original, stays readable by sandboxed agents, and agents are only ever
//! handed files from that folder: [`resolve`] refuses any other path.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine;
use serde::Serialize;

const MAX_BYTES: u64 = 20 * 1024 * 1024;
/// Text files up to this size go into the prompt itself.
const MAX_TEXT_BYTES: u64 = 256 * 1024;
/// Attachments older than this are removed on the next import.
const KEEP_FOR: Duration = Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mime: String,
    pub size: u64,
    /// `image`, `video`, `text` (inlined), or `file` (anything else).
    pub kind: &'static str,
}

fn root() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("attachments")
}

/// Copy a file the user picked or dropped.
#[tauri::command]
pub fn attachment_import(path: String) -> Result<Attachment, String> {
    let source = PathBuf::from(&path);
    if is_sensitive(&source) {
        return Err(format!("{} can't be attached: it may hold passwords or keys.", display_name(&source)));
    }
    let meta = std::fs::metadata(&source).map_err(|e| format!("Cannot read {path}: {e}"))?;
    if meta.is_dir() {
        return Err("Folders can't be attached. Add the folder to the chat instead.".into());
    }
    if meta.len() > MAX_BYTES {
        return Err(format!("{} is larger than 20 MB.", display_name(&source)));
    }
    let target = new_slot(&display_name(&source))?;
    std::fs::copy(&source, &target).map_err(|e| format!("Cannot copy {path}: {e}"))?;
    describe(&target)
}

/// Save a pasted picture or file.
#[tauri::command]
pub fn attachment_save(name: String, data: Vec<u8>) -> Result<Attachment, String> {
    if data.len() as u64 > MAX_BYTES {
        return Err(format!("{name} is larger than 20 MB."));
    }
    let target = new_slot(&name)?;
    std::fs::write(&target, &data).map_err(|e| format!("Cannot save {name}: {e}"))?;
    describe(&target)
}

/// A fresh `<root>/<uuid>/<name>` path; also clears out old attachments.
fn new_slot(name: &str) -> Result<PathBuf, String> {
    prune();
    let id = uuid::Uuid::new_v4().simple().to_string();
    let dir = root().join(id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    Ok(dir.join(safe_name(name)))
}

fn prune() {
    let Ok(entries) = std::fs::read_dir(root()) else { return };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > KEEP_FOR);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn describe(path: &Path) -> Result<Attachment, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let mime = mime_for(path);
    let kind = if mime.starts_with("image/") {
        "image"
    } else if mime.starts_with("video/") {
        "video"
    } else if size <= MAX_TEXT_BYTES && looks_like_text(path) {
        "text"
    } else {
        "file"
    };
    let id = path
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Attachment {
        id,
        name: display_name(path),
        path: path.to_string_lossy().into_owned(),
        mime: if kind == "text" && mime == "application/octet-stream" { "text/plain".into() } else { mime.into() },
        size,
        kind,
    })
}

/// An attachment path from the UI, accepted only inside the attachments folder.
pub fn resolve(path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root()).map_err(|_| "No attachments saved yet.".to_string())?;
    let real = std::fs::canonicalize(path).map_err(|_| format!("Attachment not found: {path}"))?;
    if real.starts_with(&root) && real.is_file() {
        Ok(real)
    } else {
        Err(format!("Not an attachment: {path}"))
    }
}

/// `data:<mime>;base64,…` for an attachment, for APIs that take inline files.
pub fn data_url(path: &str) -> Result<(String, String, String), String> {
    let real = resolve(path)?;
    let bytes = std::fs::read(&real).map_err(|e| format!("Cannot read {path}: {e}"))?;
    let mime = mime_for(&real).to_string();
    let url = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
    Ok((url, mime, display_name(&real)))
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into())
}

/// Keep the name readable but free of path tricks and characters shells or
/// CLIs might trip on.
fn safe_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || "._- ".contains(c) { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() { "file".into() } else { cleaned.chars().take(120).collect() }
}

/// Keys, credentials and agent configs never leave the machine as attachments.
pub(crate) fn is_sensitive(path: &Path) -> bool {
    const DIRS: &[&str] = &[".ssh", ".aws", ".gnupg", ".docker", ".kube", ".codex", ".cursor", ".gemini", ".antigravity"];
    const FILES: &[&str] = &[".netrc", ".npmrc", ".git-credentials", ".env", "auth.json", "id_rsa", "id_ed25519"];
    let name = display_name(path).to_ascii_lowercase();
    FILES.contains(&name.as_str())
        || name.starts_with(".env.")
        || path.components().any(|c| DIRS.contains(&c.as_os_str().to_string_lossy().as_ref()))
}

fn looks_like_text(path: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let mut head = vec![0u8; 8192];
    let Ok(read) = file.read(&mut head) else { return false };
    head.truncate(read);
    // A multibyte character may be cut at the end of the sample.
    !head.contains(&0)
        && match std::str::from_utf8(&head) {
            Ok(_) => true,
            Err(e) => e.error_len().is_none(),
        }
}

pub fn mime_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        "md" | "markdown" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "txt" | "log" => "text/plain",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_lose_paths_and_odd_characters() {
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("report (final)&v2.pdf"), "report _final__v2.pdf");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name(""), "file");
        assert_eq!(safe_name("รูป ภาพ.png"), "รูป ภาพ.png");
    }

    #[test]
    fn secrets_are_refused() {
        assert!(is_sensitive(Path::new("/Users/me/.ssh/id_ed25519")));
        assert!(is_sensitive(Path::new("/proj/.env")));
        assert!(is_sensitive(Path::new("/proj/.env.local")));
        assert!(is_sensitive(Path::new("/Users/me/.aws/credentials")));
        assert!(!is_sensitive(Path::new("/Users/me/Desktop/photo.png")));
    }

    #[test]
    fn saved_files_are_classified_and_only_they_resolve() {
        let text = attachment_save("notes.md".into(), "# hi\nสวัสดี".as_bytes().to_vec()).unwrap();
        assert_eq!(text.kind, "text");
        let image = attachment_save("shot.png".into(), vec![0x89, b'P', b'N', b'G', 0, 1]).unwrap();
        assert_eq!(image.kind, "image");
        let binary = attachment_save("blob.bin".into(), vec![0, 1, 2, 3]).unwrap();
        assert_eq!(binary.kind, "file");

        assert!(resolve(&image.path).is_ok());
        let (url, mime, _) = data_url(&image.path).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert_eq!(mime, "image/png");

        let outside = std::env::temp_dir().join(format!("mali-outside-{}.txt", uuid::Uuid::new_v4().simple()));
        std::fs::write(&outside, "secret").unwrap();
        assert!(resolve(&outside.to_string_lossy()).is_err());
        let escape = format!("{}/../../outside.txt", text.path);
        assert!(resolve(&escape).is_err());
        let _ = std::fs::remove_file(outside);
        for a in [text, image, binary] {
            let _ = std::fs::remove_dir_all(Path::new(&a.path).parent().unwrap());
        }
    }
}
