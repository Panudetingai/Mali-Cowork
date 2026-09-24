# Handoff → Cursor: Epic A — Mali Anywhere (UI)

> PRD: [PRD-delight-v0.3.md §6.2](./PRD-delight-v0.3.md) · Contract: `src/features/quick/` · Backend: `src-tauri/src/commands/quick.rs`
> **อัปเดต 25 ก.ย.:** Backend + Quick bar UI (A1) + `runQuickPrompt` ของจริง **เสร็จแล้ว (Claude Code)** — งานที่เหลือของ Cursor คือ **A2 Settings → Shortcuts** อย่างเดียว

## กติกา

- ✅ แก้/สร้างได้: หน้า Settings (`src/pages/settings/`)
- ❌ ห้ามแก้ `quick-bar-root.tsx`, `run.ts`, `bridge.ts` (Quick bar ใช้งานจริงแล้ว — แจ้งถ้าเจอบั๊ก)
- ❌ **ห้ามแก้** `types.ts`, `actions.ts`, `api.ts`, `settings.ts` และฝั่ง Rust — ต้องการ field เพิ่ม ให้จดท้ายไฟล์นี้
- ❌ **ห้ามวาง UI ของ Quick bar ในหน้าแชทหรือหน้าต่างหลัก** — Quick bar อยู่ในหน้าต่างแยกเท่านั้น
- ❌ ห้ามอ่าน clipboard เองจาก JS (`navigator.clipboard.readText`) — ใช้ `takeQuickContext()` เท่านั้น (Rust อ่านให้ตอนกด shortcut ครั้งเดียว)
- หน้าต่าง Quick bar **ไม่โหลด** chat history / projects / vault — อย่า import store พวกนั้นใน Quick bar
- รัน `bun test src` และ `npx tsc --noEmit` ให้ผ่านก่อนส่งงาน

## ทดสอบยังไง

`bun tauri dev` → กด **⌥⌘M** (Windows: Ctrl+Alt+M) จากแอปไหนก็ได้ → หน้าต่าง Quick bar ขึ้นกลางจอ · Esc หรือคลิกที่อื่น = ซ่อน
ใน browser ธรรมดา: เปิด `http://localhost:1420/?window=quick` (API จะคืนค่าว่าง ไม่ error)

## API ที่ใช้ได้

| ฟังก์ชัน | ใช้ทำอะไร | สถานะ |
| --- | --- | --- |
| `takeQuickContext()` → `QuickContext` | clipboard ที่จับไว้ตอนกด shortcut (ได้ครั้งเดียวต่อการกด) | ✅ จริง |
| `onQuickOpened(fn)` | กด shortcut อีกครั้งขณะ Quick bar โหลดอยู่ → เรียก `takeQuickContext()` ใหม่ + ล้าง state | ✅ จริง |
| `hideQuick()` | Esc / หลัง Copy | ✅ จริง |
| `captureScreen()` → `Attachment \| null` | ลากเลือกพื้นที่จอ (macOS) — `null` = ผู้ใช้กด Esc; Windows จะ throw ให้แสดงข้อความ | ✅ จริง |
| `openInMali(chatId?)` | ปุ่ม "Open in Mali" | ✅ จริง |
| `runQuickPrompt(request, onEvent, { signal, thread })` | ส่งคำถาม + stream คำตอบ (`text` / `done` / `error`) — ใน `run.ts` | ✅ จริง |
| `DEFAULT_QUICK_ACTIONS` | สรุป · แปล TH⇄EN · เขียนใหม่ให้สุภาพ · อธิบายโค้ด | ✅ |
| `useQuickConfig()` / `setQuickConfig(patch)` → `QuickStatus` | อ่าน/บันทึก Settings (บันทึกแล้ว apply ทันที) | ✅ จริง |
| `useQuickStatus()` | shortcut ใช้งานได้ไหม + `error` (เช่นชนกับแอปอื่น) | ✅ จริง |

## งานของ Cursor

### ~~A1. Quick bar UI~~ ✅ Claude Code ทำแล้ว (เก็บไว้เป็น spec อ้างอิง)
- ช่องพิมพ์ (autofocus) + chip **Clipboard** (แสดง 1–2 บรรทัดแรก, ปุ่ม × เอาออก, ป้าย "ถูกตัด" ถ้า `clipboardTruncated`)
- แถว Quick actions จาก `DEFAULT_QUICK_ACTIONS` (ปุ่มลัด ⌘1–⌘4)
- ปุ่ม **Capture screen** → `captureScreen()` → แสดง thumbnail เป็น chip (ลบได้); จับ error แล้วแสดงข้อความ
- Enter = ส่ง → แสดงคำตอบแบบ stream ด้วย markdown component เดิม (`MessageResponse` ใน `src/components/ai-elements/message.tsx` — ดูวิธีใช้ใน `assistant-message.tsx`)
- หลังตอบ: **Copy** (แล้ว `hideQuick()`), **Open in Mali**, **ถามต่อ**
- Esc: ถ้ากำลัง stream → abort; ไม่งั้น `hideQuick()`
- โทนตาม theme เดิม, มุมโค้ง, ลากหน้าต่างได้ (`data-tauri-drag-region` ที่แถบบน)
- **Paste back ยังไม่ทำใน v0.3.2** (ต้องขอสิทธิ์ Accessibility — PRD open question #2)

### A2. Settings → Shortcuts (A-FR1, A-FR6, A-FR7, A-FR8)
- เพิ่มแท็บใน `src/pages/settings/` (ดู pattern จาก `receipt-settings.tsx`)
- Toggle เปิด/ปิด Quick bar · ช่องบันทึก shortcut (กดปุ่มจริงแล้วแปลงเป็น accelerator เช่น `CommandOrControl+Alt+M`) · แสดง `useQuickStatus().error` ใต้ช่อง
- Toggle **Keep running in menu bar** (`trayMode`) — อธิบายว่าปิดหน้าต่างแล้วแอปยังอยู่ ให้ shortcut ใช้ได้
- เลือกโมเดลของ Quick bar (`modelId`) — ใช้ model picker เดิม
- Toggle บันทึกแชท Quick ในประวัติ (`saveToHistory`)
- แสดง shortcut เป็นสัญลักษณ์ตาม OS (⌥⌘M บน Mac, Ctrl+Alt+M บน Windows)

## งานที่ Claude Code จะทำต่อ (ไม่ต้องทำ)

- ~~`runQuickPrompt` ของจริง~~ ✅ ส่งผ่าน `generateStream` โหมด Chat; หน้าต่างหลักเป็นผู้บันทึกแชท (`bridge.ts`)
- Paste back (Accessibility) ถ้าตัดสินใจทำ
- Screen capture บน Windows
- `/code-review` หลัง A1–A2 เสร็จ

## ขอ field เพิ่ม (Cursor เขียนต่อท้ายตรงนี้)

-
