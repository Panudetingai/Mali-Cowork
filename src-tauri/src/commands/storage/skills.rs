//! Skill library: find `SKILL.md` files in a Git repository (GitHub), at a
//! URL, or in a folder (e.g. a team's shared drive or a cloned repo), and
//! export skills as `<name>/SKILL.md` folders others can import.
//!
//! Only the Markdown text is read. Scripts or other files a skill folder
//! may bundle are never downloaded or run.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::commands::secure_fs::write_private;

/// A `SKILL.md` is a short guide; anything bigger is not one.
const MAX_SKILL_BYTES: usize = 256 * 1024;
const MAX_SKILLS: usize = 100;
const MAX_SCAN_DEPTH: usize = 6;
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", ".venv", "venv", "dist", "build"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundSkill {
    /// Where it came from (URL or file path), shown in the picker.
    pub source: String,
    /// Name of the folder holding it, a fallback when the file has no `name`.
    pub folder: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ExportSkill {
    pub slug: String,
    pub content: String,
}

fn is_skill_file(name: &str) -> bool {
    name.eq_ignore_ascii_case("SKILL.md")
}

fn folder_of(path: &str) -> String {
    let mut parts: Vec<&str> = path.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    parts.pop();
    parts.pop().unwrap_or_default().to_string()
}

// ---------------------------------------------------------------- URLs / Git

/// What a pasted link points at.
#[derive(Debug, PartialEq)]
enum Source {
    /// A GitHub repository, optionally at a ref and under a sub-folder.
    GithubRepo { owner: String, repo: String, git_ref: Option<String>, dir: String },
    /// A single file.
    File(String),
}

fn parse_source(input: &str) -> Result<Source, String> {
    let input = input.trim();
    // `git@github.com:owner/repo.git`
    let input = match input.strip_prefix("git@github.com:") {
        Some(rest) => format!("https://github.com/{rest}"),
        None => input.to_string(),
    };
    let url = reqwest::Url::parse(&input).map_err(|_| "Enter a link that starts with https://".to_string())?;
    if url.scheme() != "https" {
        return Err("Only https:// links are supported".into());
    }
    let host = url.host_str().unwrap_or_default();
    if host != "github.com" && host != "www.github.com" {
        return Ok(Source::File(url.to_string()));
    }

    let segments: Vec<&str> = url.path_segments().map(|s| s.filter(|p| !p.is_empty()).collect()).unwrap_or_default();
    let [owner, repo, rest @ ..] = segments.as_slice() else {
        return Err("Paste a GitHub repository link, e.g. https://github.com/owner/repo".into());
    };
    let repo = repo.trim_end_matches(".git").to_string();
    let owner = owner.to_string();
    match rest {
        [] => Ok(Source::GithubRepo { owner, repo, git_ref: None, dir: String::new() }),
        ["tree", git_ref, dir @ ..] => Ok(Source::GithubRepo {
            owner,
            repo,
            git_ref: Some(git_ref.to_string()),
            dir: dir.join("/"),
        }),
        ["blob", git_ref, path @ ..] if !path.is_empty() => {
            let path = path.join("/");
            if path.to_ascii_lowercase().ends_with(".md") {
                Ok(Source::File(format!("https://raw.githubusercontent.com/{owner}/{repo}/{git_ref}/{path}")))
            } else {
                Err("That file isn't Markdown. Link a SKILL.md or a folder.".into())
            }
        }
        _ => Err("Paste a link to a repository, a folder (…/tree/…) or a SKILL.md file".into()),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("mali-cowork")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client.get(url).send().await.map_err(|e| format!("Cannot reach {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} returned {status}"));
    }
    if response.content_length().is_some_and(|n| n as usize > MAX_SKILL_BYTES) {
        return Err(format!("{url} is too large to be a skill"));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_SKILL_BYTES {
        return Err(format!("{url} is too large to be a skill"));
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| format!("{url} is not a text file"))
}

#[derive(Deserialize)]
struct RepoInfo {
    default_branch: String,
}

#[derive(Deserialize)]
struct Tree {
    tree: Vec<TreeEntry>,
    #[serde(default)]
    truncated: bool,
}

#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
}

async fn github_json<T: for<'de> Deserialize<'de>>(client: &reqwest::Client, url: &str) -> Result<T, String> {
    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Cannot reach GitHub: {e}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("GitHub couldn't find that repository. Private repositories aren't supported yet; clone it and use “Import from folder”.".into());
    }
    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("GitHub's rate limit was reached. Try again in a while.".into());
    }
    if !status.is_success() {
        return Err(format!("GitHub returned {status}"));
    }
    response.json().await.map_err(|e| e.to_string())
}

async fn fetch_github_repo(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    git_ref: Option<String>,
    dir: &str,
) -> Result<Vec<FoundSkill>, String> {
    let git_ref = match git_ref {
        Some(r) => r,
        None => {
            github_json::<RepoInfo>(client, &format!("https://api.github.com/repos/{owner}/{repo}"))
                .await?
                .default_branch
        }
    };
    let tree: Tree = github_json(
        client,
        &format!("https://api.github.com/repos/{owner}/{repo}/git/trees/{git_ref}?recursive=1"),
    )
    .await?;
    let prefix = if dir.is_empty() { String::new() } else { format!("{}/", dir.trim_end_matches('/')) };
    let paths: Vec<String> = tree
        .tree
        .into_iter()
        .filter(|e| e.kind == "blob" && e.path.starts_with(&prefix))
        .filter(|e| e.path.rsplit('/').next().is_some_and(is_skill_file))
        .map(|e| e.path)
        .take(MAX_SKILLS)
        .collect();
    if paths.is_empty() {
        let hint = if tree.truncated { " (the repository is very large; link its skills folder instead)" } else { "" };
        return Err(format!("No SKILL.md files found in {owner}/{repo}{hint}"));
    }

    let git_ref = git_ref.as_str();
    let fetches = paths.iter().map(|path| {
        let url = format!("https://raw.githubusercontent.com/{owner}/{repo}/{git_ref}/{path}");
        async move {
            let content = fetch_text(client, &url).await?;
            let folder = folder_of(path);
            Ok::<_, String>(FoundSkill {
                source: format!("https://github.com/{owner}/{repo}/blob/{git_ref}/{path}"),
                folder: if folder.is_empty() { repo.to_string() } else { folder },
                content,
            })
        }
    });
    let results = futures::future::join_all(fetches).await;
    let found: Vec<FoundSkill> = results.into_iter().filter_map(Result::ok).collect();
    if found.is_empty() {
        return Err("Couldn't download the SKILL.md files from GitHub".into());
    }
    Ok(found)
}

#[tauri::command]
pub async fn skills_fetch_url(url: String) -> Result<Vec<FoundSkill>, String> {
    let client = client()?;
    match parse_source(&url)? {
        Source::GithubRepo { owner, repo, git_ref, dir } => {
            fetch_github_repo(&client, &owner, &repo, git_ref, &dir).await
        }
        Source::File(file_url) => {
            let content = fetch_text(&client, &file_url).await?;
            let path = reqwest::Url::parse(&file_url).map(|u| u.path().to_string()).unwrap_or_default();
            Ok(vec![FoundSkill { source: file_url, folder: folder_of(&path), content }])
        }
    }
}

// -------------------------------------------------------------------- Folders

fn scan_dir(root: &Path) -> Vec<FoundSkill> {
    let walker = walkdir::WalkDir::new(root)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && e.depth() > 0 && SKIP_DIRS.contains(&name.as_ref()))
        });
    walker
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_skill_file(&e.file_name().to_string_lossy()))
        .filter(|e| e.metadata().is_ok_and(|m| m.len() as usize <= MAX_SKILL_BYTES))
        .filter_map(|e| {
            let content = std::fs::read_to_string(e.path()).ok()?;
            let path = e.path().to_string_lossy().to_string();
            Some(FoundSkill { folder: folder_of(&path), source: path, content })
        })
        .take(MAX_SKILLS)
        .collect()
}

#[tauri::command]
pub async fn skills_scan_folder(folder: String) -> Result<Vec<FoundSkill>, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(format!("{folder} is not a folder"));
    }
    let found = tokio::task::spawn_blocking(move || scan_dir(&root)).await.map_err(|e| e.to_string())?;
    if found.is_empty() {
        return Err("No SKILL.md files found in that folder".into());
    }
    Ok(found)
}

/// A folder name that can't escape the export folder.
fn safe_slug(slug: &str) -> Result<&str, String> {
    let ok = !slug.is_empty()
        && slug.len() <= 200
        && slug != "."
        && slug != ".."
        && !slug.starts_with('.')
        && !slug.ends_with(' ')
        && !slug.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c));
    ok.then_some(slug).ok_or_else(|| format!("Invalid skill folder name: {slug:?}"))
}

/// Write each skill to `<folder>/<slug>/SKILL.md`; returns how many were written.
#[tauri::command]
pub async fn skills_export_folder(folder: String, skills: Vec<ExportSkill>) -> Result<usize, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(format!("{folder} is not a folder"));
    }
    for skill in &skills {
        safe_slug(&skill.slug)?;
        if skill.content.len() > MAX_SKILL_BYTES {
            return Err(format!("{} is too large to export", skill.slug));
        }
    }
    tokio::task::spawn_blocking(move || {
        for skill in &skills {
            write_private(&root.join(&skill.slug).join("SKILL.md"), &skill.content)?;
        }
        Ok(skills.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(owner: &str, repo: &str, git_ref: Option<&str>, dir: &str) -> Source {
        Source::GithubRepo {
            owner: owner.into(),
            repo: repo.into(),
            git_ref: git_ref.map(Into::into),
            dir: dir.into(),
        }
    }

    #[test]
    fn understands_github_links() {
        assert_eq!(parse_source("https://github.com/anthropics/skills").unwrap(), repo("anthropics", "skills", None, ""));
        assert_eq!(
            parse_source("https://github.com/anthropics/skills.git").unwrap(),
            repo("anthropics", "skills", None, "")
        );
        assert_eq!(
            parse_source("git@github.com:anthropics/skills.git").unwrap(),
            repo("anthropics", "skills", None, "")
        );
        assert_eq!(
            parse_source("https://github.com/o/r/tree/main/skills/pdf").unwrap(),
            repo("o", "r", Some("main"), "skills/pdf")
        );
        assert_eq!(
            parse_source("https://github.com/o/r/blob/main/skills/pdf/SKILL.md").unwrap(),
            Source::File("https://raw.githubusercontent.com/o/r/main/skills/pdf/SKILL.md".into())
        );
        assert!(parse_source("https://github.com/o/r/blob/main/run.sh").is_err());
    }

    #[test]
    fn refuses_plain_http_and_junk() {
        assert!(parse_source("http://example.com/SKILL.md").is_err());
        assert!(parse_source("file:///etc/passwd").is_err());
        assert!(parse_source("not a url").is_err());
        assert_eq!(
            parse_source("https://example.com/team/SKILL.md").unwrap(),
            Source::File("https://example.com/team/SKILL.md".into())
        );
    }

    #[test]
    fn slugs_cannot_escape_the_folder() {
        assert!(safe_slug("weekly-report").is_ok());
        assert!(safe_slug("สรุปงาน").is_ok());
        assert!(safe_slug("ส่งงาน-v2").is_ok());
        for bad in ["", "..", ".hidden", "a/b", "a\\b", "../x", "a:b", "x\n"] {
            assert!(safe_slug(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn finds_skill_files_in_a_folder() {
        let root = std::env::temp_dir().join(format!("mali-skills-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(root.join("pdf")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("pdf/SKILL.md"), "---\nname: pdf\n---\nRead PDFs").unwrap();
        std::fs::write(root.join("node_modules/x/SKILL.md"), "skip me").unwrap();
        let found = scan_dir(&root);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].folder, "pdf");
        let _ = std::fs::remove_dir_all(root);
    }

    /// Hits GitHub: `cargo test --lib imports_from_github -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn imports_from_github() {
        let found = skills_fetch_url("https://github.com/anthropics/skills/tree/main/skills/pdf".into())
            .await
            .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].folder, "pdf");
        assert!(found[0].content.starts_with("---"));
    }
}
