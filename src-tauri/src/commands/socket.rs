use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

use crate::chat_stream::ChatStreamEvent;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketRequest {
    pub prompt: String,
    /// เช่น "http://localhost:3000"
    pub base_url: Option<String>,
}

fn normalize_http_url(base_url: &str) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn normalize_ws_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    base.replace("http://", "ws://")
        .replace("https://", "wss://")
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP + SSE
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn socket_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Error {
            message: "Prompt cannot be empty.".into(),
        });
        return Ok(());
    }

    let base = normalize_http_url(&request.base_url.unwrap_or_else(|| "http://localhost:3000".into()));
    let url = format!("{}/chat/stream", base);

    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "prompt": prompt }))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Agent Server at {url}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let _ = on_event.send(ChatStreamEvent::Error {
            message: format!("Agent Server error {status}: {body}"),
        });
        return Ok(());
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut has_text = false;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find("\n\n") {
            let frame = buf[..pos].to_string();
            buf = buf[pos + 2..].to_string();

            for line in frame.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let json_str = line.strip_prefix("data:").unwrap_or(line).trim();
                if json_str.is_empty() {
                    continue;
                }

                let v: serde_json::Value = match serde_json::from_str(json_str) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                match v.get("event").and_then(|e| e.as_str()) {
                    Some("chunk") => {
                        let text = v
                            .get("data")
                            .and_then(|d| d.as_str())
                            .or_else(|| {
                                v.get("data")
                                    .and_then(|d| d.get("text"))
                                    .and_then(|t| t.as_str())
                            })
                            .unwrap_or("");
                        if !text.is_empty() {
                            has_text = true;
                            let _ = on_event.send(ChatStreamEvent::Chunk {
                                text: text.to_string(),
                            });
                        }
                    }
                    Some("done") => {
                        let _ = on_event.send(ChatStreamEvent::Done {
                            model_id: "agent-socket".into(),
                        });
                        return Ok(());
                    }
                    Some("error") => {
                        let msg = v
                            .get("data")
                            .and_then(|d| d.get("message"))
                            .and_then(|m| m.as_str())
                            .unwrap_or("Agent error");
                        let _ = on_event.send(ChatStreamEvent::Error {
                            message: msg.into(),
                        });
                        return Ok(());
                    }
                    _ => {}
                }
            }
        }
    }

    if !has_text {
        let _ = on_event.send(ChatStreamEvent::Error {
            message: "Agent Server returned empty stream.".into(),
        });
        return Ok(());
    }

    let _ = on_event.send(ChatStreamEvent::Done {
        model_id: "agent-socket".into(),
    });
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn socket_ws_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let url = normalize_ws_url(&request.base_url.unwrap_or_else(|| "ws://localhost:3000".into()));
    let url = format!("{}/ws", url);

    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    let (mut ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("WS connect failed {url}: {e}"))?;

    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        serde_json::json!({ "prompt": request.prompt }).to_string().into(),
    ))
    .await
    .map_err(|e| e.to_string())?;

    while let Some(msg) = ws.next().await {
        let msg = msg.map_err(|e| e.to_string())?;
        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            let v: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| e.to_string())?;
            match v.get("event").and_then(|e| e.as_str()) {
                Some("chunk") => {
                    let t = v
                        .get("data")
                        .and_then(|d| d.get("text"))
                        .and_then(|s| s.as_str())
                        .unwrap_or("");
                    let _ = on_event.send(ChatStreamEvent::Chunk { text: t.into() });
                }
                Some("done") => {
                    let _ = on_event.send(ChatStreamEvent::Done {
                        model_id: "agent-ws".into(),
                    });
                    break;
                }
                Some("error") => {
                    let m = v
                        .get("data")
                        .and_then(|d| d.get("message"))
                        .and_then(|s| s.as_str())
                        .unwrap_or("WS error");
                    let _ = on_event.send(ChatStreamEvent::Error {
                        message: m.into(),
                    });
                    break;
                }
                _ => {}
            }
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// TCP raw
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn socket_tcp_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let addr = request
        .base_url
        .unwrap_or_else(|| "127.0.0.1:4000".into());

    let mut stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("TCP connect {addr} failed: {e}"))?;

    let payload = serde_json::json!({ "prompt": request.prompt }).to_string() + "\n";
    stream
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&mut stream).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                let _ = on_event.send(ChatStreamEvent::Chunk {
                    text: line + "\n",
                });
                continue;
            }
        };

        match v.get("event").and_then(|e| e.as_str()) {
            Some("chunk") => {
                let t = v
                    .get("data")
                    .and_then(|d| d.get("text"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if !t.is_empty() {
                    let _ = on_event.send(ChatStreamEvent::Chunk { text: t.into() });
                }
            }
            Some("done") => {
                let _ = on_event.send(ChatStreamEvent::Done {
                    model_id: "agent-tcp".into(),
                });
                return Ok(());
            }
            Some("error") => {
                let m = v
                    .get("data")
                    .and_then(|d| d.get("message"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("TCP error");
                let _ = on_event.send(ChatStreamEvent::Error {
                    message: m.into(),
                });
                return Ok(());
            }
            _ => {}
        }
    }

    let _ = on_event.send(ChatStreamEvent::Done {
        model_id: "agent-tcp".into(),
    });
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Unix Socket (Unix/macOS/Linux only)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
#[tauri::command]
pub async fn socket_uds_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    use tokio::net::UnixStream;

    let path = request
        .base_url
        .unwrap_or_else(|| "/tmp/mali.sock".into());

    let mut stream = UnixStream::connect(&path)
        .await
        .map_err(|e| format!("UDS connect {path} failed: {e}"))?;

    let payload = serde_json::json!({ "prompt": request.prompt }).to_string() + "\n";
    stream
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    on_event
        .send(ChatStreamEvent::Started)
        .map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&mut stream).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                let _ = on_event.send(ChatStreamEvent::Chunk {
                    text: line + "\n",
                });
                continue;
            }
        };

        match v.get("event").and_then(|e| e.as_str()) {
            Some("chunk") => {
                let t = v
                    .get("data")
                    .and_then(|d| d.get("text"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if !t.is_empty() {
                    let _ = on_event.send(ChatStreamEvent::Chunk { text: t.into() });
                }
            }
            Some("done") => {
                let _ = on_event.send(ChatStreamEvent::Done {
                    model_id: "agent-uds".into(),
                });
                return Ok(());
            }
            Some("error") => {
                let m = v
                    .get("data")
                    .and_then(|d| d.get("message"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("UDS error");
                let _ = on_event.send(ChatStreamEvent::Error {
                    message: m.into(),
                });
                return Ok(());
            }
            _ => {}
        }
    }

    let _ = on_event.send(ChatStreamEvent::Done {
        model_id: "agent-uds".into(),
    });
    Ok(())
}
