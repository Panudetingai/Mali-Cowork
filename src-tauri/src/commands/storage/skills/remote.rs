//! Reading skills out of a GitHub repository or off a plain https link.
//!
//! Only the `SKILL.md` text is downloaded here. The scripts and references
//! beside it are listed with their sizes so the user can look before
//! installing; [`skills_read_asset`] fetches one of them on demand, and
//! `install` downloads the ones the user kept.

use std::time::Duration;

use serde::Deserialize;

use super::{
    blocked_reason, folder_of, is_skill_file, vet_assets, SkillAsset, SkillPackage, MAX_ASSET_BYTES,
    MAX_SKILLS, MAX_SKILL_BYTES,
};
use super::source::{parse_source, Source};

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("mali-cowork")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Download a text file, refusing anything too big to be skill material.
pub async fn fetch_text(client: &reqwest::Client, url: &str, max: u64) -> Result<String, String> {
    let response = client.get(url).send().await.map_err(|e| format!("Cannot reach {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} returned {status}"));
    }
    if response.content_length().is_some_and(|n| n > max) {
        return Err(format!("{url} is too large"));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max {
        return Err(format!("{url} is too large"));
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| format!("{url} is not a text file"))
}

/// Download a file of any kind, for installing a skill's bundled assets.
pub async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client.get(url).send().await.map_err(|e| format!("Cannot reach {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} returned {status}"));
    }
    if response.content_length().is_some_and(|n| n > MAX_ASSET_BYTES) {
        return Err(format!("{url} is too large"));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err(format!("{url} is too large"));
    }
    Ok(bytes.to_vec())
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
    #[serde(default)]
    size: u64,
}

pub async fn github_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, String> {
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
        return Err("GitHub's rate limit was reached. Try again in a minute.".into());
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
) -> Result<Vec<SkillPackage>, String> {
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
    let blobs: Vec<TreeEntry> = tree
        .tree
        .into_iter()
        .filter(|e| e.kind == "blob" && e.path.starts_with(&prefix))
        .collect();

    // Each SKILL.md defines a skill; everything else under its folder belongs
    // to it, unless a nested skill claims that sub-folder instead.
    let mut roots: Vec<String> = blobs
        .iter()
        .filter(|e| e.path.rsplit('/').next().is_some_and(is_skill_file))
        .map(|e| e.path.rsplit_once('/').map_or(String::new(), |(dir, _)| dir.to_string()))
        .collect();
    roots.sort();
    roots.dedup();
    if roots.is_empty() {
        let hint = if tree.truncated {
            " (the repository is very large; link its skills folder instead)"
        } else {
            ""
        };
        return Err(format!("No SKILL.md files found in {owner}/{repo}{hint}"));
    }
    roots.truncate(MAX_SKILLS);

    let git_ref = git_ref.as_str();
    let raw = |path: &str| format!("https://raw.githubusercontent.com/{owner}/{repo}/{git_ref}/{path}");
    let fetches = roots.iter().map(|root| {
        let skill_path = if root.is_empty() { "SKILL.md".to_string() } else { format!("{root}/SKILL.md") };
        // GitHub keeps the case a repository used, so find the real entry.
        let skill_path = blobs
            .iter()
            .find(|e| e.path.eq_ignore_ascii_case(&skill_path))
            .map_or(skill_path, |e| e.path.clone());
        let files = assets_under(&blobs, root, &roots, &raw);
        let url = raw(&skill_path);
        async move {
            let content = fetch_text(client, &url, MAX_SKILL_BYTES as u64).await?;
            let folder = folder_of(&skill_path);
            Ok::<_, String>(SkillPackage {
                source: format!("https://github.com/{owner}/{repo}/blob/{git_ref}/{skill_path}"),
                folder: if folder.is_empty() { repo.to_string() } else { folder },
                content,
                files,
            })
        }
    });
    let found: Vec<SkillPackage> =
        futures::future::join_all(fetches).await.into_iter().filter_map(Result::ok).collect();
    if found.is_empty() {
        return Err("Couldn't download the SKILL.md files from GitHub".into());
    }
    Ok(found)
}

/// The files belonging to the skill rooted at `root`: everything under it
/// except its own `SKILL.md` and anything a nested skill owns.
fn assets_under(
    blobs: &[TreeEntry],
    root: &str,
    roots: &[String],
    raw: &impl Fn(&str) -> String,
) -> Vec<SkillAsset> {
    let prefix = if root.is_empty() { String::new() } else { format!("{root}/") };
    let nested: Vec<String> = roots
        .iter()
        .filter(|r| r.as_str() != root && r.starts_with(&prefix))
        .map(|r| format!("{r}/"))
        .collect();
    let assets = blobs
        .iter()
        .filter(|e| e.path.starts_with(&prefix))
        .filter(|e| !nested.iter().any(|n| e.path.starts_with(n)))
        .filter_map(|e| {
            let path = e.path[prefix.len()..].to_string();
            (!is_skill_file(&path)).then(|| SkillAsset {
                url: raw(&e.path),
                bytes: e.size,
                skipped: blocked_reason(&path, e.size),
                path,
            })
        })
        .collect();
    vet_assets(assets)
}

/// Skills in a GitHub repository or folder, or a single SKILL.md at any
/// `https` URL.
#[tauri::command]
pub async fn skills_fetch_url(url: String) -> Result<Vec<SkillPackage>, String> {
    let client = client()?;
    match parse_source(&url)? {
        Source::GithubRepo { owner, repo, git_ref, dir } => {
            fetch_github_repo(&client, &owner, &repo, git_ref, &dir).await
        }
        Source::File(file_url) => {
            let content = fetch_text(&client, &file_url, MAX_SKILL_BYTES as u64).await?;
            let path = reqwest::Url::parse(&file_url).map(|u| u.path().to_string()).unwrap_or_default();
            Ok(vec![SkillPackage {
                source: file_url,
                folder: folder_of(&path),
                content,
                files: Vec::new(),
            }])
        }
    }
}

/// Read one of a skill's bundled files so the user can look before installing.
#[tauri::command]
pub async fn skills_read_asset(url: String) -> Result<String, String> {
    if let Some(path) = url.strip_prefix('/') {
        let path = std::path::PathBuf::from(format!("/{path}"));
        let bytes = tokio::fs::metadata(&path).await.map(|m| m.len()).unwrap_or(0);
        if bytes > MAX_ASSET_BYTES {
            return Err("That file is too large to preview".into());
        }
        return tokio::fs::read_to_string(&path)
            .await
            .map_err(|_| "That file isn't text".to_string());
    }
    if !url.starts_with("https://") {
        return Err("Only https:// links can be previewed".into());
    }
    fetch_text(&client()?, &url, MAX_ASSET_BYTES).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hits GitHub: `cargo test --lib remote:: -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn imports_one_skill_with_the_files_it_bundles() {
        let found = skills_fetch_url(
            "https://github.com/obra/superpowers/tree/main/skills/brainstorming".into(),
        )
        .await
        .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].folder, "brainstorming");
        assert!(found[0].content.starts_with("---"));
        let paths: Vec<&str> = found[0].files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.contains(&"scripts/start-server.sh"), "{paths:?}");
        assert!(found[0].files.iter().all(|f| f.url.starts_with("https://raw.githubusercontent.com/")));
    }

    /// A repository of many skills lists each one separately, and a skill's
    /// folder never swallows the one nested inside it.
    #[tokio::test]
    #[ignore]
    async fn imports_a_whole_collection() {
        let found = skills_fetch_url("anthropics/skills".into()).await.unwrap();
        assert!(found.len() > 10, "{} skills", found.len());
        let pdf = found.iter().find(|p| p.folder == "pdf").expect("the pdf skill");
        assert!(pdf.files.iter().all(|f| !is_skill_file(&f.path)));
    }
}
