//! What's left of Agent Arena, which has been removed: its Cowork rounds ran
//! each contender in a git worktree of the user's repository, kept under
//! `arena_root()`. Those copies (and the worktree entries git keeps for them
//! in the user's repository) are removed at startup, so nothing is left behind.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::git::runner::Git;

fn arena_root() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("arena")
}

/// The part of a round's `meta.json` cleanup needs.
#[derive(Debug, Deserialize)]
struct Meta {
    /// The repository's top-level folder (the user's).
    repo: String,
    count: usize,
}

fn read_meta(dir: &Path) -> Option<Meta> {
    let text = std::fs::read_to_string(dir.join("meta.json")).ok()?;
    serde_json::from_str(&text).ok()
}

async fn remove_round(dir: &Path) {
    if let Some(meta) = read_meta(dir) {
        let repo = Git::new(&meta.repo);
        for n in 0..meta.count {
            let tree = dir.join(n.to_string()).to_string_lossy().into_owned();
            let _ = repo.write(&["worktree", "remove", "--force", &tree]).await;
        }
        let _ = std::fs::remove_dir_all(dir);
        let _ = repo.write(&["worktree", "prune"]).await;
    } else {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Remove every leftover round, then the Arena folder itself.
pub async fn remove_leftovers() {
    let root = arena_root();
    let Ok(entries) = std::fs::read_dir(&root) else { return };
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            remove_round(&entry.path()).await;
        }
    }
    let _ = std::fs::remove_dir(&root);
}
