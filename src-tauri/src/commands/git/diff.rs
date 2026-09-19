//! What changed in one file of the working folder, and a summary of all
//! changes for writing a commit message.

use std::path::Path;

use serde::Serialize;

use super::runner::{Git, DIFF_FLAGS};
use super::status::check_path;
use crate::commands::file_diff::FileDiff;

/// Untracked files larger than this get no line diff.
const MAX_TEXT_BYTES: u64 = 1024 * 1024;
/// Diff text handed to the model that writes the commit message.
const MAX_CONTEXT_CHARS: usize = 12_000;

/// Which side of a file's change to show.
#[derive(Clone, Copy)]
pub enum Area {
    /// Staged, compared with the last commit.
    Staged,
    /// Not staged, compared with what's staged.
    Unstaged,
    /// New file git doesn't track yet.
    Untracked,
    /// Staged and unstaged together, compared with the last commit: what a
    /// commit of everything would contain.
    Head,
}

impl Area {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "staged" => Ok(Self::Staged),
            "unstaged" => Ok(Self::Unstaged),
            "untracked" => Ok(Self::Untracked),
            "head" => Ok(Self::Head),
            other => Err(format!("Unknown diff area: {other}")),
        }
    }
}

pub async fn file_diff(git: &Git, path: &str, orig_path: Option<&str>, area: Area) -> Result<FileDiff, String> {
    check_path(path)?;
    if let Some(orig) = orig_path {
        check_path(orig)?;
    }
    if let Area::Untracked = area {
        return Ok(untracked(&git.root.join(path)));
    }
    let mut args: Vec<&str> = vec!["diff"];
    args.extend_from_slice(DIFF_FLAGS);
    args.push("-M");
    match area {
        Area::Staged => args.push("--cached"),
        // Before the first commit, everything staged is the whole change.
        Area::Head if has_head(git).await => args.push("HEAD"),
        Area::Head => args.push("--cached"),
        _ => {}
    }
    args.push("--");
    args.extend(orig_path);
    args.push(path);
    let out = git.read(&args).await?;
    if out.truncated {
        return Ok(FileDiff::empty("too-large"));
    }
    Ok(FileDiff::parse_unified(&out.stdout))
}

async fn has_head(git: &Git) -> bool {
    git.read(&["rev-parse", "--verify", "--quiet", "HEAD"]).await.is_ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub orig_path: Option<String>,
    /// `added`, `modified`, `deleted`, `renamed` or `conflicted`.
    pub kind: &'static str,
    /// Whole change staged (`true`), none of it (`false`), or part (`None`).
    pub staged: Option<bool>,
    pub untracked: bool,
    /// Lines added/removed against the last commit; `None` for binary files.
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}

/// Untracked files counted line by line at most; the rest show no numbers.
const MAX_COUNTED_UNTRACKED: usize = 500;

/// Every changed file with its line counts against HEAD, for the Changes view.
pub async fn changes(git: &Git) -> Result<Vec<ChangedFile>, String> {
    let status = git.read(&["status", "--porcelain=v2", "-z", "--untracked-files=all"]).await?;
    let (_, files) = super::status::parse_porcelain(&status.stdout);
    let base = if has_head(git).await { "HEAD" } else { "--cached" };
    let numstat = git.read(&["diff", base, "-M", "--numstat", "-z"]).await.map(|o| o.stdout).unwrap_or_default();
    let counts = super::history::parse_numstat(&numstat);
    let mut counted = 0;
    Ok(files
        .into_iter()
        .map(|f| {
            let code = f.staged.or(f.unstaged).unwrap_or('M');
            let kind = if f.conflicted {
                "conflicted"
            } else if f.untracked || code == 'A' {
                "added"
            } else if code == 'D' || f.unstaged == Some('D') {
                "deleted"
            } else if matches!(code, 'R' | 'C') {
                "renamed"
            } else {
                "modified"
            };
            let staged = match (f.staged.is_some(), f.unstaged.is_some()) {
                (true, false) => Some(true),
                (false, _) => Some(false),
                (true, true) => None,
            };
            let (additions, deletions) = if f.untracked {
                counted += 1;
                if counted > MAX_COUNTED_UNTRACKED {
                    (None, None)
                } else {
                    match untracked(&git.root.join(&f.path)) {
                        d if d.kind == "text" => (Some(d.additions), Some(0)),
                        _ => (None, None),
                    }
                }
            } else {
                counts.get(&f.path).copied().unwrap_or((None, None))
            };
            ChangedFile {
                path: f.path,
                orig_path: f.orig_path,
                kind,
                staged,
                untracked: f.untracked,
                additions,
                deletions,
            }
        })
        .collect())
}

/// A new file: every line is an addition.
fn untracked(path: &Path) -> FileDiff {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() > MAX_TEXT_BYTES => return FileDiff::empty("too-large"),
        Ok(_) => {}
        Err(_) => return FileDiff::empty("unavailable"),
    }
    match std::fs::read(path).map(String::from_utf8) {
        Ok(Ok(text)) if !text.contains('\0') => FileDiff::from_texts("", &text),
        Ok(_) => FileDiff::empty("binary"),
        Err(_) => FileDiff::empty("unavailable"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitContext {
    /// Staged changes (or all changes when nothing is staged), cut to a size
    /// a model reads quickly.
    pub diff: String,
    /// Recent commit subjects, so the message matches the repo's style.
    pub recent_subjects: Vec<String>,
    /// Nothing is staged; the commit would take every change.
    pub all_changes: bool,
}

pub async fn commit_context(git: &Git) -> Result<CommitContext, String> {
    let staged = git.read(&["diff", "--cached", "--quiet"]).await.is_err();
    let has_head = git.read(&["rev-parse", "--verify", "--quiet", "HEAD"]).await.is_ok();
    let base: &[&str] = if staged { &["--cached"] } else if has_head { &["HEAD"] } else { &[] };

    let mut stat_args = vec!["diff", "--stat=100"];
    stat_args.extend_from_slice(base);
    let mut patch_args = vec!["diff", "-U2"];
    patch_args.extend_from_slice(DIFF_FLAGS);
    patch_args.extend_from_slice(base);

    let stat = git.read(&stat_args).await.map(|o| o.stdout).unwrap_or_default();
    let patch = git.read(&patch_args).await.map(|o| o.stdout).unwrap_or_default();
    let mut diff = format!("{stat}\n{patch}");
    if !staged {
        let untracked = git
            .read(&["ls-files", "--others", "--exclude-standard"])
            .await
            .map(|o| o.stdout)
            .unwrap_or_default();
        if !untracked.trim().is_empty() {
            diff.push_str("\nNew files:\n");
            diff.push_str(&untracked);
        }
    }
    if diff.len() > MAX_CONTEXT_CHARS {
        let mut cut = MAX_CONTEXT_CHARS;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
        diff.push_str("\n… (diff cut)");
    }
    let recent_subjects = if has_head {
        git.read(&["log", "-n", "8", "--format=%s"])
            .await
            .map(|o| o.stdout.lines().map(str::to_string).collect())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(CommitContext { diff, recent_subjects, all_changes: !staged })
}
