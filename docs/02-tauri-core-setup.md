# 02 — Tauri Core Setup (ตั้งโปรเจกต์ตั้งแต่ศูนย์)

> บทนี้สอนสร้างโปรเจกต์แบบ Mali Cowork ตั้งแต่ `bun create` จนรัน `bun tauri dev` ได้

## 2.1 Prerequisites

| สิ่งที่ต้องมี | ตรวจสอบ |
|---------------|---------|
| Rust (stable) | `rustc --version` |
| Bun หรือ Node 18+ | `bun --version` |
| Tauri prerequisites (Windows: WebView2, C++ build tools) | https://tauri.app/start/prerequisites/ |

```bash
# ติดตั้ง Rust (ถ้ายังไม่มี)
winget install Rustlang.Rustup   # Windows
# หรือ https://rustup.rs
```

## 2.2 สร้างโปรเจกต์

```bash
bun create tauri-app mali_cowork --template react-ts
cd mali_cowork
bun install
```

เลือก:
- Package manager: `bun`
- Frontend: `React` + `TypeScript`
- Rust crate name: `mali_cowork`

## 2.3 ติดตั้ง Dependencies ที่โปรเจกต์นี้ใช้

```bash
bun add @tauri-apps/api @tauri-apps/plugin-opener ai streamdown motion lucide-react
bun add -D @tauri-apps/cli @tailwindcss/vite tailwindcss
```

`src-tauri/Cargo.toml` ที่ใช้จริง:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
aisdk = { version = "0.5.2", features = ["anthropic", "openai", "google", "openrouter", "groq"] }
dotenvy = "0.15"
futures = "0.3"
```

> ถ้าจะทำ **CLI (บท 04)** เพิ่ม `tauri-plugin-shell = "2"` หรือใช้ `std::process` ตรงๆ
> ถ้าจะทำ **Socket (บท 05)** เพิ่ม `tokio = { version = "1", features = ["full"] }`, `axum = "0.7"`, `tokio-tungstenite = "0.21"`

## 2.4 Config สำคัญ (`src-tauri/tauri.conf.json`)

```json
{
  "productName": "Mali Cowork",
  "identifier": "com.panudet.mali_cowork",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Mali Cowork",
      "width": 1280, "height": 720,
      "decorations": false,
      "shadow": true
    }],
    "security": { "csp": null }
  }
}
```

### `vite.config.ts` — ต้อง fixed port

```ts
// src-tauri/tauri.conf.json devUrl ต้องตรงกับ vite server.port
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] }
  }
})
```

ดูไฟล์จริง: `vite.config.ts:25` และ `src-tauri/tauri.conf.json:7`

## 2.5 Rust Entry Point (`src-tauri/src/lib.rs`)

```rust
mod ai;
mod chat_stream;
mod commands;
use commands::chat::chat_generate;

pub fn run() {
    let _ = dotenvy::dotenv();              // โหลด ./.env
    let _ = dotenvy::from_path("../.env");  // เผื่อรันจาก src-tauri/

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .menu(|h| tauri::menu::Menu::new(h)) // ลบ native menu bar
        .invoke_handler(tauri::generate_handler![chat_generate])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

> ทุก command ที่เพิ่มใหม่ ต้องมา register ใน `generate_handler![]` ตรงนี้

## 2.6 .env

```
# .env ที่ root (D:\mali_cowork\.env)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIza...
OPENROUTER_API_KEY=sk-or-v1-...
GROQ_API_KEY=gsk_...
```

`lib.rs:16` จะ `eprintln!` เตือนถ้าไม่มี `OPENROUTER_API_KEY` — ดู log ใน terminal ที่รัน `bun tauri dev`

## 2.7 รันและ Build

```bash
bun tauri dev      # dev (hot reload)
bun tauri build    # build → src-tauri/target/release/bundle/
```

### โครงสร้าง `src-tauri/src` ที่แนะนำ

```
src/
├── lib.rs
├── main.rs              # #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
├── chat_stream.rs       # enum ChatStreamEvent
├── ai/mod.rs            # LLM providers
└── commands/
    ├── mod.rs
    ├── chat.rs          # chat_generate
    ├── cli.rs           # ← เพิ่มสำหรับบท 04
    └── socket.rs        # ← เพิ่มสำหรับบท 05
```

## 2.8 Checklist ก่อนไปบทถัดไป

- [ ] `bun tauri dev` เปิดหน้าต่างได้
- [ ] `invoke("chat_generate")` เรียกจาก UI ได้ (ดูบท 06)
- [ ] `.env` โหลดได้ (`eprintln!` ไม่เตือน)
- [ ] `cargo check` ผ่าน

---
ต่อไป: **บท 03 — Provider API** (มีโค้ดพร้อมใช้)
