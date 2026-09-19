//! Git for the Cowork folder: the Git panel's backend.
//!
//! Each file has one job:
//! - [`runner`]: runs `git` safely (no prompts, repo config can't run
//!   programs, timeouts, output cap).
//! - [`status`]: repository, branch, changed files.
//! - [`diff`]: one file's working-folder diff; context for commit messages.
//! - [`actions`]: stage, unstage, discard, commit, init.
//! - [`history`]: log, a commit's files and diffs.
//! - [`branches`]: list, switch, create.
//! - [`remote`]: fetch, pull, push.
//! - [`avatars`]: GitHub profile pictures of commit authors.
//!
//! Every command takes the folder the chat works in; git finds the
//! repository around it. Paths, commit ids and branch names from the UI are
//! checked before they reach git.

mod actions;
mod avatars;
mod branches;
mod diff;
mod history;
mod remote;
mod runner;
mod status;

use actions::CommitResult;
use branches::BranchInfo;
use diff::{Area, ChangedFile, CommitContext};
use history::{Commit, CommitFile};
use remote::SyncResult;
use status::{open, GitStatus};

use crate::commands::file_diff::FileDiff;

#[tauri::command]
pub async fn git_status(folder: String) -> Result<GitStatus, String> {
    status::status(&folder).await
}

#[tauri::command]
pub async fn git_init(folder: String) -> Result<(), String> {
    actions::init(&folder).await
}

#[tauri::command]
pub async fn git_file_diff(
    folder: String,
    path: String,
    orig_path: Option<String>,
    area: String,
) -> Result<FileDiff, String> {
    let git = open(&folder).await?;
    diff::file_diff(&git, &path, orig_path.as_deref(), Area::parse(&area)?).await
}

#[tauri::command]
pub async fn git_changes(folder: String) -> Result<Vec<ChangedFile>, String> {
    diff::changes(&open(&folder).await?).await
}

#[tauri::command]
pub async fn git_stage(folder: String, paths: Vec<String>) -> Result<(), String> {
    actions::stage(&open(&folder).await?, &paths).await
}

#[tauri::command]
pub async fn git_stage_all(folder: String) -> Result<(), String> {
    actions::stage_all(&open(&folder).await?).await
}

#[tauri::command]
pub async fn git_unstage(folder: String, paths: Vec<String>) -> Result<(), String> {
    actions::unstage(&open(&folder).await?, &paths).await
}

#[tauri::command]
pub async fn git_discard(folder: String, paths: Vec<String>) -> Result<(), String> {
    actions::discard(&open(&folder).await?, &paths).await
}

#[tauri::command]
pub async fn git_commit(folder: String, message: String, stage_all: bool) -> Result<CommitResult, String> {
    actions::commit(&open(&folder).await?, &message, stage_all).await
}

#[tauri::command]
pub async fn git_commit_context(folder: String) -> Result<CommitContext, String> {
    diff::commit_context(&open(&folder).await?).await
}

#[tauri::command]
pub async fn git_log(folder: String, skip: usize, limit: usize) -> Result<Vec<Commit>, String> {
    history::log(&open(&folder).await?, skip, limit).await
}

#[tauri::command]
pub async fn git_commit_files(folder: String, hash: String) -> Result<Vec<CommitFile>, String> {
    history::commit_files(&open(&folder).await?, &hash).await
}

#[tauri::command]
pub async fn git_commit_file_diff(
    folder: String,
    hash: String,
    path: String,
    orig_path: Option<String>,
) -> Result<FileDiff, String> {
    history::commit_file_diff(&open(&folder).await?, &hash, &path, orig_path.as_deref()).await
}

/// Lower-cased email → GitHub avatar URL for the repo's recent commit authors.
#[tauri::command]
pub async fn git_avatars(folder: String) -> Result<std::collections::HashMap<String, String>, String> {
    Ok(avatars::avatars(&open(&folder).await?).await)
}

#[tauri::command]
pub async fn git_branches(folder: String) -> Result<Vec<BranchInfo>, String> {
    branches::list(&open(&folder).await?).await
}

#[tauri::command]
pub async fn git_switch_branch(folder: String, name: String, remote: bool) -> Result<(), String> {
    branches::switch(&open(&folder).await?, &name, remote).await
}

#[tauri::command]
pub async fn git_create_branch(folder: String, name: String) -> Result<(), String> {
    branches::create(&open(&folder).await?, &name).await
}

#[tauri::command]
pub async fn git_fetch(folder: String) -> Result<SyncResult, String> {
    remote::fetch(&open(&folder).await?).await
}

#[tauri::command]
pub async fn git_pull(folder: String) -> Result<SyncResult, String> {
    remote::pull(&open(&folder).await?).await
}

#[tauri::command]
pub async fn git_push(folder: String) -> Result<SyncResult, String> {
    remote::push(&open(&folder).await?).await
}

#[cfg(test)]
mod tests {
    //! Against a real repository in a temp folder.
    use super::*;

    async fn repo() -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("mali-git-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let folder = dir.to_string_lossy().into_owned();
        git_init(folder.clone()).await.unwrap();
        let git = runner::Git::new(&dir);
        git.write(&["config", "user.name", "Test"]).await.unwrap();
        git.write(&["config", "user.email", "t@example.com"]).await.unwrap();
        git.write(&["config", "commit.gpgsign", "false"]).await.unwrap();
        (dir, folder)
    }

    #[tokio::test]
    async fn stage_commit_history_branch_and_discard() {
        if runner::git_bin().is_none() {
            return;
        }
        let (dir, folder) = repo().await;
        assert!(git_status(std::env::temp_dir().join("no-such").to_string_lossy().into()).await.is_err());

        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(dir.join("ไทย.md"), "# hi\n").unwrap();
        let status = git_status(folder.clone()).await.unwrap();
        assert!(status.is_repo);
        assert!(status.files.iter().all(|f| f.untracked));

        // Untracked diff: every line added.
        let diff = git_file_diff(folder.clone(), "a.txt".into(), None, "untracked".into()).await.unwrap();
        assert_eq!(diff.additions, 2);

        // Nothing staged: "stage all & commit".
        let first = git_commit(folder.clone(), "Initial commit".into(), true).await.unwrap();
        assert_eq!(first.subject, "Initial commit");

        std::fs::write(dir.join("a.txt"), "one\n2\n").unwrap();
        git_stage(folder.clone(), vec!["a.txt".into()]).await.unwrap();
        let staged = git_file_diff(folder.clone(), "a.txt".into(), None, "staged".into()).await.unwrap();
        assert_eq!((staged.additions, staged.deletions), (1, 1));
        let context = git_commit_context(folder.clone()).await.unwrap();
        assert!(!context.all_changes);
        assert!(context.diff.contains("-two"));
        assert_eq!(context.recent_subjects, ["Initial commit"]);

        git_unstage(folder.clone(), vec!["a.txt".into()]).await.unwrap();
        let status = git_status(folder.clone()).await.unwrap();
        assert_eq!(status.files[0].staged, None);
        assert_eq!(status.files[0].unstaged, Some('M'));

        std::fs::write(dir.join("b.txt"), "x\ny\n").unwrap();
        let changes = git_changes(folder.clone()).await.unwrap();
        let summary: Vec<(&str, &str, Option<usize>)> =
            changes.iter().map(|c| (c.path.as_str(), c.kind, c.additions)).collect();
        assert_eq!(summary, [("a.txt", "modified", Some(1)), ("b.txt", "added", Some(2))]);
        let head = git_file_diff(folder.clone(), "a.txt".into(), None, "head".into()).await.unwrap();
        assert_eq!((head.additions, head.deletions), (1, 1));
        std::fs::remove_file(dir.join("b.txt")).unwrap();

        git_commit(folder.clone(), "Change a\n\nDetails".into(), true).await.unwrap();
        let log = git_log(folder.clone(), 0, 10).await.unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].body, "Details");
        assert_eq!((log[0].files, log[0].additions, log[0].deletions), (1, 1, 1));
        let files = git_commit_files(folder.clone(), log[0].hash.clone()).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!((files[0].additions, files[0].deletions), (Some(1), Some(1)));
        let first_files = git_commit_files(folder.clone(), log[1].hash.clone()).await.unwrap();
        assert_eq!(first_files.len(), 2, "the first commit lists every file");
        let commit_diff = git_commit_file_diff(folder.clone(), log[0].hash.clone(), "a.txt".into(), None).await.unwrap();
        assert_eq!(commit_diff.additions, 1);

        git_create_branch(folder.clone(), "feature/x".into()).await.unwrap();
        assert!(git_create_branch(folder.clone(), "--force".into()).await.is_err());
        let branches = git_branches(folder.clone()).await.unwrap();
        assert!(branches.iter().any(|b| b.name == "feature/x" && b.current));
        let main = branches.iter().find(|b| !b.current).unwrap().name.clone();
        git_switch_branch(folder.clone(), main, false).await.unwrap();

        // Discard: tracked edits revert, new files go away.
        std::fs::write(dir.join("a.txt"), "changed").unwrap();
        std::fs::write(dir.join("new.txt"), "x").unwrap();
        git_discard(folder.clone(), vec!["a.txt".into(), "new.txt".into()]).await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "one\n2\n");
        assert!(!dir.join("new.txt").exists());
        assert!(git_discard(folder.clone(), vec!["../outside".into()]).await.is_err());

        // No remote: push explains instead of failing obscurely.
        let push = git_push(folder.clone()).await.unwrap_err();
        assert!(push.contains("no remote"), "{push}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn a_plain_folder_is_not_a_repo() {
        let dir = std::env::temp_dir().join(format!("mali-nogit-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let status = git_status(dir.to_string_lossy().into()).await.unwrap();
        assert!(!status.is_repo);
        let _ = std::fs::remove_dir_all(dir);
    }
}
