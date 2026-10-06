<p align="center">
  <img src="./docs/brand/mali-cowork-icon.png" width="128" height="128" alt="Mali Cowork logo: yellow blob with two dark pill-shaped eyes" />
</p>

<h1 align="center">Mali Cowork</h1>

<p align="center">
  <strong>AI that works on your machine — not on someone else's server.</strong><br />
  Chat with AI, or let an agent edit real files only in folders you allow.
</p>

<p align="center">
  macOS · Windows · Linux &nbsp;·&nbsp; Tauri 2 + React 19 + Rust &nbsp;·&nbsp; <strong>v0.1.7</strong> (early access)
</p>

---

## What is it

One desktop app for all the models and agents you already pay for. Pick a model once, then decide how much power it gets:

| Mode | For | Touches your files? |
|---|---|---|
| **Chat** | Q&A, writing, summarizing, thinking | ❌ No — never reads or edits files |
| **Cowork** | Agent edits code, organizes files, creates docs, runs commands | ✅ Yes — only in folders you approve, every action confirmable |

A chat stays in one mode forever — a plain chat can never silently become a file-editing agent.

## Highlights (v0.1.7)

- **Models everywhere** — Provider APIs (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Qwen, Z.ai, Kimi, OpenRouter, Groq, Ollama local + cloud) and local CLIs (**OpenCode**, Codex, Gemini CLI, Cursor Agent). One model picker tells you where each model comes from.
- **Real agent work** — streaming answers, thinking view, agent steps with timing, task plan / todo checklist, `@` file mentions, `/` skills, Projects with their own instructions.
- **Safe Cowork** — per-folder Read & write / Read only grants, shell permission cards, **Undo/Redo checkpoint every turn**, Files-changed panel with Preview + line diff, full **Git panel** (Changes / Commits / Branches, AI commit messages, ff-only pull).
- **Connectors (MCP)** — official MCP Registry + Popular list, install from chat, OAuth sign-in as **Mali Cowork**, keys in OS Keychain. Built-ins: Word, Exec, Filesystem, GitHub, Fetch, Playwright, SQLite, Postgres, Memory, Brave Search, Slack.
- **Visual studio** — separate Image / Video page (Google, OpenAI, OpenRouter, xAI, Qwen/Wan). Size, count, resolution, duration controls, local gallery.
- **Voice + Notch** — voice input with waveform, macOS Notch pill UI with mouse-wheel, click-away fold, Quick Capture overlay.
- **Bot Studio, Puter, Onboarding** — new in 0.1.7: team bots, Puter cloud files, first-run wizard that detects and installs agents for you.
- **Private by default** — chat history in local SQLite, keys in Keychain/Credential Manager, no analytics, no telemetry, no server. See [LANDING.md](./docs/LANDING.md#ความปลอดภัย--คำถามที่ควรถาม) for honest limits.

Full list: [FEATURES.md](./docs/FEATURES.md). User-facing install guide: [INSTALL.md](./docs/INSTALL.md).

## Architecture

```
┌───────────────────────┐       ┌───────────────────────┐
│   UI (React)          │ ────> │  Rust Core Backend    │
└───────────────────────┘       └───────────┬───────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                             ▼                             ▼
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│   1. Local CLI / Agent  │   │    2. Provider API      │   │   3. Local Port/Socket  │
│  (opencode, cursor CLI) │   │ (OpenAI, Anthropic, etc)│   │   (Local Agent Server)  │
└─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
```

All three backends stream through one `ChatStreamEvent` channel, so the frontend never cares which one answered. Details: [01 Architecture](./docs/01-architecture-overview.md).

## Quick Start (developers)

```bash
bun install
cp .env.example .env   # fill in API keys you use
bun tauri dev          # Tauri + Vite on :1420
```

Other commands:

```bash
bun run dev        # Vite only
bun tauri build    # production bundle
bun test src       # TypeScript tests (bun)
cargo test         # Rust tests (src-tauri)
npx tsc --noEmit   # typecheck
```

Env keys (dev only, loaded via `dotenvy`): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`. Release builds never load `.env` from the launch folder.

## Docs

Start at [`docs/`](./docs/README.md):

| Doc | Covers |
|---|---|
| [01 Architecture](./docs/01-architecture-overview.md) | Overview, data flow, project layout |
| [02 Tauri Core Setup](./docs/02-tauri-core-setup.md) | Tauri + React + Rust from zero |
| [03 Provider API](./docs/03-provider-api-integration.md) | OpenAI / Anthropic / Google / OpenRouter / Groq wiring |
| [04 Local CLI / Agent](./docs/04-local-cli-agent-integration.md) | `opencode`, `cursor-agent` via `std::process::Command` |
| [05 Local Port / Socket](./docs/05-local-port-socket-integration.md) | Agent Server over HTTP SSE / WS / TCP / UDS |
| [06 Frontend Integration](./docs/06-frontend-integration.md) | `invoke` + `Channel`, merging backends by `modelId` |
| [07 MCP Gateway](./docs/07-mcp-gateway.md) | `mali` gateway for external agents |
| [08 Plugins](./docs/08-plugins.md) | Plugins, marketplaces, sandboxed panels, `skillfish` installs |
| [Features](./docs/FEATURES.md) | Current capabilities + build checklists |
| [Install (users)](./docs/INSTALL.md) | Download, macOS/Windows install, first run |
| [Landing / Security](./docs/LANDING.md) | Thai-first pitch + honest security FAQ |

## Release

GitHub Actions [`.github/workflows/release.yml`](./.github/workflows/release.yml) builds and attaches installers to a GitHub Release:

- **macOS**: `.dmg` (Universal: Apple Silicon + Intel)
- **Windows**: NSIS `setup.exe`

Version must match in all three places — `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. Current: **v0.1.7**.

```bash
# bump version in the 3 files above, commit, then:
git tag v0.1.7
git push origin v0.1.7
# or: Actions → Release → Run workflow (tags v<version> from tauri.conf.json automatically)
```

Notes:

- No code-sign / notarize yet — macOS first open: Right click → Open (or `xattr -cr "/Applications/Mali Cowork.app"`); Windows SmartScreen → More info → Run anyway.
- In-app auto-update checks on launch and every 6h (v0.1.2 and older must reinstall manually once).

Brand master: [`docs/brand/mali-cowork-icon.png`](./docs/brand/mali-cowork-icon.png) (transparent). Regenerate icons:

```bash
cp /path/to/mali-cowork-icon-transparent.png ./mali-cowork-icon.png
./scripts/regenerate-brand-from-master.sh
```

Social preview (opaque, white matte, not for in-app use): `docs/brand/mali-cowork-icon-social-preview.png`.

## Security in 30 seconds

- Keys and MCP tokens in **Keychain / Credential Manager** (`0600` file on Linux), never plain text in localStorage.
- Chat history and projects in local **SQLite** (`0600`).
- Folder allow-list enforced in Rust (symlink/`..` resolved), shell commands ask first, read-only folders truly blocked.
- Strict CSP, no remote scripts, AI/tool Markdown rendered as text, never HTML.
- No analytics, no crash reporter, no account, no Mali server — verify by searching the source.

Threat-model honesty (prompt injection, malware, audit status): [LANDING.md security FAQ](./docs/LANDING.md#ความปลอดภัย--คำถามที่ควรถาม).

## Project layout

```
src/                 React 19 + Vite + Tailwind 4 + Router
  pages/chat/        Chat + Cowork UI, Visual studio, Bot Studio, Settings
  features/          notch, coworkers, checkpoints, git, mcp, providers, voice, …
  components/        chat blocks, diff views, UI primitives
src-tauri/src/       Rust backend: agent, ai, commands/{chat,git,checkpoint,…}, mcp, media, storage
agent-server/        Local agent server (port/socket backend)
scripts/             sidecar build, token-bench, brand regen
docs/                Developer docs + user guides (see table above)
```

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
