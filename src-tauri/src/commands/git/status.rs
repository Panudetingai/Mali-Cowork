//! Where the repository is and what's changed in it: branch, upstream,
//! staged / unstaged / untracked / conflicted files.

use std::path::{Component, Path};

use serde::Serialize;

use super::runner::Git;

/// Files listed at most; a repo with more (usually build output that isn't
/// ignored) is reported as truncated.
const MAX_FILES: usize = 3_000;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// Branch name; `None` when HEAD is detached.
    pub head: Option<String>,
    /// Short commit id of HEAD; `None` before the first commit.
    pub commit: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusFile {
    /// Path relative to the repository root, with `/`.
    pub path: String,
    /// Old path of a rename or copy.
    pub orig_path: Option<String>,
    /// Staged change: `M`, `A`, `D`, `R`, `C`, `T`; `None` when unstaged only.
    pub staged: Option<char>,
    /// Change in the working folder not yet staged.
    pub unstaged: Option<char>,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    /// Repository root.
    pub root: Option<String>,
    pub branch: Branch,
    pub files: Vec<StatusFile>,
    pub truncated: bool,
    /// `merge`, `rebase`, `cherry-pick` or `revert` in progress.
    pub operation: Option<&'static str>,
    pub remotes: Vec<String>,
}

impl GitStatus {
    fn not_a_repo() -> Self {
        Self {
            is_repo: false,
            root: None,
            branch: Branch::default(),
            files: Vec::new(),
            truncated: false,
            operation: None,
            remotes: Vec::new(),
        }
    }
}

/// The repository containing `folder`, if any.
pub async fn find_root(folder: &str) -> Result<Option<String>, String> {
    let dir = Path::new(folder.trim());
    if !dir.is_dir() {
        return Err(format!("{folder} isn't a folder"));
    }
    // Looked up here rather than by asking git, whose "not a repository"
    // message depends on the user's language.
    if !dir.ancestors().any(|d| d.join(".git").exists()) {
        return Ok(None);
    }
    let out = Git::new(dir).read(&["rev-parse", "--show-toplevel"]).await?;
    Ok(Some(out.stdout.trim().to_string()))
}

/// The repository containing `folder`, or an error saying it isn't one.
pub async fn open(folder: &str) -> Result<Git, String> {
    let root = find_root(folder).await?.ok_or("This folder isn't a Git repository")?;
    Ok(Git::new(root))
}

pub async fn status(folder: &str) -> Result<GitStatus, String> {
    let Some(root) = find_root(folder).await? else {
        return Ok(GitStatus::not_a_repo());
    };
    let git = Git::new(&root);
    let out = git
        .read(&["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])
        .await?;
    let (branch, mut files) = parse_porcelain(&out.stdout);
    let truncated = out.truncated || files.len() > MAX_FILES;
    files.truncate(MAX_FILES);

    let remotes = git
        .read(&["remote"])
        .await
        .map(|o| o.stdout.lines().map(str::to_string).filter(|r| !r.is_empty()).collect())
        .unwrap_or_default();

    Ok(GitStatus {
        is_repo: true,
        operation: operation(&git).await,
        root: Some(root),
        branch,
        files,
        truncated,
        remotes,
    })
}

/// A merge, rebase, cherry-pick or revert waiting to be finished.
async fn operation(git: &Git) -> Option<&'static str> {
    let out = git.read(&["rev-parse", "--absolute-git-dir"]).await.ok()?;
    let dir = Path::new(out.stdout.trim());
    [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ]
    .into_iter()
    .find(|(file, _)| dir.join(file).exists())
    .map(|(_, name)| name)
}

/// Parse `git status --porcelain=v2 --branch -z`.
pub fn parse_porcelain(raw: &str) -> (Branch, Vec<StatusFile>) {
    let mut branch = Branch::default();
    let mut files = Vec::new();
    let mut fields = raw.split('\0').filter(|f| !f.is_empty());
    while let Some(record) = fields.next() {
        if let Some(header) = record.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" if value != "(initial)" => branch.commit = Some(value.chars().take(7).collect()),
                "branch.head" if value != "(detached)" => branch.head = Some(value.to_string()),
                "branch.upstream" => branch.upstream = Some(value.to_string()),
                "branch.ab" => {
                    for part in value.split_whitespace() {
                        if let Some(n) = part.strip_prefix('+') {
                            branch.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            branch.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let kind = record.as_bytes()[0];
        match kind {
            b'1' | b'2' => {
                // `1 XY sub mH mI mW hH hI path`; `2` adds a score, then the old path follows.
                let parts: Vec<&str> = record.splitn(if kind == b'1' { 9 } else { 10 }, ' ').collect();
                let Some(path) = parts.last() else { continue };
                let xy = parts.get(1).copied().unwrap_or("..");
                let orig_path = if kind == b'2' { fields.next().map(str::to_string) } else { None };
                files.push(StatusFile {
                    path: path.to_string(),
                    orig_path,
                    staged: state(xy, 0),
                    unstaged: state(xy, 1),
                    untracked: false,
                    conflicted: false,
                });
            }
            b'u' => {
                let parts: Vec<&str> = record.splitn(11, ' ').collect();
                if let Some(path) = parts.last() {
                    files.push(StatusFile {
                        path: path.to_string(),
                        orig_path: None,
                        staged: None,
                        unstaged: Some('U'),
                        untracked: false,
                        conflicted: true,
                    });
                }
            }
            b'?' => files.push(StatusFile {
                path: record[2..].to_string(),
                orig_path: None,
                staged: None,
                unstaged: Some('?'),
                untracked: true,
                conflicted: false,
            }),
            _ => {}
        }
    }
    (branch, files)
}

fn state(xy: &str, index: usize) -> Option<char> {
    xy.chars().nth(index).filter(|c| *c != '.')
}

/// A path from the UI: relative to the repository, and staying inside it.
pub fn check_path(path: &str) -> Result<&str, String> {
    let p = Path::new(path);
    let inside = !path.is_empty()
        && !p.is_absolute()
        && p.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir));
    inside.then_some(path).ok_or_else(|| format!("Not a file in this repository: {path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_every_kind_of_change() {
        let raw = [
            "# branch.oid 1234567890abcdef",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 M. N... 100644 100644 100644 aaa bbb src/staged file.rs",
            "1 .M N... 100644 100644 100644 aaa bbb notes.md",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new.txt",
            "old.txt",
            "u UU N... 100644 100644 100644 100644 a b c conflict.txt",
            "? รายงาน.docx",
            "",
        ]
        .join("\0");
        let (branch, files) = parse_porcelain(&raw);
        assert_eq!(branch.head.as_deref(), Some("main"));
        assert_eq!(branch.commit.as_deref(), Some("1234567"));
        assert_eq!(branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!((branch.ahead, branch.behind), (2, 1));

        let summary: Vec<(&str, Option<char>, Option<char>)> =
            files.iter().map(|f| (f.path.as_str(), f.staged, f.unstaged)).collect();
        assert_eq!(
            summary,
            [
                ("src/staged file.rs", Some('M'), None),
                ("notes.md", None, Some('M')),
                ("new.txt", Some('R'), None),
                ("conflict.txt", None, Some('U')),
                ("รายงาน.docx", None, Some('?')),
            ]
        );
        assert_eq!(files[2].orig_path.as_deref(), Some("old.txt"));
        assert!(files[3].conflicted);
        assert!(files[4].untracked);
    }

    #[test]
    fn detached_head_and_new_repo() {
        let (branch, _) = parse_porcelain("# branch.oid (initial)\0# branch.head (detached)\0");
        assert_eq!(branch.head, None);
        assert_eq!(branch.commit, None);
    }

    #[test]
    fn paths_must_stay_in_the_repository() {
        assert!(check_path("src/a.rs").is_ok());
        for bad in ["", "/etc/passwd", "../x", "a/../../x"] {
            assert!(check_path(bad).is_err(), "{bad}");
        }
    }
}
