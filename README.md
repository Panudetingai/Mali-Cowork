<p align="center">
  <img src="./docs/brand/mali-cowork-icon.png" width="128" height="128" alt="Mali Cowork logo: yellow blob with two dark pill-shaped eyes" />
</p>

# Mali Cowork

**Mali Cowork** is a desktop app (Tauri + React + Rust) for talking to AI and running agents on your machine. Use **Chat** for Q&amp;A and writing, or **Cowork** to let an agent read and change files only in folders you allow — via provider APIs (OpenAI, Anthropic, and others), local CLI agents (OpenCode, Codex, Gemini CLI, Cursor Agent), or a local agent server. See [Features](./docs/FEATURES.md) for the full capability list.

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

## Release (macOS + Windows)

GitHub Actions workflow [`.github/workflows/release.yml`](./.github/workflows/release.yml) builds installers and attaches them to a GitHub Release.

**Version** must match in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. Current release: **v0.1.2**.

### Brand assets

Official icon (PNG): [`docs/brand/mali-cowork-icon.png`](./docs/brand/mali-cowork-icon.png) — Luke’s **transparent** master (~1337×1177, yellow blob + eyes on alpha). Same file as [`docs/brand/mali-cowork-icon-transparent.png`](./docs/brand/mali-cowork-icon-transparent.png). Web UI favicons and Open Graph image live under [`public/`](./public/) (`icon.png`, `favicon-*.png`, `icon-512.png`).

Regenerate all derived icons from the master (Tauri bundle + `public/`):

```bash
cp /path/to/mali-cowork-icon-transparent.png ./mali-cowork-icon.png   # transparent chat master
./scripts/regenerate-brand-from-master.sh
```

For GitHub **social preview** (needs an opaque image), use [`docs/brand/mali-cowork-icon-social-preview.png`](./docs/brand/mali-cowork-icon-social-preview.png) (white matte export only — not used for in-app icons).

### วิธีปล่อยเวอร์ชันให้คนอื่นดาวน์โหลด

1. อัปเดตเลขเวอร์ชันในทั้ง 3 ไฟล์ด้านบน แล้ว commit
2. สร้าง tag และ push:

```bash
git tag v0.1.2
git push origin v0.1.2
```

3. รอ workflow **Release** บน GitHub Actions ให้เสร็จ
4. เปิดหน้า **Releases** ของ repo — จะมีไฟล์ประมาณนี้:
   - **macOS**: `.dmg` (Universal: Apple Silicon + Intel)
   - **Windows**: `.msi` และ/หรือ NSIS `.exe`

หรือรันมือจาก **Actions → Release → Run workflow** (ใช้เวอร์ชันจาก `tauri.conf.json` สร้าง tag `v<version>` ให้อัตโนมัติ)

### หมายเหตุการแจกจ่าย

- แอปยังไม่ได้ code-sign / notarize — ผู้ใช้ macOS อาจต้องเปิดครั้งแรกด้วย Right click → Open
- Windows อาจแสดง SmartScreen สำหรับไฟล์ที่ไม่ได้ลงนาม — เป็นเรื่องปกติสำหรับ build จาก CI แบบ open source

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
