# Mali Cowork — Tauri Desktop App

> React (WebView) → Rust Core → 3 backends: Local CLI / Agent, Provider API, Local Port/Socket

```
┌───────────────────────┐       ┌───────────────────────┐
│   UI (React / Vue)    │ ────> │  Rust Core Backend    │
└───────────────────────┘       └───────────┬───────────┘
                                           │
             ┌─────────────────────────────┼─────────────────────────────┐
             ▼                             ▼                             ▼
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│   1. Local CLI / Agent  │   │    2. Provider API      │   │   3. Local Port/Socket  │
│  (opencode, cursor CLI) │   │ (OpenAI, Anthropic, etc)│   │   (Local Agent Server)  │
└─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
```

## Docs

เอกสารการสร้างระบบทั้งหมดอยู่ที่ [`docs/`](./docs/README.md):

| เอกสาร | เนื้อหา |
|--------|---------|
| [01 Architecture Overview](./docs/01-architecture-overview.md) | ภาพรวม + data flow + โครงสร้างโปรเจกต์ |
| [02 Tauri Core Setup](./docs/02-tauri-core-setup.md) | ตั้งโปรเจกต์ Tauri+React+Rust ตั้งแต่ศูนย์ |
| [03 Provider API](./docs/03-provider-api-integration.md) | เชื่อม OpenAI/Anthropic/Google/OpenRouter/Groq (โค้ดจริง) |
| [04 Local CLI / Agent](./docs/04-local-cli-agent-integration.md) | เรียก `opencode`, `cursor-agent` ผ่าน `std::process::Command` |
| [05 Local Port / Socket](./docs/05-local-port-socket-integration.md) | เชื่อม Agent Server ผ่าน HTTP SSE / WebSocket / TCP / UDS |
| [06 Frontend Integration](./docs/06-frontend-integration.md) | React `invoke` + `Channel` + รวม 3 backend ด้วย `modelId` |

## Quick Start

```bash
bun install
cp .env.example .env   # ใส่ API keys
bun tauri dev          # รัน Tauri + Vite (port 1420)
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
