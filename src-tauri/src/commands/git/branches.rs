//! Local and remote branches: list, switch, create.

use serde::Serialize;

use super::runner::Git;

const FIELD: char = '\x1f';

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// `main`, or `origin/main` for a remote branch.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// The upstream branch was deleted on the remote.
    pub gone: bool,
    /// Last commit: seconds since the Unix epoch, and its subject.
    pub date: i64,
    pub subject: String,
}

pub async fn list(git: &Git) -> Result<Vec<BranchInfo>, String> {
    let format = format!(
        "--format=%(refname){FIELD}%(refname:short){FIELD}%(HEAD){FIELD}%(upstream:short){FIELD}%(upstream:track,nobracket){FIELD}%(committerdate:unix){FIELD}%(subject)"
    );
    let out = git
        .read(&["for-each-ref", "--sort=-committerdate", &format, "refs/heads", "refs/remotes"])
        .await?;
    Ok(parse(&out.stdout))
}

pub fn parse(raw: &str) -> Vec<BranchInfo> {
    raw.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(7, FIELD).collect();
            if f.len() < 7 {
                return None;
            }
            let remote = f[0].starts_with("refs/remotes/");
            // `origin/HEAD` just points at the remote's default branch.
            if remote && f[0].ends_with("/HEAD") {
                return None;
            }
            let (mut ahead, mut behind) = (0, 0);
            for part in f[4].split(", ") {
                if let Some(n) = part.strip_prefix("ahead ") {
                    ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix("behind ") {
                    behind = n.parse().unwrap_or(0);
                }
            }
            Some(BranchInfo {
                name: f[1].to_string(),
                remote,
                current: f[2] == "*",
                upstream: Some(f[3]).filter(|u| !u.is_empty()).map(str::to_string),
                ahead,
                behind,
                gone: f[4] == "gone",
                date: f[5].parse().unwrap_or_default(),
                subject: f[6].to_string(),
            })
        })
        .collect()
}

/// A branch name from the UI: valid for git, and never read as an option.
pub async fn check_name(git: &Git, name: &str) -> Result<(), String> {
    let invalid = || format!("\"{name}\" isn't a valid branch name");
    if name.is_empty() || name.starts_with('-') || name.chars().any(char::is_whitespace) {
        return Err(invalid());
    }
    git.read(&["check-ref-format", "--branch", name]).await.map(|_| ()).map_err(|_| invalid())
}

/// Switch to a local branch, or to a new local branch tracking a remote one.
pub async fn switch(git: &Git, name: &str, remote: bool) -> Result<(), String> {
    check_name(git, name).await?;
    if remote {
        git.write(&["switch", "--track", name]).await?;
    } else {
        git.write(&["switch", name]).await?;
    }
    Ok(())
}

/// Create a branch from the current commit and switch to it.
pub async fn create(git: &Git, name: &str) -> Result<(), String> {
    check_name(git, name).await?;
    git.write(&["switch", "-c", name]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_local_and_remote_branches() {
        let f = FIELD;
        let raw = format!(
            "refs/heads/main{f}main{f}*{f}origin/main{f}ahead 2, behind 1{f}1700000000{f}Fix it\n\
             refs/heads/old{f}old{f} {f}origin/old{f}gone{f}1600000000{f}Old work\n\
             refs/remotes/origin/HEAD{f}origin{f} {f}{f}{f}1700000000{f}x\n\
             refs/remotes/origin/main{f}origin/main{f} {f}{f}{f}1700000000{f}Fix it\n"
        );
        let branches = parse(&raw);
        assert_eq!(branches.len(), 3);
        assert!(branches[0].current);
        assert_eq!((branches[0].ahead, branches[0].behind), (2, 1));
        assert!(branches[1].gone);
        assert!(branches[2].remote);
        assert_eq!(branches[2].name, "origin/main");
    }
}
