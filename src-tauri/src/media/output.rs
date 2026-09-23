//! Where generated pictures and clips are written, and under what name.

use std::path::{Path, PathBuf};

/// One finished file, still in memory.
pub struct Produced {
    pub bytes: Vec<u8>,
    /// Without the dot: `png`, `jpg`, `mp4`, …
    pub extension: String,
}

impl Produced {
    pub fn new(bytes: Vec<u8>, extension: impl Into<String>) -> Self {
        Self { bytes, extension: extension.into() }
    }
}

/// Guess the extension from a MIME type, falling back to `default`.
pub fn extension_for(mime: Option<&str>, default: &str) -> String {
    let mime = mime.unwrap_or_default().split(';').next().unwrap_or_default().trim();
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        _ => default,
    }
    .to_string()
}

/// The extension a download URL implies, when it carries one we know.
pub fn extension_from_url(url: &str, default: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let ext = path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    const KNOWN: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov"];
    if KNOWN.contains(&ext.as_str()) {
        return if ext == "jpeg" { "jpg".into() } else { ext };
    }
    default.to_string()
}

/// The app's own folder for generated media, used when the caller names none.
///
/// It sits beside the attachments folder rather than in the user's working
/// folder: a picture is made on the way to an answer, and an agent that drops
/// files into a repository it was only asked a question about is a nuisance.
/// Callers that do want it in the workspace pass `output_dir`.
pub fn default_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("MALI_MEDIA_DIR").map(PathBuf::from) {
        if !dir.as_os_str().is_empty() {
            return dir;
        }
    }
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("generated-media")
}

/// Keep a caller-supplied folder to somewhere sane: an absolute path, no `..`.
pub fn resolve_dir(requested: Option<&str>) -> Result<PathBuf, String> {
    let Some(raw) = requested.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(default_dir());
    };
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(format!("output_dir must be an absolute path, got {raw}"));
    }
    if path.components().any(|c| c.as_os_str() == "..") {
        return Err(format!("output_dir must not contain '..', got {raw}"));
    }
    Ok(path)
}

/// A short, file-system-safe stem taken from the prompt, so a folder of
/// generated pictures can be read without opening every one of them.
fn stem_from(prompt: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in prompt.chars() {
        if out.chars().count() >= 40 {
            break;
        }
        if ch.is_alphanumeric() {
            // Keeps Thai and other non-Latin prompts readable in the name.
            out.extend(ch.to_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "generated".into()
    } else {
        trimmed
    }
}

/// Write every file, returning the paths. Names never overwrite: a `-2`, `-3`
/// … is appended until the name is free.
pub fn save_all(dir: &Path, prompt: &str, files: &[Produced]) -> Result<Vec<PathBuf>, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    let stem = stem_from(prompt);
    let mut paths = Vec::new();
    for file in files {
        let path = free_path(dir, &stem, &file.extension);
        std::fs::write(&path, &file.bytes)
            .map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
        paths.push(path);
    }
    Ok(paths)
}

fn free_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{extension}"));
    if !first.exists() {
        return first;
    }
    for n in 2..10_000 {
        let candidate = dir.join(format!("{stem}-{n}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}.{extension}", uuid::Uuid::new_v4().simple()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_from_the_prompt_and_stay_safe() {
        assert_eq!(stem_from("A cat wearing a hat!"), "a-cat-wearing-a-hat");
        assert_eq!(stem_from("  ../../etc/passwd  "), "etc-passwd");
        assert_eq!(stem_from("!!!"), "generated");
        assert_eq!(stem_from("วาดรูปแมว"), "วาดรูปแมว");
        assert!(stem_from(&"x".repeat(200)).chars().count() <= 40);
    }

    #[test]
    fn a_caller_cannot_aim_the_output_somewhere_else() {
        assert!(resolve_dir(Some("relative/path")).is_err());
        assert!(resolve_dir(Some("/tmp/../etc")).is_err());
        assert_eq!(resolve_dir(Some("/tmp/pics")).unwrap(), PathBuf::from("/tmp/pics"));
        assert_eq!(resolve_dir(Some("  ")).unwrap(), default_dir());
        assert_eq!(resolve_dir(None).unwrap(), default_dir());
    }

    #[test]
    fn extensions_come_from_the_mime_type_or_the_url() {
        assert_eq!(extension_for(Some("image/png"), "bin"), "png");
        assert_eq!(extension_for(Some("image/jpeg; charset=x"), "bin"), "jpg");
        assert_eq!(extension_for(None, "png"), "png");
        assert_eq!(extension_from_url("https://x/y/a.MP4?token=1", "bin"), "mp4");
        assert_eq!(extension_from_url("https://x/y/a.jpeg", "bin"), "jpg");
        assert_eq!(extension_from_url("https://x/files/abc", "mp4"), "mp4");
    }

    #[test]
    fn saving_twice_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("mali-media-{}", uuid::Uuid::new_v4().simple()));
        let one = || vec![Produced::new(b"x".to_vec(), "png")];
        let first = save_all(&dir, "a cat", &one()).unwrap();
        let second = save_all(&dir, "a cat", &one()).unwrap();
        assert_eq!(first[0].file_name().unwrap(), "a-cat.png");
        assert_eq!(second[0].file_name().unwrap(), "a-cat-2.png");
        let _ = std::fs::remove_dir_all(dir);
    }
}
