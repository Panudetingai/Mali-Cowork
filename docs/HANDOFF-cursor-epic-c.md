# Handoff → Cursor: Epic C — Work Receipt & Outputs (UI)

> PRD: [PRD-delight-v0.3.md §6.4](./PRD-delight-v0.3.md) · Contract: `src/features/work-receipt/`
> ข้อมูลทั้งหมดคำนวณจากแชทที่โหลดอยู่ในหน่วยความจำแล้ว และ backend (`outputs_stat`) เสร็จแล้ว — ไม่มี mock เหลือ

## กติกา

- ✅ แก้/สร้างได้: component ใหม่, `pages/`, sidebar, settings UI
- ❌ **ห้ามแก้** `types.ts`, `receipt.ts`, `outputs.ts`, `recap.ts`, `api.ts` ใน `src/features/work-receipt/` — ถ้าต้องการ field เพิ่ม ให้จดไว้ท้ายไฟล์นี้ แล้ว Claude Code จะเพิ่มให้
- ❌ ห้าม import `mock.ts` ในโค้ด production (ใช้ได้เฉพาะตอน dev / preview)
- รัน `bun test src` และ `npx tsc --noEmit` ให้ผ่านก่อนส่งงาน

## API ที่ใช้ได้

| ฟังก์ชัน | ใช้ทำอะไร | สถานะ |
| --- | --- | --- |
| `buildWorkReceipt(session, message)` → `WorkReceipt \| undefined` | ข้อมูลการ์ด Receipt ของ reply หนึ่ง (undefined = ไม่ต้องแสดง) | ✅ จริง |
| `estimateMinutesSaved(receipt, rates?)` | "ประหยัดเวลาไป ~N นาที" — **ต้องติดป้าย "ประมาณการ" เสมอ** | ✅ จริง |
| `DEFAULT_TIME_SAVED_RATES` | ค่าเริ่มต้นของสูตร (ให้ผู้ใช้ปรับใน Settings) | ✅ จริง |
| `listOutputs(sessions, query)` → `OutputItem[]` | รายการไฟล์ที่ agent สร้าง, กรอง project / kind / search / since | ✅ จริง |
| `outputKindOf(path)` | ชนิดไฟล์สำหรับ filter + icon | ✅ จริง |
| `buildWeeklyRecap(sessions, weekStart?, rates?)` → `WeeklyRecap` | ตัวเลขหน้า Weekly recap | ✅ จริง |
| `startOfWeek(date?)` | วันจันทร์ 00:00 ของสัปดาห์ | ✅ จริง |
| `statOutputs(items)` → `OutputStat[]` | ไฟล์ยังอยู่ไหม (แสดง "ไม่พบไฟล์") — ส่ง `{ path, checkpointId }` | ✅ จริง (25 ก.ย.) |
| `MOCK_SESSIONS` (`mock.ts`) | แชทตัวอย่าง 2 อัน สำหรับ dev ตอนเครื่องไม่มีประวัติ Cowork | dev only |

แหล่งข้อมูลแชท: `useChatSessions()` จาก `@/features/chat-history` · ชื่อ project: `getProject(id)` จาก `@/features/projects`

## งานของ Cursor

### C1. Work receipt card (C-FR1)

> ⚠️ **อัปเดต 25 ก.ย.:** ห้ามวาง receipt card ในหน้าแชท — หน้าแชทเป็นพื้นที่ทำงานของผู้ใช้ ต้องมีแค่คำตอบ + Files changed
> ตอนนี้เปิดจากไอคอน 🧾 ในแถบ Copy / 👍 / Retry → `WorkReceiptDialog` (`work-receipt-dialog.tsx`) · กติกานี้ใช้กับ UI ใหม่ทุกชิ้นของ v0.3 ด้วย
> Rename/ย้ายไฟล์ ตอนนี้นับเป็น Modified (มี `files.renamed`) ไม่ใช่ Created + Deleted แล้ว
- ~~แสดงใต้ reply สุดท้ายของรอบ Cowork~~ → แสดงใน dialog (ดูด้านบน)
- เนื้อหา: ไฟล์ +สร้าง/~แก้/−ลบ (+/− บรรทัด) · คำสั่งที่รัน (พับได้) · connector (ใช้ `McpToolIcon` จาก `@/features/mcp`) · เวลา · token/cost · ประมาณการเวลาที่ประหยัด
- ปุ่ม Undo: ใช้ของเดิมใน `features/checkpoints` (ห้ามเขียน logic ใหม่)
- `state === "undone"` → แสดงแบบจาง + ป้าย "Undone"; `partial` → แสดงคำเตือนแบบเดียวกับ FilesChanged
- ตัวอย่าง pattern: `src/features/checkpoints/files-changed.tsx`

### C2. Export receipt เป็น Markdown (C-FR2)
- ปุ่มในการ์ด → บันทึก `.md` แบบเดียวกับ Export แชทที่มีอยู่ (ค้นหา export chat ใน `chat-message-panel.tsx`) — ไม่รวม thinking

### C3. Outputs gallery (C-FR3)
- หน้าใหม่ `/outputs` + เมนูใน sidebar (`src/components/app/sidebar/app-sidebar.tsx`) + แท็บ Outputs ในหน้า project (`src/pages/projects/`)
- Filter chips ตาม `OutputKind`, ช่องค้นหา, virtualized list (≥ 1,000 รายการต้องลื่น)
- คลิก: Preview ด้วย `checkpointPreview(checkpointId, path)` · Reveal ด้วย `openCheckpointFile(checkpointId, path, true)` · "ไปยังแชท" → navigate ไปที่ `chatId`
- เรียก `statOutputs` เฉพาะรายการที่อยู่บนจอ; `exists: false` → ป้าย "ไม่พบไฟล์" (ไม่ลบออกจากรายการ)

### C4. Weekly recap (C-FR4)
- dialog/หน้า เปิดจากเมนู และเปิดอัตโนมัติครั้งแรกของวันจันทร์ (จำใน localStorage แบบ try/catch)
- stat tiles: tasks · ไฟล์ที่สร้าง · เวลาที่ agent ทำงาน · cost · ประมาณการเวลาที่ประหยัด; top projects / models
- ปุ่มเลื่อนสัปดาห์ก่อนหน้า (`weekStart - 7 วัน`); empty state เมื่อ `tasks === 0`

### C5. Settings → ตั้งสูตรเวลาที่ประหยัด (C-FR5)
- 4 ช่องตัวเลขตาม `TimeSavedRates` + ปุ่ม Reset เป็น `DEFAULT_TIME_SAVED_RATES`
- เก็บด้วย `createStore` จาก `@/lib/local-store` แล้วส่งค่าเข้า `estimateMinutesSaved` / `buildWeeklyRecap`

## งานที่ Claude Code จะทำต่อ (ไม่ต้องทำ)

- ~~implement `outputs_stat`~~ ✅ เสร็จแล้ว — ตอบเฉพาะ path ที่ checkpoint บันทึกไว้
- `/code-review` หลัง C1–C5 เสร็จ

## ขอ field เพิ่ม (Cursor เขียนต่อท้ายตรงนี้)

- Cursor กำลัง implement C1–C5 ตามเอกสารนี้ — ยังไม่ต้องการ field เพิ่มจาก contract ในขั้นตอนแรก หากระหว่างทำพบว่าขาด field จะจดต่อท้ายนี้
- สิ่งที่ใช้เพิ่มเติมเป็น UI state ใน localStorage (ไม่ใช่ field ของ contract): store สำหรับ `TimeSavedRates` และ key จดจำการเปิด Weekly recap ล่าสุด
