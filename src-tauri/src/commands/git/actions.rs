//! Changing the repository from the Changes tab: stage, unstage, discard,
//! commit, and starting a repository.

use std::collections::HashMap;

use serde::Serialize;

use super::runner::Git;
use super::status::{check_path, parse_porcelain};

const MAX_MESSAGE_CHARS: usize = 20_000;

fn paths_arg(paths: &[String]) -> Result<Vec<&str>, String> {
    if paths.is_empty() {
        return Err("No files selected".into());
    }
    paths.iter().map(|p| check_path(p)).collect()
}

/// Stage files, including deletions.
pub async fn stage(git: &Git, paths: &[String]) -> Result<(), String> {
    let mut args = vec!["add", "-A", "--"];
    args.extend(paths_arg(paths)?);
    git.write(&args).await.map(|_| ())
}

/// Stage every change, new files included.
pub async fn stage_all(git: &Git) -> Result<(), String> {
    git.write(&["add", "-A"]).await.map(|_| ())
}

/// Take files out of the next commit, keeping their changes on disk.
pub async fn unstage(git: &Git, paths: &[String]) -> Result<(), String> {
    let paths = paths_arg(paths)?;
    let has_head = git.read(&["rev-parse", "--verify", "--quiet", "HEAD"]).await.is_ok();
    // Before the first commit there's nothing to restore from.
    let mut args = if has_head { vec!["restore", "--staged", "--"] } else { vec!["rm", "--cached", "-r", "-q", "--"] };
    args.extend(paths);
    git.write(&args).await.map(|_| ())
}

/// Throw away unstaged changes: tracked files go back to their staged or
/// committed content, new files are deleted. Staged changes are kept.
pub async fn discard(git: &Git, paths: &[String]) -> Result<(), String> {
    let paths = paths_arg(paths)?;
    let status = git.read(&["status", "--porcelain=v2", "-z", "--untracked-files=all"]).await?;
    let (_, files) = parse_porcelain(&status.stdout);
    let untracked: HashMap<&str, bool> = files.iter().map(|f| (f.path.as_str(), f.untracked)).collect();
    let (new, tracked): (Vec<&str>, Vec<&str>) =
        paths.into_iter().partition(|p| untracked.get(p).copied().unwrap_or(false));
    if !tracked.is_empty() {
        let mut args = vec!["restore", "--worktree", "--"];
        args.extend(tracked);
        git.write(&args).await?;
    }
    if !new.is_empty() {
        let mut args = vec!["clean", "-f", "-q", "--"];
        args.extend(new);
        git.write(&args).await?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub hash: String,
    pub subject: String,
}

/// Commit what's staged; with `stage_all`, stage every change first.
pub async fn commit(git: &Git, message: &str, stage_all_first: bool) -> Result<CommitResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Write a commit message first".into());
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err("The commit message is too long".into());
    }
    if stage_all_first {
        stage_all(git).await?;
    }
    if git.read(&["diff", "--cached", "--quiet"]).await.is_ok() {
        return Err("Nothing is staged to commit".into());
    }
    // The message goes through stdin: any text, any length, never an option.
    git.write_with_input(&["commit", "--file=-", "--cleanup=strip"], message).await?;
    let out = git.read(&["log", "-n", "1", "--format=%h%x1f%s"]).await?;
    let (hash, subject) = out.stdout.trim().split_once('\x1f').unwrap_or(("", ""));
    Ok(CommitResult { hash: hash.to_string(), subject: subject.to_string() })
}

/// Put every change, new files included, on the stash and leave the folder clean.
pub async fn stash(git: &Git) -> Result<String, String> {
    let out = git.write(&["stash", "push", "--include-untracked"]).await?;
    let text = out.stdout.trim();
    if text.is_empty() || text.starts_with("No local changes") {
        return Err("Nothing to stash".into());
    }
    Ok(text.lines().next().unwrap_or("Stashed").to_string())
}

/// Start a repository in `folder`.
pub async fn init(folder: &str) -> Result<(), String> {
    let dir = std::path::Path::new(folder.trim());
    if !dir.is_dir() {
        return Err(format!("{folder} isn't a folder"));
    }
    Git::new(dir).write(&["init"]).await.map(|_| ())
}
