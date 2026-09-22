use std::fs;
use std::path::{Component, Path, PathBuf};

use thiserror::Error;
use walkdir::WalkDir;

#[derive(Debug, Error)]
pub enum FilesystemError {
    #[error("path is outside the approved workspace")]
    OutsideWorkspace,
    #[error("path traversal, UNC, or device path is not allowed")]
    UnsafePath,
    #[error("sensitive file or directory is blocked by sandbox policy")]
    SensitivePath,
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
}

/// Resolve a user supplied path without allowing it to leave `workspace`.
/// Existing components are canonicalised (following symlinks/junctions); the
/// still-missing tail is then appended. This permits safe creation of a new
/// file while retaining escape protection.
pub fn resolve_workspace_path(workspace: &Path, raw: &Path) -> Result<PathBuf, FilesystemError> {
    if is_device_or_unc(raw) || has_parent_escape(raw) {
        return Err(FilesystemError::UnsafePath);
    }
    let root = fs::canonicalize(workspace)?;
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let resolved = canonicalize_existing_prefix(&candidate)?;
    if !is_within(&resolved, &root) {
        return Err(FilesystemError::OutsideWorkspace);
    }
    if is_sensitive(&resolved) {
        return Err(FilesystemError::SensitivePath);
    }
    Ok(resolved)
}

fn canonicalize_existing_prefix(path: &Path) -> Result<PathBuf, std::io::Error> {
    let mut missing = Vec::new();
    let mut current = path;
    loop {
        match fs::canonicalize(current) {
            Ok(real) => {
                return Ok(missing
                    .iter()
                    .rev()
                    .fold(real, |base, part| base.join(part)))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match (current.parent(), current.file_name()) {
                    (Some(parent), Some(name)) => {
                        missing.push(name.to_os_string());
                        current = parent;
                    }
                    _ => return Err(error),
                }
            }
            Err(error) => return Err(error),
        }
    }
}

fn has_parent_escape(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn is_device_or_unc(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let raw = path.as_os_str().to_string_lossy();
        return raw.starts_with(r"\\") || raw.starts_with(r"\\?\") || raw.starts_with(r"\??\");
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

fn is_within(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let path = path.to_string_lossy().to_ascii_lowercase();
        let root = root
            .to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .to_ascii_lowercase();
        path == root
            || path
                .strip_prefix(&root)
                .is_some_and(|rest| rest.starts_with('/') || rest.starts_with('\\'))
    }
    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}

/// Central policy list: never scatter credential filenames through callers.
pub fn is_sensitive(path: &Path) -> bool {
    const FILES: &[&str] = &["credentials.json", ".netrc", ".npmrc", ".git-credentials"];
    const DIRS: &[&str] = &[
        ".ssh", ".aws", ".azure", ".gcloud", ".gnupg", ".kube", ".docker", ".codex", ".cursor",
        ".gemini", ".antigravity",
    ];
    let names: Vec<String> = path
        .components()
        .filter_map(|part| part.as_os_str().to_str())
        .map(|part| part.to_ascii_lowercase())
        .collect();
    if names.iter().any(|part| DIRS.contains(&part.as_str())) {
        return true;
    }
    let Some(file) = names.last() else {
        return false;
    };
    file == ".env"
        || file.starts_with(".env.")
        || FILES.contains(&file.as_str())
        || ["pem", "key", "p12", "pfx"]
            .iter()
            .any(|ext| file.ends_with(&format!(".{ext}")))
}

pub fn search(
    workspace: &Path,
    query: &str,
    max_results: usize,
) -> Result<Vec<String>, FilesystemError> {
    let root = fs::canonicalize(workspace)?;
    let needle = query.trim().to_ascii_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if is_sensitive(path) {
            continue;
        }
        if entry.file_type().is_file() {
            let name_hit = entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .contains(&needle);
            let content_hit = if name_hit {
                false
            } else {
                file_contains(path, &needle)
            };
            if name_hit || content_hit {
                if let Ok(relative) = path.strip_prefix(&root) {
                    found.push(relative.to_string_lossy().into_owned());
                }
            }
        }
        if found.len() >= max_results.min(200) {
            break;
        }
    }
    Ok(found)
}

fn file_contains(path: &Path, needle: &str) -> bool {
    const MAX_SEARCH_BYTES: u64 = 1024 * 1024;
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if meta.len() > MAX_SEARCH_BYTES {
        return false;
    }
    fs::read_to_string(path)
        .map(|text| text.to_ascii_lowercase().contains(needle))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_names_are_always_denied() {
        for name in [
            ".env",
            ".env.local",
            "id_rsa.pem",
            "CERT.PFX",
            ".ssh/id_rsa",
            ".aws/credentials",
        ] {
            assert!(is_sensitive(Path::new(name)), "{name}");
        }
    }

    #[test]
    fn parent_segments_are_rejected_before_prefix_matching() {
        assert!(has_parent_escape(Path::new("src/../../secret")));
    }

    #[test]
    fn resolver_never_allows_a_workspace_escape() {
        let root =
            std::env::temp_dir().join(format!("mali-sandbox-{}", uuid::Uuid::new_v4().simple()));
        let workspace = root.join("workspace");
        let outside = root.join("outside");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&outside).unwrap();

        assert!(resolve_workspace_path(&workspace, Path::new("src/new.rs")).is_ok());
        assert!(matches!(
            resolve_workspace_path(&workspace, Path::new("../outside/secret.txt")),
            Err(FilesystemError::UnsafePath)
        ));
        assert!(matches!(
            resolve_workspace_path(&workspace, &outside.join("secret.txt")),
            Err(FilesystemError::OutsideWorkspace)
        ));
        let _ = fs::remove_dir_all(root);
    }
}
