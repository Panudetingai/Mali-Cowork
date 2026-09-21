//! Finding public skill collections.
//!
//! There is no registry for skills the way there is for MCP servers — skills
//! are published as folders in Git repositories. So Discover searches GitHub
//! for repositories that tag themselves as skill collections, and the app
//! ships a short curated list for the times searching isn't what you want.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::remote::client;

/// Topics a repository uses to say "there are Agent Skills in here".
const TOPICS: [&str; 2] = ["agent-skills", "claude-skills"];
const PER_TOPIC: usize = 25;

/// A repository that publishes skills.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRepo {
    /// `owner/repo`, which is also its identity in the UI.
    pub name: String,
    pub owner: String,
    pub description: String,
    pub url: String,
    pub stars: u32,
    /// The owner's avatar, shown beside the repository.
    pub avatar: Option<String>,
    pub topics: Vec<String>,
    /// When it was last pushed to, so stale collections are visible as such.
    pub updated: Option<String>,
}

/// A page of results, with what GitHub said about the search budget.
///
/// Searching without a token is allowed ten times a minute, so the count it
/// reports matters as much as the results: the app can stop typing-ahead
/// before it runs out rather than after.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSearch {
    pub repos: Vec<SkillRepo>,
    /// Searches left this minute, as GitHub last reported it.
    pub remaining: Option<u32>,
    /// Seconds until it will answer again; set only when it refused.
    pub retry_after: Option<u64>,
}

#[derive(Deserialize)]
struct SearchPage {
    #[serde(default)]
    items: Vec<Repo>,
}

/// What one topic's search came back with.
enum Outcome {
    Found(Vec<Repo>),
    /// GitHub refused; wait this many seconds.
    RateLimited(u64),
    Failed(String),
}

#[derive(Deserialize)]
struct Repo {
    full_name: String,
    #[serde(default)]
    description: Option<String>,
    html_url: String,
    #[serde(default)]
    stargazers_count: u32,
    #[serde(default)]
    topics: Vec<String>,
    #[serde(default)]
    pushed_at: Option<String>,
    owner: Owner,
}

#[derive(Deserialize)]
struct Owner {
    login: String,
    #[serde(default)]
    avatar_url: Option<String>,
}

impl From<Repo> for SkillRepo {
    fn from(repo: Repo) -> Self {
        SkillRepo {
            name: repo.full_name,
            owner: repo.owner.login,
            description: repo.description.unwrap_or_default(),
            url: repo.html_url,
            stars: repo.stargazers_count,
            avatar: repo.owner.avatar_url,
            topics: repo.topics,
            updated: repo.pushed_at,
        }
    }
}

/// Search GitHub for skill collections, most-starred first.
///
/// An empty query browses the most popular ones. Each topic is a separate
/// search because GitHub reads several `topic:` terms as "all of them".
///
/// Being refused is a normal outcome here, not an error: the caller gets
/// whatever came back plus how long to wait, and can keep showing what it
/// already has.
#[tauri::command]
pub async fn skills_search_repos(query: String) -> Result<SkillSearch, String> {
    let client = client()?;
    let query = query.trim();
    if query.len() > 200 {
        return Err("That search is too long".into());
    }

    let searches = TOPICS.map(|topic| {
        let url = format!(
            "https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page={PER_TOPIC}",
            urlencoding(format!("{query} topic:{topic}").trim()),
        );
        let client = &client;
        async move { search_one(client, &url).await }
    });

    let mut result = SkillSearch::default();
    let mut repos = Vec::new();
    let mut failure = None;
    for (outcome, remaining) in futures::future::join_all(searches).await {
        // The smaller count is the honest one: both searches share the budget.
        result.remaining = match (result.remaining, remaining) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
        match outcome {
            Outcome::Found(items) => repos.extend(items),
            Outcome::RateLimited(secs) => {
                result.retry_after = Some(result.retry_after.map_or(secs, |s: u64| s.max(secs)));
            }
            Outcome::Failed(why) => failure = Some(why),
        }
    }

    // Nothing came back and nothing explains why: that is a real failure.
    if repos.is_empty() && result.retry_after.is_none() {
        if let Some(why) = failure {
            return Err(why);
        }
    }

    let mut found: Vec<SkillRepo> = repos.into_iter().map(SkillRepo::from).collect();
    found.sort_by(|a, b| b.stars.cmp(&a.stars).then_with(|| a.name.cmp(&b.name)));
    found.dedup_by(|a, b| a.name == b.name);
    result.repos = found;
    Ok(result)
}

/// One topic's search, keeping what the response headers say about the budget.
async fn search_one(client: &reqwest::Client, url: &str) -> (Outcome, Option<u32>) {
    let response = match client.get(url).header("Accept", "application/vnd.github+json").send().await {
        Ok(response) => response,
        Err(e) => return (Outcome::Failed(format!("Cannot reach GitHub: {e}")), None),
    };
    let status = response.status();
    let remaining = header_number(&response, "x-ratelimit-remaining").map(|n| n as u32);

    if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return (Outcome::RateLimited(seconds_until_reset(&response)), remaining.or(Some(0)));
    }
    if !status.is_success() {
        return (Outcome::Failed(format!("GitHub returned {status}")), remaining);
    }
    match response.json::<SearchPage>().await {
        Ok(page) => (Outcome::Found(page.items), remaining),
        Err(e) => (Outcome::Failed(e.to_string()), remaining),
    }
}

/// How long GitHub says to wait, from `retry-after` or the reset timestamp.
/// A minute is the window it uses, so that is the fallback and the ceiling.
fn seconds_until_reset(response: &reqwest::Response) -> u64 {
    if let Some(secs) = header_number(response, "retry-after") {
        return secs.clamp(1, 60);
    }
    let Some(reset) = header_number(response, "x-ratelimit-reset") else {
        return 60;
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    reset.saturating_sub(now).clamp(1, 60)
}

fn header_number(response: &reqwest::Response, name: &str) -> Option<u64> {
    response.headers().get(name)?.to_str().ok()?.trim().parse().ok()
}

/// Percent-encode a search term. GitHub's `q` takes `+` for spaces and needs
/// the few characters that would otherwise end the query escaped.
fn urlencoding(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b' ' => out.push('+'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b':' | b'/' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_terms_survive_the_url() {
        assert_eq!(urlencoding("pdf topic:agent-skills"), "pdf+topic:agent-skills");
        assert_eq!(urlencoding("c++ & co"), "c%2B%2B+%26+co");
        assert_eq!(urlencoding("สรุป"), "%E0%B8%AA%E0%B8%A3%E0%B8%B8%E0%B8%9B");
    }

    /// Hits GitHub: `cargo test --lib browses_public_skill_repos -- --ignored`.
    /// Being throttled is not a failure here — that is what the other test
    /// leaves behind when they run together.
    #[tokio::test]
    #[ignore]
    async fn browses_public_skill_repos() {
        let found = skills_search_repos(String::new()).await.unwrap();
        if found.retry_after.is_some() {
            eprintln!("skipped: GitHub is throttling this machine");
            return;
        }
        assert!(found.repos.len() > 5);
        assert!(found.repos.iter().any(|r| r.name == "anthropics/skills"));
        assert!(found.repos.windows(2).all(|w| w[0].stars >= w[1].stars), "sorted by stars");
        assert!(found.remaining.is_some(), "GitHub reports the search budget");
        assert!(found.retry_after.is_none());
    }

    /// Hits GitHub hard enough to be refused, then checks it says so calmly
    /// instead of erroring: `cargo test --lib being_refused -- --ignored`.
    /// This spends the minute's whole search budget, so it is the last thing
    /// to answer for a minute afterwards.
    #[tokio::test]
    #[ignore]
    async fn being_refused_is_an_answer_not_an_error() {
        let mut refused = None;
        for n in 0..12 {
            let found = skills_search_repos(format!("test{n}")).await.expect("never an error");
            if found.retry_after.is_some() {
                refused = Some(found);
                break;
            }
        }
        let found = refused.expect("twelve searches should exhaust ten per minute");
        assert!(matches!(found.retry_after, Some(secs) if (1..=60).contains(&secs)));
    }
}
