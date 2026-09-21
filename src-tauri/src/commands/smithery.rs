//! Smithery (<https://smithery.ai>): a catalogue of MCP servers and Agent
//! Skills, searched with the user's own API key.
//!
//! This is an extra place to look, never a replacement — the official MCP
//! Registry and GitHub stay in place for anyone who doesn't connect it.
//!
//! Nothing here installs anything. A skill comes back with the Git URL it
//! was published from, which goes through the same preview-and-install path
//! as any other skill; a server comes back with its connection details, which
//! go through the same install dialog as the official registry. So whatever
//! Smithery says about a package still has to survive the checks already in
//! place before it can run.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const BASE: &str = "https://api.smithery.ai";
/// A page big enough to fill the list without asking for the world.
const PAGE_SIZE: u32 = 30;
const MAX_QUERY: usize = 200;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("mali-cowork")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

/// An API key that can go in a header without breaking the request.
fn clean_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("Enter your Smithery API key".into());
    }
    if key.len() > 500 || key.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("That doesn't look like a Smithery API key".into());
    }
    Ok(key)
}

async fn get<T: for<'de> Deserialize<'de>>(key: &str, full_path: &str) -> Result<T, String> {
    // Just the endpoint, for error messages — the query may hold a search term.
    let path = full_path.split('?').next().unwrap_or(full_path);
    let response = client()?
        .get(format!("{BASE}{full_path}"))
        .bearer_auth(clean_key(key)?)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Cannot reach Smithery: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("Smithery refused that API key. Check it in your Smithery account settings.".into());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Smithery is rate limiting this key. Try again shortly.".into());
    }
    if !status.is_success() {
        return Err(format!("Smithery returned {status}"));
    }

    // Parsed from the text rather than straight off the wire: when Smithery
    // changes a field, serde names it, and the message says which one instead
    // of just "error decoding response body".
    let body = response.text().await.map_err(|e| format!("Cannot read Smithery's reply: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("Smithery sent something unexpected ({path}): {e}"))
}

/// Percent-encode one query value.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn search_path(kind: &str, query: &str, page: u32) -> Result<String, String> {
    let query = query.trim();
    if query.len() > MAX_QUERY {
        return Err("That search is too long".into());
    }
    let page = page.clamp(1, 100);
    Ok(format!("/{kind}?q={}&page={page}&pageSize={PAGE_SIZE}", encode(query)))
}

// ------------------------------------------------------------------ Account

#[derive(Debug, Deserialize)]
struct Namespaces {
    #[serde(default)]
    namespaces: Vec<Namespace>,
}

#[derive(Debug, Deserialize)]
struct Namespace {
    #[serde(default)]
    name: Option<String>,
}

/// Who the key belongs to, as far as Smithery will say.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryAccount {
    /// The namespaces this key can publish under; empty is normal for a
    /// personal key that has published nothing.
    pub namespaces: Vec<String>,
}

/// Check an API key against Smithery.
///
/// Browsing happens to work without a key today, but the account endpoint is
/// the only one that actually answers "is this key real?" — so that is what a
/// key is checked against, rather than a search that would pass regardless.
#[tauri::command]
pub async fn smithery_check_key(key: String) -> Result<SmitheryAccount, String> {
    let found: Namespaces = get(&key, "/namespaces").await?;
    Ok(SmitheryAccount {
        namespaces: found.namespaces.into_iter().filter_map(|n| n.name).collect(),
    })
}

// ------------------------------------------------------------------- Paging

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pagination {
    #[serde(default)]
    current_page: Option<u32>,
    #[serde(default)]
    total_pages: Option<u32>,
    #[serde(default)]
    total_count: Option<u32>,
}

/// One page of results, with enough to offer "load more".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryPage<T> {
    pub items: Vec<T>,
    pub page: u32,
    pub total_pages: u32,
    pub total_count: u32,
}

impl<T> SmitheryPage<T> {
    fn new(items: Vec<T>, pagination: Option<Pagination>) -> Self {
        let p = pagination.unwrap_or_default();
        let counted = p.total_count.unwrap_or_default();
        SmitheryPage {
            total_count: if counted > 0 { counted } else { items.len() as u32 },
            page: p.current_page.unwrap_or(1).max(1),
            total_pages: p.total_pages.unwrap_or(1).max(1),
            items,
        }
    }
}

// ------------------------------------------------------------------- Skills

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillRow {
    /// Absent when browsing, present when searching — so it is rebuilt from
    /// `namespace` and `slug`, which are always there.
    #[serde(default)]
    qualified_name: Option<String>,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    /// Where it was published from; without it there is nothing to install.
    #[serde(default)]
    git_url: Option<String>,
    #[serde(default)]
    categories: Option<Vec<String>>,
    #[serde(default)]
    verified: Option<bool>,
    #[serde(default)]
    external_stars: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct SkillPage {
    #[serde(default)]
    skills: Vec<SkillRow>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

/// A skill listed on Smithery.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitherySkill {
    pub qualified_name: String,
    pub name: String,
    pub description: String,
    /// The repository folder it lives in — this is what gets installed.
    pub git_url: String,
    pub categories: Vec<String>,
    pub verified: bool,
    pub stars: u32,
}

/// Search Smithery for skills.
///
/// Anything without a Git URL is left out: there would be nothing to show the
/// user before installing, and nothing to install.
#[tauri::command]
pub async fn smithery_search_skills(
    key: String,
    query: String,
    page: u32,
) -> Result<SmitheryPage<SmitherySkill>, String> {
    let found: SkillPage = get(&key, &search_path("skills", &query, page)?).await?;
    let items = found
        .skills
        .into_iter()
        .filter_map(|row| {
            let qualified_name = row.qualified_name.clone().or_else(|| qualify(&row))?;
            let git_url = row.git_url.filter(|u| u.starts_with("https://"))?;
            Some(SmitherySkill {
                name: row.display_name.clone().unwrap_or_else(|| qualified_name.clone()),
                qualified_name,
                description: row.description.unwrap_or_default(),
                git_url,
                categories: row.categories.unwrap_or_default(),
                verified: row.verified.unwrap_or_default(),
                stars: row.external_stars.unwrap_or_default(),
            })
        })
        .collect();
    Ok(SmitheryPage::new(items, found.pagination))
}

/// `namespace/slug`, for the rows that arrive without a qualified name.
fn qualify(row: &SkillRow) -> Option<String> {
    let namespace = row.namespace.as_deref().filter(|s| !s.is_empty())?;
    Some(match row.slug.as_deref().filter(|s| !s.is_empty()) {
        Some(slug) => format!("{namespace}/{slug}"),
        None => namespace.to_string(),
    })
}

// ------------------------------------------------------------------ Servers

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerRow {
    #[serde(default)]
    qualified_name: Option<String>,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    verified: Option<bool>,
    #[serde(default)]
    remote: Option<bool>,
    #[serde(default)]
    is_deployed: Option<bool>,
    #[serde(default)]
    use_count: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ServerPage {
    #[serde(default)]
    servers: Vec<ServerRow>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

/// An MCP server listed on Smithery.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryServer {
    pub qualified_name: String,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub homepage: Option<String>,
    pub verified: bool,
    pub use_count: u32,
}

/// Search Smithery for MCP servers.
///
/// Only servers Smithery is actually hosting are offered: the rest have no
/// address to connect to from here.
#[tauri::command]
pub async fn smithery_search_servers(
    key: String,
    query: String,
    page: u32,
) -> Result<SmitheryPage<SmitheryServer>, String> {
    let found: ServerPage = get(&key, &search_path("servers", &query, page)?).await?;
    let items = found
        .servers
        .into_iter()
        .filter(|row| row.remote.unwrap_or(false) || row.is_deployed.unwrap_or(false))
        .filter_map(|row| {
            let qualified_name = row.qualified_name.clone().or_else(|| {
                let namespace = row.namespace.as_deref().filter(|s| !s.is_empty())?;
                Some(match row.slug.as_deref().filter(|s| !s.is_empty()) {
                    Some(slug) => format!("{namespace}/{slug}"),
                    None => namespace.to_string(),
                })
            })?;
            Some(SmitheryServer {
                name: row.display_name.clone().unwrap_or_else(|| qualified_name.clone()),
                qualified_name,
                description: row.description.unwrap_or_default(),
                icon_url: row.icon_url,
                homepage: row.homepage,
                verified: row.verified.unwrap_or_default(),
                use_count: row.use_count.unwrap_or_default(),
            })
        })
        .collect();
    Ok(SmitheryPage::new(items, found.pagination))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerDetailRow {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    deployment_url: Option<String>,
    #[serde(default)]
    connections: Vec<ConnectionRow>,
    #[serde(default)]
    tools: Vec<ToolRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionRow {
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    deployment_url: Option<String>,
    #[serde(default)]
    config_schema: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ToolRow {
    #[serde(default)]
    name: Option<String>,
}

/// One setting a server takes before it will connect.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryConfigField {
    pub name: String,
    pub description: String,
    pub required: bool,
    /// Looks like a credential, so the app hides it while typing.
    pub secret: bool,
    pub default: Option<String>,
}

/// Everything needed to offer a Smithery server for install.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmitheryServerDetail {
    pub qualified_name: String,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    /// The MCP endpoint, which is the deployment URL itself.
    pub url: String,
    pub config: Vec<SmitheryConfigField>,
    /// Tool names, so the user can see what it offers before connecting.
    pub tools: Vec<String>,
}

/// Look up one server's connection details.
#[tauri::command]
pub async fn smithery_server(key: String, qualified_name: String) -> Result<SmitheryServerDetail, String> {
    let name = qualified_name.trim();
    // The name goes straight into the path, so it may only be a name.
    if name.is_empty()
        || name.len() > 200
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || "-_./@".contains(c))
        || name.contains("..")
    {
        return Err(format!("{qualified_name} is not a Smithery server name"));
    }

    let row: ServerDetailRow = get(&key, &format!("/servers/{name}")).await?;
    // Prefer an HTTP connection; anything else has no URL we can use.
    let connection = row
        .connections
        .iter()
        .find(|c| c.kind.as_deref() == Some("http") && c.deployment_url.is_some())
        .or_else(|| row.connections.iter().find(|c| c.deployment_url.is_some()));

    let url = connection
        .and_then(|c| c.deployment_url.clone())
        .or(row.deployment_url)
        .ok_or("That server isn't hosted anywhere this app can reach")?;
    if !url.starts_with("https://") {
        return Err("That server's address isn't https".into());
    }

    Ok(SmitheryServerDetail {
        name: row.display_name.unwrap_or_else(|| name.to_string()),
        qualified_name: name.to_string(),
        description: row.description.unwrap_or_default(),
        icon_url: row.icon_url,
        url,
        config: connection.and_then(|c| c.config_schema.as_ref()).map(config_fields).unwrap_or_default(),
        tools: row.tools.into_iter().filter_map(|t| t.name).collect(),
    })
}

/// Read a JSON Schema object into the settings a server asks for.
fn config_fields(schema: &serde_json::Value) -> Vec<SmitheryConfigField> {
    let required: Vec<&str> = schema
        .get("required")
        .and_then(|r| r.as_array())
        .map(|r| r.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) else {
        return Vec::new();
    };
    properties
        .iter()
        .filter(|(name, _)| !name.is_empty() && name.len() <= 100)
        .map(|(name, field)| SmitheryConfigField {
            secret: looks_secret(name),
            name: name.clone(),
            description: field.get("description").and_then(|d| d.as_str()).unwrap_or_default().to_string(),
            required: required.contains(&name.as_str()),
            default: field.get("default").and_then(|d| d.as_str()).map(str::to_string),
        })
        .collect()
}

/// Whether a setting's name says it holds a credential.
fn looks_secret(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    ["key", "token", "secret", "password", "passwd", "auth", "credential"]
        .iter()
        .any(|word| lower.contains(word))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_keys_that_would_break_a_request() {
        assert!(clean_key("sm-abc123").is_ok());
        assert_eq!(clean_key("  sm-abc123  ").unwrap(), "sm-abc123");
        for bad in ["", "   ", "has space", "new\nline", "tab\there"] {
            assert!(clean_key(bad).is_err(), "{bad:?}");
        }
        assert!(clean_key(&"x".repeat(501)).is_err());
    }

    #[test]
    fn search_terms_survive_the_url() {
        assert_eq!(search_path("skills", "pdf", 1).unwrap(), "/skills?q=pdf&page=1&pageSize=30");
        assert_eq!(search_path("servers", "a b", 2).unwrap(), "/servers?q=a+b&page=2&pageSize=30");
        assert!(search_path("skills", "c++ & co", 1).unwrap().contains("c%2B%2B+%26+co"));
        assert!(search_path("skills", "สรุป", 1).unwrap().contains("%E0%B8%AA"));
        assert!(search_path("skills", &"x".repeat(201), 1).is_err());
        // A page number can't escape into the rest of the query.
        assert!(search_path("skills", "", 0).unwrap().contains("page=1"));
        assert!(search_path("skills", "", 9_999).unwrap().contains("page=100"));
    }

    #[test]
    fn config_schemas_become_fields() {
        let schema = serde_json::json!({
            "type": "object",
            "required": ["NOTION_API_KEY"],
            "properties": {
                "NOTION_API_KEY": { "type": "string", "description": "Integration token" },
                "NOTION_TIMEOUT": { "type": "string", "default": "30000", "description": "Timeout" }
            }
        });
        let mut fields = config_fields(&schema);
        fields.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(fields.len(), 2);

        assert_eq!(fields[0].name, "NOTION_API_KEY");
        assert!(fields[0].required);
        assert!(fields[0].secret, "a key is hidden while typing");
        assert_eq!(fields[0].description, "Integration token");

        assert_eq!(fields[1].name, "NOTION_TIMEOUT");
        assert!(!fields[1].required);
        assert!(!fields[1].secret);
        assert_eq!(fields[1].default.as_deref(), Some("30000"));
    }

    #[test]
    fn an_empty_schema_asks_for_nothing() {
        assert!(config_fields(&serde_json::json!({})).is_empty());
        assert!(config_fields(&serde_json::json!({ "type": "object" })).is_empty());
    }

    #[test]
    fn credentials_are_recognised_by_name() {
        for name in ["API_KEY", "notion_token", "clientSecret", "DB_PASSWORD", "AUTH_HEADER"] {
            assert!(looks_secret(name), "{name}");
        }
        for name in ["TIMEOUT", "region", "BASE_URL", "version"] {
            assert!(!looks_secret(name), "{name}");
        }
    }

    /// Browsing and searching answer with different fields: a browsed skill
    /// arrives with no `qualifiedName` at all. Requiring one made every
    /// browse fail to parse, and the whole list came back empty.
    #[test]
    fn a_browsed_skill_is_named_from_its_namespace_and_slug() {
        let browsed: SkillRow = serde_json::from_value(serde_json::json!({
            "namespace": "smithery-ai",
            "slug": "cli",
            "displayName": "smithery-ai-cli",
            "gitUrl": "https://github.com/smithery-ai/cli/tree/main/skills/smithery-ai-cli"
        }))
        .expect("a row with no qualifiedName still parses");
        assert_eq!(qualify(&browsed).as_deref(), Some("smithery-ai/cli"));

        let searched: SkillRow = serde_json::from_value(serde_json::json!({
            "qualifiedName": "openclaw/nano-pdf",
            "namespace": "openclaw",
            "slug": "nano-pdf"
        }))
        .unwrap();
        assert_eq!(searched.qualified_name.as_deref(), Some("openclaw/nano-pdf"));

        let nameless: SkillRow = serde_json::from_value(serde_json::json!({ "slug": "x" })).unwrap();
        assert_eq!(qualify(&nameless), None, "nothing to call it by");
    }

    /// Smithery sends `null` for fields it has no value for, and `#[serde(default)]`
    /// alone does not cover that — it only fills in a key that is absent.
    /// One null used to cost the whole page.
    #[test]
    fn a_null_field_does_not_cost_the_page() {
        let row: SkillRow = serde_json::from_value(serde_json::json!({
            "namespace": "someone",
            "slug": "thing",
            "displayName": null,
            "description": null,
            "categories": null,
            "verified": null,
            "externalStars": null,
            "gitUrl": "https://github.com/someone/thing"
        }))
        .expect("nulls parse");
        assert_eq!(row.verified, None);
        assert_eq!(row.external_stars, None);

        let page: SkillPage = serde_json::from_value(serde_json::json!({
            "skills": [],
            "pagination": { "currentPage": null, "totalPages": null, "totalCount": null }
        }))
        .expect("a null pagination parses");
        let empty = SmitheryPage::new(Vec::<SmitherySkill>::new(), page.pagination);
        assert_eq!((empty.page, empty.total_pages), (1, 1));
    }

    /// Hits Smithery: `cargo test --lib smithery -- --ignored`.
    /// Set SMITHERY_API_KEY to check the signed-in paths too.
    #[tokio::test]
    #[ignore]
    async fn a_bad_key_is_refused_clearly() {
        let error = smithery_check_key("sm-definitely-not-a-real-key".into()).await.unwrap_err();
        assert!(error.contains("refused"), "{error}");
    }

    /// The signed-in paths need a real key; without one there is nothing to
    /// check, so say so rather than fail.
    fn key_or_skip() -> Option<String> {
        match std::env::var("SMITHERY_API_KEY") {
            Ok(key) if !key.trim().is_empty() => Some(key),
            _ => {
                eprintln!("skipped: set SMITHERY_API_KEY to run this");
                None
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn searches_skills_and_servers() {
        let Some(key) = key_or_skip() else { return };
        let skills = smithery_search_skills(key.clone(), "pdf".into(), 1).await.unwrap();
        assert!(!skills.items.is_empty());
        assert!(skills.items.iter().all(|s| s.git_url.starts_with("https://")));

        let servers = smithery_search_servers(key, "notion".into(), 1).await.unwrap();
        assert!(!servers.items.is_empty());
    }

    /// Browsing is the first thing the page does, and it takes a different
    /// shape from searching.
    #[tokio::test]
    #[ignore]
    async fn browsing_with_no_query_returns_skills() {
        let Some(key) = key_or_skip() else { return };
        let browsed = smithery_search_skills(key, String::new(), 1).await.unwrap();
        assert!(!browsed.items.is_empty(), "browsing came back empty");
        assert!(browsed.items.iter().all(|s| !s.qualified_name.is_empty()));
    }

    #[tokio::test]
    #[ignore]
    async fn reads_a_server_connection() {
        let Some(key) = key_or_skip() else { return };
        let detail = smithery_server(key, "node2flow/notion".into()).await.unwrap();
        assert!(detail.url.starts_with("https://"));
        assert!(detail.config.iter().any(|f| f.name == "NOTION_API_KEY" && f.required && f.secret));
    }

    #[tokio::test]
    #[ignore]
    async fn a_server_name_cannot_walk_the_path() {
        let bad = smithery_server("k".into(), "../../namespaces".into()).await.unwrap_err();
        assert!(bad.contains("not a Smithery server name"), "{bad}");
    }
}
