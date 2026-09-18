# 06 — Frontend Integration (React ↔ Rust via Tauri IPC)

> บทนี้สอนวิธีเรียก Rust command จาก React, ทำ streaming UI, และรวม 3 backend ให้สลับได้จาก `modelId` เดียว

## 6.1 Tauri IPC พื้นฐาน

### `invoke` + `Channel`

```ts
import { Channel, invoke } from "@tauri-apps/api/core";

// Rust: #[tauri::command] fn chat_generate(request: ChatRequest, on_event: Channel<ChatStreamEvent>)
// TS:   invoke("chat_generate", { request, onEvent: channel })
```

- `invoke` → ส่ง JSON ไป Rust, รอ `Result<(), String>` กลับ
- `Channel` → Rust ส่ง event กลับมาหลายครั้ง (streaming) ผ่าน `channel.onmessage`

### ตรวจสอบว่าอยู่ใน Tauri

`src/lib/api/chat.ts:21`

```ts
function isTauri() {
  return "__TAURI__" in window || "__TAURI_INTERNALS__" in window;
}
```

ถ้าเปิดด้วย `bun run dev` (browser ธรรมดา) จะ throw `AI streaming works in Tauri app only. Run: bun tauri dev`

## 6.2 Wrapper ปัจจุบัน (`src/lib/api/chat.ts`)

```ts
export type ChatRequest = { prompt: string; modelId: string };
export type ChatStreamEvent =
  | { event: "started" }
  | { event: "chunk"; data: { text: string } }
  | { event: "done"; data: { modelId: string } }
  | { event: "error"; data: { message: string } };

export type ChatStreamHandlers = {
  onStart?: () => void;
  onChunk: (text: string) => void;
  onDone: (modelId: string) => void;
  onError: (message: string) => void;
};

export async function chatGenerateStream(request: ChatRequest, handlers: ChatStreamHandlers) {
  if (!isTauri()) throw new Error("AI streaming works in Tauri app only. Run: bun tauri dev");

  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (message) => {
    switch (message.event) {
      case "started": handlers.onStart?.(); break;
      case "chunk":   handlers.onChunk(message.data.text); break;
      case "done":    handlers.onDone(message.data.modelId); break;
      case "error":   handlers.onError(message.data.message); break;
    }
  };

  await invoke("chat_generate", {
    request: { prompt: request.prompt, modelId: request.modelId },
    onEvent: channel,
  });
}
```

> ชื่อ `onEvent` ต้องตรงกับพารามิเตอร์ Rust `on_event: Channel<ChatStreamEvent>` (Tauri แปลง camelCase อัตโนมัติ)

## 6.3 ใช้ใน React (`src/pages/chat/layout.tsx:25`)

```tsx
import { chatGenerateStream } from "@/lib/api/chat";
import { useState } from "react";
import type { ChatMessage } from "./types";

export default function ChatLayout() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async ({ prompt, modelId }: { prompt: string; modelId: string }) => {
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt };
    const assistantId = crypto.randomUUID();
    let hasErrored = false; // กัน error ซ้ำ

    setMessages(prev => [...prev, userMessage, { id: assistantId, role: "assistant", content: "", modelId, isStreaming: true }]);
    setIsLoading(true);

    try {
      await chatGenerateStream({ prompt, modelId }, {
        onChunk: (text) => setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + text } : m)),
        onDone:  (doneModelId) => setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, modelId: doneModelId, isStreaming: false } : m)),
        onError: (message) => {
          if (hasErrored) return;
          hasErrored = true;
          setMessages(prev => [...prev.filter(x => x.id !== assistantId), { id: crypto.randomUUID(), role: "error", content: message }]);
        },
      });
    } catch (error) {
      if (hasErrored) return;
      hasErrored = true;
      const raw = error instanceof Error ? error.message : String(error);
      const friendly = raw.includes("429") ? "429 Too Many Requests — ลองรอสักครู่หรือสลับโมเดล" : raw;
      setMessages(prev => [...prev.filter(x => x.id !== assistantId), { id: crypto.randomUUID(), role: "error", content: friendly }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ChatMessages messages={messages} isLoading={isLoading} />
      <PromptInput isLoading={isLoading} onSubmit={handleSubmit} />
    </div>
  );
}
```

### ทำไมต้อง `hasErrored`?

Rust ส่ง `Error` ผ่าน Channel แล้ว `return Ok(())` (`ai/mod.rs:231`) แต่ถ้าเผลอ `return Err` จะทำให้ `invoke` throw ด้วย → `onError` + `catch` ทำงานทั้งคู่ → ได้ error bubble 2 อัน (`layout.tsx:33`)

## 6.4 Types (`src/pages/chat/types.ts`)

```ts
export type ChatRole = "user" | "assistant" | "error";
export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  modelId?: string;
  createdAt?: number;
  isStreaming?: boolean;
};
```

- `isStreaming` ใช้ทำ cursor กระพริบ / disable input
- `role: "error"` แยกสี bubble (เช่น แดง)

## 6.5 รวม 3 Backend ให้สลับด้วย `modelId` เดียว

### `src/lib/api/router.ts` (สร้างใหม่)

```ts
import { chatGenerateStream } from "./chat";
import { cliGenerateStream } from "./cli";       // บท 04
import { socketGenerateStream } from "./socket"; // บท 05
import type { ChatStreamHandlers } from "./chat";

export type GenerateRequest = { prompt: string; modelId: string };

export async function generateStream(req: GenerateRequest, handlers: ChatStreamHandlers) {
  // 1. Local CLI: modelId ขึ้นต้น cli: เช่น cli:opencode
  if (req.modelId.startsWith("cli:")) {
    const agent = req.modelId.slice(4); // "opencode"
    return cliGenerateStream({ prompt: req.prompt, agent }, handlers);
  }

  // 2. Local Socket: modelId ขึ้นต้น socket: หรือ agent:
  if (req.modelId.startsWith("socket:") || req.modelId.startsWith("agent:")) {
    const baseUrl = localStorage.getItem("agent_base_url") || "http://localhost:3000";
    return socketGenerateStream({ prompt: req.prompt, baseUrl }, handlers);
  }

  // 3. Provider API (default)
  return chatGenerateStream(req, handlers);
}
```

แล้ว `layout.tsx` เปลี่ยนบรรทัดเดียว:

```ts
// ก่อน: await chatGenerateStream({ prompt, modelId }, handlers)
// หลัง:
import { generateStream } from "@/lib/api/router";
await generateStream({ prompt, modelId }, handlers);
```

### Model Selector (`components/prompt.tsx`)

```tsx
const MODELS = [
  // Provider API
  { id: "z-ai/glm-5.2:free", label: "GLM 5.2 (free)" },
  { id: "gpt-4o",            label: "GPT-4o" },
  { id: "claude-sonnet-4",   label: "Claude Sonnet 4" },
  // Local CLI
  { id: "cli:opencode",      label: "opencode (local CLI)" },
  { id: "cli:cursor",        label: "Cursor Agent" },
  // Local Socket
  { id: "socket:local",      label: "Local Agent Server" },
] as const;
```

## 6.6 UX Patterns

### Streaming cursor

```tsx
// components/chat-messages.tsx
{message.isStreaming && <span className="animate-pulse">▍</span>}
```

### Disable input ขณะสตรีม

```tsx
<PromptInput isLoading={isLoading} onSubmit={...} />
// ใน PromptInput: <button disabled={isLoading || !prompt.trim()}>
```

### Auto-scroll

```tsx
const bottomRef = useRef<HTMLDivElement>(null);
useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
```

### Markdown + Code Highlight

โปรเจกต์นี้ใช้ `streamdown` อยู่แล้ว:

```tsx
import { Streamdown } from "streamdown";
<Streamdown>{message.content}</Streamdown>
```

## 6.7 Error Handling ทั้งระบบ

| แหล่ง error | รูปแบบ | Frontend ทำ |
|-------------|--------|-------------|
| Rust `Channel::Error` | `{event:"error", data:{message}}` | `onError` → error bubble |
| `invoke` throw | `catch (error)` | friendly message (เช่น 429) |
| `!isTauri()` | `throw` | แจ้งให้รัน `bun tauri dev` |
| Agent Server down | `Failed to connect...` | แจ้งให้รัน `node agent-server/server.js` |

> อย่า `return Err` จาก Rust หลัง `send(Error)` — จะได้ error ซ้ำ (ดู `ai/mod.rs:225`)

## 6.8 ทดสอบ Frontend โดยไม่ต้องรัน Tauri (Mock)

```ts
// lib/api/mock.ts
export async function chatGenerateStreamMock(req: ChatRequest, handlers: ChatStreamHandlers) {
  handlers.onStart?.();
  const words = `Mock response for: ${req.prompt}`.split(" ");
  for (const w of words) {
    await new Promise(r => setTimeout(r, 60));
    handlers.onChunk(w + " ");
  }
  handlers.onDone(req.modelId);
}
```

```ts
// ใช้ mock เมื่อ !isTauri()
import { chatGenerateStreamMock } from "./mock";
const fn = isTauri() ? chatGenerateStream : chatGenerateStreamMock;
await fn({ prompt, modelId }, handlers);
```

มีประโยชน์สำหรับ Storybook / `bun run dev` แบบไม่เปิด Tauri

## 6.9 Checklist

- [ ] `invoke` ชื่อตรงกับ `#[tauri::command]` (snake_case ↔ camelCase)
- [ ] `Channel` generic type ตรงกับ Rust enum
- [ ] `hasErrored` guard กัน error ซ้ำ
- [ ] `isStreaming` → disable input + โชว์ cursor
- [ ] `generateStream` router รวม 3 backend แล้ว
- [ ] ทดสอบทั้ง `bun tauri dev` และ `bun run dev` (mock)

---
กลับไป [README](./README.md) | อ่าน [01 Overview](./01-architecture-overview.md) อีกครั้งเพื่อเห็นภาพรวม
