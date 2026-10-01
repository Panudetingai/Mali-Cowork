# Handoff → Cursor: Notch Pill + Background Agent (macOS + Windows)

> Contract: `src/features/notch/` (ใหม่) · Backend: `src-tauri/src/commands/notch.rs` (ใหม่)
> อ้างอิงเดิม: `src-tauri/src/commands/quick.rs:166` (quick_window pattern) · `src/main.tsx:27` (?window=quick branch) · `src-tauri/capabilities/quick.json` · `src-tauri/src/lib.rs:55` (invoke_handler)
> PRD: Ambient / Companion Agent UI — Notch pill (Working / Needs permission / Idle dot) + Tray + Ephemeral upload

## เป้าหมาย

สร้างหน้าต่างเล็ก `notch` แยกจาก main/quick:
- โชว์สถานะ agent แบบไม่ต้องเปิดแอป: `Working… / Prep workspace… / Needs permission (git push) / Idle dot`
- กด `Allow (Y) / Deny (N)` ได้จาก pill เลย (reuse permission system เดิม ไม่สร้างใหม่)
- บน macOS วางใต้ notch ชิดเมนูบาร์ / บน Windows วาง top-center บนสุด (fallback ไม่มี notch)
- ไม่โหลด history/vault — เปิดไวเหมือน Quick bar

## กติกา (ห้ามแหก)

- ✅ สร้างได้: `src-tauri/src/commands/notch.rs`, `src-tauri/capabilities/notch.json`, `src/features/notch/*`, branch `?window=notch` ใน `src/main.tsx`
- ❌ ห้ามแก้ `quick-bar-root.tsx`, `run.ts`, `bridge.ts` (Quick bar ใช้งานจริงแล้ว)
- ❌ ห้ามแก้ permission backend เดิม — reuse `opencode_permission_reply`, `agent_reply_permission` เท่านั้น
- ❌ ห้ามอ่าน clipboard จาก JS — ถ้าต้องใช้ ใช้ `quick_take_context` pattern เท่านั้น
- ❌ ห้ามโหลด `loadChatHistory / loadProjects / loadVault` ใน Notch window (ต้องเปิดไว)
- รัน `bun test src` + `npx tsc --noEmit` ให้ผ่านก่อนส่ง

## 1. Backend Rust — `src-tauri/src/commands/notch.rs` (ใหม่)

ลอก `quick_window()` ใน `quick.rs:166-187` ทั้งดุ้น เปลี่ยนแค่:

```rust
pub const NOTCH_LABEL: &str = "notch";
// compact: 720x64, expanded: 720x220, dot: 48x48 (resize via set_size เอา ไม่ต้องสร้าง window ใหม่)
fn notch_window(app: &AppHandle) -> Result<WebviewWindow> {
  if let Some(w) = app.get_webview_window(NOTCH_LABEL) { return Ok(w); }
  let builder = WebviewWindowBuilder::new(app, NOTCH_LABEL, WebviewUrl::App("index.html?window=notch".into()))
    .title("Mali Notch")
    .inner_size(720.0, 64.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .shadow(true);
  #[cfg(target_os = "macos")]
  let builder = builder.transparent(true);
  #[cfg(target_os = "windows")]
  let builder = builder.transparent(true); // Win11 รองรับ แต่ blur ไม่สวยเท่า macOS — ใช้ CSS rounded ชดเชย
  builder.build()
}
```

Commands ที่ต้องมี (register ใน `lib.rs` invoke_handler):
- `notch_show(mode: String)` — show + position + set_size ตาม mode (`compact|expanded|dot`)
- `notch_hide()` — hide
- `notch_set_mode(mode: String)` — resize อย่างเดียว ไม่ show/hide (compact 720x64 / expanded 720x220 / dot 48x48)
- `notch_open_main(chat_id?: String)` — reuse logic `quick_open_main`: hide notch → show main → `emit_to("main", "quick:open-chat", chat_id)`

Positioning (สำคัญ — ต่างกันตาม OS):
```rust
// macOS: top-center ของจอที่ cursor อยู่, y = menu_bar_height (~24-28px) + 8px offset
// หมายเหตุ: วาดทับรอย notch ไม่ได้ — วางใต้ notch เท่านั้น
// Windows: top-center ของจอที่ cursor อยู่, y = 8px จากขอบบน (ไม่มี notch/menu bar แบบ mac)
// ใช้ cursor_position() → current_monitor() → set_position(Physical)
```
- หาจอจาก cursor เหมือน `quick_start_capture_overlay` ใน `quick.rs:379-431` (ลอก `screen_infos` + find by cursor)
- Focus: `notch_show(expanded)` ตอน permission → `set_focus()` เพื่อรับ Y/N; `notch_show(compact/dot)` ตอน working/idle → ไม่ steal focus (`show()` อย่างเดียว ไม่ `set_focus`)

Event mirror (ไม่สร้าง event ใหม่ — forward ของเดิม):
- ใน `chat_stream.rs` / agent emit เดิม หลัง `emit_to("main", ...)` เพิ่ม `emit_to("notch", ...)` ด้วย event เดิม:
  - `agent:step` → pill text (`Prep workspace…`, `Asking…`, `Sending…`)
  - `agent:todos` → expanded list (title + status)
  - `opencode:permission` / `agent:permission` → `notch_set_mode("expanded")` + show ค้าง + `native_alert` เดิม
- ถ้าหา emit point ไม่เจอ ให้จดไว้ท้ายไฟล์นี้ ห้ามแก้ logic stream เดิม

`on_window_event`: เพิ่ม `(NOTCH_LABEL, Focused(false))` → **ห้าม auto-hide** (ต่างจาก Quick bar) เพราะ user ต้องเห็น pill ค้างขณะ agent ทำงาน

## 2. Capabilities — `src-tauri/capabilities/notch.json` (ใหม่)

ลอก `quick.json` เป๊ะ เปลี่ยนแค่ windows:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "notch",
  "description": "Notch pill: status mirror + Allow/Deny only. No fs/dialog/clipboard.",
  "windows": ["notch"],
  "permissions": [
    "core:default",
    "core:window:allow-hide",
    "core:window:allow-start-dragging",
    "core:window:allow-set-focus",
    "opener:default"
  ]
}
```

## 3. Frontend — `src/features/notch/` (ใหม่) + `src/main.tsx`

`src/main.tsx:38` เพิ่ม branch (ห้ามแตะ branch quick เดิม):
```tsx
} else if (windowParam === "notch") {
  document.documentElement.dataset.window = "notch";
  root().render(<React.StrictMode><ThemeProvider><NotchRoot /></ThemeProvider></React.StrictMode>);
}
```

ไฟล์ที่ต้องสร้าง:
- `src/features/notch/NotchRoot.tsx` — ฟัง event `agent:step|todos|permission` ผ่าน `listen()` เดิม, เก็บ state `mode: idle|working|permission`, `steps: string[]`, `permission?: {tool, command}`
- `src/features/notch/NotchPill.tsx` — 3 state ตามรูป:
  - `working (compact)`: icon spinner + text shimmer (เช่น "Prep workspace…") + hover/click → expanded
  - `permission (expanded ค้าง)`: `korus needs permission` + command mono (`git push`) + ปุ่ม `Allow (Y) / Deny (N)` → เรียก `opencode_permission_reply` / `agent_reply_permission` ตัวเดิม → `notch_set_mode("compact")`
  - `idle (dot)`: หลัง working จบ 5วิ → ย่อเหลือ dot 48px (แบบรูปล่างสุด) กด → `notch_open_main(chat_id)`
- `src/features/notch/bridge.ts` — wrapper `invoke("notch_show"|"notch_hide"|"notch_set_mode"|"notch_open_main")` (pattern เดียวกับ `features/quick/bridge.ts`)
- Keyboard: `Y` = Allow, `N` / `Esc` = Deny (เฉพาะตอน permission), ไม่ต้อง global shortcut ใหม่
- Theme: ใช้ CSS variables เดิม + `data-tauri-drag-region` ที่แถบ pill เพื่อลากได้
- ห้าม import `loadChatHistory/loadProjects/loadVault` เด็ดขาด

## 4. OS-specific checklist (ต้องเทสทั้งคู่)

| เรื่อง | macOS | Windows |
|---|---|---|
| ตำแหน่ง | ใต้ notch, ชิด menu bar, top-center | top-center, y=8px จากขอบบน |
| transparent | `transparent(true)` + vibrancy สวย | `transparent(true)` ได้ แต่ไม่มี vibrancy — ใช้ CSS `border-radius:16px + solid bg` fallback |
| shadow | system shadow ตาม card | `shadow(true)` อาจ flicker — ถ้ากระพริบให้ปิด shadow บน Win |
| taskbar/dock | `skip_taskbar(true)` ซ่อน dock | ซ่อน taskbar ได้ แต่ Alt-Tab อาจยังเห็น — รับได้ |
| focus steal | permission เท่านั้นที่ `set_focus` | เหมือนกัน |
| tray | menu bar extra ไม่ต้อง | ใช้ tray เดิม (`set_tray` ใน quick.rs) เป็นหลัก |

## 5. Acceptance (Cursor ต้องสาธิตได้)

1. `bun tauri dev` → รัน agent ใน main → pill `compact` โผล่ top-center พร้อม text step จริง
2. agent ขอ `git push` → pill ขยายค้าง + กด `Y` = Allow งานต่อ, `N` = Deny งานหยุด (เช็คจาก permission เดิม ไม่ใช่ mock)
3. งานจบ 5วิ → ย่อเหลือ dot → กด dot → main เปิดที่แชทนั้น
4. ปิด main (tray_mode on) → pill ยังอัปเดตได้
5. บน Windows: pill ไม่บัง taskbar, ปุ่ม Allow/Deny กดได้, ลาก pill ได้
6. `bun test src` + `npx tsc --noEmit` ผ่าน

## ขอ field / ติด logic เดิม (Cursor เขียนต่อท้ายตรงนี้)

- **ไม่มี event `agent:step` / `agent:todos` / `opencode:permission` อยู่จริง** — ทุก backend stream ผ่าน `Channel<ChatStreamEvent>` ต่อ request ไปที่ main เท่านั้น การ mirror ฝั่ง Rust ต้องแก้ทุก provider จึงเปลี่ยนเป็น relay ฝั่ง main window แทน: `src/features/notch/relay.ts` ฟัง `subscribeToRuns` + `subscribeToChats` (store เดิม) → `emitTo("notch", "notch:state")` ไม่แตะ stream เลย
- Allow/Deny: pill ส่ง `notch:reply` กลับ main → `replyToPermission()` ใน `pages/chat/turn.ts` (routing agent → opencode เดิม + เคลียร์การ์ดในแชท) ไม่ invoke backend ตรง
- ตำแหน่ง: ใช้ `monitor.work_area()` แทน menu bar height ตายตัว (Mac ที่มี notch เมนูบาร์ ~37px) — สูตรเดียวใช้ได้ทั้ง mac/Windows
- Focus: window สร้างด้วย `focused(false)` + `focusable(false)`; เปิด focusable เฉพาะโหมด expanded และ `set_focus` ครั้งเดียวต่อ permission id
- Pill ซ่อนเมื่อ main window มี focus (มี UI ในแชทอยู่แล้ว); งานจบตอนดู main อยู่ → ไม่ทิ้ง dot
- ขนาดจริง: compact 420×52, expanded 420×220, dot 48×48 (720 กว้างเกินสำหรับบรรทัดเดียว) — ปรับที่ `NotchMode::size()`
- Settings → Quick bar → "Show agent status at the top of the screen" (default เปิด, `mali.notch.enabled`)
- Known gap: งานที่รันจาก Quick bar (`run.ts`) ไม่ขึ้น pill เพราะไม่ผ่าน run store
- **Notch mode** (`notch_enter_mode` / `notch_exit_mode`, `features/notch/notch-mode.ts`): titlebar button → main window shrinks to a dot (macOS, clip-path) → hidden → the pill's window covers the screen down to the dot without taking clicks (`notch-intro.tsx`: dot flies up, light runs along the top edge) → pill opens on the ask box. The main window coming back (Dock, tray, "Open Mali") ends notch mode (`main_focused` in `on_window_event`).
- In notch mode ⌥⌘M opens the notch instead of the Quick bar (`notch::summon` in the shortcut handler); a Rust thread watches the cursor (top strip around the notch shows a hidden pill; enter/leave → `notch:hover`) because the page can't see the mouse while Mali is in the background. Double-click the bot hides the pill until the next hover/shortcut.
- Asking in the notch reuses the Quick bar engine (`runQuickPrompt`, `saveQuickThread`) without touching `run.ts` / `bridge.ts`; Settings → Quick bar → "Save what you ask in the notch" (`mali.notch.saveChats`, also toggled from the pill).
- `notch.json` gained `dialog:allow-open` for the + (attach) button. Dev preview of every state: `/dev/notch`.
- Round 3: views are now `collapsed | home | chat | permission | drop | welcome` with Home / Ask / New tabs (`TopBar`). Nothing is drawn over the camera: `cameraOf()` = notch + 12px either side. Notch detection reads NSScreen's auxiliary top areas (`read_notch`, tested), falls back to the main screen, keeps the last good reading, and is re-sent on every show (`show_pill`, which also re-asserts the window level).
- Team: Home's right card lists the user's team (read from `mali_team` in storage, `features/notch/team.ts`); tapping a bot asks it directly (its duty as a Quick action prefix, its model). A bot the lead hands work to takes the main spot and Mali waits in its chip until it reports back — bots are persistent elements keyed by id, so they glide instead of remounting.
- Round 5 (flicker, drops, capture): the notch window no longer resizes per view — one fixed size (`pillWindow`), the pill animates inside, and Rust lets clicks through outside the pill (`notch_hit_area` + the cursor watcher toggling `set_ignore_cursor_events`). Collection behavior is `Transient` (Stationary made Mission Control zoom the pill). A file drag is seen from the drag pasteboard (`DragWatch`) and opens the drop zone while it's still below the top edge (a drag that reaches the edge opens Mission Control). Dragging the bot out and letting go on a window captures that window (`notch_capture_at_cursor`: CGWindowList → `screencapture -l`); the camera tab picks one (`screencapture -iW`). Captures need Screen Recording permission. The notch's model list reads OpenCode without syncing providers (`use-notch-catalog.ts`): `useOpencode` waited forever for the keychain there.
