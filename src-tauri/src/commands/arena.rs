//! Epic D — Agent Arena in Cowork (docs/PRD-delight-v0.3.md §6.5): each
//! contender works in its own git worktree, so the user's folder is untouched
//! until they pick a winner, whose changes are then applied as one patch.
//!
//! Git repositories only. The worktrees start from the folder as it is now —
//! uncommitted edits included (`git stash create`, which doesn't touch the
//! working tree); untracked files aren't carried over.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::git::runner::Git;

const MAX_CONTENDERS: usize = 3;

fn arena_root() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("arena")
}

/// Round ids end up in paths.
fn round_dir(id: &str) -> Result<PathBuf, String> {
    let ok = !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if !ok {
        return Err("Invalid Arena round".into());
    }
    Ok(arena_root().join(id))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    /// The repository's top-level folder (the user's).
    repo: String,
    /// The commit every worktree starts from.
    base: String,
    count: usize,
}

fn read_meta(dir: &Path) -> Result<Meta, String> {
    let text = std::fs::read_to_string(dir.join("meta.json")).map_err(|_| "This Arena round is gone".to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaPrepared {
    /// Where each contender works: its worktree, at the same subfolder as the
    /// folder the user picked.
    pub folders: Vec<String>,
    /// Worktree roots, to grant and later revoke folder access for.
    pub roots: Vec<String>,
}

/// An empty folder handed to git as `core.hooksPath`, so creating a worktree
/// doesn't run the repository's checkout hooks.
fn no_hooks_dir() -> Result<PathBuf, String> {
    let dir = arena_root().join(".no-hooks");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Make `count` worktrees of the repository `folder` is in.
#[tauri::command]
pub async fn arena_prepare(id: String, folder: String, count: usize) -> Result<ArenaPrepared, String> {
    if !(2..=MAX_CONTENDERS).contains(&count) {
        return Err(format!("Arena compares 2–{MAX_CONTENDERS} agents"));
    }
    let dir = round_dir(&id)?;
    let folder_path = PathBuf::from(&folder);
    let top = Git::new(&folder_path)
        .read(&["rev-parse", "--show-toplevel"])
        .await
        .map_err(|_| "Arena in Cowork works on Git repositories. Initialize Git in this folder first, or use Chat.".to_string())?;
    let repo = PathBuf::from(top.stdout.trim());
    let git = Git::new(&repo);
    // The folder's current state, uncommitted edits included, without touching it.
    let stash = git.write(&["stash", "create"]).await?.stdout.trim().to_string();
    let base = if stash.is_empty() {
        git.read(&["rev-parse", "HEAD"])
            .await
            .map_err(|_| "This repository has no commits yet. Commit once, then try the Arena.".to_string())?
            .stdout
            .trim()
            .to_string()
    } else {
        stash
    };

    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create the Arena folder: {e}"))?;
    let meta = Meta { repo: repo.to_string_lossy().into_owned(), base: base.clone(), count };
    std::fs::write(dir.join("meta.json"), serde_json::to_string(&meta).unwrap_or_default()).map_err(|e| e.to_string())?;

    let canonical_repo = std::fs::canonicalize(&repo).unwrap_or(repo.clone());
    let sub = std::fs::canonicalize(&folder_path)
        .ok()
        .and_then(|f| f.strip_prefix(&canonical_repo).ok().map(Path::to_path_buf))
        .unwrap_or_default();
    let hooks = no_hooks_dir()?;
    let hooks_arg = format!("core.hooksPath={}", hooks.to_string_lossy());

    let mut folders = Vec::new();
    let mut roots = Vec::new();
    for n in 0..count {
        let tree = dir.join(n.to_string());
        let tree_arg = tree.to_string_lossy().into_owned();
        if let Err(e) = git.write(&["-c", &hooks_arg, "worktree", "add", "--detach", &tree_arg, &base]).await {
            let _ = cleanup(&id).await;
            return Err(format!("Cannot make a copy for the Arena: {e}"));
        }
        folders.push(tree.join(&sub).to_string_lossy().into_owned());
        roots.push(tree_arg);
    }
    Ok(ArenaPrepared { folders, roots })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaApplied {
    /// Files the patch touched.
    pub files: usize,
}

/// Apply what contender `index` changed to the user's repository, as one patch.
/// Fails without changing anything if the folder moved on in the same places.
#[tauri::command]
pub async fn arena_apply(id: String, index: usize) -> Result<ArenaApplied, String> {
    let dir = round_dir(&id)?;
    let meta = read_meta(&dir)?;
    if index >= meta.count {
        return Err("No such contender".into());
    }
    let tree = Git::new(dir.join(index.to_string()));
    // Stage in the worktree's own index, so new files are part of the diff.
    tree.write(&["add", "-A"]).await?;
    let names = tree.read(&["diff", "--cached", "--name-only", &meta.base]).await?;
    let files = names.stdout.lines().filter(|l| !l.trim().is_empty()).count();
    if files == 0 {
        return Ok(ArenaApplied { files: 0 });
    }
    let patch = tree
        .read(&["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--no-color", &meta.base])
        .await?;
    if patch.truncated {
        return Err("These changes are too large to apply from the Arena. Open the contender's chat instead.".into());
    }
    let repo = Git::new(&meta.repo);
    repo.write_with_input(&["apply", "--check", "--binary", "-"], &patch.stdout)
        .await
        .map_err(|e| format!("The folder changed in the same places since the round started, so the winner's changes don't fit anymore ({e})"))?;
    repo.write_with_input(&["apply", "--binary", "-"], &patch.stdout).await?;
    Ok(ArenaApplied { files })
}

async fn cleanup(id: &str) -> Result<(), String> {
    let dir = round_dir(id)?;
    if let Ok(meta) = read_meta(&dir) {
        let repo = Git::new(&meta.repo);
        for n in 0..meta.count {
            let tree = dir.join(n.to_string()).to_string_lossy().into_owned();
            let _ = repo.write(&["worktree", "remove", "--force", &tree]).await;
        }
        let _ = std::fs::remove_dir_all(&dir);
        let _ = repo.write(&["worktree", "prune"]).await;
    } else {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}

/// Remove a round's worktrees.
#[tauri::command]
pub async fn arena_cleanup(id: String) -> Result<(), String> {
    cleanup(&id).await
}

/// At startup: remove every round's worktrees except `keep` (rounds still
/// waiting for a pick), so a crash never leaves copies behind for good.
#[tauri::command]
pub async fn arena_cleanup_stale(keep: Vec<String>) -> Result<usize, String> {
    let Ok(entries) = std::fs::read_dir(arena_root()) else { return Ok(0) };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || keep.contains(&name) {
            continue;
        }
        if cleanup(&name).await.is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git_in(dir: &Path, args: &[&str]) {
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    #[tokio::test]
    async fn a_winner_lands_in_the_real_folder_only_when_applied() {
        let repo = std::env::temp_dir().join(format!("mali-arena-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo);
        std::fs::create_dir_all(repo.join("app")).unwrap();
        git_in(&repo, &["init", "-q"]);
        std::fs::write(repo.join("app/a.txt"), "one\n").unwrap();
        git_in(&repo, &["add", "-A"]);
        git_in(&repo, &["commit", "-q", "-m", "init"]);
        // An uncommitted edit the contenders must start from.
        std::fs::write(repo.join("app/a.txt"), "one\ntwo\n").unwrap();

        let id = format!("test-{}", std::process::id());
        let folder = repo.join("app").to_string_lossy().into_owned();
        let prepared = arena_prepare(id.clone(), folder, 2).await.unwrap();
        assert_eq!(prepared.folders.len(), 2);
        let contender = PathBuf::from(&prepared.folders[1]);
        assert_eq!(std::fs::read_to_string(contender.join("a.txt")).unwrap(), "one\ntwo\n");

        std::fs::write(contender.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        std::fs::write(contender.join("new.txt"), "hi\n").unwrap();
        assert_eq!(std::fs::read_to_string(repo.join("app/a.txt")).unwrap(), "one\ntwo\n", "untouched before apply");

        let applied = arena_apply(id.clone(), 1).await.unwrap();
        assert_eq!(applied.files, 2);
        assert_eq!(std::fs::read_to_string(repo.join("app/a.txt")).unwrap(), "one\ntwo\nthree\n");
        assert_eq!(std::fs::read_to_string(repo.join("app/new.txt")).unwrap(), "hi\n");

        arena_cleanup(id.clone()).await.unwrap();
        assert!(!round_dir(&id).unwrap().exists());
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn round_ids_cannot_escape_the_arena_folder() {
        assert!(round_dir("../../etc").is_err());
        assert!(round_dir("a/b").is_err());
        assert!(round_dir("").is_err());
        assert!(round_dir("3f2a-9c").is_ok());
    }
}
