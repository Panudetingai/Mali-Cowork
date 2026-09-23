# 05 — Local Port / Socket Integration (Local Agent Server)

> บทนี้สอนให้ Tauri เชื่อมกับ **Agent Server ที่รันแยก process** ผ่าน TCP / Unix Socket / WebSocket / HTTP — เหมาะกับ agent ที่ต้องคง state, มี memory, หรือรัน model local

## 5.1 สถาปัตยกรรม

```
┌──────────────┐         ┌──────────────────┐
│ Tauri (Rust) │  TCP/WS │  Agent Server    │
│  commands/   │────────→│  (Node/Python/   │
│  socket.rs   │  :3000  │   Rust)          │
│              │←────────│  stream response │
└──────────────┘         └──────────────────┘
        ↕ Channel
┌──────────────┐
│ React UI     │
└──────────────┘
```

### เลือกโปรโตคอลไหน?

| โปรโตคอล | เหมาะกับ | ตัวอย่าง |
|----------|----------|----------|
| **HTTP + SSE** | ง่ายสุด, ใช้ `reqwest` + `fetch` ได้ | `POST /chat/stream` → `text/event-stream` |
| **WebSocket** | bidirectional, agent ส่ง tool-call กลับมาได้ | `ws://localhost:3000/ws` |
| **TCP raw** | เร็ว, คุม framing เอง | `TcpStream::connect("127.0.0.1:4000")` |
| **Unix Socket** | ปลอดภัยกว่า TCP (ไม่เปิดพอร์ต) | `/tmp/mali.sock` (Unix/macOS/Linux) |

> **แนะนำเริ่มจาก HTTP+SSE หรือ WebSocket** — ดีบักง่าย, ใช้กับ agent เขียนด้วย Node/Python ได้ทันที

## 5.2 ตัวอย่าง Agent Server (Node.js) — สำหรับทดสอบ

สร้าง `agent-server/server.js` (รันแยกจาก Tauri):

```js
// agent-server/server.js
import { WebSocketServer } from "ws";
import http from "node:http";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  // SSE endpoint
  if (req.url === "/chat/stream" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      const { prompt } = JSON.parse(body || "{}");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      // mock streaming: ส่งทีละคำ
      const words = `Echo: ${prompt} — from Agent Server`.split(" ");
      let i = 0;
      const timer = setInterval(() => {
        if (i >= words.length) {
          res.write(`data: ${JSON.stringify({ event: "done" })}\n\n`);
          clearInterval(timer);
          return res.end();
        }
        res.write(`data: ${JSON.stringify({ event: "chunk", data: words[i] + " " })}\n\n`);
        i++;
      }, 80);
    });
    return;
  }
  res.writeHead(404).end();
});

// WebSocket endpoint
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", ws => {
  ws.on("message", raw => {
    const { prompt } = JSON.parse(raw.toString());
    const words = `WS Echo: ${prompt}`.split(" ");
    let i = 0;
    const timer = setInterval(() => {
      if (i >= words.length) {
        ws.send(JSON.stringify({ event: "done", data: { modelId: "agent-ws" } }));
        clearInterval(timer);
        return;
      }
      ws.send(JSON.stringify({ event: "chunk", data: { text: words[i] + " " } }));
      i++;
    }, 80);
  });
});

server.listen(3000, () => console.log("Agent Server listening on http://localhost:3000  ws://localhost:3000/ws"));
```

```bash
cd agent-server
npm init -y && npm i ws
node server.js
# ทดสอบ
curl -X POST http://localhost:3000/chat/stream -H "Content-Type: application/json" -d '{"prompt":"hello"}'
```

## 5.3 Tauri Rust — เชื่อมแบบ HTTP SSE (`src-tauri/src/commands/socket.rs`)

`Cargo.toml` เพิ่ม:

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
futures = "0.3"
tokio-tungstenite = "0.21"  # ถ้าจะใช้ WebSocket
```

### 5.3.1 HTTP SSE

```rust
use futures::StreamExt;
use serde::Deserialize;
use tauri::ipc::Channel;
use crate::chat_stream::ChatStreamEvent;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketRequest {
    pub prompt: String,
    /// เช่น "http://localhost:3000"
    pub base_url: Option<String>,
}

#[tauri::command]
pub async fn socket_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Error { message: "Prompt cannot be empty.".into() });
        return Ok(());
    }
    let base = request.base_url.unwrap_or_else(|| "http://localhost:3000".into());
    let url = format!("{}/chat/stream", base.trim_end_matches('/'));

    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;

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

    // อ่าน SSE stream: "data: {...}\n\n"
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut has_text = false;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        // แยก event ทีละ "data: ...\n\n"
        while let Some(pos) = buf.find("\n\n") {
            let frame = buf[..pos].to_string();
            buf = buf[pos + 2..].to_string();

            for line in frame.lines() {
                let line = line.trim();
                if line.is_empty() { continue; }
                let json_str = line.strip_prefix("data:").unwrap_or(line).trim();
                if json_str.is_empty() { continue; }

                let v: serde_json::Value = match serde_json::from_str(json_str) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                match v.get("event").and_then(|e| e.as_str()) {
                    Some("chunk") => {
                        let text = v.get("data").and_then(|d| d.as_str())
                            .or_else(|| v.get("data").and_then(|d| d.get("text")).and_then(|t| t.as_str()))
                            .unwrap_or("");
                        if !text.is_empty() {
                            has_text = true;
                            let _ = on_event.send(ChatStreamEvent::Chunk { text: text.to_string() });
                        }
                    }
                    Some("done") => {
                        let _ = on_event.send(ChatStreamEvent::Done { model_id: "agent-socket".into() });
                        return Ok(());
                    }
                    Some("error") => {
                        let msg = v.get("data").and_then(|d| d.get("message")).and_then(|m| m.as_str()).unwrap_or("Agent error");
                        let _ = on_event.send(ChatStreamEvent::Error { message: msg.into() });
                        return Ok(());
                    }
                    _ => {}
                }
            }
        }
    }

    if !has_text {
        let _ = on_event.send(ChatStreamEvent::Error { message: "Agent Server returned empty stream.".into() });
        return Ok(());
    }
    let _ = on_event.send(ChatStreamEvent::Done { model_id: "agent-socket".into() });
    Ok(())
}
```

### 5.3.2 WebSocket

```rust
use futures::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;

#[tauri::command]
pub async fn socket_ws_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let base = request.base_url.unwrap_or_else(|| "ws://localhost:3000".into());
    let url = format!("{}/ws", base.trim_end_matches('/').replace("http://", "ws://").replace("https://", "wss://"));

    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;

    let (mut ws, _) = connect_async(&url).await
        .map_err(|e| format!("WS connect failed {url}: {e}"))?;

    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        serde_json::json!({ "prompt": request.prompt }).to_string().into()
    )).await.map_err(|e| e.to_string())?;

    while let Some(msg) = ws.next().await {
        let msg = msg.map_err(|e| e.to_string())?;
        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            match v.get("event").and_then(|e| e.as_str()) {
                Some("chunk") => {
                    let t = v.get("data").and_then(|d| d.get("text")).and_then(|s| s.as_str()).unwrap_or("");
                    let _ = on_event.send(ChatStreamEvent::Chunk { text: t.into() });
                }
                Some("done") => {
                    let _ = on_event.send(ChatStreamEvent::Done { model_id: "agent-ws".into() });
                    break;
                }
                Some("error") => {
                    let m = v.get("data").and_then(|d| d.get("message")).and_then(|s| s.as_str()).unwrap_or("WS error");
                    let _ = on_event.send(ChatStreamEvent::Error { message: m.into() });
                    break;
                }
                _ => {}
            }
        }
    }
    Ok(())
}
```

### 5.3.3 TCP raw (ถ้า Agent เป็น TCP server)

```rust
use tokio::net::TcpStream;
use tokio::io::{AsyncWriteExt, AsyncBufReadExt, BufReader};

#[tauri::command]
pub async fn socket_tcp_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let addr = request.base_url.unwrap_or_else(|| "127.0.0.1:4000".into());
    let mut stream = TcpStream::connect(&addr).await
        .map_err(|e| format!("TCP connect {addr} failed: {e}"))?;

    // ส่ง prompt แบบ line-delimited JSON
    let payload = serde_json::json!({ "prompt": request.prompt }).to_string() + "\n";
    stream.write_all(payload.as_bytes()).await.map_err(|e| e.to_string())?;
    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(&mut stream).lines();
    while let Ok(Some(line)) = reader.next_line().await {
        if line.is_empty() { continue; }
        let v: serde_json::Value = match serde_json::from_str(&line) { Ok(v) => v, Err(_) => {
            let _ = on_event.send(ChatStreamEvent::Chunk { text: line + "\n" });
            continue;
        }};
        // parse event เหมือน HTTP SSE
    }
    Ok(())
}
```

### 5.3.4 Unix Socket (Unix/macOS/Linux)

```rust
#[cfg(unix)]
use tokio::net::UnixStream;

#[cfg(unix)]
#[tauri::command]
pub async fn socket_uds_generate(
    request: SocketRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let path = request.base_url.unwrap_or_else(|| "/tmp/mali.sock".into());
    let mut stream = UnixStream::connect(&path).await
        .map_err(|e| format!("UDS connect {path} failed: {e}"))?;
    // ... เหมือน TCP
    Ok(())
}
```

## 5.4 Register

`src-tauri/src/commands/mod.rs`:

```rust
pub mod chat;
pub mod socket;
```

`src-tauri/src/lib.rs`:

```rust
use commands::{chat::chat_generate, socket::{socket_generate, socket_ws_generate}};

tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![chat_generate, socket_generate, socket_ws_generate])
```

## 5.5 Frontend

`src/lib/api/chat.ts` เพิ่ม:

```ts
export async function socketGenerateStream(
  request: { prompt: string; baseUrl?: string },
  handlers: ChatStreamHandlers,
) {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (msg) => {
    switch (msg.event) {
      case "started": handlers.onStart?.(); break;
      case "chunk":   handlers.onChunk(msg.data.text); break;
      case "done":    handlers.onDone(msg.data.modelId); break;
      case "error":   handlers.onError(msg.data.message); break;
    }
  };
  await invoke("socket_generate", {
    request: { prompt: request.prompt, baseUrl: request.baseUrl },
    onEvent: channel,
  });
}
```

### Health check ก่อนส่ง

```ts
async function isAgentUp(baseUrl = "http://localhost:3000") {
  try {
    const r = await fetch(`${baseUrl}/health`);
    return r.ok;
  } catch { return false; }
}

// ก่อนเรียก socketGenerateStream
if (!await isAgentUp()) {
  handlers.onError("Agent Server not running. Run: node agent-server/server.js");
  return;
}
```

## 5.6 Tauri รัน Agent Server เอง (Auto-start)

ถ้าไม่อยากให้ user รัน server แยก ให้ Tauri spawn ตอน startup:

`src-tauri/src/lib.rs`:

```rust
use std::sync::Mutex;
use tokio::process::Child;

struct AgentServerState(Mutex<Option<Child>>);

pub fn run() {
    tauri::Builder::default()
        .manage(AgentServerState(Mutex::new(None)))
        .setup(|app| {
            // spawn agent server เป็น sidecar หรือ node process
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut cmd = tokio::process::Command::new("node");
                cmd.args(["agent-server/server.js"]);
                cmd.current_dir("../");
                if let Ok(child) = cmd.spawn() {
                    if let Some(state) = handle.try_state::<AgentServerState>() {
                        *state.0.lock().unwrap() = Some(child);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // cleanup: kill agent server
            }
        })
        // ...
}
```

หรือใช้ **sidecar** (`tauri.conf.json`):

```json
{
  "bundle": {
    "externalBin": ["binaries/agent-server"]
  }
}
```

แล้วรันด้วย `tauri_plugin_shell::ShellExt::sidecar("agent-server")`

## 5.7 Config — ให้ User ตั้ง Port ได้

เพิ่ม `src/lib/config.ts`:

```ts
export const AGENT_BASE_URL = localStorage.getItem("agent_base_url") || "http://localhost:3000";
```

UI ตั้งค่า:

```tsx
<input value={baseUrl} onChange={e => localStorage.setItem("agent_base_url", e.target.value)} placeholder="http://localhost:3000" />
```

Rust อ่านจาก `request.baseUrl` ที่ frontend ส่งมา — ไม่ต้อง hardcode

## 5.8 Troubleshooting

| อาการ | แก้ |
|-------|-----|
| `Failed to connect to Agent Server` | เช็คว่า `node agent-server/server.js` รันอยู่ `curl http://localhost:3000/health` |
| `WS connect failed` | ใช้ `ws://` ไม่ใช่ `http://` สำหรับ WebSocket |
| Firewall บล็อก | ใช้ `127.0.0.1` ไม่ใช่ `0.0.0.0`, หรือเพิ่ม firewall rule |
| Port ชน | เปลี่ยน `server.listen(3001)` + ส่ง `baseUrl: "http://localhost:3001"` |
| CORS (ถ้าเรียกจาก WebView fetch ตรง) | ให้ Rust เป็น proxy แทน (วิธีในบทนี้) จะไม่มี CORS |

---
ต่อไป: **บท 06 — Frontend Integration** (เรียก Rust จาก React แบบ streaming)
