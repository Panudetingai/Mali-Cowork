//! The official MCP Registry (registry.modelcontextprotocol.io): search it,
//! read one server, and fetch server icons for the Connectors page.
//!
//! Registry entries are published by anyone, so everything here is treated
//! as untrusted data: only the fields the app uses are passed on, packages
//! and remotes the app can't run are dropped, and icons are fetched here (not
//! by the webview, whose CSP blocks other sites) with size and type limits.
//! Nothing is installed from this module; the user confirms every install.

use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

const REGISTRY: &str = "https://registry.modelcontextprotocol.io/v0.1";
const MAX_PAGE: u32 = 100;
const MAX_ICON_BYTES: usize = 512 * 1024;
const MAX_CACHED_ICONS: usize = 400;
const MAX_NAMES: usize = 40;
/// The registry is often slow (a cold request can take ~20s) or drops
/// requests. The first try is short so saved results can show quickly; each
/// retry waits longer, since a slow request warms the registry up.
const TRY_TIMEOUTS: [Duration; 3] = [Duration::from_secs(8), Duration::from_secs(25), Duration::from_secs(25)];
const RETRIES: u32 = 2;
/// A repeated search within this window is answered from memory.
const FRESH_FOR: Duration = Duration::from_secs(10 * 60);
const MAX_CACHED_PAGES: usize = 200;
/// Every server the registry has returned is kept (in memory and on disk) so
/// search still works when the registry doesn't answer.
const MAX_CATALOG: usize = 5000;
const CATALOG_FILE: &str = "mcp-registry-catalog.json";
/// Registry types the app can launch: `npx`, `uvx` and `docker`.
const LOCAL_TYPES: &[&str] = &["npm", "pypi", "oci"];
const REMOTE_TYPES: &[&str] = &["streamable-http", "sse"];

#[derive(Deserialize)]
struct Page {
    #[serde(default)]
    servers: Vec<Entry>,
    #[serde(default)]
    metadata: PageMeta,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PageMeta {
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct Entry {
    server: RawServer,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawServer {
    name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    website_url: Option<String>,
    #[serde(default)]
    repository: Option<Repository>,
    #[serde(default)]
    icons: Vec<Icon>,
    #[serde(default)]
    packages: Vec<Value>,
    #[serde(default)]
    remotes: Vec<Value>,
}

#[derive(Deserialize)]
struct Repository {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Icon {
    src: String,
    #[serde(default)]
    mime_type: Option<String>,
}

/// What the Connectors page gets for one server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryServer {
    /// Reverse-DNS id, e.g. `com.notion/mcp`; its namespace is the publisher.
    pub name: String,
    pub title: String,
    pub description: String,
    pub version: String,
    pub website_url: Option<String>,
    pub repository_url: Option<String>,
    /// Icon URLs to try in order (the registry's own, then the site's).
    pub icons: Vec<String>,
    /// Local packages the app can run (npm / PyPI / Docker over stdio).
    pub packages: Vec<Value>,
    /// Remote endpoints (streamable HTTP / SSE over https).
    pub remotes: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPage {
    pub servers: Vec<RegistryServer>,
    pub next_cursor: Option<String>,
    /// The registry didn't answer; these come from servers seen earlier.
    pub stale: bool,
}

fn https_url(raw: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    // No loopback or private addresses: a registry entry must not make the
    // app call into the user's own network.
    let host = url.host_str()?;
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return None;
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified(),
            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        };
        if private {
            return None;
        }
    }
    Some(url)
}

/// A site's domain for its favicon: `mcp.notion.com` → `notion.com`.
fn site_domain(url: &reqwest::Url) -> Option<String> {
    let host = url.host_str()?;
    let parts: Vec<&str> = host.split('.').collect();
    let trimmed = if parts.len() > 2 && matches!(parts[0], "mcp" | "api" | "www" | "server") {
        parts[1..].join(".")
    } else {
        host.to_string()
    };
    Some(trimmed)
}

fn icon_candidates(raw: &RawServer) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |url: String| {
        if !out.contains(&url) && out.len() < 6 {
            out.push(url);
        }
    };
    // The registry's own icons first; raster before SVG is not needed, both render in <img>.
    for icon in &raw.icons {
        let image = icon.mime_type.as_deref().is_none_or(|m| m.starts_with("image/"));
        if image {
            if let Some(url) = https_url(&icon.src) {
                push(url.to_string());
            }
        }
    }
    // `io.github.<user>/…` → that user's GitHub avatar.
    if let Some(user) = raw.name.strip_prefix("io.github.").and_then(|rest| rest.split('/').next()) {
        if !user.is_empty() && user.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            push(format!("https://github.com/{user}.png?size=64"));
        }
    }
    // Otherwise the site's own icon: website, then the remote's host.
    let site = raw
        .website_url
        .as_deref()
        .and_then(https_url)
        .or_else(|| raw.remotes.iter().find_map(|r| r["url"].as_str().and_then(https_url)));
    if let Some(domain) = site.as_ref().and_then(site_domain) {
        if !domain.ends_with("github.com") && !domain.ends_with("githubusercontent.com") {
            push(format!("https://{domain}/apple-touch-icon.png"));
            push(format!("https://{domain}/favicon.ico"));
            // Sites that keep their icon elsewhere (DuckDuckGo's icon service, no tracking).
            push(format!("https://icons.duckduckgo.com/ip3/{domain}.ico"));
        }
    }
    out
}

fn supported_package(pkg: &Value) -> bool {
    let kind = pkg["registryType"].as_str().unwrap_or_default();
    let transport = pkg["transport"]["type"].as_str().unwrap_or("stdio");
    LOCAL_TYPES.contains(&kind) && transport == "stdio" && pkg["identifier"].as_str().is_some()
}

fn supported_remote(remote: &Value) -> bool {
    let kind = remote["type"].as_str().unwrap_or_default();
    // URLs with `{variables}` are checked once the user fills them in.
    let url_ok = remote["url"]
        .as_str()
        .is_some_and(|u| u.starts_with("https://") && u.len() <= 2048);
    REMOTE_TYPES.contains(&kind) && url_ok
}

fn clip(text: &str, max: usize) -> String {
    text.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect()
}

fn to_server(raw: RawServer) -> RegistryServer {
    let icons = icon_candidates(&raw);
    let title = raw
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| clip(t, 120))
        .unwrap_or_else(|| pretty_name(&raw.name));
    RegistryServer {
        title,
        description: clip(&raw.description, 600),
        version: clip(&raw.version, 64),
        website_url: raw.website_url.as_deref().and_then(https_url).map(|u| u.to_string()),
        repository_url: raw
            .repository
            .and_then(|r| r.url)
            .as_deref()
            .and_then(https_url)
            .map(|u| u.to_string()),
        packages: raw.packages.into_iter().filter(supported_package).collect(),
        remotes: raw.remotes.into_iter().filter(supported_remote).collect(),
        icons,
        name: clip(&raw.name, 200),
    }
}

/// `com.notion/mcp` → `Notion`, `io.github.user/weather-mcp` → `Weather`.
fn pretty_name(name: &str) -> String {
    let (namespace, server) = name.split_once('/').unwrap_or(("", name));
    let generic = ["mcp", "server", "mcp-server", "remote"];
    let base = if generic.contains(&server.to_ascii_lowercase().as_str()) {
        namespace.rsplit('.').find(|p| !["com", "io", "app", "ai", "dev", "org", "net", "mcp"].contains(p)).unwrap_or(server)
    } else {
        server
    };
    let words: Vec<String> = base
        .split(['-', '_', '.'])
        .filter(|w| !w.is_empty() && !["mcp", "server"].contains(&w.to_ascii_lowercase().as_str()))
        .map(|w| {
            let mut chars = w.chars();
            chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
        })
        .collect();
    if words.is_empty() {
        name.to_string()
    } else {
        words.join(" ")
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("mali-cowork")
        .build()
        .map_err(|e| e.to_string())
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name.contains('/')
        && !name.contains("..")
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "./-_".contains(c))
}

const UNREACHABLE: &str = "The MCP Registry isn't responding right now. Try again in a moment.";

enum Failure {
    /// Not there: asking again won't help.
    NotFound,
    /// Timeout, dropped connection, 5xx, 429 or a garbled reply: worth a retry.
    Unreachable,
}

async fn get_json_once<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &reqwest::Url,
    timeout: Duration,
) -> Result<T, Failure> {
    let response = client.get(url.clone()).timeout(timeout).send().await.map_err(|_| Failure::Unreachable)?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(Failure::NotFound);
    }
    if !status.is_success() {
        return Err(Failure::Unreachable);
    }
    response.json().await.map_err(|_| Failure::Unreachable)
}

async fn get_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: reqwest::Url,
    attempts: std::ops::RangeInclusive<u32>,
) -> Result<T, Failure> {
    let (mut attempt, last) = attempts.into_inner();
    loop {
        let timeout = TRY_TIMEOUTS[(attempt as usize).min(TRY_TIMEOUTS.len() - 1)];
        match get_json_once(client, &url, timeout).await {
            Err(Failure::Unreachable) if attempt < last => {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(400 * 3u64.pow(attempt - 1))).await;
            }
            result => return result,
        }
    }
}

// ---------------------------------------------------------------- Caches

fn page_cache() -> &'static Mutex<HashMap<String, (Instant, RegistryPage)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, RegistryPage)>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn catalog() -> &'static Mutex<Option<HashMap<String, RegistryServer>>> {
    static CATALOG: OnceLock<Mutex<Option<HashMap<String, RegistryServer>>>> = OnceLock::new();
    CATALOG.get_or_init(Default::default)
}

/// Where the catalog is kept on disk; `None` keeps it in memory only.
fn catalog_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|dir| dir.join(CATALOG_FILE))
}

/// The catalog, read from disk on first use.
fn with_catalog<T>(path: Option<&PathBuf>, f: impl FnOnce(&mut HashMap<String, RegistryServer>) -> T) -> T {
    let mut guard = catalog().lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(|| {
        path.and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Vec<RegistryServer>>(&bytes).ok())
            .map(|servers| servers.into_iter().map(|s| (s.name.clone(), s)).collect())
            .unwrap_or_default()
    });
    f(map)
}

fn remember(path: Option<&PathBuf>, servers: &[RegistryServer]) {
    if servers.is_empty() {
        return;
    }
    let snapshot = with_catalog(path, |map| {
        for server in servers {
            if map.len() < MAX_CATALOG || map.contains_key(&server.name) {
                map.insert(server.name.clone(), server.clone());
            }
        }
        map.values().cloned().collect::<Vec<_>>()
    });
    let Some(path) = path.cloned() else { return };
    // Best effort: the catalog only makes a registry outage less visible.
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec(&snapshot) {
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, bytes).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    });
}

/// Search the saved catalog the way the registry would: every word of the
/// query must appear in the name, title or description.
fn search_catalog(path: Option<&PathBuf>, query: &str, limit: usize) -> Vec<RegistryServer> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    with_catalog(path, |map| {
        let mut hits: Vec<&RegistryServer> = map
            .values()
            .filter(|s| {
                let haystack = format!("{} {} {}", s.name, s.title, s.description).to_lowercase();
                words.iter().all(|w| haystack.contains(w.as_str()))
            })
            .collect();
        // Name/title matches first, then alphabetical so the order is stable.
        hits.sort_by_key(|s| {
            let head = format!("{} {}", s.name, s.title).to_lowercase();
            (!words.iter().all(|w| head.contains(w.as_str())), s.title.to_lowercase())
        });
        hits.into_iter().take(limit).cloned().collect()
    })
}

/// Search the registry (latest version of each server). Empty `query` lists all.
/// When the registry doesn't answer, servers seen earlier are searched instead
/// (`stale`), so a registry outage reads as "older results", not an error.
#[tauri::command]
pub async fn mcp_registry_search<R: Runtime>(
    app: AppHandle<R>,
    query: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<RegistryPage, String> {
    search(catalog_path(&app).as_ref(), query, cursor, limit).await
}

async fn search(
    saved_at: Option<&PathBuf>,
    query: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<RegistryPage, String> {
    let limit = limit.unwrap_or(30).clamp(1, MAX_PAGE);
    let query = query.as_deref().map(str::trim).filter(|q| !q.is_empty()).map(|q| clip(q, 100));
    let cursor = cursor.as_deref().filter(|c| !c.is_empty()).map(|c| clip(c, 300));

    let key = format!("{limit}\n{}\n{}", query.as_deref().unwrap_or(""), cursor.as_deref().unwrap_or(""));
    let cached = page_cache().lock().unwrap_or_else(|e| e.into_inner()).get(&key).cloned();
    if let Some((at, page)) = &cached {
        if at.elapsed() < FRESH_FOR {
            return Ok(page.clone());
        }
    }

    let mut url = reqwest::Url::parse(&format!("{REGISTRY}/servers")).expect("static URL");
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("version", "latest");
        params.append_pair("limit", &limit.to_string());
        if let Some(q) = &query {
            params.append_pair("search", q);
        }
        if let Some(c) = &cursor {
            params.append_pair("cursor", c);
        }
    }

    let client = client()?;
    // One quick try first: if it fails and there is something saved to show,
    // show it rather than keep the user waiting on retries.
    let saved = || {
        if cursor.is_some() {
            return Vec::new();
        }
        search_catalog(saved_at, query.as_deref().unwrap_or(""), limit as usize)
    };
    let mut result = get_json::<Page>(&client, url.clone(), 0..=0).await;
    if matches!(result, Err(Failure::Unreachable)) && cached.is_none() && saved().is_empty() {
        result = get_json::<Page>(&client, url, 1..=RETRIES).await;
    }

    match result {
        Ok(page) => {
            let page = RegistryPage {
                servers: page.servers.into_iter().map(|e| to_server(e.server)).collect(),
                next_cursor: page.metadata.next_cursor,
                stale: false,
            };
            remember(saved_at, &page.servers);
            let mut pages = page_cache().lock().unwrap_or_else(|e| e.into_inner());
            if pages.len() >= MAX_CACHED_PAGES {
                pages.retain(|_, (at, _)| at.elapsed() < FRESH_FOR);
                if pages.len() >= MAX_CACHED_PAGES {
                    pages.clear();
                }
            }
            pages.insert(key, (Instant::now(), page.clone()));
            Ok(page)
        }
        Err(_) => {
            if let Some((_, page)) = cached {
                return Ok(RegistryPage { stale: true, ..page });
            }
            if cursor.is_some() {
                return Err(UNREACHABLE.into());
            }
            let servers = saved();
            // Nothing saved matches: "no results" would be a lie, so say why.
            if servers.is_empty() && with_catalog(saved_at, |map| map.is_empty()) {
                return Err(UNREACHABLE.into());
            }
            Ok(RegistryPage { servers, next_cursor: None, stale: true })
        }
    }
}

/// The latest version of each named server; unknown names are skipped, and a
/// server the registry doesn't return right now comes from the saved catalog.
#[tauri::command]
pub async fn mcp_registry_get<R: Runtime>(app: AppHandle<R>, names: Vec<String>) -> Result<Vec<RegistryServer>, String> {
    get_servers(catalog_path(&app).as_ref(), names).await
}

async fn get_servers(saved_at: Option<&PathBuf>, names: Vec<String>) -> Result<Vec<RegistryServer>, String> {
    let client = client()?;
    let fetches = names.iter().filter(|n| valid_name(n)).take(MAX_NAMES).map(|name| {
        let client = &client;
        async move {
            let mut url = reqwest::Url::parse(REGISTRY).expect("static URL");
            url.path_segments_mut()
                .expect("https URL")
                .extend(["servers", name.as_str(), "versions", "latest"]);
            (name, get_json::<Entry>(client, url, 0..=RETRIES).await.map(|e| to_server(e.server)))
        }
    });
    let results = futures::future::join_all(fetches).await;
    let fetched: Vec<RegistryServer> = results.iter().filter_map(|(_, r)| r.as_ref().ok().cloned()).collect();
    remember(saved_at, &fetched);
    Ok(results
        .into_iter()
        .filter_map(|(name, result)| match result {
            Ok(server) => Some(server),
            Err(Failure::NotFound) => None,
            Err(Failure::Unreachable) => with_catalog(saved_at, |map| map.get(name.as_str()).cloned()),
        })
        .collect())
}

fn icon_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

fn image_type(content_type: &str, bytes: &[u8]) -> Option<&'static str> {
    let declared = content_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    let sniffed = if bytes.starts_with(b"\x89PNG") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" && matches!(&bytes[8..12], b"avif" | b"avis") {
        Some("image/avif")
    } else if bytes.starts_with(b"BM") && bytes.len() > 26 {
        Some("image/bmp")
    } else {
        None
    };
    if sniffed.is_some() {
        return sniffed;
    }
    // SVG is text; shown through <img>, where its scripts never run.
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    (declared == "image/svg+xml" || head.contains("<svg")).then_some("image/svg+xml")
}

async fn fetch_icon(client: &reqwest::Client, url: &reqwest::Url) -> Option<String> {
    let response = client.get(url.clone()).send().await.ok()?;
    // A redirect may not leave https or go to a private address.
    https_url(response.url().as_str())?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n as usize > MAX_ICON_BYTES) {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return None;
    }
    let mime = image_type(&content_type, &bytes)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// The first of `urls` that is a real image, as a data URL (cached).
#[tauri::command]
pub async fn mcp_registry_icon(urls: Vec<String>) -> Option<String> {
    let key = urls.join("\n");
    if let Some(hit) = icon_cache().lock().unwrap().get(&key) {
        return hit.clone();
    }
    let client = reqwest::Client::builder()
        .user_agent("mali-cowork")
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .ok()?;
    let mut found = None;
    for url in urls.iter().take(6).filter_map(|u| https_url(u)) {
        if let Some(data) = fetch_icon(&client, &url).await {
            found = Some(data);
            break;
        }
    }
    let mut cache = icon_cache().lock().unwrap();
    if cache.len() >= MAX_CACHED_ICONS {
        cache.clear();
    }
    cache.insert(key, found.clone());
    found
}

/// Largest picture the user may point a connector's icon at; the app
/// shrinks it to a small PNG right after.
const MAX_CUSTOM_ICON_BYTES: usize = 8 * 1024 * 1024;

/// An image link the user pasted as a connector's icon, as a data URL.
/// Unlike registry icons, a failure says why, and nothing is cached: the
/// user may fix the link and try again.
#[tauri::command]
pub async fn mcp_fetch_icon(url: String) -> Result<String, String> {
    let url = https_url(&url).ok_or("Use a public https:// link")?;
    fetch_image(url).await
}

/// A public https link (not loopback or the local network), parsed.
pub(crate) fn public_https(raw: &str) -> Option<reqwest::Url> {
    https_url(raw)
}

/// Download a picture from a public https link as a data URL; a failure says why.
pub(crate) async fn fetch_image(url: reqwest::Url) -> Result<String, String> {
    let client = reqwest::Client::builder()
        // Some image hosts turn away clients that don't look like a browser.
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(6))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "The site took too long to answer".to_string()
            } else {
                "Couldn't reach that site".to_string()
            }
        })?;
    https_url(response.url().as_str()).ok_or("The link redirected somewhere that isn't public https")?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!("The site refused to share that image ({status}). Try another link, or download it and upload it"),
            404 => "Nothing at that link (404)".to_string(),
            _ => format!("The site answered {status}"),
        });
    }
    if response.content_length().is_some_and(|n| n as usize > MAX_CUSTOM_ICON_BYTES) {
        return Err("That image is over 8 MB".into());
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response.bytes().await.map_err(|_| "The download was cut off".to_string())?;
    if bytes.len() > MAX_CUSTOM_ICON_BYTES {
        return Err("That image is over 8 MB".into());
    }
    let Some(mime) = image_type(&content_type, &bytes) else {
        let kind = content_type.split(';').next().unwrap_or_default().trim();
        return Err(if kind.contains("html") {
            "That link opens a web page, not an image. Right-click the picture and use \"Copy Image Address\"".into()
        } else if kind.is_empty() {
            "That link isn't an image".into()
        } else {
            format!("That link isn't an image this app can show ({kind})")
        });
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw(value: Value) -> RawServer {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn keeps_only_what_the_app_can_run() {
        let server = to_server(raw(json!({
            "name": "com.example/mcp",
            "description": "Example",
            "version": "1.0.0",
            "packages": [
                { "registryType": "npm", "identifier": "example-mcp", "transport": { "type": "stdio" } },
                { "registryType": "mcpb", "identifier": "https://x/y.mcpb", "transport": { "type": "stdio" } },
                { "registryType": "npm", "identifier": "example-http", "transport": { "type": "streamable-http" } }
            ],
            "remotes": [
                { "type": "streamable-http", "url": "https://mcp.example.com/mcp" },
                { "type": "streamable-http", "url": "http://mcp.example.com/mcp" },
                { "type": "websocket", "url": "https://mcp.example.com/ws" }
            ]
        })));
        assert_eq!(server.packages.len(), 1);
        assert_eq!(server.remotes.len(), 1);
        assert_eq!(server.title, "Example");
        assert_eq!(
            server.icons,
            vec![
                "https://example.com/apple-touch-icon.png",
                "https://example.com/favicon.ico",
                "https://icons.duckduckgo.com/ip3/example.com.ico",
            ]
        );
    }

    #[test]
    fn icons_never_point_inside_the_network() {
        for bad in [
            "http://example.com/a.png",
            "https://localhost/a.png",
            "https://127.0.0.1/a.png",
            "https://192.168.1.10/a.png",
            "https://[::1]/a.png",
            "https://printer.local/a.png",
        ] {
            assert!(https_url(bad).is_none(), "{bad}");
        }
        assert!(https_url("https://example.com/a.png").is_some());
    }

    #[test]
    fn github_publishers_get_their_avatar() {
        let server = to_server(raw(json!({ "name": "io.github.octo-cat/weather-mcp", "description": "" })));
        assert_eq!(server.icons, vec!["https://github.com/octo-cat.png?size=64"]);
        assert_eq!(server.title, "Weather");
    }

    #[test]
    fn readable_names() {
        assert_eq!(pretty_name("com.notion/mcp"), "Notion");
        assert_eq!(pretty_name("app.linear/linear"), "Linear");
        assert_eq!(pretty_name("io.github.x/github-issues-server"), "Github Issues");
    }

    #[test]
    fn sniffs_images() {
        assert_eq!(image_type("", b"\x89PNG\r\n"), Some("image/png"));
        assert_eq!(image_type("text/html", b"<html><body>no</body></html>"), None);
        assert_eq!(image_type("image/svg+xml", b"<?xml version=\"1.0\"?><svg></svg>"), Some("image/svg+xml"));
    }

    #[test]
    fn registry_names_are_checked() {
        assert!(valid_name("com.notion/mcp"));
        assert!(!valid_name("../../etc"));
        assert!(!valid_name("com.notion/mcp?x=1"));
    }

    /// Hits the registry: `cargo test --lib registry_live -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn registry_live() {
        let page = search(None, Some("notion".into()), None, Some(10)).await.unwrap();
        assert!(page.servers.iter().any(|s| s.name == "com.notion/mcp"));
        let featured = get_servers(None, vec![
            "com.notion/mcp".into(),
            "io.github.github/github-mcp-server".into(),
            "app.linear/linear".into(),
            "does.not/exist".into(),
        ])
        .await
        .unwrap();
        assert_eq!(featured.len(), 3);
        for server in &featured {
            let icon = mcp_registry_icon(server.icons.clone()).await;
            println!("{} {:?} icon={}", server.title, server.icons, icon.as_deref().map(|i| &i[..30.min(i.len())]).unwrap_or("none"));
        }
        let github = featured.iter().find(|s| s.name.contains("github")).unwrap();
        println!("github packages={} remotes={}", github.packages.len(), github.remotes.len());
    }
}

