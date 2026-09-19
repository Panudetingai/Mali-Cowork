//! Commits: the log, the files each commit touched, and a file's diff in it.

use serde::Serialize;

use super::runner::{Git, DIFF_FLAGS};
use super::status::check_path;
use crate::commands::file_diff::FileDiff;

const MAX_PAGE: usize = 200;
const FIELD: char = '\x1f';
const RECORD: char = '\x1e';

#[derive(Serialize, Debug, PartialEq)]
pub struct Person {
    pub name: String,
    pub email: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    /// Seconds since the Unix epoch.
    pub date: i64,
    /// Branches and tags pointing here: `HEAD -> main, origin/main, tag: v1`.
    pub refs: Vec<String>,
    pub subject: String,
    pub body: String,
    /// People from `Co-authored-by:` trailers.
    pub co_authors: Vec<Person>,
    /// Files changed and lines added/removed (merges: against the first parent).
    pub files: usize,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub orig_path: Option<String>,
    /// `A`, `M`, `D`, `R`, `C`, `T`.
    pub status: char,
    /// `None` for binary files.
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
}

/// Commits reachable from HEAD, newest first.
pub async fn log(git: &Git, skip: usize, limit: usize) -> Result<Vec<Commit>, String> {
    if git.read(&["rev-parse", "--verify", "--quiet", "HEAD"]).await.is_err() {
        return Ok(Vec::new()); // No commit yet.
    }
    let limit = limit.clamp(1, MAX_PAGE).to_string();
    let skip = skip.to_string();
    // Each record starts with RECORD; `--shortstat` output follows the fields.
    let format = format!("--format={RECORD}%H{FIELD}%h{FIELD}%P{FIELD}%an{FIELD}%ae{FIELD}%at{FIELD}%D{FIELD}%s{FIELD}%b{FIELD}");
    let out = git
        .read(&["log", &format, "--shortstat", "--diff-merges=first-parent", "-n", &limit, "--skip", &skip])
        .await?;
    Ok(parse_log(&out.stdout))
}

pub fn parse_log(raw: &str) -> Vec<Commit> {
    raw.split(RECORD)
        .filter_map(|record| {
            let f: Vec<&str> = record.splitn(10, FIELD).collect();
            if f.len() < 10 {
                return None;
            }
            let (files, additions, deletions) = parse_shortstat(f[9]);
            Some(Commit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                parents: f[2].split_whitespace().map(str::to_string).collect(),
                author: f[3].to_string(),
                email: f[4].to_string(),
                date: f[5].parse().unwrap_or_default(),
                refs: f[6].split(", ").filter(|r| !r.is_empty()).map(str::to_string).collect(),
                subject: f[7].to_string(),
                body: f[8].trim().to_string(),
                co_authors: co_authors(f[8]),
                files,
                additions,
                deletions,
            })
        })
        .collect()
}

/// ` 3 files changed, 7 insertions(+), 5 deletions(-)` → (3, 7, 5).
fn parse_shortstat(text: &str) -> (usize, usize, usize) {
    let mut out = (0, 0, 0);
    for part in text.trim().split(", ") {
        let mut words = part.split_whitespace();
        let (Some(n), Some(what)) = (words.next().and_then(|n| n.parse().ok()), words.next()) else { continue };
        if what.starts_with("file") {
            out.0 = n;
        } else if what.starts_with("insertion") {
            out.1 = n;
        } else if what.starts_with("deletion") {
            out.2 = n;
        }
    }
    out
}

/// `Co-authored-by: Name <email>` trailers.
fn co_authors(body: &str) -> Vec<Person> {
    body.lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            if !key.trim().eq_ignore_ascii_case("co-authored-by") {
                return None;
            }
            let (name, rest) = value.split_once('<').unwrap_or((value, ""));
            let name = name.trim();
            let email = rest.split('>').next().unwrap_or_default().trim();
            (!name.is_empty()).then(|| Person { name: name.to_string(), email: email.to_string() })
        })
        .collect()
}

/// A commit id from the UI: hex only, so it can't be read as an option.
pub fn check_hash(hash: &str) -> Result<&str, String> {
    let ok = (4..=64).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit());
    ok.then_some(hash).ok_or_else(|| format!("Not a commit id: {hash}"))
}

/// `diff-tree` arguments comparing a commit with its first parent (or with
/// nothing, for the first commit).
async fn range(git: &Git, hash: &str) -> Result<Vec<String>, String> {
    let out = git.read(&["rev-list", "--parents", "-n", "1", hash]).await?;
    let ids: Vec<&str> = out.stdout.split_whitespace().collect();
    Ok(match ids.get(1) {
        Some(parent) => vec![parent.to_string(), hash.to_string()],
        None => vec!["--root".into(), hash.to_string()],
    })
}

pub async fn commit_files(git: &Git, hash: &str) -> Result<Vec<CommitFile>, String> {
    check_hash(hash)?;
    let range = range(git, hash).await?;
    let range: Vec<&str> = range.iter().map(String::as_str).collect();
    let mut status_args = vec!["diff-tree", "--no-commit-id", "-r", "-M", "--name-status", "-z"];
    status_args.extend(&range);
    let mut count_args = vec!["diff-tree", "--no-commit-id", "-r", "-M", "--numstat", "-z"];
    count_args.extend(&range);
    let statuses = git.read(&status_args).await?.stdout;
    let counts = git.read(&count_args).await?.stdout;
    Ok(parse_commit_files(&statuses, &counts))
}

/// `--numstat -z` output: path → (additions, deletions); `None` for binary.
pub fn parse_numstat(numstat: &str) -> std::collections::HashMap<String, (Option<usize>, Option<usize>)> {
    // numstat -z: `add\tdel\tpath\0`, or for renames `add\tdel\t\0old\0new\0`.
    let mut counts = std::collections::HashMap::new();
    let mut fields = numstat.split('\0');
    while let Some(field) = fields.next() {
        let mut parts = field.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let path = if path.is_empty() {
            fields.next();
            fields.next().unwrap_or_default()
        } else {
            path
        };
        counts.insert(path.to_string(), (add.parse().ok(), del.parse().ok()));
    }
    counts
}

pub fn parse_commit_files(name_status: &str, numstat: &str) -> Vec<CommitFile> {
    let counts = parse_numstat(numstat);
    // name-status -z: `M\0path\0`, or `R100\0old\0new\0`.
    let mut files = Vec::new();
    let mut fields = name_status.split('\0').filter(|f| !f.is_empty());
    while let Some(code) = fields.next() {
        let status = code.chars().next().unwrap_or('M');
        let (orig_path, path) = if matches!(status, 'R' | 'C') {
            (fields.next().map(str::to_string), fields.next())
        } else {
            (None, fields.next())
        };
        let Some(path) = path else { break };
        let (additions, deletions) = counts.get(path).copied().unwrap_or((None, None));
        files.push(CommitFile { path: path.to_string(), orig_path, status, additions, deletions });
    }
    files
}

pub async fn commit_file_diff(git: &Git, hash: &str, path: &str, orig_path: Option<&str>) -> Result<FileDiff, String> {
    check_hash(hash)?;
    check_path(path)?;
    if let Some(orig) = orig_path {
        check_path(orig)?;
    }
    let range = range(git, hash).await?;
    let mut args: Vec<&str> = vec!["diff-tree", "--no-commit-id", "-r", "-M", "-p"];
    args.extend_from_slice(DIFF_FLAGS);
    args.extend(range.iter().map(String::as_str));
    args.push("--");
    args.extend(orig_path);
    args.push(path);
    let out = git.read(&args).await?;
    if out.truncated {
        return Ok(FileDiff::empty("too-large"));
    }
    Ok(FileDiff::parse_unified(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_records() {
        let raw = format!(
            "{r}abc123{f}abc{f}p1 p2{f}Ann{f}ann@x.io{f}1700000000{f}HEAD -> main, tag: v1{f}Merge it{f}Body line\n\nCo-authored-by: Cursor Agent <a@cursor.com>\n{f}\n\n 3 files changed, 7 insertions(+), 5 deletions(-)\n\
             {r}def456{f}def{f}{f}Bo{f}bo@x.io{f}1600000000{f}{f}First{f}{f}\n\n 1 file changed, 1 insertion(+)\n",
            f = FIELD,
            r = RECORD
        );
        let commits = parse_log(&raw);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].parents, ["p1", "p2"]);
        assert_eq!(commits[0].refs, ["HEAD -> main", "tag: v1"]);
        assert!(commits[0].body.starts_with("Body line"));
        assert_eq!(
            commits[0].co_authors,
            [Person { name: "Cursor Agent".into(), email: "a@cursor.com".into() }]
        );
        assert_eq!((commits[0].files, commits[0].additions, commits[0].deletions), (3, 7, 5));
        assert_eq!((commits[1].files, commits[1].additions, commits[1].deletions), (1, 1, 0));
        assert!(commits[1].parents.is_empty());
        assert!(commits[1].refs.is_empty());
        assert_eq!(commits[1].subject, "First");
    }

    #[test]
    fn parses_files_with_renames_and_binary() {
        let status = "M\0src/a.rs\0R090\0old.md\0new.md\0A\0logo.png\0";
        let counts = "3\t1\tsrc/a.rs\x002\t2\t\0old.md\0new.md\0-\t-\tlogo.png\0";
        let files = parse_commit_files(status, counts);
        assert_eq!(
            files,
            [
                CommitFile { path: "src/a.rs".into(), orig_path: None, status: 'M', additions: Some(3), deletions: Some(1) },
                CommitFile { path: "new.md".into(), orig_path: Some("old.md".into()), status: 'R', additions: Some(2), deletions: Some(2) },
                CommitFile { path: "logo.png".into(), orig_path: None, status: 'A', additions: None, deletions: None },
            ]
        );
    }

    #[test]
    fn hashes_are_hex_only() {
        assert!(check_hash("abc123").is_ok());
        assert!(check_hash("--all").is_err());
        assert!(check_hash("HEAD").is_err());
    }
}
