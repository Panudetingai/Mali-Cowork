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
    /// How the token endpoint wants the client to authenticate.
    #[serde(default)]
    pub auth_method: Option<String>,
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
    authorization_endpoint: Option<String>,
    #[serde(default)]
    token_endpoint: Option<String>,
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
        auth_method: Some(auth_method.to_string()),
    })
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


// ---------------------------------------------------------------- Mali's own tokens
//
// Mali signs in itself — PKCE with the client registered above — and keeps
// the tokens in an owner-only file next to the registrations. They are used
// by Mali's MCP hub only: never sent to the webview, the model, or another app.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    server_url: String,
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// Unix seconds.
    #[serde(default)]
    expires_at: Option<u64>,
    token_endpoint: String,
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
    #[serde(default)]
    auth_method: Option<String>,
}

fn tokens_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("mali-cowork")
        .join("mcp-oauth-tokens.json")
}

fn tokens() -> &'static Mutex<HashMap<String, Tokens>> {
    static TOKENS: OnceLock<Mutex<HashMap<String, Tokens>>> = OnceLock::new();
    TOKENS.get_or_init(|| {
        let saved = std::fs::read_to_string(tokens_path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Mutex::new(saved)
    })
}

fn save_tokens(map: &HashMap<String, Tokens>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    write_private(&tokens_path(), &json)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_token() -> String {
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    b64url(&bytes)
}

/// PKCE (RFC 7636): the verifier we keep, and its S256 challenge we send.
fn pkce() -> (String, String) {
    use sha2::Digest;
    let verifier = random_token();
    let challenge = b64url(&sha2::Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// Post to the token endpoint the way the client registered to authenticate.
async fn token_request(
    client: &reqwest::Client,
    endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    auth_method: Option<&str>,
    mut form: Vec<(&str, String)>,
) -> Result<Value, String> {
    let mut request = client.post(endpoint).header("Accept", "application/json");
    match (client_secret, auth_method) {
        (Some(secret), Some("client_secret_basic")) => {
            request = request.basic_auth(client_id, Some(secret));
        }
        (Some(secret), _) => {
            form.push(("client_id", client_id.to_string()));
            form.push(("client_secret", secret.to_string()));
        }
        (None, _) => form.push(("client_id", client_id.to_string())),
    }
    let response = request.form(&form).send().await.map_err(|e| format!("Couldn't reach the sign-in server: {e}"))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() || body["access_token"].as_str().is_none() {
        let why = body["error_description"].as_str().or_else(|| body["error"].as_str()).unwrap_or("no token in the answer");
        return Err(format!("The server didn't hand out a token ({status}): {why}"));
    }
    Ok(body)
}

fn tokens_from(body: &Value, previous_refresh: Option<String>, base: Tokens) -> Tokens {
    Tokens {
        access_token: body["access_token"].as_str().unwrap_or_default().to_string(),
        refresh_token: body["refresh_token"].as_str().map(str::to_string).or(previous_refresh),
        expires_at: body["expires_in"].as_u64().map(|s| now_secs() + s),
        ..base
    }
}

/// A token for the hub to call a remote server with, refreshed when it's about to expire.
pub async fn access_token(id: &str, url: &str) -> Option<String> {
    let saved = tokens().lock().unwrap_or_else(|p| p.into_inner()).get(id).cloned()?;
    if !same_url(&saved.server_url, url) {
        return None;
    }
    let fresh = saved.expires_at.map(|at| at > now_secs() + 60).unwrap_or(true);
    if fresh {
        return Some(saved.access_token);
    }
    let refresh = saved.refresh_token.clone()?;
    let client = client().ok()?;
    let form = vec![
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh.clone()),
        ("resource", saved.server_url.clone()),
    ];
    match token_request(
        &client,
        &saved.token_endpoint,
        &saved.client_id,
        saved.client_secret.as_deref(),
        saved.auth_method.as_deref(),
        form,
    )
    .await
    {
        Ok(body) => {
            let updated = tokens_from(&body, Some(refresh), saved);
            let token = updated.access_token.clone();
            let mut map = tokens().lock().unwrap_or_else(|p| p.into_inner());
            map.insert(id.to_string(), updated);
            let _ = save_tokens(&map);
            Some(token)
        }
        Err(e) => {
            eprintln!("[mcp-oauth] {id}: refresh failed: {e}");
            None
        }
    }
}

/// Forget Mali's tokens for a server (sign out).
pub fn sign_out(id: &str) -> Result<(), String> {
    let mut map = tokens().lock().unwrap_or_else(|p| p.into_inner());
    if map.remove(id).is_some() {
        save_tokens(&map)?;
    }
    Ok(())
}

/// Sign in to a remote MCP server as Mali Cowork: the browser shows the
/// provider's consent page, the callback lands on loopback, and the tokens stay
/// with Mali.
pub async fn sign_in(app: &tauri::AppHandle, id: &str, server_url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let client = client()?;
    let existing = store().lock().unwrap_or_else(|p| p.into_inner()).get(id).cloned();
    let reg = match existing.filter(|r| same_url(&r.server_url, server_url) && r.redirect_uri == redirect_uri()) {
        Some(reg) => reg,
        None => {
            let reg = register(&client, server_url).await.map_err(|e| {
                format!("{e}. Add the service's API token in the connector's headers instead.")
            })?;
            let mut map = store().lock().unwrap_or_else(|p| p.into_inner());
            map.insert(id.to_string(), reg.clone());
            save_store(&map)?;
            reg
        }
    };
    let meta = discover(&client, server_url).await?;
    let authorize = meta.authorization_endpoint.ok_or("The server doesn't say where to sign in")?;
    let token_endpoint = meta.token_endpoint.ok_or("The server doesn't say where to get a token")?;
    let mut authorize = https(&authorize)?;
    https(&token_endpoint)?;

    let (verifier, challenge) = pkce();
    let state = random_token();
    // Bind before opening the browser, so the callback can't be missed.
    let mut callback = listen(id).await?;
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &reg.client_id)
        .append_pair("redirect_uri", &reg.redirect_uri)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("resource", server_url.trim());
    app.opener()
        .open_url(authorize.as_str(), None::<&str>)
        .map_err(|e| format!("Couldn't open the browser: {e}"))?;
    let service = reqwest::Url::parse(server_url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| "the service".into());
    let code = match callback.wait(&state, &service).await? {
        Callback::Code(code) => code,
        Callback::Denied(reason) => return Err(format!("Sign-in was declined: {reason}")),
    };
    let form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", reg.redirect_uri.clone()),
        ("code_verifier", verifier),
        ("resource", server_url.trim().to_string()),
    ];
    let body = token_request(
        &client,
        &token_endpoint,
        &reg.client_id,
        reg.client_secret.as_deref(),
        reg.auth_method.as_deref(),
        form,
    )
    .await?;
    let tokens_for_server = tokens_from(
        &body,
        None,
        Tokens {
            server_url: server_url.trim().to_string(),
            access_token: String::new(),
            refresh_token: None,
            expires_at: None,
            token_endpoint,
            client_id: reg.client_id.clone(),
            client_secret: reg.client_secret.clone(),
            auth_method: reg.auth_method.clone(),
        },
    );
    let mut map = tokens().lock().unwrap_or_else(|p| p.into_inner());
    map.insert(id.to_string(), tokens_for_server);
    save_tokens(&map)
}

#[cfg(test)]
mod native_tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_s256_of_the_verifier() {
        use sha2::Digest;
        let (verifier, challenge) = pkce();
        assert!(verifier.len() >= 43);
        assert_eq!(challenge, b64url(&sha2::Sha256::digest(verifier.as_bytes())));
        assert!(!challenge.contains('='));
    }

    #[test]
    fn a_refresh_keeps_the_old_refresh_token_when_none_comes_back() {
        let base = Tokens {
            server_url: "https://x".into(),
            access_token: "old".into(),
            refresh_token: Some("r1".into()),
            expires_at: None,
            token_endpoint: "https://x/token".into(),
            client_id: "c".into(),
            client_secret: None,
            auth_method: None,
        };
        let t = tokens_from(&json!({ "access_token": "new", "expires_in": 3600 }), Some("r1".into()), base);
        assert_eq!(t.access_token, "new");
        assert_eq!(t.refresh_token.as_deref(), Some("r1"));
        assert!(t.expires_at.unwrap() > now_secs());
    }
}
