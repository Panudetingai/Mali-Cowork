//! Where the agent may look and write: the folders the user granted this
//! chat, nothing else — and never a credential file, whatever was granted.

use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

/// A folder granted to the chat, as the app sends it (`FolderGrantInput`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderGrant {
    pub path: String,
    /// `read` or `write`.
    pub access: String,
}

#[derive(Debug, Clone)]
struct Grant {
    root: PathBuf,
    write: bool,
}

#[derive(Debug, Clone)]
pub struct Scope {
    pub cwd: PathBuf,
    grants: Vec<Grant>,
}

/// Resolve `.` and `..` without touching the disk (the file may not exist yet).
fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The real path: symlinks resolved on the part that exists, the rest kept.
fn real(path: &Path) -> PathBuf {
    let path = lexical(path);
    let mut existing = path.clone();
    let mut rest = Vec::new();
    while !existing.exists() {
        match (existing.file_name().map(|n| n.to_os_string()), existing.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                existing = parent.to_path_buf();
            }
            _ => return path,
        }
    }
    let mut out = std::fs::canonicalize(&existing).unwrap_or(existing);
    for name in rest.into_iter().rev() {
        out.push(name);
    }
    out
}

impl Scope {
    pub fn new(cwd: &str, folders: &[FolderGrant]) -> Result<Self, String> {
        let cwd = real(Path::new(cwd));
        if !cwd.is_dir() {
            return Err(format!("The working folder {} isn't there any more.", cwd.display()));
        }
        let mut grants: Vec<Grant> = folders
            .iter()
            .filter(|g| !g.path.trim().is_empty())
            .map(|g| Grant { root: real(Path::new(&g.path)), write: g.access == "write" })
            .collect();
        // The working folder is always in reach; the app asked for it before the turn.
        if !grants.iter().any(|g| g.root == cwd) {
            grants.insert(0, Grant { root: cwd.clone(), write: true });
        }
        Ok(Self { cwd, grants })
    }

    /// The absolute path for what the model wrote, if the chat may use it.
    pub fn resolve(&self, raw: &str, write: bool) -> Result<PathBuf, String> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err("No path given.".into());
        }
        let expanded = match raw.strip_prefix("~/") {
            Some(rest) => dirs::home_dir().map(|h| h.join(rest)).unwrap_or_else(|| PathBuf::from(raw)),
            None => PathBuf::from(raw),
        };
        let joined = if expanded.is_absolute() { expanded } else { self.cwd.join(expanded) };
        let path = real(&joined);
        if let Some(reason) = crate::sandbox::permission_rejection_reason("read", path.to_str(), None) {
            return Err(reason.into());
        }
        let grant = self
            .grants
            .iter()
            .filter(|g| path.starts_with(&g.root))
            // The most specific grant decides: a read-only folder inside a writable one stays read-only.
            .max_by_key(|g| g.root.components().count());
        match grant {
            None => Err(format!(
                "{} is outside the folders this chat may use ({}). Work inside them, or ask the user to add the folder to the chat.",
                path.display(),
                self.roots()
            )),
            Some(g) if write && !g.write => {
                Err(format!("{} is in a read-only folder; the user allowed reading it, not changing it.", path.display()))
            }
            Some(_) => Ok(path),
        }
    }

    /// Paths as the model should see them: relative to the working folder when inside it.
    pub fn show(&self, path: &Path) -> String {
        match path.strip_prefix(&self.cwd) {
            Ok(rel) if rel.as_os_str().is_empty() => ".".into(),
            Ok(rel) => rel.display().to_string(),
            Err(_) => path.display().to_string(),
        }
    }

    pub fn roots(&self) -> String {
        self.grants
            .iter()
            .map(|g| format!("{}{}", g.root.display(), if g.write { "" } else { " (read-only)" }))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// A glob (`*`, `**`, `?`, `{a,b}`) as a regex over `/`-separated relative paths.
pub fn glob_regex(pattern: &str) -> Result<regex::Regex, String> {
    let pattern = pattern.trim().trim_start_matches("./");
    // A bare name pattern matches at any depth, like most tools do.
    let pattern = if pattern.contains('/') { pattern.to_string() } else { format!("**/{pattern}") };
    let mut re = String::from("^");
    let chars: Vec<char> = pattern.chars().collect();
    let mut i = 0;
    let mut braces = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '*' if chars.get(i + 1) == Some(&'*') => {
                // `**/` matches zero or more directories.
                if chars.get(i + 2) == Some(&'/') {
                    re.push_str("(?:.*/)?");
                    i += 3;
                } else {
                    re.push_str(".*");
                    i += 2;
                }
                continue;
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            '{' => {
                braces += 1;
                re.push_str("(?:");
            }
            '}' if braces > 0 => {
                braces -= 1;
                re.push(')');
            }
            ',' if braces > 0 => re.push('|'),
            c => re.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    re.push('$');
    regex::Regex::new(&re).map_err(|e| format!("Bad glob pattern: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs() {
        let re = glob_regex("*.ts").unwrap();
        assert!(re.is_match("a.ts"));
        assert!(re.is_match("src/deep/a.ts"));
        assert!(!re.is_match("a.tsx"));
        let re = glob_regex("src/**/*.{ts,tsx}").unwrap();
        assert!(re.is_match("src/a.tsx"));
        assert!(re.is_match("src/x/y/a.ts"));
        assert!(!re.is_match("lib/a.ts"));
    }

    #[test]
    fn scope_keeps_paths_inside_grants() {
        let dir = std::env::temp_dir().join(format!("mali-scope-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(dir.join("ro")).unwrap();
        let scope = Scope::new(
            dir.to_str().unwrap(),
            &[
                FolderGrant { path: dir.to_string_lossy().into(), access: "write".into() },
                FolderGrant { path: dir.join("ro").to_string_lossy().into(), access: "read".into() },
            ],
        )
        .unwrap();
        assert!(scope.resolve("new/file.txt", true).is_ok());
        assert!(scope.resolve("../escape.txt", false).is_err());
        assert!(scope.resolve("ro/a.txt", false).is_ok());
        assert!(scope.resolve("ro/a.txt", true).is_err());
        assert!(scope.resolve("/etc/hosts", false).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
