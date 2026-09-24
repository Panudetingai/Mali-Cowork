# PRD: Mali Cowork — Growth & Daily Use (v0.2)

| ฟิลด์ | ค่า |
| --- | --- |
| **ผลิตภัณฑ์** | Mali Cowork (desktop — Tauri + React + Rust) |
| **เวอร์ชันเอกสาร** | 1.0 |
| **วันที่** | 24 ก.ย. 2026 |
| **สถานะ** | Draft — สำหรับ implement หลัง v0.1.x |
| **เจ้าของ** | Product / Mali Cowork team |
| **อ้างอิง** | [FEATURES.md](./FEATURES.md) · [LANDING.md](./LANDING.md) |

---

## 1. บทสรุป (Executive summary)

Mali Cowork v0.1.x มี **engine ครบ** สำหรับ power user: Chat / Cowork / Code, หลาย agent & provider, MCP, Git, checkpoint, Projects, Skills, Keychain, ไม่มี telemetry

**ปัญหาเชิงการเติบโต:** ผู้ใช้ใหม่กลัวติดตั้ง (unsigned build), ผู้ใช้ประจำไม่เห็น **ค่าใช้จ่ายรวม** และไม่มีเหตุผล **เปิดแอปทุกวัน** นอกจากงาน ad-hoc — คู่แข่ง (Cursor, Claude Desktop, ChatGPT) ชนะที่ habit + distribution

**เป้าหมาย v0.2 (ไตรมาสถัดไป):** ทำให้ผู้ใช้ **ไว้ใจติดตั้ง → คุมงบ → ให้ agent ทำงานซ้ำเอง → เริ่มงานจาก template** โดยไม่ทำลาย positioning **local-first, ไม่มี cloud ของ Mali**

**ขอบเขต PRD นี้ (4 แพ็กหลัก + release gate):**

1. **Usage & Budget Dashboard** (ขยายจาก sidebar token footer + context meter)
2. **Scheduled Cowork** (งานตั้งเวล / recurring)
3. **Cowork Playbooks** (workflow สำเร็จรูปผูก Project)
4. **Memory UI** (ความจำข้ามแชท — first-class, ไม่ซ่อนใน MCP อย่างเดียว)
5. **Release gate:** code signing + auto-update ใช้งานได้จริง (ไม่ใช่ feature แต่ blocker การใช้งาน)

---

## 2. เป้าหมายและตัวชี้วัด (Goals & metrics)

### 2.1 เป้าหมายผลิตภัณฑ์

| # | เป้าหมาย | คำอธิบายสั้น |
| --- | --- | --- |
| G1 | **Retention** | ผู้ใช้ที่ติดตั้งแล้วกลับมาใช้ ≥ 3 วัน/สัปดาห์ |
| G2 | **Trust** | ลด drop-off ติดตั้งจาก “แอปเปิดไม่ได้ / กลัวไฟล์” |
| G3 | **Habit** | มีอย่างน้อย 1 scheduled job หรือ playbook ที่รันซ้ำ |
| G4 | **Cost clarity** | ผู้ใช้ API หลายตัวรู้ว่าเดือนนี้ใช้ไปเท่าไร (ประมาณการก็ได้) |
| G5 | **Differentiation** | สื่อสารชัดว่า “Cowork บนเครื่อง + หลาย agent” ไม่ใช่แชททั่วไป |

### 2.2 ตัวชี้วัด (ไม่ส่ง telemetry — วัดได้จาก support / สำรวจ / optional local only)

> Mali **ไม่ส่ง analytics** — metric ด้านล่างใช้สำหรับ beta กลุ่มเล็ก (opt-in export สถิติ local) หรือ interview

| Metric | Baseline (สมมติ early access) | Target v0.2 |
| --- | --- | --- |
| ติดตั้งแล้วเปิดใช้งานครั้งที่ 2 ภายใน 7 วัน | TBD | +25% |
| ผู้ใช้ที่ตั้ง monthly budget อย่างน้อย 1 ครั้ง | 0 | ≥ 30% ของผู้ใช้ที่มี cost > 0 |
| ผู้ใช้ที่สร้าง scheduled job ≥ 1 | 0 | ≥ 15% active Cowork users |
| ผู้ใช้ที่รัน playbook ≥ 1 | 0 | ≥ 20% active Cowork users |
| รายงาน “เปิดแอpไม่ได้” (macOS gatekeeper) | สูง | ลดหลัง sign/notarize |

---

## 3. Personas

### P1 — Developer Dan

- ใช้ Cursor/Codex subscription + API เป็นครั้งคราว
- ต้องการ Code mode + Git + checkpoint
- กลัว agent แก้ repo พัง; อยากเห็น **cost ต่อโมเดล** และ **PR review playbook**

### P2 — Knowledge worker Kai

- ไม่เขียนโค้ด แต่มีโฟลเดอร์เอกสาร / รายงาน
- ต้องการ Cowork สรุป PDF, จัดไฟล์, Word MCP
- อยากได้ **งานเช้าจันทร์สรุปโฟลเดอร์ Reports** แบบไม่ต้องจำ prompt

### P3 — Small team lead Lin

- แชร์ **Project instructions + Skills** ให้ทีม 3–8 คน (ไม่ sync แชท)
- ต้องการ export Project pack ไม่มี secret
- สนใจ **memory ระดับ project** (“stack เราใช้อะไร”)

---

## 4. สถานะปัจจุบัน (Baseline)

| พื้นที่ | มีแล้ว | ช่องว่าง |
| --- | --- | --- |
| Usage รายข้อความ | `message.usage`, Context meter | ไม่มีมุมมอง **รายวัน/เดือน**, budget alert |
| Usage รวม | `SidebarTokenFooter` + `aggregateTokenUsage()` | ไม่มีหน้า Settings, ไม่แยก Chat/Cowork/Code/Visual |
| งานซ้ำ | Skills, Projects | ไม่มี scheduler |
| Template | Skill templates | ไม่มี multi-step **Playbook** (โฟลเดอร์ + MCP + โมเดล) |
| Memory | MCP `memory` ใน onboarding | ไม่มี UI ดู/ลบ/ผูก project |
| Distribution | Updater plugin + `UpdateDialog` | macOS/Windows **ยังไม่ sign** (LANDING) |
| ข้อมูล | SQLite `history.sqlite3` | ต้องออกแบบตารางใหม่สำหรับ schedules / playbooks / usage rollups |

---

## 5. ขอบเขตฟีเจอร์

### 5.1 Release gate — Signing & updates

**ปัญหา:** ผู้ใช้ macOS/Windows หยุดที่ Gatekeeper / SmartScreen

**ความต้องการ:**

- macOS: Developer ID + notarize; Windows: Authenticode
- Updater ที่มีอยู่ทำงานกับ build ที่ sign แล้ว
- LANDING / INSTALL อัปเดตขั้นตอนหลัง sign

**Out of scope:** Linux store distribution

**Acceptance:**

- [ ] ผู้ใช้เปิด `.dmg` / `setup.exe` จาก Releases ได้โดยไม่ต้อง Right-click → Open (macOS ครั้งแรกอาจยังมีคำอธิบายสั้น ๆ)
- [ ] UpdateDialog ดาวน์โหลดและติดตั้งรุ่นใหม่ได้เมื่อมี release ใหม่

---

### 5.2 Epic A — Usage & Budget Dashboard

**Roadmap ref:** FEATURES.md #10

#### A.1 User stories

| ID | As a… | I want… | So that… |
| --- | --- | --- | --- |
| A-1 | Dan | ดูค่าใช้จ่ายและ token **แยกตามโมเดล** ราย 7 / 30 วัน | ตัดสินใจใช้โมเดลถูก/แพงได้ |
| A-2 | Dan | ตั้ง **งบ USD/เดือน** (หรือ “เตือนที่ $X”) | ไม่เผลอเผา API |
| A-3 | Kai | เห็นว่า Cowork กิน token มากกว่า Chat แค่ไหน | เข้าใจค่าใช้จ่ายจริง |
| A-4 | ทุกคน | export สรุป usage เป็น CSV/JSON **local** | ส่งให้บัญชี / เก็บเอง |

#### A.2 Functional requirements

1. **หน้า Settings → Usage** (หรือ `/settings/usage`)
   - ช่วงเวลา: Today · 7d · 30d · All time (จากข้อมูลใน SQLite)
   - แยก **mode**: Chat · Cowork · Code · Visual (infer จาก session / route / `sessionMode` + `view`)
   - ตาราง / กราฟ: โมเดล, turns, input/output/reasoning/cache, **cost** (ถ้ามี)
   - ลิงก์ไปแชทที่ contribute usage สูงสุด (optional v0.2.1)

2. **Budget**
   - เก็บ `monthlyBudgetUsd` (optional) + `alertThresholdPercent` (default 80%) ใน SQLite `meta` หรือ settings table
   - เมื่อ **สะสม cost เดือนปฏิทิน** ≥ threshold → desktop notification (reuse `features/notifications`) **ไม่แสดง key/prompt**
   - Reset ตาม timezone ของ OS

3. **Data pipeline**
   - ณ จุดที่บันทึก assistant message ลง SQLite: append row ใน `usage_events` (chat_id, message_id, model_id, mode, tokens\*, cost, ts)
   - Backfill ครั้งเดียวจาก `chats` JSON ที่มีอยู่ (migration script ใน Rust)
   - CLI subscription (Cursor/Codex) ที่ **ไม่รายงาน cost** → แสดง “—” + คำอธิบาย “usage ไม่ครบจาก agent นี้”

4. **Sidebar footer**
   - คง popover สรุปรวม; เพิ่มลิงก์ “View details → Settings → Usage”

#### A.3 Non-functional

- ไม่ส่ง usage ออกจากเครื่อง
- Query 30 วันต้องตอบ < 200ms บน MacBook ทั่วไป (index ที่ `ts`, `model_id`)
- รองรับ chat ลบแล้ว — เก็บ aggregate ใน events หรือ cascade ตามนโยบาย (แนะนำ: **เก็บ events** เพื่อ budget ไม่เพี้ยน)

#### A.4 Out of scope (v0.2)

- บิลจาก OpenAI dashboard แบบ real-time sync
- แยก cost ต่อ project (v0.2.1)

#### A.5 Acceptance criteria

- [ ] หลังส่ง 10 ข้อความที่มี `usage.cost` หน้า Usage แสดงยอดตรงกับผลรวม manual ± rounding
- [ ] ตั้ง budget $5 → mock สะสม $4 → ได้ notification ครั้งเดียวต่อเดือน (ไม่ spam)
- [ ] Visual generation ที่ไม่มี token ใน chat stream แสดงในแท็บ Visual ถ้ามี metadata จาก media API (หรือ “estimated” ชัดเจน)

---

### 5.3 Epic B — Scheduled Cowork

**Roadmap ref:** FEATURES.md #7

#### B.1 User stories

| ID | As a… | I want… | So that… |
| --- | --- | --- | --- |
| B-1 | Kai | ตั้งให้ agent **ทุกจันทร์ 9:00** สรุปไฟล์ใหม่ในโฟลเดอร์ | ไม่ต้องจำ prompt |
| B-2 | Dan | รัน **หลัง git pull** หรือ cron แบบ “ทุก 6 ชม.” | CI แบบเบา ๆ บนเครื่อง |
| B-3 | ทุกคน | ได้ **notification** เมื่อ job เสร็จ / รออนุญาต | ไม่ต้องเปิดแอpค้าง |
| B-4 | ทุกคน | pause / ลบ schedule ได้ | ควบคุมความเสี่ยง |

#### B.2 Functional requirements

1. **UI: Settings → Automation** หรือ sidebar **Automations**
   - สร้าง job: ชื่อ, **cron หรือ preset** (Daily 8:00, Weekly Mon 9:00, Custom cron), timezone OS
   - โหมด **Cowork only** (v0.2)
   - โฟลเดอร์งาน (ต้องอยู่ใน allowed folders)
   - Prompt หรือ **อ้างอิง Playbook** (Epic C)
   - โมเดล/agent default (แนะนำจาก project)
   - ตัวเลือก: “Skip if previous run still active”, “Read-only folder”

2. **Runtime (Rust)**
   - Scheduler thread / `tauri` background: ใช้ `cron` parser (Rust crate) + sleep until next
   - Trigger: สร้าง **แชทใหม่** หรือ append ใน “Automation thread” chat (แนะนำ: **แชทใหม่ต่อ run** + tag `automationRunId` เพื่อ audit)
   - เรียก pipeline เดียวกับ Cowork (`generateStream`) — **permission rules เหมือน manual** (ไม่ auto-approve ใหม่โดย default)
   - ถ้าแอpปิด: **macOS/Windows** — document ว่า job รันได้เมื่อแอpเปิด หรือ launch at login (v0.2: **ต้องเปิดแอp**; v0.3: optional login item)

3. **Safety**
   - Job ไม่รัน shell โดยไม่ผ่าน permission card
   - จำกัด concurrent jobs (e.g. max 2)
   - Log ใน SQLite: started_at, finished_at, status, chat_id, error summary (ไม่เก็บ prompt เต็มใน log ถ้า sensitive — เก็บ chat_id อ้างอิง)

4. **Notifications**
   - Job complete / failed / permission pending (reuse existing notify rules)

#### B.3 Out of scope (v0.2)

- Webhook trigger
- Chain jobs (A แล้ว B)
- รันเมื่อแอpปิด (background service แยก)

#### B.4 Acceptance criteria

- [ ] สร้าง job “every day 08:00” → ถึงเวลาแอpเปิดอยู่ → เริ่ม Cowork ในโฟลเดอร์ที่กำหนด
- [ ] Job ที่ต้อง approve shell → notification + เปิดแอpแล้วเห็น permission card
- [ ] Pause job → ไม่รันจนกว่า enable ใหม่
- [ ] ลบ job → ไม่มี cron ค้าง

---

### 5.4 Epic C — Cowork Playbooks

#### C.1 นิยาม

**Playbook** = ชุดที่ reproducible ประกอบด้วย:

- ชื่อ + คำอธิบาย
- Prompt template (รองรับ `{folder}`, `{date}`, `{projectName}`)
- โฟลเดอร์เริ่มต้น (optional override ตอนรัน)
- Project link (optional) → ดึง project instructions + skills
- รายการ **MCP connectors ที่แนะนำ** (ไม่ force install — แสดง checklist ก่อนรัน)
- โมเดล/agent แนะนำ (optional)

#### C.2 User stories

| ID | As a… | I want… | So that… |
| --- | --- | --- | --- |
| C-1 | Dan | กด “Review uncommitted changes” แล้วเริ่ม Cowork ทันที | ไม่พิมพ์ prompt ยาว |
| C-2 | Lin | export/import playbook เป็นไฟล์ **ไม่มี secret** | แชร์ทีม |
| C-3 | Kai | playbook ใน Project “Reports” | context ถูกต้องทุกครั้ง |

#### C.3 Functional requirements

1. **UI**
   - หน้า Project: แท็บ **Playbooks** + ปุ่ม “Run”
   - Cowork composer: `+` → **Run playbook**
   - Settings → Playbooks (global library) — CRUD, duplicate, export `.mali-playbook.json`

2. **Built-in templates (v0.2)** — อย่างน้อย 5 รายการ:

   - Weekly folder digest
   - Git: summarize changes since last commit
   - README / architecture sketch from repo
   - Clean & rename downloads folder (with strong permission warning)
   - Prepare release notes from git log

3. **Integration**
   - Run playbook = สร้างแชท Cowork + inject prompt + skills + `@folder` if configured
   - Scheduled job เลือก playbook แทน raw prompt (Epic B)

#### C.4 Out of scope

- Marketplace กลางของ Mali
- Playbook ที่รัน shell โดยไม่ถาม ( forbidden )

#### C.5 Acceptance criteria

- [ ] Run playbook จาก Project → โฟลเดอร์ project ถูกเลือกอัตโนมัติ
- [ ] Export → import บนเครื่องอื่น → เนื้อหาเหมือนเดิม ไม่มี API key
- [ ] Template “Git summarize” ทำงานใน repo ที่มี `.git`

---

### 5.5 Epic D — Memory UI

#### D.1 User stories

| ID | As a… | I want… | So that… |
| --- | --- | --- | --- |
| D-1 | Dan | ดูว่า agent **จำอะไร** ข้ามแชท | แก้/ลบ fact ผิด |
| D-2 | Lin | memory **ผูก Project** | ทีมใช้ stack เดียวกัน (local ต่อเครื่อง) |
| D-3 | ทุกคน | ปิด memory ต่อ project | งานลับไม่รั่วข้าม context |

#### D.2 Functional requirements

1. **Storage strategy (v0.2)**
   - ใช้ MCP Memory server ที่มีอยู่ **เป็นที่เก็บ** หรือ mirror ลง SQLite `memory_facts` (แนะนำ: **SQLite mirror** + sync จาก MCP read API เพื่อ UI เร็ว — ถ้า MCP ปิด แสดง “Memory connector off”)

2. **UI: Settings → Memory**
   - รายการ fact (title, body, source chat optional, updated_at)
   - Add / edit / delete manual
   - Scope: Global · Project (dropdown)
   - Toggle “Allow agents to write memory” (default on ถ้า MCP memory enabled)

3. **Agent behavior**
   - System hint ใน Cowork/Chat: ชี้ไป memory scope ของ project ปัจจุบัน
   - ไม่เก็บ path สมบูรณ์ / key ใน memory (validate ฝั่ง Rust ก่อน persist — regex deny `.env`, `sk-`, `/Users/.../.ssh`)

#### D.3 Out of scope

- Sync memory ข้ามเครื่อง
- Vector RAG เอกสารเต็มรูปแบบ (ใช้ MCP + Projects แทน)

#### D.4 Acceptance criteria

- [ ] ลบ fact ใน UI → agent รอบถัดไปไม่อ้าง fact นั้น (ภายใน scope)
- [ ] ปิด memory write → agent ไม่เรียก memory write tool (หรือ MCP disabled)

---

## 6. ลำดับการส่งมอบ (Phasing)

| Phase | เนื้อหา | เป้า | ขนาดโดยประมาณ |
| --- | --- | --- | --- |
| **0.2.0** | Release gate (sign + updater doc) | G2 | M |
| **0.2.1** | Epic A — Usage dashboard + budget alert | G4 | M |
| **0.2.2** | Epic C — Playbooks (ก่อน schedule เพื่อให้ job อ้าง playbook ได้) | G5 | M |
| **0.2.3** | Epic B — Scheduled Cowork | G3 | L |
| **0.2.4** | Epic D — Memory UI | G1, G5 | M |

**เหตุผลสลับ C ก่อน B:** Scheduled job ควรอ้าง playbook ได้ตั้งแต่ GA; Playbook ให้ value ทันทีแม้ไม่ใช้ cron

---

## 7. UX / IA

```
Sidebar
├── New chat / Cowork / Code / Visual  (เดิม)
├── Projects                            (เดิม + แท็บ Playbooks)
├── Automations                         (ใหม่ — รายการ schedule)
└── Settings
    ├── Models / Agents / Instructions / Connectors / Folders  (เดิม)
    ├── Usage                           (ใหม่ — Epic A)
    ├── Playbooks                       (ใหม่ — Epic C library)
    └── Memory                          (ใหม่ — Epic D)
```

- ภาษา UI v0.2: **EN หลัก** + string-ready สำหรับ TH (ไม่ block release)
- Empty states อธิบาย local-first / ไม่ส่งข้อมูลออก

---

## 8. Technical notes

### 8.1 SQLite (proposal)

```sql
-- usage_events: append-only
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  model_id TEXT NOT NULL,
  mode TEXT NOT NULL, -- chat|cowork|code|visual
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0
);
CREATE INDEX idx_usage_ts ON usage_events(ts);

-- automations
CREATE TABLE automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cron_expr TEXT NOT NULL,
  timezone TEXT,
  folder_path TEXT NOT NULL,
  playbook_id TEXT,
  prompt TEXT,
  model_id TEXT,
  project_id TEXT,
  last_run_ts INTEGER,
  next_run_ts INTEGER
);

-- playbooks
CREATE TABLE playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  prompt_template TEXT NOT NULL,
  default_folder TEXT,
  project_id TEXT,
  recommended_mcps TEXT, -- JSON array
  recommended_model TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

-- memory_facts
CREATE TABLE memory_facts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL, -- global|project
  project_id TEXT,
  title TEXT,
  body TEXT NOT NULL,
  updated_at INTEGER
);

-- settings_meta: budget keys
```

Migration: `PRAGMA user_version` ใน `history.rs` pattern เดิม

### 8.2 Reuse

| ส่วน | ใช้ใหม่ |
| --- | --- |
| Usage aggregate | `src/features/usage/token-usage.ts` → extend + DB |
| Notifications | `features/notifications/notify.ts` |
| Cowork run | `use-chat.tsx` / Rust `chat_stream` |
| Permissions | policy เดิม — schedule ไม่ bypass |
| Checkpoints | ทุก scheduled run ได้ undo เหมือน manual |

### 8.3 Security (must hold)

- Scheduled run **ไม่** เปิด auto-approve เอง
- Playbook export **strip** secrets; validate import schema
- Memory deny patterns สำหรับ credentials paths
- ไม่เพิ่ม network endpoint ของ Mali

---

## 9. ความเสี่ยงและการลดความเสี่ยง

| ความเสี่ยง | ผลกระทบ | การลด |
| --- | --- | --- |
| Scheduler รันซ้ำขณะ agent ค้าง | สับสน / สิ้นเปลือง quota | Skip if busy; max concurrent |
| Usage ไม่ครบจาก CLI agents | งบเพี้ยน | แสดง “partial data” + คำอธิบาย |
| User กลัว automation | ไม่ adopt | Default off; preview prompt; permission เหมือนมือ |
| SQLite โตเร็ว | ช้า | Rollup รายวัน (v0.2.1 optional); retention 12 เดือน |
| Scope creep Code mode | ล่าช้า | ไม่แตะ Code ใน PRD นี้ — แค่ tag mode ใน usage |

---

## 10. QA checklist (release v0.2)

- [ ] Migration จาก v0.1.x ไม่ทำให้แชทหาย
- [ ] Budget notification ไม่ leak ชื่อไฟล์ลับ
- [ ] Schedule + playbook + project folder สอดคล้อง permission
- [ ] `cargo test` + `bun test` ผ่าน; เพิ่ม test parser cron + usage rollup
- [ ] อัปเดต FEATURES.md + LANDING (Automation, Usage, Playbooks)

---

## 11. Open questions

| # | คำถาม | เจ้าของ | กำหนดตัดสินใจ |
| --- | --- | --- | --- |
| 1 | Schedule ต้องเปิดแอpเท่านั้น v0.2 ยอมรับได้ไหม? | Product | ก่อนเริ่ม Epic B |
| 2 | Usage backfill ย้อนหลังกี่เดือน? | Eng | ก่อน migration |
| 3 | Playbook file format `.mali-playbook.json` vs reuse SKILL.md | Eng | Epic C kickoff |
| 4 | Memory: SQLite-only vs MCP-only | Eng | Epic D kickoff |
| 5 | แปล UI ไทยใน v0.2 หรือ v0.3? | Product | หลัง 0.2.1 |

---

## 12. Appendix — สิ่งที่ตั้งใจไม่ทำ (Non-goals)

- บัญชีผู้ใช้ / sync แชทกลาง Mali Cloud
- Analytics / telemetry ฝั่งเรา
- Marketplace โมเดลหรือ playbook กลาง
- แทนที่ Cursor IDE เต็มรูปแบบ
- Sandbox MCP แยก process (เก็บเป็น security roadmap แยก)

---

*เอกสารนี้เป็น living doc — อัปเดตเมื่อ scope เปลี่ยนหลัง review กับผู้ใช้ early access*
