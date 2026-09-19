//! The state of a set of folders at one moment, and what changed between two.
//!
//! Each file's content goes into the [`store`](super::store) so it can be put
//! back later. An index per folder remembers the size, modified time and hash
//! seen last time, so only files that changed since are read again: the first
//! checkpoint of a folder reads everything, later ones take moments.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::store;

/// Folders that hold installed or generated files, never the user's work.
const SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "target", ".venv", "venv", "__pycache__",
    ".next", ".nuxt", ".turbo", ".cache", ".gradle", ".idea", "Pods", "DerivedData",
];
const SKIP_FILES: &[&str] = &[".DS_Store", "Thumbs.db", "desktop.ini"];

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_files: usize,
    /// Larger files are listed but not copied, so they can't be restored.
    pub max_file_bytes: u64,
    /// New content copied by one scan; the rest is listed but not copied.
    pub max_new_bytes: u64,
    pub deadline: Instant,
}

/// One file in a snapshot. `hash` is `None` when its content wasn't saved
/// (too large, a secret, over budget); such files are compared by size and
/// modified time and can't be restored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub size: u64,
    /// Modified time in nanoseconds since the Unix epoch.
    pub mtime: i128,
    pub hash: Option<String>,
    #[serde(default)]
    pub mode: u32,
}

impl Entry {
    /// Same content, as far as can be told.
    pub fn same_as(&self, other: &Entry) -> bool {
        match (&self.hash, &other.hash) {
            (Some(a), Some(b)) => a == b,
            _ => self.size == other.size && self.mtime == other.mtime,
        }
    }
}

/// Absolute path → entry.
pub type Manifest = BTreeMap<String, Entry>;

pub struct Scan {
    pub files: Manifest,
    /// Some files were listed without their content.
    pub partial: bool,
}

/// Snapshot every file under `roots`.
pub fn scan(roots: &[PathBuf], limits: &Limits) -> Result<Scan, String> {
    let mut files = Manifest::new();
    let mut partial = false;
    let mut new_bytes = 0u64;
    for root in roots {
        let mut index = load_index(root);
        let mut next_index = HashMap::new();
        let walker = WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !(e.file_type().is_dir() && e.depth() > 0 && skipped_dir(e.file_name())));
        for item in walker {
            if Instant::now() > limits.deadline {
                return Err(format!("{} is too large to save a checkpoint in time", root.display()));
            }
            // Unreadable entries (permissions, removed meanwhile) are left out.
            let Ok(item) = item else { continue };
            if !item.file_type().is_file() || SKIP_FILES.contains(&&*item.file_name().to_string_lossy()) {
                continue;
            }
            if files.len() >= limits.max_files {
                return Err(format!("{} has more than {} files", root.display(), limits.max_files));
            }
            let Ok(meta) = item.metadata() else { continue };
            let path = item.path();
            let key = path.to_string_lossy().into_owned();
            let size = meta.len();
            let mtime = mtime_ns(&meta);
            let mode = file_mode(&meta);

            let cached = index
                .remove(&key)
                .filter(|e| e.size == size && e.mtime == mtime)
                .and_then(|e| e.hash)
                .filter(|h| store::has(h));
            let hash = if let Some(hash) = cached {
                Some(hash)
            } else if size > limits.max_file_bytes
                || crate::commands::attachments::is_sensitive(path)
                || new_bytes + size > limits.max_new_bytes
            {
                partial = true;
                None
            } else {
                match store::put(path) {
                    Ok(hash) => {
                        new_bytes += size;
                        Some(hash)
                    }
                    Err(_) => {
                        partial = true;
                        None
                    }
                }
            };
            let entry = Entry { size, mtime, hash, mode };
            if entry.hash.is_some() {
                next_index.insert(key.clone(), entry.clone());
            }
            files.insert(key, entry);
        }
        save_index(root, &next_index);
    }
    Ok(Scan { files, partial })
}

fn skipped_dir(name: &std::ffi::OsStr) -> bool {
    SKIP_DIRS.contains(&&*name.to_string_lossy())
}

/// A file that differs between two snapshots; `None` means it didn't exist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    pub path: String,
    pub before: Option<Entry>,
    pub after: Option<Entry>,
}

pub fn diff(before: &Manifest, after: &Manifest) -> Vec<Change> {
    let mut changes = Vec::new();
    for (path, old) in before {
        match after.get(path) {
            Some(new) if old.same_as(new) => {}
            new => changes.push(Change { path: path.clone(), before: Some(old.clone()), after: new.cloned() }),
        }
    }
    for (path, new) in after {
        if !before.contains_key(path) {
            changes.push(Change { path: path.clone(), before: None, after: Some(new.clone()) });
        }
    }
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    changes
}

/// The current entry for one file, hashed so it can be compared exactly.
pub fn current(path: &Path) -> Option<Entry> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    Some(Entry {
        size: meta.len(),
        mtime: mtime_ns(&meta),
        hash: store::hash_file(path).ok(),
        mode: file_mode(&meta),
    })
}

fn mtime_ns(meta: &std::fs::Metadata) -> i128 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as i128)
        .unwrap_or_default()
}

fn file_mode(meta: &std::fs::Metadata) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o7777
    }
    #[cfg(not(unix))]
    {
        let _ = meta;
        0
    }
}

fn index_path(root: &Path) -> PathBuf {
    let id = hex::encode(Sha256::digest(root.to_string_lossy().as_bytes()));
    store::root().join("index").join(format!("{id}.json"))
}

fn load_index(root: &Path) -> HashMap<String, Entry> {
    std::fs::read(index_path(root))
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .unwrap_or_default()
}

fn save_index(root: &Path, index: &HashMap<String, Entry>) {
    let path = index_path(root);
    if let Ok(json) = serde_json::to_string(index) {
        let _ = super::write_json(&path, &json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(size: u64, mtime: i128, hash: Option<&str>) -> Entry {
        Entry { size, mtime, hash: hash.map(str::to_string), mode: 0 }
    }

    #[test]
    fn diff_reports_added_modified_and_deleted_files() {
        let before = Manifest::from([
            ("/w/same".into(), entry(1, 1, Some("a"))),
            ("/w/touched".into(), entry(1, 1, Some("a"))),
            ("/w/edited".into(), entry(1, 1, Some("a"))),
            ("/w/gone".into(), entry(1, 1, Some("a"))),
            ("/w/big".into(), entry(9, 1, None)),
        ]);
        let after = Manifest::from([
            ("/w/same".into(), entry(1, 1, Some("a"))),
            // Saved again with the same content: not a change.
            ("/w/touched".into(), entry(1, 2, Some("a"))),
            ("/w/edited".into(), entry(1, 1, Some("b"))),
            ("/w/new".into(), entry(1, 1, Some("c"))),
            // No content saved: the modified time tells.
            ("/w/big".into(), entry(9, 2, None)),
        ]);
        let changes = diff(&before, &after);
        let summary: Vec<(&str, bool, bool)> = changes
            .iter()
            .map(|c| (c.path.as_str(), c.before.is_some(), c.after.is_some()))
            .collect();
        assert_eq!(
            summary,
            [
                ("/w/big", true, true),
                ("/w/edited", true, true),
                ("/w/gone", true, false),
                ("/w/new", false, true),
            ]
        );
    }
}
