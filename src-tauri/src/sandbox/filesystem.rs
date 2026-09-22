//! The one list of things the agent may never reach, wherever a path shows up.

use std::path::Path;

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
}
