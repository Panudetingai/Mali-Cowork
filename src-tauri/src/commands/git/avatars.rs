//! Profile pictures of the people who made a GitHub repository's commits.
//!
//! GitHub knows which account made each commit, and so its avatar. The list
//! of recent commits is read with the GitHub CLI (`gh`) when it's signed in,
//! which also covers private repositories, or else from the public API.
//! Only `avatars.githubusercontent.com` URLs are passed on, and each
//! repository is asked at most once every [`CACHE_FOR`].

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::runner::Git;

const CACHE_FOR: Duration = Duration::from_secs(15 * 60);
const TIMEOUT: Duration = Duration::from_secs(10);
const AVATAR_HOST: &str = "https://avatars.githubusercontent.com/";

type Avatars = HashMap<String, String>;

fn cache() -> &'static Mutex<HashMap<String, (Instant, Avatars)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Avatars)>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// Lower-cased commit email → avatar URL, for recent commits. Empty when the
/// repository isn't on GitHub or GitHub can't be reached.
pub async fn avatars(git: &Git) -> Avatars {
    let remotes = git.read(&["remote", "-v"]).await.map(|o| o.stdout).unwrap_or_default();
    let Some(repo) = remotes.split_whitespace().find_map(github_repo) else {
        return Avatars::new();
    };
    if let Some((at, map)) = cache().lock().unwrap().get(&repo) {
        if at.elapsed() < CACHE_FOR {
            return map.clone();
        }
    }
    let path = format!("repos/{repo}/commits?per_page=100");
    let body = match from_gh(&path).await {
        Some(body) => Some(body),
        None => from_api(&path).await,
    };
    let map = body.map(|b| parse(&b)).unwrap_or_default();
    // Remembered even when empty, so a private repo without `gh` isn't asked again and again.
    cache().lock().unwrap().insert(repo, (Instant::now(), map.clone()));
    map
}

/// `owner/name` from a GitHub remote URL (https or ssh).
pub fn github_repo(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = rest.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    let valid = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    (valid(owner) && valid(name) && parts.next().is_none()).then(|| format!("{owner}/{name}"))
}

/// Through the GitHub CLI, signed in as the user.
async fn from_gh(path: &str) -> Option<String> {
    let bin = gh_bin()?;
    let mut cmd = crate::commands::process::command(bin, &["api", path]);
    cmd.env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(TIMEOUT, cmd.output()).await.ok()?.ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The public API: public repositories only.
async fn from_api(path: &str) -> Option<String> {
    let res = reqwest::Client::new()
        .get(format!("https://api.github.com/{path}"))
        .header("User-Agent", "mali-cowork")
        .header("Accept", "application/vnd.github+json")
        .timeout(TIMEOUT)
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.text().await.ok()
}

fn gh_bin() -> Option<&'static str> {
    static BIN: OnceLock<Option<String>> = OnceLock::new();
    BIN.get_or_init(|| {
        let names: &[&str] = if cfg!(windows) { &["gh.exe"] } else { &["gh"] };
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        if cfg!(windows) {
            dirs.push(PathBuf::from(r"C:\Program Files\GitHub CLI"));
        } else {
            dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        }
        dirs.iter()
            .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
            .find(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .as_deref()
}

/// Commits list → email → avatar, for authors and committers.
pub fn parse(body: &str) -> Avatars {
    let mut map = Avatars::new();
    let Ok(Value::Array(commits)) = serde_json::from_str::<Value>(body) else {
        return map;
    };
    for item in &commits {
        for role in ["author", "committer"] {
            let email = item["commit"][role]["email"].as_str().unwrap_or_default().trim().to_lowercase();
            let avatar = item[role]["avatar_url"].as_str().unwrap_or_default();
            if !email.is_empty() && avatar.starts_with(AVATAR_HOST) {
                map.entry(email).or_insert_with(|| avatar.to_string());
            }
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_repository_in_remote_urls() {
        assert_eq!(github_repo("https://github.com/Me/My-Repo.git").as_deref(), Some("Me/My-Repo"));
        assert_eq!(github_repo("git@github.com:me/repo.git").as_deref(), Some("me/repo"));
        assert_eq!(github_repo("ssh://git@github.com/me/repo").as_deref(), Some("me/repo"));
        assert_eq!(github_repo("https://gitlab.com/me/repo.git"), None);
        assert_eq!(github_repo("https://github.com/me/repo/../../x"), None);
    }

    #[test]
    fn keeps_only_github_avatar_urls() {
        let body = r#"[
            {"commit": {"author": {"email": "Ann@X.io"}, "committer": {"email": "noreply@github.com"}},
             "author": {"avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"},
             "committer": {"avatar_url": "https://evil.example/pic.png"}},
            {"commit": {"author": {"email": "ghost@x.io"}}, "author": null}
        ]"#;
        let map = parse(body);
        assert_eq!(map.get("ann@x.io").map(String::as_str), Some("https://avatars.githubusercontent.com/u/1?v=4"));
        assert_eq!(map.len(), 1);
    }
}
