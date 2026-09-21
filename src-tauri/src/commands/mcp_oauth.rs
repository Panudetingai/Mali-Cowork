//! Sign-in to remote MCP servers as **Mali Cowork**, not as OpenCode.
//!
//! OpenCode registers itself with a server's OAuth (dynamic client
//! registration) under the fixed name "OpenCode", so the consent screen
//! would say OpenCode is asking for access. Instead the app:
//!
//! 1. registers its own client ("Mali Cowork") with the server's
//!    authorization server, with our loopback callback as redirect URI;
//! 2. gives OpenCode that client in the server's config (`oauth.clientId`,
//!    `redirectUri`), so OpenCode never registers its own;
//! 3. asks OpenCode to start the flow (PKCE, state), opens the sign-in page
//!    itself, receives the callback on `127.0.0.1` — checking `state` — and
//!    shows a Mali Cowork page with the app's icon;
//! 4. hands the code to OpenCode, which exchanges it and keeps the tokens in
//!    its own owner-only auth file. Tokens never reach the webview or the AI.
//!
//! Servers without dynamic registration fall back to OpenCode's own flow.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::secure_fs::write_private;

pub const CLIENT_NAME: &str = "Mali Cowork";
const SOFTWARE_ID: &str = "com.panudet.mali-cowork";
/// A public https page and logo for consent screens that show them. Unset
/// until the app has a public site: servers reject unreachable URLs.
const CLIENT_URI: Option<&str> = None;
const LOGO_URI: Option<&str> = None;
pub const CALLBACK_PORT: u16 = 19877;
pub const CALLBACK_PATH: &str = "/mcp/oauth/callback";
/// Time the user has to finish signing in.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const APP_ICON: &[u8] = include_bytes!("../../icons/128x128.png");

pub fn redirect_uri() -> String {
    format!("http://127.0.0.1:{CALLBACK_PORT}{CALLBACK_PATH}")
}

// ---------------------------------------------------------------- registrations

/// The client Mali Cowork registered with one server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub server_url: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    pub redirect_uri: String,
}

fn store_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("mcp-oauth-clients.json")
}

fn store() -> &'static Mutex<HashMap<String, Registration>> {
    static STORE: OnceLock<Mutex<HashMap<String, Registration>>> = OnceLock::new();
    STORE.get_or_init(|| {
        let saved = std::fs::read_to_string(store_path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Mutex::new(saved)
    })
}

fn save_store(map: &HashMap<String, Registration>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    // Holds client secrets: owner-only, like OpenCode's own auth file.
    write_private(&store_path(), &json)
}

fn same_url(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

/// The `oauth` block for a remote server's OpenCode config, when Mali Cowork
/// has a client registered for exactly this URL.
pub fn oauth_config_for(id: &str, url: &str) -> Option<Value> {
    let map = store().lock().unwrap_or_else(|p| p.into_inner());
    let reg = map.get(id)?;
    if !same_url(&reg.server_url, url) || reg.redirect_uri != redirect_uri() {
        return None;
    }
    let mut oauth = json!({ "clientId": reg.client_id, "redirectUri": reg.redirect_uri });
    if let Some(secret) = &reg.client_secret {
        oauth["clientSecret"] = json!(secret);
    }
    Some(oauth)
}

/// The server URL Mali Cowork registered a client for, if any.
pub fn registered_url(id: &str) -> Option<String> {
    let map = store().lock().unwrap_or_else(|p| p.into_inner());
    map.get(id).filter(|r| r.redirect_uri == redirect_uri()).map(|r| r.server_url.clone())
}

pub fn forget(id: &str) -> Result<(), String> {
    let mut map = store().lock().unwrap_or_else(|p| p.into_inner());
    if map.remove(id).is_some() {
        save_store(&map)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- discovery

fn https(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| format!("Invalid URL: {raw}"))?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match url.scheme() {
        "https" => Ok(url),
        "http" if local => Ok(url),
        _ => Err(format!("{raw} must use https://")),
    }
}

/// `https://host/a/b` → `https://host/.well-known/<name>/a/b` (RFC 8414 / 9728 path form).
fn well_known(base: &reqwest::Url, name: &str, keep_path: bool) -> reqwest::Url {
    let mut url = base.clone();
    let path = base.path().trim_end_matches('/');
    let suffix = if keep_path && !path.is_empty() && path != "/" { path } else { "" };
    url.set_path(&format!("/.well-known/{name}{suffix}"));
    url.set_query(None);
    url.set_fragment(None);
    url
}

#[derive(Deserialize, Default)]
struct ResourceMetadata {
    #[serde(default)]
    authorization_servers: Vec<String>,
}

#[derive(Deserialize, Default)]
struct ServerMetadata {
    #[serde(default)]
    registration_endpoint: Option<String>,
    #[serde(default)]
    token_endpoint_auth_methods_supported: Vec<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("mali-cowork")
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_json<T: for<'de> Deserialize<'de>>(client: &reqwest::Client, url: reqwest::Url) -> Option<T> {
    let response = client.get(url).header("Accept", "application/json").send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

async fn discover(client: &reqwest::Client, server_url: &str) -> Result<ServerMetadata, String> {
    let resource = https(server_url)?;
    let mut resource_meta = None;
    for keep_path in [true, false] {
        resource_meta = get_json::<ResourceMetadata>(client, well_known(&resource, "oauth-protected-resource", keep_path)).await;
        if resource_meta.is_some() {
            break;
        }
    }
    // Servers from before protected-resource metadata are their own authorization server.
    let issuer = match resource_meta.and_then(|m| m.authorization_servers.into_iter().next()) {
        Some(url) => https(&url)?,
        None => {
            let mut origin = resource.clone();
            origin.set_path("/");
            origin
        }
    };
    let candidates = [
        well_known(&issuer, "oauth-authorization-server", true),
        well_known(&issuer, "oauth-authorization-server", false),
        well_known(&issuer, "openid-configuration", true),
        well_known(&issuer, "openid-configuration", false),
    ];
    for url in candidates {
        if let Some(meta) = get_json::<ServerMetadata>(client, url).await {
            return Ok(meta);
        }
    }
    Err("This server doesn't publish OAuth metadata".into())
}

#[derive(Deserialize)]
struct RegisteredClient {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
}

async fn register(client: &reqwest::Client, server_url: &str) -> Result<Registration, String> {
    let meta = discover(client, server_url).await?;
    let endpoint = meta
        .registration_endpoint
        .ok_or("This server doesn't let apps register for sign-in")?;
    let endpoint = https(&endpoint)?;
    let methods = &meta.token_endpoint_auth_methods_supported;
    // A public client (PKCE, no secret) when the server allows it.
    let auth_method = if methods.is_empty() || methods.iter().any(|m| m == "none") {
        "none"
    } else if methods.iter().any(|m| m == "client_secret_post") {
        "client_secret_post"
    } else {
        "client_secret_basic"
    };
    let mut body = json!({
        "client_name": CLIENT_NAME,
        "software_id": SOFTWARE_ID,
        "software_version": env!("CARGO_PKG_VERSION"),
        "redirect_uris": [redirect_uri()],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": auth_method,
    });
    if let Some(uri) = CLIENT_URI {
        body["client_uri"] = json!(uri);
    }
    if let Some(uri) = LOGO_URI {
        body["logo_uri"] = json!(uri);
    }
    let response = client
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't register with the server: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let detail: String = response.text().await.unwrap_or_default().chars().take(300).collect();
        return Err(format!("The server refused to register Mali Cowork ({status}): {detail}"));
    }
    let registered: RegisteredClient = response.json().await.map_err(|e| e.to_string())?;
    Ok(Registration {
        server_url: server_url.trim().to_string(),
        client_id: registered.client_id,
        client_secret: registered.client_secret,
        redirect_uri: redirect_uri(),
    })
}

/// Make sure Mali Cowork has its own client with this server. Returns false
/// when the server doesn't support that (OpenCode's own flow is used then).
#[tauri::command]
pub async fn mcp_oauth_prepare(id: String, url: String, fresh: Option<bool>) -> Result<bool, String> {
    if fresh.unwrap_or(false) {
        forget(&id)?;
    } else if oauth_config_for(&id, &url).is_some() {
        return Ok(true);
    }
    match register(&client()?, &url).await {
        Ok(reg) => {
            let mut map = store().lock().unwrap_or_else(|p| p.into_inner());
            map.insert(id, reg);
            save_store(&map)?;
            Ok(true)
        }
        Err(e) => {
            eprintln!("[mcp-oauth] {url}: {e}; using OpenCode's sign-in");
            Ok(false)
        }
    }
}

// ---------------------------------------------------------------- callback

/// What came back to the loopback callback.
pub enum Callback {
    Code(String),
    Denied(String),
}

fn cancels() -> &'static Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>> = OnceLock::new();
    CANCELS.get_or_init(Default::default)
}

#[tauri::command]
pub fn mcp_auth_cancel(id: String) {
    if let Some(tx) = cancels().lock().unwrap().remove(&id) {
        let _ = tx.send(true);
    }
}

pub struct CallbackServer {
    listener: TcpListener,
    id: String,
    cancel: tokio::sync::watch::Receiver<bool>,
}

impl Drop for CallbackServer {
    fn drop(&mut self) {
        cancels().lock().unwrap().remove(&self.id);
    }
}

/// Listen on the callback port before the flow starts, so OpenCode (which
/// checks the port) doesn't start a callback server of its own there.
pub async fn listen(id: &str) -> Result<CallbackServer, String> {
    let listener = TcpListener::bind(("127.0.0.1", CALLBACK_PORT)).await.map_err(|_| {
        "Another sign-in is already waiting. Finish or cancel it first.".to_string()
    })?;
    let (tx, rx) = tokio::sync::watch::channel(false);
    cancels().lock().unwrap().insert(id.to_string(), tx);
    Ok(CallbackServer { listener, id: id.to_string(), cancel: rx })
}

/// True when the request's `Host` is a loopback name on the port we are
/// listening on. `localhost` counts: browsers resolve it to the loopback
/// themselves, so it can't be pointed elsewhere. Any other name can.
fn host_is_loopback(request: &str, port: u16) -> bool {
    let Some(host) = request
        .lines()
        .take_while(|line| !line.trim().is_empty())
        .find_map(|line| line.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("host")))
        .map(|(_, v)| v.trim())
    else {
        // HTTP/1.1 requires Host; a request without one didn't come from a
        // browser finishing a sign-in.
        return false;
    };
    let Some((name, given_port)) = host.rsplit_once(':') else { return false };
    if given_port.parse::<u16>() != Ok(port) {
        return false;
    }
    matches!(name.trim_matches(['[', ']']), "127.0.0.1" | "localhost" | "::1")
}

fn query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        (k == key).then(|| percent_decode(v))
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(b)) => {
                out.push(b);
                i += 3;
            }
            (b'+', _) => {
                out.push(b' ');
                i += 1;
            }
            (b, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

/// The page the browser shows after signing in, in the app's own look.
pub fn page(service: &str, error: Option<&str>) -> String {
    let icon = base64::engine::general_purpose::STANDARD.encode(APP_ICON);
    let (title, message) = match error {
        None => (
            format!("Connected to {}", escape(service)),
            "Mali Cowork can now use it. You can close this tab and go back to the app.".to_string(),
        ),
        Some(e) => (
            format!("Couldn’t connect to {}", escape(service)),
            format!("{} — go back to Mali Cowork and try again.", escape(e)),
        ),
    };
    let accent = if error.is_some() { "#dc2626" } else { "#16a34a" };
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mali Cowork</title><style>
:root{{color-scheme:light dark}}body{{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;background:#fafafa;color:#18181b}}
@media (prefers-color-scheme:dark){{body{{background:#18181b;color:#fafafa}}.card{{background:#27272a!important;border-color:#3f3f46!important}}p{{color:#a1a1aa!important}}}}
.card{{max-width:420px;margin:24px;padding:32px;border:1px solid #e4e4e7;border-radius:20px;background:#fff;text-align:center}}
img{{width:64px;height:64px;border-radius:16px}}h1{{font-size:20px;margin:16px 0 6px}}p{{margin:0;color:#71717a}}
.dot{{display:inline-block;width:8px;height:8px;border-radius:50%;background:{accent};margin-right:8px;vertical-align:middle}}
small{{display:block;margin-top:20px;color:#a1a1aa;font-size:12px}}</style></head>
<body><div class="card"><img alt="Mali Cowork" src="data:image/png;base64,{icon}"><h1><span class="dot"></span>{title}</h1><p>{message}</p><small>Mali Cowork · sign-in handled on this computer</small></div></body></html>"#
    )
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, body: &str) {
    // `no-store` keeps the code out of the browser cache; `no-referrer` keeps
    // it out of the next page's Referer header; the CSP makes the page inert
    // even if a service ever got text past `escape`.
    let head = format!(
        "HTTP/1.1 {status}\r\n         Content-Type: text/html; charset=utf-8\r\n         Content-Length: {}\r\n         Cache-Control: no-store\r\n         Referrer-Policy: no-referrer\r\n         X-Content-Type-Options: nosniff\r\n         X-Frame-Options: DENY\r\n         Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'\r\n         Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

impl CallbackServer {
    /// Wait for the browser to come back with our `state`. Other requests
    /// (favicon, stray tabs, a wrong state) are answered and ignored.
    pub async fn wait(&mut self, expected_state: &str, service: &str) -> Result<Callback, String> {
        let deadline = tokio::time::Instant::now() + SIGN_IN_TIMEOUT;
        let local_port = self.listener.local_addr().map(|a| a.port()).unwrap_or(CALLBACK_PORT);
        loop {
            let accept = tokio::select! {
                accepted = self.listener.accept() => accepted,
                _ = tokio::time::sleep_until(deadline) => return Err("Sign-in wasn't finished in time. Try again.".into()),
                _ = self.cancel.changed() => return Err("Sign-in cancelled".into()),
            };
            let Ok((mut stream, _)) = accept else { continue };
            let mut buffer = vec![0u8; 8192];
            let read = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer)).await;
            let Ok(Ok(n)) = read else { continue };
            let request = String::from_utf8_lossy(&buffer[..n]);
            // A web page can point any hostname at 127.0.0.1 (DNS rebinding) and
            // then talk to this port as if it were its own origin. The browser
            // still sends that name in `Host`, so only the literal loopback
            // address — what our own redirect_uri uses — is answered.
            if !host_is_loopback(&request, local_port) {
                respond(&mut stream, "421 Misdirected Request", "").await;
                continue;
            }
            let target = request.lines().next().and_then(|line| line.split_whitespace().nth(1)).unwrap_or("/");
            let (path, query) = target.split_once('?').unwrap_or((target, ""));
            if path != CALLBACK_PATH {
                respond(&mut stream, "404 Not Found", "").await;
                continue;
            }
            if query_param(query, "state").as_deref() != Some(expected_state) {
                // Not our flow (or forged): never pass its code on.
                respond(&mut stream, "400 Bad Request", &page(service, Some("This sign-in link has expired"))).await;
                continue;
            }
            if let Some(error) = query_param(query, "error") {
                let detail = query_param(query, "error_description").unwrap_or(error);
                respond(&mut stream, "200 OK", &page(service, Some(&detail))).await;
                return Ok(Callback::Denied(detail));
            }
            let Some(code) = query_param(query, "code").filter(|c| !c.is_empty()) else {
                respond(&mut stream, "400 Bad Request", &page(service, Some("No authorization code"))).await;
                continue;
            };
            respond(&mut stream, "200 OK", &page(service, None)).await;
            return Ok(Callback::Code(code));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn well_known_urls() {
        let base = reqwest::Url::parse("https://mcp.example.com/v1/mcp").unwrap();
        assert_eq!(
            well_known(&base, "oauth-protected-resource", true).as_str(),
            "https://mcp.example.com/.well-known/oauth-protected-resource/v1/mcp"
        );
        assert_eq!(
            well_known(&base, "oauth-authorization-server", false).as_str(),
            "https://mcp.example.com/.well-known/oauth-authorization-server"
        );
    }

    #[test]
    fn only_answers_our_own_loopback_host() {
        let req = |host: &str| format!("GET {CALLBACK_PATH}?code=a HTTP/1.1\r\nHost: {host}\r\n\r\n");
        assert!(host_is_loopback(&req("127.0.0.1:19877"), 19877));
        assert!(host_is_loopback(&req("localhost:19877"), 19877));
        // A page that pointed its own name at 127.0.0.1 sends that name.
        assert!(!host_is_loopback(&req("evil.example:19877"), 19877));
        // Another local listener's port is not ours.
        assert!(!host_is_loopback(&req("127.0.0.1:80"), 19877));
        assert!(!host_is_loopback("GET / HTTP/1.1\r\n\r\n", 19877));
    }

    #[test]
    fn reads_callback_query() {
        let q = "code=abc%2F123&state=xyz&scope=a+b";
        assert_eq!(query_param(q, "code").as_deref(), Some("abc/123"));
        assert_eq!(query_param(q, "state").as_deref(), Some("xyz"));
        assert_eq!(query_param(q, "scope").as_deref(), Some("a b"));
        assert_eq!(query_param(q, "missing"), None);
    }

    #[test]
    fn page_escapes_what_the_server_sent() {
        let html = page("evil.example", Some("<script>alert(1)</script>"));
        assert!(!html.contains("<script>alert"));
        assert!(html.contains("Mali Cowork"));
    }

    #[test]
    fn only_https_endpoints() {
        assert!(https("http://auth.example.com").is_err());
        assert!(https("https://auth.example.com").is_ok());
        assert!(https("http://127.0.0.1:3845/mcp").is_ok());
    }

    #[tokio::test]
    async fn callback_checks_state() {
        let (_cancel, cancel) = tokio::sync::watch::channel(false);
        let mut server = CallbackServer {
            listener: TcpListener::bind(("127.0.0.1", 0)).await.unwrap(),
            id: "test".into(),
            cancel,
        };
        let port = server.listener.local_addr().unwrap().port();
        let send = move |path: String| async move {
            let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes())
                .await
                .unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out).await;
            out
        };
        let client = tokio::spawn(async move {
            let wrong = send(format!("{CALLBACK_PATH}?code=stolen&state=other")).await;
            assert!(wrong.starts_with("HTTP/1.1 400"));
            let ok = send(format!("{CALLBACK_PATH}?code=good&state=expected")).await;
            assert!(ok.contains("Connected to Example"));
        });
        match server.wait("expected", "Example").await.unwrap() {
            Callback::Code(code) => assert_eq!(code, "good"),
            Callback::Denied(e) => panic!("{e}"),
        }
        client.await.unwrap();
    }

    /// Reads real servers' OAuth metadata (no registration):
    /// `cargo test --lib discovers_live -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn discovers_live() {
        let client = client().unwrap();
        for url in ["https://mcp.linear.app/mcp", "https://mcp.notion.com/mcp", "https://mcp.figma.com/mcp"] {
            let meta = discover(&client, url).await.unwrap();
            println!("{url}: register={:?} methods={:?}", meta.registration_endpoint, meta.token_endpoint_auth_methods_supported);
            assert!(meta.registration_endpoint.is_some());
        }
    }
}

