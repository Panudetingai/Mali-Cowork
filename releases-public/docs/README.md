# Mali Cowork — Tauri Desktop App Docs

> เอกสารคู่มือสำหรับสร้างระบบ Tauri Desktop App ที่เชื่อมต่อได้ 3 รูปแบบ: Local CLI / Agent, Provider API, และ Local Port/Socket ตามแผนภาพสถาปัตยกรรม

```
┌─────────────────────────────┐
│      Tauri Desktop App      │
│ ┌─────────────┐ ┌─────────┐ │
│ │ UI (React)  │→│Rust Core│ │
│ └─────────────┘ └────┬────┘ │
└──────────────────────┼──────┘
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ 1. Local │  │2. Provider│ │3. Local  │
   │ CLI/Agent│  │   API     │  │Port/Socket│
   └──────────┘  └──────────┘  └──────────┘
```

## สารบัญ

| ลำดับ | เอกสาร | เนื้อหา |
|-------|--------|---------|
| 01 | [Architecture Overview](./01-architecture-overview.md) | ภาพรวม, โครงสร้างโปรเจกต์, data flow |
| 02 | [Tauri Core Setup](./02-tauri-core-setup.md) | ตั้งโปรเจกต์ Tauri + React + Rust ตั้งแต่ศูนย์ |
| 03 | [Provider API](./03-provider-api-integration.md) | เชื่อม OpenAI / Anthropic / Google / OpenRouter / Groq (ใช้งานจริงแล้วในโปรเจกต์นี้) |
| 04 | [Local CLI / Agent](./04-local-cli-agent-integration.md) | เรียก opencode, cursor CLI, หรือ CLI ใดๆ จาก Rust |
| 05 | [Local Port / Socket](./05-local-port-socket-integration.md) | รัน Local Agent Server (TCP / Unix Socket / WebSocket / HTTP) |
| 06 | [Frontend Integration](./06-frontend-integration.md) | React เรียก Rust ผ่าน Tauri IPC + Streaming Channel |
| — | [Features](./FEATURES.md) | สรุป features ปัจจุบัน + แนวทาง feature ถัดไป |

## เริ่มตรงไหนดี?

- **อยากเข้าใจระบบทั้งหมดก่อน** → อ่าน `01` → `02`
- **จะต่อ LLM API** → ข้ามไป `03` ได้เลย (มีโค้ดพร้อม copy)
- **จะต่อ Agent/CLI ภายนอก** → อ่าน `04`
- **จะทำ Local Server ให้ภายนอกรัน agent** → อ่าน `05`
- **จะเขียนหน้า UI ให้เรียก Rust** → อ่าน `06`

## Tech Stack ปัจจุบัน (โปรเจกต์นี้)

| Layer | เทคโนโลยี |
|-------|-----------|
| UI | React 19 + Vite + Tailwind 4 + React Router |
| IPC | `@tauri-apps/api` (`invoke` + `Channel`) |
| Backend | Rust + Tauri 2 + `aisdk` crate + `dotenvy` |
| Providers | Anthropic / OpenAI / Google / OpenRouter / Groq |
| Streaming | `LanguageModelStream` → `Channel<ChatStreamEvent>` → React state |

## คำสั่งสำคัญ

```bash
bun install          # ติดตั้ง deps
bun run dev          # รัน Vite อย่างเดียว
bun tauri dev        # รัน Tauri + Vite (แนะนำ)
bun tauri build      # build โปรดักชัน
```

## Env

คัดลอก `.env.example` → `.env` ที่ root ของโปรเจกต์แล้วใส่ key ที่จะใช้

```env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
```

> Rust โหลด `.env` ผ่าน `dotenvy` ใน `src-tauri/src/lib.rs:11` ทั้ง `./.env` และ `../.env`

---
ดูรายละเอียดแต่ละบทในไฟล์แยกได้เลย ↓
