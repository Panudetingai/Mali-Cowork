//! A client for one MCP server: JSON-RPC over the server's stdio (local
//! servers, started through `mali-mcp-runner` so the sandbox policy applies)
//! or over Streamable HTTP (remote servers, with Mali's own OAuth token).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::StreamExt;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::oneshot;

use crate::commands::mcp::{resolve_argv, server_config, McpServerEntry};
use crate::commands::mcp_oauth;

pub const PROTOCOL_VERSION: &str = "2025-06-18";
/// Errors that mean "sign in first" start with this.
pub const NEEDS_AUTH: &str = "needs_auth:";
/// Kept from a local server's stderr, to explain why it stopped.
const STDERR_TAIL: usize = 2_000;

#[derive(Debug, Clone)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

struct Stdio {
    stdin: Arc<tokio::sync::Mutex<ChildStdin>>,
    pending: Pending,
    alive: Arc<AtomicBool>,
    stderr: Arc<Mutex<String>>,
    child: Mutex<Option<Child>>,
}

impl Drop for Stdio {
    fn drop(&mut self) {
        if let Some(child) = self.child.lock().unwrap().take() {
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                // The runner leads its own process group: end the whole tree.
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGTERM);
                }
            }
            drop(child); // kill_on_drop
        }
    }
}

struct Http {
    id: String,
    url: String,
    headers: HashMap<String, String>,
    session: Mutex<Option<String>>,
    client: reqwest::Client,
}

enum Transport {
    Stdio(Stdio),
    Http(Http),
}

/// A connected server and the tools it offers.
pub struct Conn {
    pub id: String,
    pub tools: Vec<ToolDef>,
    transport: Transport,
    next: AtomicU64,
    timeout: Duration,
}

fn rpc_error(error: &Value) -> String {
    let message = error["message"].as_str().unwrap_or("error");
    match error["code"].as_i64() {
        Some(code) => format!("{message} ({code})"),
        None => message.to_string(),
    }
}

impl Conn {
    pub fn alive(&self) -> bool {
        match &self.transport {
            Transport::Stdio(s) => s.alive.load(Ordering::SeqCst),
            Transport::Http(_) => true,
        }
    }

    async fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        match &self.transport {
            Transport::Stdio(s) => {
                if !s.alive.load(Ordering::SeqCst) {
                    return Err(stopped_message(&s.stderr));
                }
                let (tx, rx) = oneshot::channel();
                s.pending.lock().unwrap().insert(id, tx);
                if let Err(e) = write_line(&s.stdin, &message).await {
                    s.pending.lock().unwrap().remove(&id);
                    return Err(e);
                }
                match tokio::time::timeout(timeout, rx).await {
                    Ok(Ok(result)) => result,
                    Ok(Err(_)) => Err(stopped_message(&s.stderr)),
                    Err(_) => {
                        s.pending.lock().unwrap().remove(&id);
                        Err(format!("{} didn't answer {method} within {}s", self.id, timeout.as_secs()))
                    }
                }
            }
            Transport::Http(h) => tokio::time::timeout(timeout, h.post(&message, Some(id)))
                .await
                .map_err(|_| format!("{} didn't answer {method} within {}s", self.id, timeout.as_secs()))?
                .map(|v| v.unwrap_or(Value::Null)),
        }
    }

    async fn notify(&self, method: &str) {
        let message = json!({ "jsonrpc": "2.0", "method": method });
        match &self.transport {
            Transport::Stdio(s) => {
                let _ = write_line(&s.stdin, &message).await;
            }
            Transport::Http(h) => {
                let _ = h.post(&message, None).await;
            }
        }
    }

    /// Call one tool: the text the model gets back, whether it failed, and any pictures it returned.
    pub async fn call(&self, tool: &str, args: Value) -> Result<ToolResult, String> {
        let args = if args.is_object() { args } else { json!({}) };
        let result = self
            .request("tools/call", json!({ "name": tool, "arguments": args }), self.timeout)
            .await?;
        Ok(ToolResult {
            text: content_text(&result),
            is_error: result["isError"].as_bool().unwrap_or(false),
            images: content_images(&result),
        })
    }

    async fn handshake(&mut self) -> Result<(), String> {
        let init = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "Mali Cowork", "version": env!("CARGO_PKG_VERSION") },
                }),
                self.timeout,
            )
            .await?;
        if !init.is_object() {
            return Err(format!("{} didn't complete the MCP handshake", self.id));
        }
        self.notify("notifications/initialized").await;
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let page = self.request("tools/list", params, self.timeout).await?;
            for tool in page["tools"].as_array().into_iter().flatten() {
                let Some(name) = tool["name"].as_str() else { continue };
                tools.push(ToolDef {
                    name: name.to_string(),
                    description: tool["description"].as_str().unwrap_or_default().to_string(),
                    schema: match &tool["inputSchema"] {
                        s if s.is_object() => s.clone(),
                        _ => json!({ "type": "object", "properties": {} }),
                    },
                });
            }
            cursor = page["nextCursor"].as_str().map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        self.tools = tools;
        Ok(())
    }
}

/// What a tool call came back with.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolResult {
    pub text: String,
    pub is_error: bool,
    pub images: Vec<crate::agent::wire::ToolImage>,
}

/// Pictures in a tool result, scaled down for the model.
pub fn content_images(result: &Value) -> Vec<crate::agent::wire::ToolImage> {
    result["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["type"] == "image")
        .filter_map(|item| crate::agent::images::from_base64(item["data"].as_str()?))
        .take(4)
        .collect()
}

/// A tool result as text: text parts as they are, anything else described.
pub fn content_text(result: &Value) -> String {
    let mut parts = Vec::new();
    for item in result["content"].as_array().into_iter().flatten() {
        match item["type"].as_str().unwrap_or_default() {
            "text" => parts.push(item["text"].as_str().unwrap_or_default().to_string()),
            "image" => parts.push(format!(
                "[picture ({}) returned]",
                item["mimeType"].as_str().unwrap_or("unknown type")
            )),
            "audio" => parts.push(format!(
                "[{} ({}) returned; not shown]",
                item["type"].as_str().unwrap_or_default(),
                item["mimeType"].as_str().unwrap_or("unknown type")
            )),
            "resource" => {
                let r = &item["resource"];
                parts.push(r["text"].as_str().map(str::to_string).unwrap_or_else(|| {
                    format!("[resource {}]", r["uri"].as_str().unwrap_or_default())
                }));
            }
            "resource_link" => parts.push(format!(
                "[link: {} {}]",
                item["name"].as_str().unwrap_or_default(),
                item["uri"].as_str().unwrap_or_default()
            )),
            _ => {}
        }
    }
    if parts.is_empty() {
        if let Some(structured) = result.get("structuredContent").filter(|v| !v.is_null()) {
            return structured.to_string();
        }
        return "(no output)".into();
    }
    parts.join("\n")
}

fn stopped_message(stderr: &Mutex<String>) -> String {
    let tail = stderr.lock().unwrap().trim().to_string();
    if tail.is_empty() {
        "The MCP server stopped".into()
    } else {
        format!("The MCP server stopped: {}", tail.lines().last().unwrap_or_default())
    }
}

async fn write_line(stdin: &tokio::sync::Mutex<ChildStdin>, message: &Value) -> Result<(), String> {
    let mut line = message.to_string();
    line.push('\n');
    let mut stdin = stdin.lock().await;
    stdin.write_all(line.as_bytes()).await.map_err(|e| format!("Couldn't reach the MCP server: {e}"))?;
    stdin.flush().await.map_err(|e| format!("Couldn't reach the MCP server: {e}"))
}

/// A request the server sends us: answered so it never waits on the app.
fn answer_server_request(message: &Value) -> Value {
    let id = message["id"].clone();
    match message["method"].as_str().unwrap_or_default() {
        "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
        "roots/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "roots": [] } }),
        _ => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Not supported by Mali Cowork" } }),
    }
}

fn spawn_stdio(argv: &[String], env: &HashMap<String, String>) -> Result<Stdio, String> {
    let (program, args) = argv.split_first().ok_or("No command to start")?;
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut cmd = crate::commands::process::command(program, &arg_refs);
    cmd.envs(env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start {program}: {e}"))?;
    let stdin = child.stdin.take().ok_or("The server has no stdin")?;
    let stdout = child.stdout.take().ok_or("The server has no stdout")?;
    let stderr = child.stderr.take();

    let stdin = Arc::new(tokio::sync::Mutex::new(stdin));
    let pending: Pending = Arc::default();
    let alive = Arc::new(AtomicBool::new(true));
    let tail = Arc::new(Mutex::new(String::new()));

    if let Some(stderr) = stderr {
        let tail = tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut t = tail.lock().unwrap();
                t.push_str(&line);
                t.push('\n');
                if t.len() > STDERR_TAIL {
                    let cut = t.len() - STDERR_TAIL;
                    let cut = (cut..t.len()).find(|&i| t.is_char_boundary(i)).unwrap_or(t.len());
                    t.drain(..cut);
                }
            }
        });
    }

    {
        let (stdin, pending, alive, tail) = (stdin.clone(), pending.clone(), alive.clone(), tail.clone());
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(message) = serde_json::from_str::<Value>(line.trim()) else { continue };
                let is_response = message.get("result").is_some() || message.get("error").is_some();
                if is_response {
                    if let Some(id) = message["id"].as_u64() {
                        if let Some(tx) = pending.lock().unwrap().remove(&id) {
                            let _ = tx.send(match message.get("error") {
                                Some(error) if !error.is_null() => Err(rpc_error(error)),
                                _ => Ok(message["result"].clone()),
                            });
                        }
                    }
                } else if message.get("id").is_some() && message.get("method").is_some() {
                    let _ = write_line(&stdin, &answer_server_request(&message)).await;
                }
            }
            alive.store(false, Ordering::SeqCst);
            let why = stopped_message(&tail);
            for (_, tx) in pending.lock().unwrap().drain() {
                let _ = tx.send(Err(why.clone()));
            }
        });
    }

    Ok(Stdio { stdin, pending, alive, stderr: tail, child: Mutex::new(Some(child)) })
}

impl Http {
    /// POST one message; for a request, the matching response's `result`.
    async fn post(&self, message: &Value, id: Option<u64>) -> Result<Option<Value>, String> {
        let mut request = self
            .client
            .post(&self.url)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL_VERSION)
            .json(message);
        let has_auth = self.headers.keys().any(|k| k.eq_ignore_ascii_case("authorization"));
        for (key, value) in &self.headers {
            request = request.header(key, value);
        }
        if !has_auth {
            if let Some(token) = mcp_oauth::access_token(&self.id, &self.url).await {
                request = request.bearer_auth(token);
            }
        }
        if let Some(session) = self.session.lock().unwrap().clone() {
            request = request.header("Mcp-Session-Id", session);
        }
        let response = request.send().await.map_err(|e| format!("Couldn't reach {}: {e}", self.url))?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN && !has_auth {
            return Err(format!("{NEEDS_AUTH} sign in to {} first", self.id));
        }
        if status == reqwest::StatusCode::NOT_FOUND && self.session.lock().unwrap().is_some() {
            // The server forgot our session; the next connect starts a new one.
            *self.session.lock().unwrap() = None;
            return Err("The MCP session expired; reconnect and try again".into());
        }
        if !status.is_success() {
            let body: String = response.text().await.unwrap_or_default().chars().take(300).collect();
            return Err(format!("{} answered {status}: {body}", self.url));
        }
        if let Some(session) = response.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            *self.session.lock().unwrap() = Some(session.to_string());
        }
        let Some(id) = id else { return Ok(None) };
        let sse = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        if sse {
            let mut stream = response.bytes_stream();
            let mut buffer = Vec::new();
            while let Some(chunk) = stream.next().await {
                buffer.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
                while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = buffer.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&line);
                    let Some(data) = line.trim_end().strip_prefix("data:") else { continue };
                    let Ok(message) = serde_json::from_str::<Value>(data.trim()) else { continue };
                    if let Some(found) = match_response(&message, id) {
                        return found.map(Some);
                    }
                }
            }
            return Err(format!("{} closed the stream without answering", self.url));
        }
        let body: Value = response.json().await.map_err(|e| format!("{} sent something that isn't JSON: {e}", self.url))?;
        let messages = if body.is_array() { body.as_array().cloned().unwrap_or_default() } else { vec![body] };
        for message in &messages {
            if let Some(found) = match_response(message, id) {
                return found.map(Some);
            }
        }
        Err(format!("{} didn't answer the request", self.url))
    }
}

fn match_response(message: &Value, id: u64) -> Option<Result<Value, String>> {
    if message["id"].as_u64() != Some(id) {
        return None;
    }
    Some(match message.get("error") {
        Some(error) if !error.is_null() => Err(rpc_error(error)),
        _ => Ok(message["result"].clone()),
    })
}

/// How long to wait for a server: its own setting, with room for a first start
/// that downloads the package (`npx`, `uvx`).
fn timeout_for(server: &McpServerEntry) -> Duration {
    Duration::from_millis(server.timeout().max(60_000))
}

/// Start (or reach) a server and read its tools.
pub async fn connect(server: &McpServerEntry) -> Result<Conn, String> {
    let timeout = timeout_for(server);
    if server.is_remote() {
        let url = server.url.as_deref().unwrap_or_default().trim().to_string();
        if url.is_empty() {
            return Err("No URL for this connector".into());
        }
        let client = reqwest::Client::builder()
            .user_agent("mali-cowork")
            .connect_timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| e.to_string())?;
        let mut conn = Conn {
            id: server.id.clone(),
            tools: Vec::new(),
            transport: Transport::Http(Http {
                id: server.id.clone(),
                url,
                headers: server.headers.clone(),
                session: Mutex::new(None),
                client,
            }),
            next: AtomicU64::new(1),
            timeout,
        };
        conn.handshake().await?;
        return Ok(conn);
    }

    let mut candidates: Vec<&Vec<String>> = vec![&server.command];
    for fallback in &server.fallbacks {
        if !fallback.is_empty() && !candidates.contains(&fallback) {
            candidates.push(fallback);
        }
    }
    let mut last = String::from("No command to start");
    for command in candidates {
        let config = server_config(server, &resolve_argv(command));
        let argv: Vec<String> = config["command"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        let env: HashMap<String, String> = config["environment"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
            .collect();
        let stdio = match spawn_stdio(&argv, &env) {
            Ok(s) => s,
            Err(e) => {
                last = e;
                continue;
            }
        };
        let mut conn = Conn {
            id: server.id.clone(),
            tools: Vec::new(),
            transport: Transport::Stdio(stdio),
            next: AtomicU64::new(1),
            timeout,
        };
        match conn.handshake().await {
            Ok(()) => return Ok(conn),
            Err(e) => last = e,
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_every_kind_of_content() {
        let result = json!({ "content": [
            { "type": "text", "text": "hello" },
            { "type": "image", "mimeType": "image/png", "data": "…" },
            { "type": "resource", "resource": { "uri": "file:///a", "text": "body" } },
        ]});
        assert_eq!(content_text(&result), "hello\n[picture (image/png) returned]\nbody");
        assert_eq!(content_text(&json!({ "structuredContent": { "n": 1 } })), "{\"n\":1}");
        assert_eq!(content_text(&json!({})), "(no output)");
    }

    #[test]
    fn server_requests_get_an_answer() {
        let ping = answer_server_request(&json!({ "id": 7, "method": "ping" }));
        assert_eq!(ping["id"], 7);
        assert!(ping["result"].is_object());
        let other = answer_server_request(&json!({ "id": "x", "method": "sampling/createMessage" }));
        assert_eq!(other["error"]["code"], -32601);
    }

    /// A Streamable-HTTP server: SSE answers, a session id, 202 for notifications.
    #[tokio::test]
    async fn talks_to_a_streamable_http_server() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let sessions = Arc::new(Mutex::new(Vec::<Option<String>>::new()));
        let log = sessions.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let mut req = Vec::new();
                let mut buf = [0u8; 8192];
                let (head, body) = loop {
                    let n = sock.read(&mut buf).await.unwrap();
                    if n == 0 { return; }
                    req.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&req).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text[..end].lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                        if req.len() >= end + 4 + len {
                            break (text[..end].to_ascii_lowercase(), text[end + 4..end + 4 + len].to_string());
                        }
                    }
                };
                log.lock().unwrap().push(head.lines().find_map(|l| l.strip_prefix("mcp-session-id:").map(|v| v.trim().to_string())));
                let msg: Value = serde_json::from_str(&body).unwrap();
                let reply = match msg["method"].as_str().unwrap() {
                    "initialize" => Some(json!({"protocolVersion": PROTOCOL_VERSION, "capabilities": {}})),
                    "tools/list" => Some(json!({"tools": [{"name": "search", "inputSchema": {"type": "object"}}]})),
                    "tools/call" => Some(json!({"content": [{"type": "text", "text": "found 3"}]})),
                    _ => None,
                };
                let response = match reply {
                    None => "HTTP/1.1 202 Accepted\r\ncontent-length: 0\r\nconnection: close\r\n\r\n".to_string(),
                    Some(result) => {
                        let event = format!("event: message\ndata: {}\n\n", json!({"jsonrpc": "2.0", "id": msg["id"], "result": result}));
                        format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nmcp-session-id: s-42\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{event}", event.len())
                    }
                };
                sock.write_all(response.as_bytes()).await.unwrap();
                let _ = sock.shutdown().await;
            }
        });
        let server: McpServerEntry = serde_json::from_value(json!({
            "id": "custom-remote-test",
            "enabled": true,
            "kind": "remote",
            "url": format!("http://{addr}/mcp"),
        }))
        .unwrap();
        let conn = connect(&server).await.unwrap();
        assert_eq!(conn.tools[0].name, "search");
        assert_eq!(conn.call("search", json!({"q": "x"})).await.unwrap().text, "found 3");
        let sessions = sessions.lock().unwrap();
        // The first request starts the session; every later one carries it.
        assert_eq!(sessions[0], None);
        assert!(sessions[1..].iter().all(|s| s.as_deref() == Some("s-42")), "{sessions:?}");
    }

    /// A tiny MCP server in shell: answers initialize, tools/list and one call.
    #[cfg(unix)]
    #[tokio::test]
    async fn talks_to_a_stdio_server() {
        let script = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"t"}}}\n' "$id" ;;
    *'"tools/list"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"echo","description":"Echo","inputSchema":{"type":"object"}}]}}\n' "$id" ;;
    *'"tools/call"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"pong"}]}}\n' "$id" ;;
  esac
done
"#;
        let stdio = spawn_stdio(&["/bin/sh".into(), "-c".into(), script.into()], &HashMap::new()).unwrap();
        let mut conn = Conn {
            id: "t".into(),
            tools: Vec::new(),
            transport: Transport::Stdio(stdio),
            next: AtomicU64::new(1),
            timeout: Duration::from_secs(5),
        };
        conn.handshake().await.unwrap();
        assert_eq!(conn.tools.len(), 1);
        assert_eq!(conn.tools[0].name, "echo");
        let result = conn.call("echo", json!({})).await.unwrap();
        assert_eq!((result.text.as_str(), result.is_error), ("pong", false));
    }
}
