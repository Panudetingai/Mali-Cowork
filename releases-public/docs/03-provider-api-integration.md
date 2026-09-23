# 03 — Provider API Integration (OpenAI / Anthropic / Google / OpenRouter / Groq)

> บทนี้อธิบายโค้ดที่มีอยู่แล้วในโปรเจกต์ (`src-tauri/src/ai/mod.rs`) และวิธีเพิ่ม provider/model ใหม่

## 3.1 ภาพรวม

```
React (modelId) → invoke(chat_generate) → resolve_model() → get_api_key() → aisdk provider → stream → Channel → React
```

ไฟล์ที่เกี่ยวข้อง:

| ไฟล์ | หน้าที่ | บรรทัด |
|------|---------|---------|
| `src-tauri/src/chat_stream.rs` | นิยาม `ChatStreamEvent` | ทั้งไฟล์ |
| `src-tauri/src/ai/mod.rs` | model registry + streaming | `15`, `68`, `101`, `161` |
| `src-tauri/src/commands/chat.rs` | Tauri command wrapper | ทั้งไฟล์ |
| `src/lib/api/chat.ts` | Frontend invoke + Channel | ทั้งไฟล์ |
| `src/pages/chat/layout.tsx` | ต่อ `onChunk/onDone/onError` เข้า `setMessages` | `48` |

## 3.2 ChatStreamEvent — Contract ระหว่าง Rust ↔ Frontend

`src-tauri/src/chat_stream.rs:3`

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ChatStreamEvent {
    Started,
    Chunk { text: String },
    Done { model_id: String },
    Error { message: String },
}
```

ฝั่ง TS ต้อง mirror แบบนี้ (`src/lib/api/chat.ts:8`):

```ts
export type ChatStreamEvent =
  | { event: "started" }
  | { event: "chunk"; data: { text: string } }
  | { event: "done"; data: { modelId: string } }
  | { event: "error"; data: { message: string } };
```

> ใช้ `tag = "event"` จึงต้องเช็ค `message.event` ไม่ใช่ `message.type`

## 3.3 Model Registry (`ai/mod.rs:15`)

```rust
fn resolve_model(model_id: &str) -> Result<ModelSpec, String> {
    match model_id {
        "claude-sonnet-4" => Ok(ModelSpec { provider: "anthropic", api_model: "claude-sonnet-4-20250514" }),
        "gpt-4o"          => Ok(ModelSpec { provider: "openai",    api_model: "gpt-4o" }),
        "gemini-2-flash"  => Ok(ModelSpec { provider: "google",    api_model: "gemini-2.0-flash" }),
        "z-ai/glm-5.2:free" => Ok(ModelSpec { provider: "openrouter", api_model: "z-ai/glm-5.2:free" }),
        "groq/gpt-oss-120b" => Ok(ModelSpec { provider: "groq", api_model: "openai/gpt-oss-120b" }),
        other => Err(format!("Unknown model id: {other}")),
    }
}
```

### เพิ่มโมเดลใหม่

```rust
// ตัวอย่าง: เพิ่ม OpenAI gpt-4o-mini
"gpt-4o-mini" => Ok(ModelSpec {
    provider: "openai",
    api_model: "gpt-4o-mini",
}),
```

หรือเพิ่ม provider ใหม่ (เช่น DeepSeek ผ่าน OpenRouter):

```rust
"deepseek-r1:free" => Ok(ModelSpec {
    provider: "openrouter",
    api_model: "deepseek/deepseek-r1:free",
}),
```

ไม่ต้องเพิ่ม provider ใหม่ — OpenRouter เป็น gateway อยู่แล้ว

## 3.4 API Key Handling (`ai/mod.rs:68`)

```rust
fn get_api_key(var: &str) -> Result<String, String> {
    let raw = std::env::var(var).map_err(|_| missing_key_message(...))?;
    let trimmed = raw.trim().trim_matches('"').trim_matches('\'').trim().to_string();
    if trimmed.is_empty() { return Err(missing_key_message(...)); }
    if trimmed != raw { unsafe { std::env::set_var(var, &trimmed) }; }
    Ok(trimmed)
}
```

- ตัด `"` `'` เผื่อ user copy จาก `.env` แบบ `KEY="sk-..."`
- `missing_key_message()` บอกให้ `Set XXX_API_KEY in .env and restart bun tauri dev`

## 3.5 Streaming Core (`ai/mod.rs:101` + `144`)

```rust
async fn consume_stream(mut stream: LanguageModelStream, on_event: &Channel<ChatStreamEvent>) -> Result<(), String> {
    on_event.send(ChatStreamEvent::Started).map_err(|e| e.to_string())?;
    let mut has_text = false;
    while let Some(chunk) = stream.next().await {
        match chunk {
            LanguageModelStreamChunkType::Text(text) => {
                if !text.is_empty() {
                    has_text = true;
                    on_event.send(ChatStreamEvent::Chunk { text }).map_err(|e| e.to_string())?;
                }
            }
            LanguageModelStreamChunkType::Failed(msg) => return Err(msg),
            LanguageModelStreamChunkType::End(_) => break,
            _ => {}
        }
    }
    if !has_text { return Err("Model returned an empty response.".into()); }
    Ok(())
}

macro_rules! stream_with_model {
    ($model:expr, $prompt:expr, $on_event:expr) => {{
        let mut request = LanguageModelRequest::builder()
            .model($model)
            .system("You are Mali Cowork, a concise and helpful assistant.")
            .prompt($prompt)
            .build();
        let response = request.stream_text().await.map_err(|e| e.to_string())?;
        consume_stream(response.stream, $on_event).await
    }};
}
```

แล้ว `stream_chat_response()` (`ai/mod.rs:161`) `match spec.provider`:

```rust
pub async fn stream_chat_response(prompt: &str, model_id: &str, on_event: Channel<ChatStreamEvent>) -> Result<(), String> {
    let spec = resolve_model(model_id)?;
    match spec.provider {
        "anthropic" => {
            get_api_key("ANTHROPIC_API_KEY")?;
            let model = Anthropic::<DynamicModel>::builder().model_name(spec.api_model).build().map_err(|e| e.to_string())?;
            stream_with_model!(model, prompt, &on_event)
        }
        "openai" => { /* ... OpenAI ... */ }
        "google" => { /* ... Google ... */ }
        "openrouter" => { /* ... Openrouter ... */ }
        "groq" => { /* ... Groq ... */ }
        other => Err(format!("Unsupported provider: {other}")),
    }
    // สำคัญ: ส่ง Done/Error ผ่าน Channel แล้ว return Ok(()) เสมอ กัน error ซ้ำ
}
```

### Error Contract สำคัญ (`ai/mod.rs:216`)

```rust
match result {
    Ok(()) => {
        on_event.send(ChatStreamEvent::Done { model_id: model_id.to_string() })?;
        Ok(())
    }
    Err(message) => {
        let _ = on_event.send(ChatStreamEvent::Error { message: message.clone() });
        Ok(()) // ← ไม่ return Err เพื่อไม่ให้ frontend โดนทั้ง onError + catch
    }
}
```

Frontend จึงมี guard `hasErrored` กันซ้ำอีกชั้น (`src/pages/chat/layout.tsx:33`)

## 3.6 Tauri Command (`commands/chat.rs`)

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest { pub prompt: String, pub model_id: String }

#[tauri::command]
pub async fn chat_generate(request: ChatRequest, on_event: Channel<ChatStreamEvent>) -> Result<(), String> {
    ai::stream_chat_response(&request.prompt, &request.model_id, on_event).await
}
```

Register ใน `lib.rs:25`:

```rust
.invoke_handler(tauri::generate_handler![chat_generate])
```

## 3.7 Frontend (`src/lib/api/chat.ts`)

```ts
import { Channel, invoke } from "@tauri-apps/api/core";

export async function chatGenerateStream(request: ChatRequest, handlers: ChatStreamHandlers) {
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (msg) => {
    switch (msg.event) {
      case "started": handlers.onStart?.(); break;
      case "chunk":   handlers.onChunk(msg.data.text); break;
      case "done":    handlers.onDone(msg.data.modelId); break;
      case "error":   handlers.onError(msg.data.message); break;
    }
  };
  await invoke("chat_generate", { request, onEvent: channel });
}
```

เรียกใช้ใน `layout.tsx:48`:

```ts
await chatGenerateStream({ prompt, modelId }, {
  onChunk: (text) => setMessages(prev => prev.map(m => m.id === assistantId ? {...m, content: m.content + text} : m)),
  onDone:  (id)   => setMessages(prev => prev.map(m => m.id === assistantId ? {...m, modelId: id, isStreaming: false} : m)),
  onError: (msg)  => { /* replace assistant bubble with error bubble */ },
});
```

## 3.8 เพิ่ม Provider ใหม่ทั้งระบบ (Checklist)

สมมติจะเพิ่ม **Ollama (local)**:

1. `Cargo.toml` เพิ่ม feature หรือ crate `ollama` / ใช้ OpenAI-compatible endpoint ผ่าน `OpenAI` provider ชี้ `base_url`
2. `ai/mod.rs` เพิ่ม `resolve_model` case + `match` arm ใหม่
3. `.env.example` เพิ่ม `OLLAMA_BASE_URL=http://localhost:11434`
4. `lib.rs` ไม่ต้องแก้ถ้าใช้ command เดิม
5. Frontend: เพิ่ม `modelId` ใน `prompt.tsx` model selector
6. ทดสอบ: `bun tauri dev` → เลือกโมเดลใหม่ → ส่ง prompt

## 3.9 Troubleshooting

| อาการ | สาเหตุ | แก้ |
|-------|--------|-----|
| `Unknown model id` | `modelId` ที่ UI ส่งไม่ตรง `resolve_model` | เช็ค `prompt.tsx` model list |
| `Set XXX_API_KEY in .env` | env ไม่โหลด | ใส่ `.env` ที่ root แล้ว restart `bun tauri dev` |
| `429 Too Many Requests` | free model rate limit | รอ 30-60s หรือสลับ model (`layout.tsx:96` ทำ friendly message ไว้แล้ว) |
| `Model returned empty` | provider ส่ง `End` โดยไม่มี `Text` | ลอง prompt อื่น / เช็ค provider status |
| ได้ error ซ้ำ 2 bubble | `return Err` + `Channel::Error` | ต้อง `Ok(())` หลัง send Error (แก้ไว้แล้ว `ai/mod.rs:231`) |
