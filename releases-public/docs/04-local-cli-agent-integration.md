# 04 — Local CLI / Agent Integration (opencode, cursor CLI, ฯลฯ)

> บทนี้สอนให้ Rust Core เรียก **CLI / Agent ที่ติดตั้งบนเครื่อง** แล้ว stream ผลลัพธ์กลับมา React ผ่าน `Channel<ChatStreamEvent>` เดิม

## 4.1 ไอเดีย

```
React → invoke("cli_generate") → Rust spawn("opencode run ...") → stdout chunks → Channel → React
```

ใช้เมื่อ:
- มี agent ที่ทำ tool-use / file-edit เก่งอยู่แล้ว (เช่น `opencode`, `cursor-agent`, `codex`, `claude --print`)
- ไม่อยากเขียน LLM client เอง
- ต้องการให้ agent เข้าถึงไฟล์ในเครื่องได้โดยตรง

## 4.2 ตัวเลือกการเรียก CLI จาก Tauri

| วิธี | ข้อดี | ข้อเสีย |
|------|-------|---------|
| `std::process::Command` (แนะนำ) | ไม่ต้อง plugin เพิ่ม, คุม stdin/stdout ได้เต็มที่ | ต้องจัดการ `allowlist` เอง |
| `tauri-plugin-shell` | มี allowlist ใน `tauri.conf.json`, ปลอดภัยกว่า | config เพิ่ม |
| Sidecar (`tauri-plugin-shell` sidecar) | bundle binary ไปกับแอป | ต้อง build binary แยก |

บทนี้ใช้ **`std::process::Command` + `tokio::process`** (async) ซึ่งเป็นวิธีตรงที่สุด

## 4.3 Dependencies

`src-tauri/Cargo.toml` เพิ่ม:

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }  # สำหรับ async process + io
# ถ้าใช้ shell plugin แทน:
# tauri-plugin-shell = "2"
```

`src-tauri/src/lib.rs` ถ้าใช้ shell plugin:

```rust
.plugin(tauri_plugin_shell::init())
```

## 4.4 สร้าง `src-tauri/src/commands/cli.rs`

```rust
use serde::Deserialize;
use tauri::ipc::Channel;
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::chat_stream::ChatStreamEvent;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRequest {
    pub prompt: String,
    /// เช่น "opencode" | "cursor" | "codex"
    pub agent: String,
    /// optional: working directory
    pub cwd: Option<String>,
}

fn agent_command(agent: &str, prompt: &str) -> Result<(String, Vec<String>), String> {
    match agent {
        "opencode" => Ok((
            "opencode".into(),
            vec!["run".into(), prompt.into()],
        )),
        "cursor" => Ok((
            "cursor-agent".into(),
            vec!["--print".into(), prompt.into()],
        )),
        "codex" => Ok((
            "codex".into(),
            vec!["exec".into(), "--json".into(), prompt.into()],
        )),
        // เพิ่ม agent อื่นๆ ตรงนี้
        other => Err(format!("Unknown agent: {other}. Available: opencode, cursor, codex")),
    }
}

#[tauri::command]
pub async fn cli_generate(
    request: CliRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), String> {
    let prompt = request.prompt.trim().to_string();
    if prompt.is_empty() {
        let _ = on_event.send(ChatStreamEvent::Error { message: "Prompt cannot be empty.".into() });
        return Ok(());
    }

    let (bin, args) = agent_command(&request.agent, &prompt)?;

    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&bin);
    cmd.args(&args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    // สำคัญ: ตั้ง cwd ถ้ามี
    if let Some(cwd) = request.cwd {
        cmd.current_dir(cwd);
    }
    // กันปัญหา PATH ใน Tauri (โดยเฉพาะ macOS)
    // ถ้า opencode อยู่ใน ~/.local/bin อาจต้องเติม PATH
    // cmd.env("PATH", format!("{}:{}", std::env::var("PATH").unwrap_or_default(), "/Users/you/.local/bin"));

    let mut child = cmd.spawn().map_err(|e| {
        format!("Failed to spawn `{bin}`: {e}. Is it installed and in PATH?")
    })?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut reader = BufReader::new(stdout).lines();
    let mut has_output = false;

    // สตรีม stdout ทีละบรรทัด → ส่งเป็น Chunk
    while let Ok(Some(line)) = reader.next_line().await {
        if !line.is_empty() {
            has_output = true;
            // ถ้า agent ส่ง JSON lines (เช่น codex --json) ให้ parse ก่อน
            // let text = parse_json_line(&line).unwrap_or(line);
            let _ = on_event.send(ChatStreamEvent::Chunk { text: line.clone() + "\n" });
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if !status.success() {
        // อ่าน stderr
        let msg = format!("Agent `{bin}` exited with {status}");
        let _ = on_event.send(ChatStreamEvent::Error { message: msg.clone() });
        return Ok(());
    }

    if !has_output {
        let _ = on_event.send(ChatStreamEvent::Error { message: "Agent returned empty output.".into() });
        return Ok(());
    }

    let _ = on_event.send(ChatStreamEvent::Done { model_id: format!("cli:{}", request.agent) });
    Ok(())
}
```

### ถ้า Agent ส่ง JSON Lines (เช่น `codex --json`)

```rust
fn parse_json_line(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    // codex: { "type": "item.completed", "item": { "text": "..." } }
    v.get("item")?.get("text")?.as_str().map(|s| s.to_string())
}
```

## 4.5 Register Command

`src-tauri/src/commands/mod.rs`:

```rust
pub mod chat;
pub mod cli;   // ← เพิ่ม
```

`src-tauri/src/lib.rs`:

```rust
use commands::{chat::chat_generate, cli::cli_generate};

tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![chat_generate, cli_generate])
```

## 4.6 Frontend (`src/lib/api/chat.ts` เพิ่ม)

```ts
export type CliRequest = { prompt: string; agent: string; cwd?: string };

export async function cliGenerateStream(
  request: CliRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (msg) => {
    switch (msg.event) {
      case "started": handlers.onStart?.(); break;
      case "chunk":   handlers.onChunk(msg.data.text); break;
      case "done":    handlers.onDone(msg.data.modelId); break;
      case "error":   handlers.onError(msg.data.message); break;
    }
  };
  await invoke("cli_generate", { request, onEvent: channel });
}
```

เรียกใช้:

```ts
// ใน layout.tsx หรือ component ใหม่
await cliGenerateStream({ prompt, agent: "opencode" }, {
  onChunk: (t) => appendToAssistant(t),
  onDone:  (id) => markDone(id),
  onError: (m)  => showError(m),
});
```

### รวมกับ Provider API ให้สลับได้

```ts
// lib/api/router.ts
export async function generateStream(req: { prompt: string; modelId: string }, handlers: ChatStreamHandlers) {
  if (req.modelId.startsWith("cli:")) {
    const agent = req.modelId.replace("cli:", ""); // "cli:opencode" → "opencode"
    return cliGenerateStream({ prompt: req.prompt, agent }, handlers);
  }
  return chatGenerateStream(req, handlers); // provider API เดิม
}
```

แล้ว UI ส่ง `modelId` เป็น `"cli:opencode"` หรือ `"gpt-4o"` ได้เลยโดยไม่แก้ `layout.tsx` มาก

## 4.7 Streaming แบบ Real-time กว่า (bytes แทน lines)

ถ้า agent พิมพ์ช้า อยากได้ทีละ token:

```rust
use tokio::io::AsyncReadExt;

let mut buf = [0u8; 1024];
let mut stdout = child.stdout.take().unwrap();
loop {
    let n = stdout.read(&mut buf).await.map_err(|e| e.to_string())?;
    if n == 0 { break; }
    let text = String::from_utf8_lossy(&buf[..n]).to_string();
    let _ = on_event.send(ChatStreamEvent::Chunk { text });
}
```

## 4.8 Security & Safety

| ประเด็น | แนะนำ |
|---------|-------|
| Command injection | อย่าใช้ `shell -c`, ใช้ `Command::new(bin).args(args)` เท่านั้น |
| Allowlist | `match agent` เป็น allowlist อยู่แล้ว — อย่าให้ user ส่ง `bin` ตรงๆ |
| cwd | จำกัดให้อยู่ใต้ workspace ที่ user เลือก (validate `starts_with`) |
| Timeout | ใส่ `tokio::time::timeout(Duration::from_secs(120), ...)` กัน agent ค้าง |
| PATH | ใน Tauri (โดยเฉพาะ macOS) `PATH` อาจไม่รวม `~/.local/bin` — เติม `env("PATH", ...)` |

## 4.9 ทดสอบ

```bash
# 1. ตรวจสอบ CLI ติดตั้ง
opencode --version
cursor-agent --version

# 2. ทดสอบ manual
echo "hello" | opencode run "repeat hello"

# 3. รัน Tauri แล้วลองจาก UI
bun tauri dev
# เลือก agent: opencode → ส่ง prompt → ดู stream
```

### Debug ถ้า spawn ไม่ได้

```rust
eprintln!("[cli] spawning: {} {:?}", bin, args);
eprintln!("[cli] PATH={}", std::env::var("PATH").unwrap_or_default());
```

ดู log ใน terminal ที่รัน `bun tauri dev`

## 4.10 ยกเลิก (Cancellation)

ถ้าต้องการปุ่ม Stop:

```rust
// เก็บ Child ไว้ใน State แล้ว kill เมื่อ user กด stop
use tauri::State;
use std::sync::Mutex;
use tokio::process::Child;

struct CliState(Mutex<Option<Child>>);

#[tauri::command]
async fn cli_stop(state: State<'_, CliState>) -> Result<(), String> {
    if let Some(mut child) = state.0.lock().unwrap().take() {
        child.kill().await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Frontend:

```ts
await invoke("cli_stop");
```

---
ต่อไป: **บท 05 — Local Port/Socket** (สำหรับ Agent Server แบบ long-lived)
