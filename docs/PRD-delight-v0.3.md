# PRD: Mali Cowork — Delight & Daily Habit (v0.3)

| ฟิลด์ | ค่า |
| --- | --- |
| **ผลิตภัณฑ์** | Mali Cowork (desktop — Tauri + React + Rust) |
| **เวอร์ชันเอกสาร** | 1.0 |
| **วันที่** | 24 ก.ย. 2026 |
| **สถานะ** | Draft — ต่อจาก [PRD Growth v0.2](./PRD-growth-v0.2.md) |
| **เจ้าของ** | Product / Mali Cowork team |
| **อ้างอิง** | [FEATURES.md](./FEATURES.md) · [PRD-growth-v0.2.md](./PRD-growth-v0.2.md) · [LANDING.md](./LANDING.md) |

---

## 1. บทสรุป (Executive summary)

v0.1.x ทำให้ Mali **ทำงานได้** (Chat / Cowork / Code, หลาย agent, MCP, checkpoint, Git) และ v0.2 ทำให้ **คุมได้และทำซ้ำได้** (Usage, Scheduled, Playbooks, Memory)

แต่สิ่งที่ทำให้ผู้ใช้ **"รัก" และบอกต่อ** ไม่ใช่จำนวน feature คือช่วงเวลาเหล่านี้:

| ช่วงเวลา | ความรู้สึกที่อยากให้เกิด | ตอนนี้ Mali เป็นอย่างไร |
| --- | --- | --- |
| **เรียกใช้** | "กดปุ๊บมาปั๊บ ไม่ต้องสลับแอป" | ต้องสลับมาหน้าต่าง Mali, ไม่มี global hotkey, ไม่มี ⌘K |
| **ระหว่างรอ** | "ปล่อยให้ทำ แล้วไปทำอย่างอื่นได้" | งานรันได้ทีละแชทที่เราเฝ้า, notification มีแล้วแต่ไม่มีที่รวมงาน |
| **ตอนเสร็จ** | "ว้าว มันทำให้เยอะขนาดนี้" | เห็นแค่ข้อความ + Files changed กระจายอยู่ในแชท |
| **ตอนเลือก** | "ไม่แน่ใจว่าโมเดลไหนดี ลองหลายตัวพร้อมกันเลย" | ต้องลองทีละตัวเอง ทั้งที่ Mali มี 4 agent + 13 provider (จุดขายที่ยังไม่ได้ใช้) |
| **ความเป็นเจ้าของภาษา** | "แอปนี้เข้าใจคนไทย" | UI อังกฤษล้วน, ไม่มีพิมพ์ด้วยเสียง, ไม่มี template งานไทย |

**เป้าหมาย v0.3:** เปลี่ยน Mali จาก "เครื่องมือที่เปิดเมื่อนึกได้" เป็น **"ผู้ช่วยที่อยู่ติดมือทุกวัน"** โดยยังคง positioning **local-first ไม่มี cloud ของ Mali ไม่มี telemetry**

**ขอบเขต PRD นี้ (5 Epic + 1 Quick-wins pack):**

| # | Epic | ช่วงเวลาที่แก้ | ขนาด |
| --- | --- | --- | --- |
| Q | **Quick wins** — ⌘K Command palette, Smart empty state, Completion moment | ทุกช่วง | S |
| A | **Mali Anywhere** — global hotkey เรียกจากทุกแอป + ส่งข้อความที่เลือก / screenshot | เรียกใช้ | M |
| B | **Task Inbox** — รัน Cowork หลายงานเบื้องหลัง + คิวตรวจงาน | ระหว่างรอ | L |
| C | **Work Receipt & Outputs** — สรุปผลงานทุกรอบ + คลังผลงาน + Weekly recap | ตอนเสร็จ | M |
| D | **Agent Arena** — สั่งงานเดียวให้ 2–3 agent แล้วเลือกผลที่ดีที่สุด | ตอนเลือก | L |
| E | **Thai-first** — UI ภาษาไทย, พิมพ์ด้วยเสียง, Thai work templates | ภาษา | M |

---

## 2. ทำไมเลือกชุดนี้ (Prioritization)

ประเมินจาก backlog ทั้งหมดที่คุยกัน ให้คะแนน 1–5 (Impact = ผลต่อความรัก/การกลับมาใช้, Diff = แตกต่างจากคู่แข่ง, Effort ยิ่งน้อยยิ่งดี)

| Feature | Impact | Diff | Effort | Fit local-first | ตัดสิน |
| --- | --- | --- | --- | --- | --- |
| ⌘K Command palette | 4 | 2 | S | ✅ | ✅ Q |
| Smart empty state (แนะนำงานจากไฟล์ในโฟลเดอร์) | 4 | 3 | S | ✅ | ✅ Q |
| Completion moment (มาสคอตฉลอง, เสียง opt-in) | 3 | 3 | S | ✅ | ✅ Q |
| Global hotkey quick bar | 5 | 3 | M | ✅ | ✅ A |
| Background tasks + Inbox | 5 | 4 | L | ✅ | ✅ B |
| Work receipt + Outputs gallery + Weekly recap | 4 | 4 | M | ✅ (คำนวณบนเครื่อง) | ✅ C |
| Multi-agent Arena | 4 | **5** | L | ✅ | ✅ D (beta) |
| Thai UI + เสียง + template | 4 | **5** (ตลาดไทย) | M | ⚠️ STT อาจต้องใช้ provider | ✅ E |
| Mobile companion / อนุมัติจากมือถือ | 4 | 3 | XL | ❌ ต้องมี relay | ❌ ไว้ v0.4+ |
| Team sync / shared workspace | 3 | 2 | XL | ❌ ต้องมี cloud | ❌ Non-goal |
| Browser extension | 3 | 2 | L | ✅ | ⏸ หลัง A (A ครอบคลุม use case หลักแล้ว) |
| Excel / PowerPoint MCP built-in | 3 | 2 | M | ✅ | ⏸ ทำเป็น Playbook/connector ใน v0.2 track |

**หลักคิด:** Q + A สร้าง **ความถี่** (เปิดบ่อย) → B + C สร้าง **คุณค่าที่มองเห็น** (ทำงานให้จริงและเห็นชัด) → D + E สร้าง **เหตุผลที่ไม่ย้ายไปใช้ตัวอื่น**

---

## 3. เป้าหมายและตัวชี้วัด

### 3.1 เป้าหมาย

| # | เป้าหมาย | คำอธิบาย |
| --- | --- | --- |
| G1 | **Frequency** | ผู้ใช้เรียก Mali ≥ 5 ครั้ง/วันทำงาน (ส่วนหนึ่งผ่าน hotkey) |
| G2 | **Delegation** | ผู้ใช้ปล่อยงาน Cowork เบื้องหลังโดยไม่เฝ้า ≥ 1 งาน/วัน |
| G3 | **Perceived value** | ผู้ใช้ตอบได้ว่า "สัปดาห์นี้ Mali ช่วยประหยัดเวลาไปเท่าไร" |
| G4 | **Differentiation** | Arena + Thai-first เป็นเหตุผลอันดับต้นที่ผู้ใช้บอกต่อ |

### 3.2 ตัวชี้วัด (ไม่ส่ง telemetry)

> เหมือน v0.2: วัดจาก beta ที่ **opt-in export สถิติ local** (ไฟล์ JSON ที่ผู้ใช้กดส่งเอง) + interview

| Metric | Target v0.3 |
| --- | --- |
| % ผู้ใช้ที่ตั้ง global hotkey แล้วใช้ ≥ 3 ครั้ง/สัปดาห์ | ≥ 40% |
| งาน Cowork ที่รันขณะแอปไม่ active (background) | ≥ 30% ของงาน Cowork |
| % งานที่ผู้ใช้เปิด Work receipt หรือ Outputs | ≥ 50% |
| ผู้ใช้ที่ลอง Arena ≥ 1 ครั้ง | ≥ 25% active Cowork users |
| ผู้ใช้ไทยที่เปลี่ยน UI เป็นภาษาไทย | ≥ 60% ของผู้ใช้ locale `th` |
| NPS (สำรวจใน beta) | ≥ 45 |

---

## 4. Personas (ต่อจาก v0.2)

- **P1 Developer Dan** — อยากสั่ง "แก้ bug นี้" ให้ Codex กับ Claude พร้อมกันแล้วเลือก diff ที่ดีกว่า (**D**); ใช้ ⌘K ตลอด (**Q**)
- **P2 Knowledge worker Kai** — อยู่ใน Chrome / Word ทั้งวัน อยากเลือกข้อความแล้วกด hotkey ให้สรุป/แปล (**A**); อยากเห็นว่า Mali ทำอะไรให้บ้างในสัปดาห์ (**C**); พิมพ์ภาษาไทยด้วยเสียงสะดวกกว่า (**E**)
- **P3 Team lead Lin** — ปล่อย 3 งานพร้อมกัน (สรุปรายงาน, จัดไฟล์, เตรียมสไลด์) แล้วมาตรวจทีเดียว (**B**); ใช้ Work receipt แนบรายงานให้หัวหน้า (**C**)
- **P4 (ใหม่) Thai SME Som** — เจ้าของกิจการเล็ก ใช้ภาษาไทยเป็นหลัก ทำใบเสนอราคา อีเมลลูกค้า หนังสือราชการ ไม่ถนัดอังกฤษ (**E**, **Q** smart empty state)

---

## 5. Baseline — มีอะไรให้ต่อยอด

| ของที่มีแล้ว | ที่อยู่ | ใช้ต่อใน |
| --- | --- | --- |
| Command component (cmdk) | `src/components/ui/command.tsx` | Q ⌘K |
| Cowork bots (Mochi, Jelly, Petal, Nori) | `src/features/cowork-bot/` | Q completion, B inbox status |
| Desktop notifications | `src/features/notifications/` | A, B |
| Checkpoint ต่อรอบ + Files changed + diff | `src-tauri/src/commands/checkpoint/`, `src/features/checkpoints/`, `components/diff/` | B review, C receipt, D apply |
| Token usage ต่อข้อความ | `src/features/usage/token-usage.ts` | C receipt (cost) |
| แชททำงานต่อเมื่อสลับแชท | `src/pages/chat/hooks/use-chat.tsx` | B background |
| Git runner | `src-tauri/src/commands/git/` | D worktree |
| Skill library + templates | `src/features/instructions/`, `features/skills/` | E Thai templates |
| SQLite history | `commands/storage/history.rs` | B, C ตารางใหม่ |

ช่องว่าง: ไม่มี global shortcut plugin, ไม่มี ⌘K ระดับแอป, ไม่มี i18n, ไม่มี voice input, ไม่มีคิวงานกลาง

---

## 6. ขอบเขตฟีเจอร์

> **Owner (agent ที่แนะนำให้ทำ เพื่อประหยัด token):**
> - 🟢 **Cursor** — UI / TS ที่อยู่ในไม่กี่ไฟล์ มี pattern ให้ลอก spec ชัด ความเสี่ยงต่ำ (component, util, content, แปลภาษา)
> - 🟣 **Claude Code** — ข้าม Rust↔TS↔SQLite, concurrency, permission, security, การวางโครงระบบ
> - 🟣 → 🟢 — Claude Code ทำ backend/API + types ก่อน แล้ว Cursor ทำ UI ตาม API นั้น
>
> ลำดับทำงานในแต่ละ Epic: 🟣 กำหนด types + Tauri commands → 🟢 ทำ UI (ระบุ path และ pattern ที่ให้ลอก) → 🟣 `/code-review` เฉพาะส่วนเสี่ยง (B, D, Rust ของ A)

### 6.1 Epic Q — Quick wins (S)

#### Q1. ⌘K Command palette — Owner: 🟢 Cursor

- `⌘K` / `Ctrl+K` เปิดได้ทุกหน้า: ค้นแชท, สลับ Project, New Chat/Cowork/Code, เปลี่ยนโมเดล, เรียก skill, เปิด Settings แต่ละแท็บ, Undo รอบล่าสุด, Toggle theme
- ค้นแบบ fuzzy (cmdk มีในตัว) + แสดง shortcut ข้างคำสั่ง
- **AC:** ทุก action ใน sidebar และเมนู `+` ทำได้จาก palette; เปิด < 100 ms

#### Q2. Smart empty state — Owner: 🟢 Cursor (ใช้ blocklist เดิม)

- หน้าแชทว่างในโหมด Cowork: สแกน **ชื่อไฟล์และนามสกุล** (ไม่อ่านเนื้อหา) ของโฟลเดอร์ที่อนุญาต แล้วเสนอ 3–4 การ์ดงาน เช่น
  - มี `.pdf` หลายไฟล์ → "สรุป PDF 12 ไฟล์ในโฟลเดอร์นี้เป็นตาราง"
  - มี `package.json` → "หา bug / เขียน test ให้โปรเจกต์นี้"
  - ไฟล์ชื่อมั่ว ๆ ใน Downloads → "จัดไฟล์เข้าโฟลเดอร์ตามประเภท"
- กฎสร้างการ์ดเป็น rule-based บนเครื่อง (ไม่เรียก LLM) — เร็วและไม่เสียเงิน
- **AC:** ไม่เคยแสดงชื่อไฟล์ที่ถูกบล็อก (`.env`, `.ssh`…); กดการ์ดแล้วเติม prompt ให้แก้ต่อได้ ไม่ส่งทันที

#### Q3. Completion moment — Owner: 🟢 Cursor

- งานเสร็จ: มาสคอตแสดงท่าฉลอง 1.5 วิ + สรุปสั้นหนึ่งบรรทัด ("แก้ 6 ไฟล์ · 3 นาที · ฿4.20")
- เสียงแจ้งเตือน **opt-in** (ปิดเป็นค่าเริ่มต้น); เคารพ `prefers-reduced-motion`
- **AC:** ไม่รบกวนเมื่อผู้ใช้กำลังพิมพ์ในช่อง composer

---

### 6.2 Epic A — Mali Anywhere (M)

#### A.1 User stories

- ในฐานะ Kai ฉันเลือกข้อความใน Chrome แล้วกด `⌥⌘M` เพื่อให้ Mali สรุป/แปล/เขียนใหม่ โดยไม่ต้องสลับหน้าต่าง
- ในฐานะ Dan ฉันกด hotkey แล้วลากกรอบ screenshot error บนจอเพื่อถามว่าแก้อย่างไร
- ในฐานะ Som ฉันกด hotkey แล้วพูดภาษาไทย (ต่อกับ Epic E) แล้วได้อีเมลตอบลูกค้า

#### A.2 Functional requirements

| ID | Requirement | Owner |
| --- | --- | --- |
| A-FR1 | Global shortcut (ค่าเริ่มต้น `⌥⌘M` / `Ctrl+Alt+M`, เปลี่ยนได้, ตรวจชนกับ shortcut ของระบบ) เปิด **Quick bar** หน้าต่างลอยขนาดเล็ก always-on-top | 🟣 Claude Code |
| A-FR2 | Quick bar แนบ **clipboard ปัจจุบัน** ให้อัตโนมัติ (แสดงเป็น chip ลบได้) — **ไม่อ่าน clipboard จนกว่าผู้ใช้จะเปิด Quick bar** | 🟣 Claude Code |
| A-FR3 | ปุ่ม **Capture screen**: เลือกพื้นที่ (macOS ใช้ `screencapture -i`, Windows ใช้ Snipping API) แนบเป็นรูป | 🟣 Claude Code |
| A-FR4 | Quick actions ตั้งได้: สรุป · แปล TH⇄EN · เขียนใหม่ให้สุภาพ · อธิบายโค้ด · เพิ่มเองจาก skill | 🟢 Cursor |
| A-FR5 | ผลลัพธ์: **Copy** · **Paste back** (วางกลับแอปเดิมด้วย clipboard + simulated ⌘V, ต้องขอ Accessibility permission ครั้งแรก) · **Open in Mali** (ต่อเป็นแชทเต็ม) | 🟣 Claude Code |
| A-FR6 | ใช้ Chat mode + โมเดลที่ผู้ใช้เลือกสำหรับ Quick bar แยกจากหน้าหลัก (ค่าเริ่มต้น = โมเดลที่เร็วที่สุดที่มี key) | 🟢 Cursor |
| A-FR7 | Quick bar แชทถูกเก็บในประวัติภายใต้กลุ่ม "Quick" (ปิดได้ใน Settings) | 🟢 Cursor |
| A-FR8 | แอปรันค้างใน **menu bar / system tray** เมื่อปิดหน้าต่างหลัก (option) เพื่อให้ hotkey ทำงาน | 🟣 Claude Code |

#### A.3 Technical notes

- `tauri-plugin-global-shortcut` + หน้าต่าง Tauri ที่สองแบบ `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`
- Paste back: macOS ต้องใช้ Accessibility (`AXIsProcessTrusted`) — ถ้าไม่ได้สิทธิ์ ตกกลับเป็น Copy + toast บอก
- Screenshot เก็บเป็น attachment ตามกฎเดิม (30 วัน, ≤ 20 MB)

#### A.4 Acceptance criteria

- [ ] กด hotkey → Quick bar แสดงภายใน 150 ms ขณะแอปอยู่ใน tray
- [ ] ไม่มีการอ่าน clipboard หรือจับภาพหน้าจอโดยไม่มี action ของผู้ใช้
- [ ] Esc ปิด Quick bar และคืน focus ให้แอปเดิม
- [ ] ทำงานบน macOS universal + Windows

---

### 6.3 Epic B — Task Inbox: Cowork เบื้องหลังหลายงาน (L)

#### B.1 User stories

- ในฐานะ Lin ฉันสั่ง 3 งานในคนละโฟลเดอร์ แล้วไปประชุม กลับมาเห็นว่างานไหนเสร็จ งานไหนรออนุญาต
- ในฐานะ Dan ฉันตรวจ diff ทุกงานในที่เดียว แล้วกด Accept หรือ Undo ทีละงาน

#### B.2 Functional requirements

| ID | Requirement | Owner |
| --- | --- | --- |
| B-FR1 | หน้า **Inbox** ใน sidebar (badge จำนวนงานที่ต้องสนใจ) แสดงงานเป็นการ์ด: ชื่อ, โฟลเดอร์, agent, สถานะ, เวลา, มาสคอตประจำงาน | 🟢 Cursor |
| B-FR2 | สถานะ: `Queued` → `Running` → `Needs you` (รอ permission / มีคำถาม) → `Ready to review` → `Accepted` / `Undone` / `Failed` | 🟣 Claude Code |
| B-FR3 | ปุ่ม **Run in background** ใน composer (หรือ `⌘⏎`) — สั่งแล้วกลับหน้าเดิมทันที | 🟣 Claude Code → 🟢 Cursor |
| B-FR4 | Permission / question prompt ตอบได้จากการ์ดใน Inbox โดยไม่ต้องเปิดแชท | 🟣 Claude Code |
| B-FR5 | **Review view**: รวม Files changed + diff ของรอบนั้น (reuse `components/diff`) + ปุ่ม **Accept** (ปิดงาน) / **Undo** (checkpoint restore) / **Continue in chat** | 🟢 Cursor |
| B-FR6 | Concurrency: ขนานได้ข้ามโฟลเดอร์ สูงสุด 3 งาน (ตั้งได้ 1–5); **โฟลเดอร์ read-write เดียวกันรันได้ทีละงาน** (lock) งานถัดไปเข้าคิว | 🟣 Claude Code |
| B-FR7 | Notification เมื่อสถานะเปลี่ยนเป็น `Needs you` / `Ready to review` (reuse notifications) | 🟣 Claude Code |
| B-FR8 | Scheduled jobs (v0.2 Epic B) เข้า Inbox เดียวกัน | 🟣 Claude Code |

#### B.3 Technical notes

- ตาราง SQLite `tasks(id, chat_id, folder, agent, status, created_at, started_at, finished_at, checkpoint_id, error)`
- Lock ต่อ canonical path ของโฟลเดอร์ (resolve symlink เหมือน read-only check)
- OpenCode รองรับหลาย session อยู่แล้ว; Codex/Gemini/Cursor = หลาย process — ต้องจำกัด memory/process ต่อ agent
- ถ้าปิดแอประหว่างงาน: เปิดใหม่ mark `Failed (interrupted)` และยัง Undo ได้จาก checkpoint

#### B.4 Acceptance criteria

- [ ] รัน 3 งานพร้อมกันในคนละโฟลเดอร์ได้ผลถูกต้อง ไม่มี permission ข้ามงาน
- [ ] สองงานในโฟลเดอร์เดียวกันไม่รันซ้อน
- [ ] Undo จาก Inbox คืนไฟล์ตรงกับ Undo ในแชท
- [ ] Auto-approve ยังเป็น off เป็นค่าเริ่มต้นสำหรับงานเบื้องหลัง

---

### 6.4 Epic C — Work Receipt & Outputs (M)

#### C.1 User stories

- ในฐานะ Lin ฉันอยากได้สรุปหนึ่งหน้าว่า agent ทำอะไรไป เพื่อแนบรายงาน
- ในฐานะ Kai ฉันอยากหาไฟล์ที่ Mali สร้างให้เมื่อสัปดาห์ก่อนได้โดยไม่ต้องจำว่าอยู่แชทไหน
- ในฐานะทุกคน ฉันอยากรู้ว่าสัปดาห์นี้ Mali ช่วยอะไรไปบ้าง

#### C.2 Functional requirements

| ID | Requirement | Owner |
| --- | --- | --- |
| C-FR1 | **Work receipt** ใต้คำตอบสุดท้ายของแต่ละรอบ Cowork: ไฟล์สร้าง/แก้/ลบ (+/−), คำสั่งที่รัน, connector ที่ใช้, เวลา, token/cost, checkpoint (ปุ่ม Undo) | 🟣 Claude Code → 🟢 Cursor |
| C-FR2 | **Export receipt** เป็น Markdown / PDF (ไม่รวม thinking เว้นแต่เลือก) | 🟢 Cursor |
| C-FR3 | **Outputs gallery** (ระดับ Project และรวมทั้งหมด): ไฟล์ที่ agent **สร้างใหม่** เรียงตามเวลา, กรองตามชนิด (เอกสาร/รูป/โค้ด/ตาราง), preview (reuse file preview), Reveal in Finder, ไปยังแชทต้นทาง | 🟣 Claude Code → 🟢 Cursor |
| C-FR4 | **Weekly recap** (เปิดทุกวันจันทร์ครั้งแรก หรือจากเมนู): จำนวนงาน, ไฟล์ที่สร้าง, ชั่วโมงที่ agent ทำงาน, ค่าใช้จ่าย, top projects — คำนวณบนเครื่องล้วน | 🟣 Claude Code → 🟢 Cursor |
| C-FR5 | "เวลาที่ประหยัด" แสดงเป็น **ประมาณการที่ผู้ใช้ปรับได้** (เช่น นาทีต่อไฟล์ที่แก้) และติดป้าย "ประมาณการ" เสมอ — ห้ามอ้างตัวเลขเกินจริง | 🟢 Cursor |

#### C.3 Technical notes

- ~~เพิ่มตาราง `outputs` ใน SQLite~~ **ตัดสินใจแล้ว (24 ก.ย. 2026):** ไม่เพิ่มตาราง — Receipt, Outputs และ Recap คำนวณจาก `turn.changes` + `usage` + `activities` ของแชทที่โหลดอยู่ในหน่วยความจำแล้ว (`src/features/work-receipt/`); backend เหลือแค่ `outputs_stat` สำหรับเช็คว่าไฟล์ยังอยู่ · Handoff: [HANDOFF-cursor-epic-c.md](./HANDOFF-cursor-epic-c.md)
- ไฟล์ที่ถูกลบ/ย้ายภายหลัง แสดงสถานะ "ไม่พบไฟล์" ไม่ลบ record อัตโนมัติ

#### C.4 Acceptance criteria

- [ ] Receipt ตรงกับ Files changed 100%
- [ ] Gallery โหลด 1,000 รายการ < 500 ms (virtualized)
- [ ] Recap ไม่ต้องใช้ network

---

### 6.5 Epic D — Agent Arena (L, ออกเป็น beta)

> จุดขายที่คู่แข่งทำไม่ได้: Mali คุม Codex, Gemini, Cursor, OpenCode และ API 13 เจ้าในที่เดียว

#### D.1 User stories

- ในฐานะ Dan ฉันสั่ง "refactor ฟังก์ชันนี้" ให้ Codex กับ Claude (ผ่าน OpenCode) พร้อมกัน แล้วเทียบ diff เลือกอันที่ดีกว่า
- ในฐานะ Kai ฉันถามคำถามเดียวกับ 3 โมเดลในโหมด Chat แล้วเลือกคำตอบที่ชอบไปต่อ

#### D.2 Functional requirements

| ID | Requirement | Owner |
| --- | --- | --- |
| D-FR1 | ปุ่ม **Arena** ใน model picker: เลือก 2–3 ตัว (agent หรือ model) | 🟢 Cursor |
| D-FR2 | Chat mode: ส่ง prompt เดียวกันพร้อมกัน แสดงคำตอบเป็นคอลัมน์ (mobile-width → แท็บ) พร้อมเวลา + cost ของแต่ละตัว | 🟣 Claude Code → 🟢 Cursor |
| D-FR3 | Cowork mode: แต่ละ agent ทำงานใน **สำเนาแยก** — git repo ใช้ `git worktree` บน branch ชั่วคราว, โฟลเดอร์ทั่วไปใช้ copy ไป temp (จำกัด ≤ 500 MB, ข้าม `node_modules` / `.git` / ไฟล์บล็อก) | 🟣 Claude Code |
| D-FR4 | Compare view: diff ของแต่ละตัวเทียบกับต้นฉบับ + (optional) ปุ่ม **Run check** ของ Code mode ในแต่ละสำเนา | 🟢 Cursor |
| D-FR5 | **Pick winner** → สร้าง checkpoint ของโฟลเดอร์จริงก่อน แล้ว apply diff ของผู้ชนะ; สำเนาอื่นถูกลบ | 🟣 Claude Code |
| D-FR6 | แชทไปต่อกับผู้ชนะ; บันทึกผลเลือกไว้บนเครื่องเพื่อแสดง "ใครชนะบ่อยในงานแบบไหน" (ไม่ส่งออก) | 🟢 Cursor |
| D-FR7 | แสดงค่าใช้จ่ายรวมก่อนเริ่ม (ประมาณ ×N) และเตือนถ้าเกิน budget ของ v0.2 | 🟣 Claude Code |

#### D.3 Acceptance criteria

- [ ] โฟลเดอร์จริงไม่ถูกแก้จนกว่าจะกด Pick winner
- [ ] Undo หลัง apply คืนสภาพเดิมได้
- [ ] worktree / temp ถูกเก็บกวาดแม้แอป crash (ตรวจตอนเปิดแอป)
- [ ] ผู้ชนะที่ต่างโฟลเดอร์ permission (read-only) apply ไม่ได้ และบอกเหตุผลชัด

---

### 6.6 Epic E — Thai-first (M)

#### E.1 Functional requirements

| ID | Requirement | Owner |
| --- | --- | --- |
| E-FR1 | **UI ภาษาไทยเต็มรูปแบบ** + อังกฤษ, เลือกตาม locale ของระบบ เปลี่ยนได้ใน Settings (ปิด open question #5 ของ v0.2) | 🟣 Claude Code → 🟢 Cursor |
| E-FR2 | **พิมพ์ด้วยเสียง**: ปุ่มไมค์ใน composer + Quick bar, กดค้าง `Fn`/ปุ่มลัดเพื่อพูด, รองรับไทย/อังกฤษปนกัน; ผู้ใช้เลือก engine: **บนเครื่อง** (macOS Speech framework / Whisper local) หรือ **provider** ที่มี key (แสดงชัดว่าเสียงถูกส่งไปที่ไหน) | 🟣 Claude Code → 🟢 Cursor |
| E-FR3 | **Thai work templates** (skill pack ติดมากับแอป): อีเมลธุรกิจสุภาพ, หนังสือราชการ, ใบเสนอราคา/ใบแจ้งหนี้ (.docx ผ่าน Word MCP), สรุปประชุม, โพสต์ขายของ, แปลเอกสารคงรูปแบบ | 🟢 Cursor |
| E-FR4 | รูปแบบไทย: วันที่ พ.ศ., ตัวเลขเงินบาท + ตัวอักษร ("หนึ่งพันบาทถ้วน"), ฟอนต์ไทยในเอกสารที่สร้าง (TH Sarabun New / Noto Sans Thai) | 🟢 Cursor |
| E-FR5 | ตัดคำไทยในการค้นหาแชท (`Intl.Segmenter('th')`) ให้ค้นเจอแม่นขึ้น | 🟢 Cursor |

#### E.2 Technical notes

- i18n: `i18next` + `react-i18next`, ไฟล์ `src/locales/{en,th}.json`; ทำ lint rule กัน string hard-code ใหม่
- เสียง: เริ่มจาก provider STT ที่ผู้ใช้มี key (เร็วที่สุด) → เพิ่ม local engine ใน 0.3.x

#### E.3 Acceptance criteria

- [ ] ไม่มี string อังกฤษหลงในหน้าหลักเมื่อเลือกไทย (ยกเว้นชื่อเฉพาะ/ชื่อโมเดล)
- [ ] ไมค์ไม่เปิดโดยไม่มีการกดของผู้ใช้ + มีไฟแสดงสถานะกำลังฟัง
- [ ] Template ใบเสนอราคาสร้าง .docx ที่เปิดใน Word แล้วฟอนต์ไทยถูกต้อง

---

## 7. ลำดับการส่งมอบ (Phasing)

| Phase | เนื้อหา | เป้า | ขนาด |
| --- | --- | --- | --- |
| **0.3.0** | Epic Q (⌘K, smart empty state, completion moment) | G1 | S |
| **0.3.1** | Epic C — Work receipt + Outputs (Weekly recap ตามมาใน 0.3.1.x) | G3 | M |
| **0.3.2** | Epic A — Mali Anywhere + tray mode | G1 | M |
| **0.3.3** | Epic E — Thai UI + templates (เสียงผ่าน provider) | G4 | M |
| **0.3.4** | Epic B — Task Inbox (รวม scheduled jobs จาก v0.2) | G2 | L |
| **0.3.5** | Epic D — Agent Arena **beta** (Chat ก่อน, Cowork ตาม) | G4 | L |

**เหตุผลลำดับ:** Q และ C ใช้ข้อมูลที่มีอยู่แล้ว ส่งได้เร็วและเห็นผลทันที · A เพิ่มความถี่การใช้ก่อนงานใหญ่ · B ต้องออกแบบ concurrency ให้แน่นจึงอยู่หลัง · D พึ่ง checkpoint + worktree และ B (การรันขนาน) จึงอยู่ท้ายสุด

> ถ้า v0.2 ยังไม่เสร็จ: ทำ Q + C ขนานกับ v0.2 ได้ (ไม่ชนกัน) แต่ B ควรรอ Scheduled Cowork เพื่อรวม Inbox ครั้งเดียว

---

## 8. UX / IA

```
Sidebar
├── New chat / Cowork / Code / Visual   (เดิม)
├── Inbox  (3)                           (ใหม่ — Epic B)
├── Outputs                              (ใหม่ — Epic C)
├── Projects                             (เดิม + แท็บ Outputs)
└── Settings
    ├── General → Language, Sounds, Tray  (ใหม่ — E, Q, A)
    ├── Shortcuts                         (ใหม่ — A, Q)
    ├── Voice                             (ใหม่ — E)
    └── (Models / Agents / Instructions / Connectors / Folders / Usage / Playbooks / Memory)

Global
├── ⌘K  Command palette                   (Q)
└── ⌥⌘M    Quick bar (นอกแอป)             (A)
```

---

## 9. Privacy & Security (ต้องคงไว้)

- Clipboard, หน้าจอ และไมค์ **อ่านเฉพาะเมื่อผู้ใช้กดเอง** — ไม่มีการเฝ้าเบื้องหลัง
- Smart empty state อ่านเฉพาะ **ชื่อไฟล์** ในโฟลเดอร์ที่อนุญาต และข้ามไฟล์ที่ถูกบล็อก
- Background tasks ใช้ permission model เดิมทุกอย่าง; auto-approve ไม่เปิดให้เองเพราะเป็นงานเบื้องหลัง
- Arena สำเนาไฟล์ไปที่ temp แบบ owner-only (`0700`) และลบหลังจบ
- Voice: ต้องแสดงชัดว่าเสียงไปที่ provider ไหน หรืออยู่บนเครื่อง
- Weekly recap / Arena stats เก็บใน SQLite เท่านั้น ไม่มี telemetry

---

## 10. ความเสี่ยง

| ความเสี่ยง | ผลกระทบ | การลด |
| --- | --- | --- |
| Hotkey ชนกับแอปอื่น (Alfred, Raycast, Spotlight) | ผู้ใช้กดแล้วไม่ขึ้น | ตรวจตอนตั้ง + ให้เปลี่ยนได้ใน onboarding |
| Background หลายงานกิน RAM/quota | เครื่องช้า / ค่าใช้จ่ายพุ่ง | Max concurrent, แสดง cost สะสมใน Inbox, budget v0.2 |
| Arena ใช้เงิน ×N | ผู้ใช้ตกใจบิล | ประมาณการก่อนเริ่ม + ยืนยัน |
| Worktree/temp ค้างเมื่อ crash | ดิสก์เต็ม / branch ขยะ | Cleanup ตอนเปิดแอป + prefix branch `mali-arena/` |
| แปลไทยไม่ครบ/ไม่เป็นธรรมชาติ | ดูไม่มืออาชีพ | ให้ผู้ใช้ไทยใน beta รีวิว, glossary คำศัพท์กลาง |
| "เวลาที่ประหยัด" ดูเกินจริง | เสียความน่าเชื่อถือ | ติดป้ายประมาณการ + ให้ผู้ใช้ปรับสูตร |

---

## 11. QA checklist (release v0.3)

- [ ] Hotkey / Quick bar / tray ทดสอบบน macOS (Intel + Apple Silicon) และ Windows 11
- [ ] Inbox: permission ไม่รั่วข้ามงาน, lock โฟลเดอร์, recovery หลังปิดแอป
- [ ] Arena: โฟลเดอร์จริงไม่ถูกแตะจนกว่าจะ Pick winner, cleanup ทำงาน
- [ ] i18n: snapshot test ทุกหน้าหลักทั้ง TH/EN
- [ ] `cargo test` + `bun test` ผ่าน; เพิ่ม test: folder lock, receipt ↔ checkpoint, smart suggestions rules
- [ ] อัปเดต FEATURES.md + LANDING (Anywhere, Inbox, Arena, ภาษาไทย)

---

## 12. Open questions

| # | คำถาม | เจ้าของ | ตัดสินใจก่อน |
| --- | --- | --- | --- |
| 1 | ~~Hotkey ค่าเริ่มต้น `⌥Space` ชน Raycast/ChatGPT บ่อย — ใช้ `⌥⌘M` แทนไหม?~~ **ตัดสินใจแล้ว (25 ก.ย.): `⌥⌘M` / `Ctrl+Alt+M`** เปลี่ยนได้ใน Settings | Product | ✅ |
| 2 | Paste back ต้องขอ Accessibility — คุ้มกับ friction ไหม หรือทำแค่ Copy ใน v0.3? | Product | 0.3.2 |
| 3 | Voice engine แรก: provider STT หรือ macOS Speech (ไทยแม่นพอไหม)? | Eng | 0.3.3 |
| 4 | Arena ใน Cowork สำหรับโฟลเดอร์ที่ไม่ใช่ git — copy ทั้งโฟลเดอร์ปลอดภัย/เร็วพอไหม? | Eng | 0.3.5 |
| 5 | Inbox แทนที่รายการแชทสำหรับงาน Cowork ไหม หรืออยู่คู่กัน? | Design | 0.3.4 |

---

## 13. Non-goals (v0.3)

- บัญชีผู้ใช้ / cloud sync / แชร์ workspace ในทีม
- Mobile app หรือ remote approve ผ่านเน็ต (พิจารณา v0.4+ แบบ LAN-only)
- Telemetry / analytics ฝั่ง Mali
- Always-listening voice หรือเฝ้า clipboard/หน้าจอเบื้องหลัง
- Browser extension (ใช้ Quick bar แทนใน v0.3)

---

*Living doc — อัปเดตหลังรีวิวกับผู้ใช้ beta โดยเฉพาะกลุ่มผู้ใช้ไทย (P4)*
