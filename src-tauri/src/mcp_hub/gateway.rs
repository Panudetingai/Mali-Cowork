//! The `mali` MCP server: how a CLI agent running inside Mali reaches the
//! user's connectors. It listens on the loopback only, answers only requests
//! that carry this app session's token, and forwards every call to the hub —
//! so the connectors themselves are never written into another app's config.
//!
//! The port and token change each time Mali starts; when Mali isn't running
//! there is nothing to connect to.

use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::client::PROTOCOL_VERSION;

/// The name CLIs see the gateway under: their tools read `mali_<connector>_<tool>`.
pub const SERVER_NAME: &str = "mali";
const MAX_BODY: usize = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct Gateway {
    pub port: u16,
    pub token: String,
}

impl Gateway {
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }

    pub fn authorization(&self) -> String {
        format!("Bearer {}", self.token)
    }
}

static GATEWAY: tokio::sync::OnceCell<Gateway> = tokio::sync::OnceCell::const_new();

/// The running gateway, started on first use.
pub async fn ensure() -> Result<Gateway, String> {
    GATEWAY
        .get_or_try_init(|| async {
            // Bound and served on the app's own runtime, which lives as long
            // as the app: a caller's runtime may be gone by the next request.
            let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
            let (tx, rx) = tokio::sync::oneshot::channel();
            let serve_token = token.clone();
            tauri::async_runtime::spawn(async move {
                match TcpListener::bind(("127.0.0.1", 0)).await {
                    Ok(listener) => {
                        let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
                        let gateway = Gateway { port, token: serve_token };
                        let _ = tx.send(Ok(port));
                        serve(listener, gateway).await;
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("Couldn't open Mali's connector gateway: {e}")));
                    }
                }
            });
            let port = rx.await.map_err(|_| "Mali's connector gateway didn't start".to_string())??;
            Ok(Gateway { port, token })
        })
        .await
        .cloned()
}

async fn serve(listener: TcpListener, gateway: Gateway) {
    loop {
        let Ok((stream, peer)) = listener.accept().await else { continue };
        if !peer.ip().is_loopback() {
            continue;
        }
        let gateway = gateway.clone();
        tokio::spawn(async move {
            let _ = handle(stream, &gateway).await;
        });
    }
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

async fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = tokio::time::timeout(Duration::from_secs(30), stream.read(&mut chunk)).await.ok()?.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        if buf.len() > 64 * 1024 {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect();
    let length: usize = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    if length > MAX_BODY {
        return None;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        let n = tokio::time::timeout(Duration::from_secs(30), stream.read(&mut chunk)).await.ok()?.ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Some(Request { method, path, headers, body })
}

async fn respond(stream: &mut TcpStream, status: &str, extra: &[(&str, String)], body: &str) {
    let mut head = format!(
        "HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\ncache-control: no-store\r\n",
        body.len()
    );
    if !body.is_empty() {
        head.push_str("content-type: application/json\r\n");
    }
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Compare without leaking how much of the token matched.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Only loopback names on our own port: a web page can't point its own domain here.
fn host_ok(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    ["127.0.0.1", "localhost", "[::1]"].iter().any(|name| host.eq_ignore_ascii_case(&format!("{name}:{port}")))
}

async fn handle(mut stream: TcpStream, gateway: &Gateway) -> Option<()> {
    let request = read_request(&mut stream).await?;
    if request.path.split('?').next() != Some("/mcp") {
        respond(&mut stream, "404 Not Found", &[], "").await;
        return Some(());
    }
    if !host_ok(request.header("host"), gateway.port) {
        respond(&mut stream, "403 Forbidden", &[], "").await;
        return Some(());
    }
    let authorized = request
        .header("authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| same_secret(t.trim(), &gateway.token));
    if !authorized {
        respond(&mut stream, "401 Unauthorized", &[], "").await;
        return Some(());
    }
    match request.method.as_str() {
        "POST" => {}
        // No server-initiated stream and nothing to tear down.
        "DELETE" => {
            respond(&mut stream, "200 OK", &[], "").await;
            return Some(());
        }
        _ => {
            respond(&mut stream, "405 Method Not Allowed", &[("allow", "POST, DELETE".into())], "").await;
            return Some(());
        }
    }
    let Ok(message) = serde_json::from_slice::<Value>(&request.body) else {
        let error = json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } });
        respond(&mut stream, "400 Bad Request", &[], &error.to_string()).await;
        return Some(());
    };
    let session = [("mcp-session-id", "mali".to_string())];
    let answer = match &message {
        Value::Array(batch) => {
            let mut out = Vec::new();
            for m in batch {
                if let Some(reply) = dispatch(m).await {
                    out.push(reply);
                }
            }
            (!out.is_empty()).then(|| Value::Array(out))
        }
        m => dispatch(m).await,
    };
    match answer {
        Some(reply) => respond(&mut stream, "200 OK", &session, &reply.to_string()).await,
        None => respond(&mut stream, "202 Accepted", &session, "").await,
    }
    Some(())
}

/// One JSON-RPC message; `None` for a notification.
async fn dispatch(message: &Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let method = message["method"].as_str().unwrap_or_default();
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": message["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "title": "Mali Cowork connectors", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "The user's connectors, set up in Mali Cowork. Tools are named <connector>_<tool>.",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => {
            let (tools, _) = super::tools(&super::current_servers()).await;
            // Team mode: a teammate's connectors are its own, not the lead's.
            let hidden = crate::agent::team_gateway::hidden_connectors();
            let mut list: Vec<Value> = tools
                .iter()
                .filter(|t| !hidden.contains(&t.server))
                .map(|t| json!({
                    "name": t.name,
                    "description": if t.description.is_empty() { format!("{} tool {}", t.server, t.tool) } else { t.description.clone() },
                    "inputSchema": t.schema,
                }))
                .collect();
            // Mali's document tools, for every agent: templates, reading and filling .docx.
            list.extend(crate::templates::tools::specs().into_iter().map(|t| json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.schema,
            })));
            // Team mode with a CLI lead: hand work to the team.
            list.extend(crate::agent::team_gateway::specs().into_iter().map(|t| json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.schema,
            })));
            Ok(json!({ "tools": list }))
        }
        "tools/call" if crate::agent::team_gateway::is_team_tool(message["params"]["name"].as_str().unwrap_or_default()) => {
            let name = message["params"]["name"].as_str().unwrap_or_default();
            let args = message["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            let out = crate::agent::team_gateway::call(name.to_string(), args).await;
            Ok(json!({ "content": [{ "type": "text", "text": out.content }], "isError": out.is_error }))
        }
        "tools/call" if crate::templates::tools::is_template_tool(message["params"]["name"].as_str().unwrap_or_default()) => {
            let name = message["params"]["name"].as_str().unwrap_or_default();
            let args = message["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            // The CLI already asked its user to allow the call; it runs in the chat's folders only.
            let result = super::workspace_scope()
                .and_then(|scope| crate::templates::tools::plan(name, &args, &scope))
                .and_then(crate::templates::tools::execute);
            Ok(match result {
                Ok(text) => json!({ "content": [{ "type": "text", "text": text }], "isError": false }),
                Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
            })
        }
        "tools/call" => {
            let name = message["params"]["name"].as_str().unwrap_or_default();
            let args = message["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            let (tools, _) = super::tools(&super::current_servers()).await;
            let hidden = crate::agent::team_gateway::hidden_connectors();
            match tools.iter().find(|t| t.name == name) {
                None => Err((-32602, format!("Unknown tool: {name}"))),
                Some(tool) if hidden.contains(&tool.server) => Ok(json!({
                    "content": [{ "type": "text", "text": format!("{} belongs to a teammate. Hand this job to that teammate with delegate_task.", tool.server) }],
                    "isError": true,
                })),
                Some(tool) => Ok(match tool.call(args).await {
                    Ok(result) => {
                        // Pictures go back to the CLI as MCP image content, so a model that can see gets them.
                        let mut content = vec![json!({ "type": "text", "text": result.text })];
                        content.extend(result.images.iter().map(|i| json!({ "type": "image", "data": i.data, "mimeType": i.mime })));
                        json!({ "content": content, "isError": result.is_error })
                    }
                    Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
                }),
            }
        }
        "resources/list" => Ok(json!({ "resources": [] })),
        "prompts/list" => Ok(json!({ "prompts": [] })),
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_compare_exactly() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }

    #[test]
    fn only_loopback_hosts_on_our_port() {
        assert!(host_ok(Some("127.0.0.1:5000"), 5000));
        assert!(host_ok(Some("localhost:5000"), 5000));
        assert!(!host_ok(Some("evil.example:5000"), 5000));
        assert!(!host_ok(Some("127.0.0.1:5001"), 5000));
        assert!(!host_ok(None, 5000));
    }

    /// A CLI's view: connect to `mali` like any remote MCP server and call a
    /// connector's tool, which the hub runs on the real server.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_cli_reaches_a_connector_through_the_gateway() {
        let script = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"n"}}}\n' "$id" ;;
    *'"tools/list"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"note","inputSchema":{"type":"object"}}]}}\n' "$id" ;;
    *'"tools/call"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"saved"}]}}\n' "$id" ;;
  esac
done
"#;
        let local: crate::commands::mcp::McpServerEntry = serde_json::from_value(json!({
            "id": "custom-gw-notes", "enabled": true, "kind": "local", "command": ["/bin/sh", "-c", script],
        }))
        .unwrap();
        let mut servers = super::super::current_servers();
        servers.retain(|s| s.id != local.id);
        servers.push(local);
        super::super::set_servers(servers);

        let gateway = ensure().await.unwrap();
        let as_cli: crate::commands::mcp::McpServerEntry = serde_json::from_value(json!({
            "id": "mali", "enabled": true, "kind": "remote", "url": gateway.url(),
            "headers": { "Authorization": gateway.authorization() },
        }))
        .unwrap();
        let conn = super::super::client::connect(&as_cli).await.unwrap();
        assert!(conn.tools.iter().any(|t| t.name == "custom-gw-notes_note"), "{:?}", conn.tools.iter().map(|t| &t.name).collect::<Vec<_>>());
        let result = conn.call("custom-gw-notes_note", json!({})).await.unwrap();
        assert_eq!((result.text.as_str(), result.is_error), ("saved", false));
        super::super::disconnect("custom-gw-notes").await;
    }

    /// Any CLI agent gets the document tools: it fills a quotation into the
    /// chat's folder, and can't write outside it.
    #[tokio::test]
    async fn a_cli_fills_a_template_in_the_chats_folder() {
        let dir = std::env::temp_dir().join(format!("mali-gw-docs-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        super::super::set_workspace(super::super::Workspace { cwd: Some(dir.to_string_lossy().into()), folders: vec![] });
        let gateway = ensure().await.unwrap();
        let as_cli: crate::commands::mcp::McpServerEntry = serde_json::from_value(json!({
            "id": "mali", "enabled": true, "kind": "remote", "url": gateway.url(),
            "headers": { "Authorization": gateway.authorization() },
        }))
        .unwrap();
        let conn = super::super::client::connect(&as_cli).await.unwrap();
        assert!(conn.tools.iter().any(|t| t.name == "fill_template"));
        let result = conn
            .call(
                "fill_template",
                json!({
                    "template": "quotation", "output": "QT-9",
                    "values": { "company_name": "ร้าน", "company_address": "กทม.", "doc_no": "9", "customer_name": "บี" },
                    "items": [{ "description": "ชา", "qty": 2, "unit_price": 50 }]
                }),
            )
            .await
            .unwrap();
        assert!(!result.is_error, "{}", result.text);
        assert!(result.text.contains("107.00"), "{}", result.text);
        assert!(dir.join("QT-9.docx").exists());
        let outside = conn
            .call("fill_template", json!({ "template": "quotation", "output": "/tmp/../etc/x.docx", "items": [{ "description": "a", "unit_price": 1 }] }))
            .await
            .unwrap();
        assert!(outside.is_error);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn needs_the_token_and_answers_mcp() {
        let gateway = ensure().await.unwrap();
        let client = reqwest::Client::new();
        let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } });

        let denied = client.post(gateway.url()).json(&init).send().await.unwrap();
        assert_eq!(denied.status(), 401);
        let wrong = client.post(gateway.url()).header("authorization", "Bearer nope").json(&init).send().await.unwrap();
        assert_eq!(wrong.status(), 401);

        let ok: Value = client
            .post(gateway.url())
            .header("authorization", gateway.authorization())
            .json(&init)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(ok["result"]["serverInfo"]["name"], "mali");

        let note = client
            .post(gateway.url())
            .header("authorization", gateway.authorization())
            .json(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .send()
            .await
            .unwrap();
        assert_eq!(note.status(), 202);

        let list: Value = client
            .post(gateway.url())
            .header("authorization", gateway.authorization())
            .json(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(list["result"]["tools"].is_array());
    }
}
