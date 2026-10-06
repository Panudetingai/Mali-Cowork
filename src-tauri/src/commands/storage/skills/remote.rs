//! Reading skills out of a GitHub repository or off a plain https link.
//!
//! Only the `SKILL.md` text is downloaded here. The scripts and references
//! beside it are listed with their sizes so the user can look before
//! installing; [`skills_read_asset`] fetches one of them on demand, and
//! `install` downloads the ones the user kept.

use std::time::Duration;

use serde::Deserialize;

use super::command;
use super::source::{parse_source, Source};
use super::tree::{front_name, pick_named, Listing};
use super::{folder_of, SkillPackage, MAX_ASSET_BYTES, MAX_SKILLS, MAX_SKILL_BYTES};

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
    fetch_bytes_max(client, url, MAX_ASSET_BYTES).await
}

/// The same, with a size limit of the caller's (a `.docx` template is bigger).
pub async fn fetch_bytes_max(client: &reqwest::Client, url: &str, max: u64) -> Result<Vec<u8>, String> {
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
    Ok(bytes.to_vec())
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

/// Skills in a GitHub repository, under `dir`. With `names`, only those
/// skills — found by folder name, or failing that by the `name` in their
/// front matter — and nothing else is downloaded.
pub async fn fetch_github_repo(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    git_ref: Option<String>,
    dir: &str,
    names: &[String],
) -> Result<Vec<SkillPackage>, String> {
    let listing = Listing::github(client, owner, repo, git_ref).await?;
    let mut roots = listing.skill_roots(dir);
    if roots.is_empty() {
        let hint = if listing.truncated {
            " (the repository is very large; link its skills folder instead)"
        } else {
            ""
        };
        return Err(format!("No SKILL.md files found in {owner}/{repo}{hint}"));
    }
    if names.is_empty() {
        roots.truncate(MAX_SKILLS);
        let found = listing.skill_packages(client, &roots).await;
        if found.is_empty() {
            return Err("Couldn't download the SKILL.md files from GitHub".into());
        }
        return Ok(found);
    }

    let (picked, missing) = pick_named(&roots, names);
    let mut found = listing.skill_packages(client, &picked).await;
    if !missing.is_empty() {
        // Not a folder name: maybe the name a SKILL.md gives itself.
        let rest: Vec<String> = roots.iter().filter(|r| !picked.contains(r)).take(MAX_SKILLS).cloned().collect();
        let others = listing.skill_packages(client, &rest).await;
        let mut still = Vec::new();
        for name in &missing {
            match others.iter().find(|p| front_name(&p.content).is_some_and(|n| n.eq_ignore_ascii_case(name))) {
                Some(p) => found.push(p.clone()),
                None => still.push(name.as_str()),
            }
        }
        if !still.is_empty() {
            return Err(format!("{owner}/{repo} has no skill called {}", still.join(", ")));
        }
    }
    if found.is_empty() {
        return Err("Couldn't download the SKILL.md files from GitHub".into());
    }
    Ok(found)
}

/// Skills in a GitHub repository or folder, or a single SKILL.md at any
/// `https` URL.
#[tauri::command]
pub async fn skills_fetch_url(url: String) -> Result<Vec<SkillPackage>, String> {
    let client = client()?;
    // `npx skillfish add owner/repo name`, as a skill's page shows it.
    let (source, names) = match command::parse(&url)? {
        Some(cmd) => (cmd.source, cmd.names),
        None => (parse_source(&url)?, Vec::new()),
    };
    match source {
        Source::GithubRepo { owner, repo, git_ref, dir } => {
            fetch_github_repo(&client, &owner, &repo, git_ref, &dir, &names).await
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
    use crate::commands::storage::skills::is_skill_file;

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

    /// `npx skillfish add owner/repo name` brings just that skill, from the
    /// repository's own skills folder rather than a translated copy.
    #[tokio::test]
    #[ignore]
    async fn installs_one_skill_by_name_from_a_command() {
        let found = skills_fetch_url("npx skillfish add affaan-m/ecc quarkus-verification".into()).await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].folder, "quarkus-verification");
        assert!(found[0].source.contains("/skills/quarkus-verification/"), "{}", found[0].source);
        assert!(!found[0].source.contains("/docs/"), "{}", found[0].source);
    }
}
