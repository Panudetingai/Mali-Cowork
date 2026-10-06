# Mali Cowork — Features

> สรุปความสามารถของแอปในเวอร์ชันปัจจุบัน (0.1.x) และแนวทาง feature ถัดไป
> อัปเดตล่าสุด: 20 ก.ย. 2026 (Connectors จาก MCP Registry, ติดตั้งผ่านแชท, sign-in ในนาม Mali Cowork, แชร์ให้ Gemini/Cursor, แก้ Keychain ถามซ้ำ)

Mali Cowork คือแอป desktop (Tauri + React + Rust) สำหรับคุยกับ AI และให้ AI agent ช่วยทำงานกับไฟล์บนเครื่อง มี 2 โหมด:


| โหมด       | ใช้ทำอะไร                                                      | เข้าถึงไฟล์                |
| ---------- | -------------------------------------------------------------- | -------------------------- |
| **Chat**   | ถาม-ตอบ เขียน สรุป คิดงาน                                      | ❌ ไม่อ่าน/แก้ไฟล์ของผู้ใช้ |
| **Cowork** | ให้ agent ทำงานจริงในโฟลเดอร์ เช่น แก้โค้ด จัดไฟล์ สร้างเอกสาร | ✅ เฉพาะโฟลเดอร์ที่อนุญาต   |


---



## 1. โมเดลและ Agent



### Provider API (ใส่ API key ใน Settings → Models)

OpenAI · Anthropic · Google · xAI · DeepSeek · Mistral · Alibaba (Qwen) · Z.ai · Moonshot (Kimi) · OpenRouter · Groq · Ollama (local) · Ollama Cloud

### Local agents (CLI บนเครื่อง)


| Agent            | Chat | Cowork | หมายเหตุ                                                              |
| ---------------- | ---- | ------ | --------------------------------------------------------------------- |
| **OpenCode**     | ✅    | ✅      | ตัวหลัก รัน server ค้างไว้ให้ตอบเร็ว, รองรับ MCP, ขออนุญาตทีละ action |
| **Codex**        | ✅    | ✅      | sandbox `read-only` / `workspace-write`                               |
| **Gemini CLI**   | ✅    | ✅      | macOS รันใน sandbox, Windows/Linux แก้ไฟล์ได้แต่ไม่รันคำสั่ง          |
| **Cursor Agent** | ✅    | ✅      | รันคำสั่งใน sandbox ของ Cursor, มีหน้า login ในแอป                    |


- เลือกโมเดลได้จากช่องพิมพ์ (Model picker) แยกจำตามโหมด
- โมเดล API จะวิ่งผ่าน OpenCode อัตโนมัติเมื่อเปิด MCP (เพื่อให้ใช้ tools ได้)
- แอปถาม API key ให้เองเมื่อเลือกโมเดลที่ยังไม่มี key

---



## 2. การแชท

- **Streaming** คำตอบแบบ real-time พร้อม auto-scroll ตามข้อความ (เลื่อนขึ้นอ่านได้โดยไม่ถูกดึงกลับ)
- **Markdown ครบ**: code highlight (Shiki), ตาราง, สมการ (KaTeX), Mermaid diagram, ภาษาไทย/CJK
- **Thinking**: แสดงการคิดของโมเดล (เปิด/ปิดได้ใน `+` → Show thinking)
- **Agent steps**: รายการขั้นตอนที่ agent ทำ (อ่าน/แก้ไฟล์, รันคำสั่ง, ค้นหา) พร้อมเวลา, กดดูรายละเอียดได้, ขั้นที่กำลังทำมี Text Shimmer
- **Task plan / Todo checklist**: แสดง sub-tasks ที่ agent กำลังทำ พร้อม progress bar (รองรับ OpenCode `todowrite` และ Codex `todo_list`)
- **Copy / 👍 👎 / Retry** ในแต่ละคำตอบ
- **Stop** หยุด agent กลางทางได้
- **Export แชท** เป็น Markdown: ปุ่มด้านบนพื้นที่แชท → บันทึก `.md` รวมข้อความ, thinking, ไฟล์แนบ, todo checklist
- **ประวัติแชท** ในแถบซ้าย: ค้นหา, ปักหมุด, เปลี่ยนชื่อ, ลบ, ย้ายเข้า project — แชทยังทำงานต่อเมื่อสลับไปแชทอื่น; เก็บใน **SQLite** บนเครื่อง (ไม่จำกัด ~5–10 MB แบบ localStorage)



### แนบไฟล์และรูป

- แนบได้ 3 ทาง: `+` → **Add files or photos**, **ลากไฟล์** มาวางบนหน้าต่าง, **วาง (paste)** รูปจาก clipboard
- ไฟล์ข้อความ → ใส่เนื้อหาในข้อความให้ทุกโมเดล
- รูป → ส่งเป็นรูปจริงให้ OpenCode / Codex / Gemini (Cursor ยังไม่รองรับ)
- PDF → ส่งเป็นไฟล์ให้ OpenCode
- สูงสุด 10 ไฟล์/ข้อความ, 20 MB/ไฟล์ — แอปเก็บสำเนาไว้ 30 วัน, ไม่รับไฟล์ลับ (`.ssh`, `.env`, `.aws` ฯลฯ)



### อ้างถึงไฟล์ด้วย `@`

พิมพ์ `@` ในโหมด Cowork เพื่อเลือกไฟล์/โฟลเดอร์ในโฟลเดอร์งาน — เนื้อหาไฟล์หรือรายชื่อไฟล์จะถูกแนบไปกับข้อความ

### เรียก Skill ด้วย `/` หรือ `\`

พิมพ์ `/` หรือ `\` ต้นคำ → เลือก skill จากรายการ → คำสั่งของ skill นั้นจะถูกส่งไปกับข้อความนั้น (ใช้ได้ทุกโมเดล)

ติดตั้ง skill ด้วยคำสั่งที่คัดลอกมาได้เลย เช่น `npx skillfish add affaan-m/ecc quarkus-verification` (Settings → Skills → Import — Mali อ่านคำสั่งแล้วดาวน์โหลดเอง ไม่รัน npx)

### Projects

- รวมแชทเป็น **Project** (แถบซ้าย → Projects หรือหน้า `/projects`): ชื่อ, คำอธิบาย, โฟลเดอร์งาน (Cowork), **Project instructions** และ **Project skills** ของตัวเอง
- แชทใน project ได้ custom instructions + project instructions + skills ทั้งสองชุด; พิมพ์ `/` เรียก project skill ได้
- เริ่ม **New chat** / **New Cowork task** จากหน้า project — Cowork เริ่มในโฟลเดอร์ของ project
- ย้ายแชทเข้า/ออกจาก project ได้จากเมนู `···` ของแชทในแถบซ้าย; ลบ project แล้วแชทยังอยู่ในประวัติ

### จัดการ Context / Token

- **Context meter** (วงกลม % ข้างปุ่มเลือกโมเดล): token ที่ใช้, input/output/reasoning/cache, ค่าใช้จ่าย
- **สรุปอัตโนมัติ**: เมื่อแชทเกิน context limit แอปให้โมเดลสรุปแชทเดิม แล้วเริ่มแชทใหม่ที่ "จำ" เรื่องเดิมผ่าน summary
- **Summarize & continue**: กดสรุปเองได้เมื่อใช้ไป ≥ 40%
- เปิดอ่าน summary ได้ที่หัวแชทใหม่ พร้อมลิงก์กลับไปแชทเดิม

---



## 3. Cowork — ทำงานกับไฟล์อย่างปลอดภัย

- **Folder access**: agent ใช้ได้เฉพาะโฟลเดอร์ที่อนุญาต — ถามผ่าน dialog ของระบบ (Read & write / Read only / Don't allow)
- **Read-only folder**: บล็อกการแก้ไขจริง (ตรวจ path แบบ resolve `..` และ symlink แล้ว)
- **แนบหลายโฟลเดอร์** ต่อแชท (`+` → Add another folder)
- **Permission card**: agent ขออนุญาตก่อนรันคำสั่ง shell (ยกเว้นคำสั่งอ่านอย่างเดียว เช่น `ls`, `git status`) — Deny / Always / Allow once, ดูรายละเอียด diff ได้
- **Auto-approve** (ปิดเป็นค่าเริ่มต้น) สำหรับคนที่ต้องการให้ทำงานรวดเดียว
- **Undo / Redo ต่อรอบ**: แอปบันทึก checkpoint ของโฟลเดอร์ (read & write) ก่อน agent เริ่มทุกรอบ — กด **Undo** เพื่อคืนไฟล์ให้เหมือนก่อนรอบนั้น, **Redo** เพื่อเอาการแก้กลับมา; ถ้าไฟล์ถูกแก้ต่อหลังจบรอบ แอปจะเตือนก่อนเขียนทับ
- **Files changed**: ใต้คำตอบแสดงไฟล์ที่ถูกสร้าง/แก้/ลบในรอบนั้น พร้อม +/− บรรทัด — คลิกเพื่อดู **Preview** (Markdown, โค้ด, รูป, PDF, Word) หรือ **Changes** (diff ทีละบรรทัด), เปิดไฟล์ หรือ Show in Finder/Explorer
- ทุกการเปลี่ยนสิทธิ์จัดการได้ที่ Settings → Folders



### Git (โหมด Cowork)

แสดง **เฉพาะเมื่อโฟลเดอร์งานอยู่ใน Git repository** — โฟลเดอร์ที่ไม่มี `.git` จะไม่เห็นอะไรเกี่ยวกับ Git เลย

**แถบเหนือช่องพิมพ์**: `Changes +10 −2` (กดเปิดแผง) · ปุ่ม **Commit / Create Branch & Commit ▾** (บน main/master จะเสนอสร้าง branch ก่อน) · `↓` Pull · `↑` Push

**แผง Git ด้านขวา** (ขยายกว้างได้):

- หัวแผง: สถานะ (Uncommitted / Unpushed / Behind / Up to date / Conflicts), `branch → upstream`, ปุ่มเขียว Commit แบบ split (Commit, Commit & Push, Create Branch & Commit, Pull, Push, Fetch), เมนู `···`
- หัวข้อ = commit ล่าสุด `#hash` + ปุ่ม copy
- แท็บ **Changes**: "N Files Changed +A −D", รายการไฟล์ (popover), diff ทุกไฟล์ต่อกันแบบ PR — หัวไฟล์ติดด้านบน, syntax highlight, ป้าย New/Deleted/Renamed, checkbox = stage/unstage, เมนู `···` (Discard ถามยืนยัน, Show in folder)
- แท็บ **Commits**: จัดกลุ่มตามวัน, แต่ละ commit มี +/−, avatar ผู้เขียน + co-author, จำนวนไฟล์, เวลา, hash — กดเพื่อดู diff ของ commit
- แท็บ **Branches**: สร้าง/สลับ branch, check out จาก remote, ahead/behind
- Commit form: ข้อความ + **Write with AI**, ชื่อ branch (เดาให้จากข้อความ), เลือก push ต่อได้; Pull/Push จากปุ่มอื่นถามยืนยันทุกครั้ง
- ความปลอดภัย: config ของ repo สั่งรันโปรแกรมผ่าน git ไม่ได้ (`core.fsmonitor`, external diff, textconv ถูกปิด), path แบบ literal, ตรวจชื่อ branch/commit id, ไม่มี prompt ค้าง, Pull แบบ fast-forward เท่านั้น

---



## 4. Settings


| แท็บ             | ทำอะไรได้                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Models**       | ใส่ API key / base URL ของแต่ละ provider, เพิ่มโมเดลเอง, ตั้ง context limit                                        |
| **Agents**       | ตรวจสถานะ OpenCode / Codex / Gemini / Cursor, ตั้งโฟลเดอร์เริ่มต้น, login Cursor                                   |
| **Instructions** | **Custom instructions** ที่ใช้กับทุกแชท + **Skill library** (สร้าง/แก้/เปิด-ปิด, import จากไฟล์ / GitHub / ลิงก์ / โฟลเดอร์ทีม, export `SKILL.md`, มี template ให้เริ่ม) |
| **Connectors**   | รายการ connector แบบตาราง (Connected / Not connected), **Discover** จาก MCP Registry ทางการ, Popular, Sign in (OAuth), เพิ่ม MCP server เอง |
| **Plugins**      | ติดตั้ง plugin (skills + slash commands + bots + connectors + templates + instructions + panels) จาก GitHub / โฟลเดอร์ / marketplace แบบ Claude Code, เปิด-ปิดทั้งชุด, อัปเดต, ถอน — ดู [08-plugins](./08-plugins.md) |
| **Folders**      | รายการโฟลเดอร์ที่อนุญาต, เปลี่ยนสิทธิ์, ยกเลิก                                                                     |




### Connectors (MCP)

- **Your connectors**: ตาราง Connector / Type (Local, Web + ป้าย Custom/Registry) / Status — ปุ่ม **Connect**, ✓ เมื่อเชื่อมแล้ว, **Sign in** เมื่อต้อง login, เมนู `···` (Settings, Sign out, Disconnect, Remove); ตัวกรอง All / Connected / Not connected
- **Popular**: บริการยอดนิยมจาก registry (Notion, GitHub, Linear, Atlassian, Figma, Supabase, Stripe, Vercel ฯลฯ) กด Connect ได้ทันที
- **Discover**: ค้นหา [MCP Registry ทางการ](https://registry.modelcontextprotocol.io) — ชื่อ, คำอธิบาย, icon, publisher, วิธีติดตั้ง (Web / npm / PyPI / Docker), กรอง Web / On this computer, Load more
- **ติดตั้ง**: เลือกวิธีติดตั้ง → กรอก key/ตัวแปร (เก็บใน Keychain) → เห็นคำสั่งที่จะรันจริงหรือ URL ก่อนยืนยัน → Install & connect
- **Login แบบ Cowork**: remote server ที่ใช้ OAuth → เปิดหน้า login ในเบราว์เซอร์ (OpenCode รับ callback บน loopback + PKCE) token เก็บในไฟล์ owner-only ของ OpenCode — แอปและ AI ไม่เห็น token
- **ติดตั้งผ่านแชท**: บอก AI เช่น "เชื่อม Notion ให้หน่อย" / "ติดตั้ง GitHub MCP" → AI ค้นใน registry แล้วแสดง **การ์ดติดตั้ง** ในแชท → ผู้ใช้กดตรวจและยืนยันเอง
- Built-in: Word (สร้าง/แก้ .docx) · Exec (รันคำสั่ง) · Filesystem · GitHub · Fetch (Puppeteer) · Playwright · SQLite · Postgres · Memory · Sequential thinking · Brave Search · Slack
- **Thinking effort**: model ที่ปรับระดับการคิดได้ จะมีปุ่ม (เช่น `Medium ⌄`) ข้างตัวเลือก model → เปิดมาเป็น slider เลือก none / low / medium / high / xhigh / max ตามที่ **model นั้นรองรับจริง** — model ที่ไม่มีให้ปรับ จะไม่มีปุ่มขึ้นมาเลย
  - ระดับที่มีมาจากตัว model เอง ไม่ได้ hardcode: OpenCode/API อ่านจาก `variants` ของ opencode (models.dev), Codex อ่านจาก `supported_reasoning_levels` ใน `codex models`, Antigravity ใช้ low/medium/high ตาม `agy --effort`
  - ส่งไปคนละทางตาม backend: opencode = `variant` ใน prompt body · Codex = `-c model_reasoning_effort=…` (override เฉพาะรอบนั้น ไม่แก้ `config.toml` ของผู้ใช้) · Antigravity = `--effort` · API ตรง = `reasoning_effort` (OpenAI) / thinking budget (Anthropic)
  - จำแยกราย model เพราะ "high" ของ model เล็กกับใหญ่ราคาไม่เท่ากัน และถ้า provider เปลี่ยนชุดระดับ ค่าที่ค้างอยู่จะตกกลับเป็น default แทนที่จะถูกปฏิเสธ
  - ไม่เกี่ยวกับ **Show thinking** ในเมนู `···` ซึ่งเป็นแค่การ *แสดง* reasoning ไม่ได้เปลี่ยนว่าคิดมากแค่ไหน
  - หน้า Visual ไม่มีปุ่มนี้ — model ที่วาดรูปไม่ได้คิดเป็นระดับ
- **หน้า Visual (สร้างรูป / วิดีโอ)**: เมนูใหม่ใน sidebar แยกออกจากแชท มีแท็บ **Video Creation / Image Creation**
  - **model select ของรูป/วิดีโออยู่ในหน้านี้** ไม่ปนกับ model select ของแชทอีกต่อไป — model พวกนี้ตอบเป็นไฟล์อย่างเดียว ไม่มีบทสนทนา ไม่มี tool ไม่มีโฟลเดอร์ อยู่ในรายการแชทแล้วสับสน
  - ตั้ง key provider ครั้งเดียวใน Settings → Models แล้ว **model ที่สร้างภาพ/วิดีโอได้จะขึ้นให้เอง** ไม่ต้องรู้ชื่อ model ไม่ต้องตั้ง key ที่สอง
  - **Image**: Size (Auto / 16:9 / 4:3 / 1:1 / 3:4 / 9:16) · Image count (slider 1–4 ตามที่ backend รับจริง)
  - **Video**: Resolution (1080P/720P/480P) · Ratio · Duration (ให้ model เลือกเอง หรือกำหนด 2/5/10/20/30s)
  - ผลงานเก็บเป็น gallery ในหน้านั้น (เก็บ path ไว้ อ่านไฟล์ตอนแสดง) มีปุ่ม Show in folder และเอาออกจากรายการ
  - ระบบยิง API ของ provider ตรง ๆ ด้วย key เดียวกับที่ใช้แชท (`commands/media.rs`) — ไม่ผ่าน agent ไม่ผ่าน MCP
  - **รูป**: Google (Gemini image) · OpenAI (gpt-image) · OpenRouter · xAI (Grok Imagine) · Alibaba (Qwen Image)
  - **วิดีโอ**: Google (Veo) · Alibaba (Wan) — API แบบ async ระบบ poll ให้เอง
  - ตารางนี้บอกว่า **แอปเรียก API ไหนเป็น** ไม่ได้บอกว่า provider ทำอะไรได้ — Grok กับ Sora ทำวิดีโอได้แต่ยังไม่ได้ต่อ (Sora API ปิด 2026-09-24) model ที่ยังไม่มีทางเรียกจะไม่ถูกเสนอเลย
  - รู้ว่า model ไหนวาดรูปจาก `modalities.output` ของ models.dev; **model ที่พิมพ์เอง** (เช่น `qwen-image-3.0`) ไม่มี metadata → ดูจากชื่อแทน ถ้า models.dev รู้จัก **metadata ชนะชื่อเสมอ** `qwen-vl-max` ที่แค่อ่านรูปจึงไม่ถูกเข้าใจผิด
  - Qwen Image/Wan อยู่คนละ endpoint กับแชท — ที่มาของ error `Input should be 'user': input.messages.0.role`

---



## 5. ความปลอดภัย (ที่ทำไว้แล้ว)

- **API key และ MCP token เก็บใน Keychain** (macOS Keychain / Windows Credential Manager; Linux = ไฟล์ `0600`) ไม่ใช่ plain text ใน localStorage — key เก่าย้ายให้อัตโนมัติ
- **ประวัติแชทและ projects เก็บใน SQLite** (`history.sqlite3`, owner-only `0600`) — ย้ายจาก localStorage ให้อัตโนมัติครั้งแรก
- API key จาก `.env` ส่งไปเฉพาะ host ของ provider นั้น, `.env` โหลดเฉพาะตอน dev
- Content Security Policy + จำกัดสิทธิ์ไฟล์ของ webview (อ่านอย่างเดียว, บล็อก `.ssh` `.aws` `.env` ฯลฯ)
- ไม่ส่ง prompt ผ่าน shell บน Windows (กัน command injection) และไม่มีหน้าต่าง console เด้ง
- โหมด Chat ปิด MCP ที่รันคำสั่ง/อ่านไฟล์ (Exec, Filesystem)
- MCP packages ล็อกเวอร์ชัน (ติดตั้งจาก registry ก็ล็อกเวอร์ชันตาม registry)
- Connector จาก registry/แชท: ผู้ใช้ต้องยืนยันเองทุกครั้ง, ตรวจชื่อ package/argument (ไม่มีอักขระ shell), remote ต้อง https, icon โหลดผ่าน backend (จำกัดขนาด/ชนิด, ไม่เรียก IP ภายใน)
- ไฟล์ config ที่มี key เขียนแบบ owner-only (`0600`)

---



## 6. อื่น ๆ

- **Cowork bots**: มาสคอตเคลื่อนไหว 4 ตัว (Mochi, Jelly, Petal, Nori) แสดงสถานะ agent
- **Desktop notifications**: แจ้งเตือนเมื่องาน Cowork เสร็จ หรือมี action รออนุญาต (เฉพาะตอนแอปไม่ active)
- **First-run wizard**: dialog อัตโนมัติตอนเปิดแอปครั้งแรก ตรวจ node/agent ที่มี ให้เลือกติดตั้ง OpenCode/Codex/Gemini/Cursor แสดง command ก่อนรัน แล้วเปิด MCP ที่แนะนำ
- Title bar แบบ custom, รองรับ dark mode
- Build/Release อัตโนมัติด้วย GitHub Actions (macOS universal + Windows)

---



## 7. แนะนำ features ถัดไป

เรียงตามความคุ้ม (ผลต่อผู้ใช้ ÷ แรงที่ต้องใช้) สำหรับ Cowork ตอนนี้:


| #   | Feature                                       | ทำไมเหมาะ                                                                                                     | แรงงาน | สถานะ       |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ | ----------- |
| 1   | **แจ้งเตือนเมื่องานเสร็จ / รออนุญาต**         | งาน Cowork ใช้เวลานาน ผู้ใช้สลับไปทำอย่างอื่น — ใช้ `tauri-plugin-notification`                               | S      | ✅ เสร็จแล้ว |
| 2   | **Undo / Checkpoint ต่อรอบ**                  | snapshot โฟลเดอร์ก่อน agent เริ่ม + ปุ่ม "ย้อนการแก้ไข" — ทำให้กล้าให้ agent แก้ไฟล์                          | M      | ✅ เสร็จแล้ว |
| 3   | **แผงไฟล์ที่ถูกแก้ + Preview**                | สรุปว่า agent สร้าง/แก้ไฟล์อะไร, เปิดดู (md/pdf/docx/รูป) หรือ Reveal in Finder ได้ทันที                      | M      | ✅ เสร็จแล้ว |
| 4   | **Task plan (To-do) ของ agent**               | OpenCode มี `todowrite` อยู่แล้ว — แสดงเป็น checklist ด้านบนคำตอบให้เห็นความคืบหน้า                           | S      | ✅ เสร็จแล้ว |
| 5   | **Projects**                                  | รวมแชทตามโฟลเดอร์ + instructions/skills เฉพาะ project (แบบ Claude Projects)                                   | M      | ✅ เสร็จแล้ว |
| 6   | **ย้ายประวัติแชทไป SQLite + key ไป Keychain** | localStorage จุได้ ~5–10 MB และ key เก็บเป็น plain text — กันข้อมูลหาย/รั่ว                                   | M      | ✅ เสร็จแล้ว |
| 7   | **งานตั้งเวลา (Scheduled tasks)**             | เช่น "ทุกวันจันทร์ 9 โมง สรุปไฟล์ใหม่ในโฟลเดอร์ Reports" — จุดเด่นของ Cowork                                  | L      | รอ          |
| 8   | **Export แชท** เป็น Markdown                  | แชร์ผลงานให้ทีมได้ง่าย (เริ่มจาก Markdown; PDF/Word รอ MCP)                                                   | S      | ✅ เสร็จแล้ว |
| 9   | **Skill library**                             | import skill จาก URL/Git, export เป็น `SKILL.md`, แชร์ในทีม                                                   | S–M    | ✅ เสร็จแล้ว |
| 10  | **Usage dashboard**                           | ค่าใช้จ่าย/token รายวัน รายโมเดล + ตั้งงบต่อเดือน                                                             | M      | รอ          |
| 11  | **First-run wizard**                          | ตรวจ node/agent อัตโนมัติ ติดตั้ง OpenCode/Codex/Gemini/Cursor ให้เลือก แสดง command ก่อนรัน + เปิด MCP แนะนำ | S–M    | ✅ เสร็จแล้ว |


**ข้อแนะนำลำดับ:** เริ่มจาก 2 + 3 (เพิ่มความมั่นใจให้ผู้ใช้ Cowork) → 6 (กันปัญหาระยะยาว) → 5 และ 7 (เป็นจุดขาย) → 9 และ 10 (ขยายผู้ใช้)

---



## 8. Checklist: รอบนี้ทำ Feature #4 — Task plan / Todo checklist



### เป้าหมาย

- Agent เริ่มงาน → ผู้ใช้เห็นรายการ sub-tasks ที่กำลังทำ พร้อมเครื่องหมาย in-progress / done
- รองรับ OpenCode (`todowrite`) และ Codex (`todo_list`) ในที่เดียว
- ไม่เก็บข้อมูลลับ (key/path) ในขั้นตอน task — แสดงเฉพาะ title/text ที่ agent ส่งมา



### โครงสร้างระบบ

1. **Rust** `chat_stream.rs` — เพิ่ม `ChatStreamEvent::Todos { items: Vec<TodoItem> }`
2. `opencode/events.rs` — ตรวจ tool `todowrite` → แปลง input/output เป็น `Todos` event
3. `codex/stream.rs` — ตรวจ `todo_list` → ส่ง `Todos` event แทน/เพิ่มจาก Activity เดิม
4. **Frontend types** — เพิ่ม `todos` ใน `ChatMessage`, handler `onTodos` ใน stream channel
5. **State** — รวม `todos` เข้า `ChatMessage` ที่กำลัง stream, replace ตาม id
6. **UI component** — `<AgentTaskPlan />` แสดง checklist + progress bar ด้านบนข้อความ assistant



### ความปลอดภัยที่ต้องเช็ค

- [x] ไม่บันทึก todo ที่มี path สมบูรณ์ / key ลง state โดยตรง (ให้ agent เป็นคนกรอง)
- [x] Todo text ผ่าน DOMPurify / แสดงเป็น text node ธรรมดา ไม่ใช่ HTML
- [x] ไม่ส่ง todo events ข้าม chat sessions (ตรวจ sessionID เหมือน activity)
- [x] จำกัดจำนวน items สูงสุด (เช่น 50) กัน abuse
- [x] ทดสอบกับ OpenCode จริงเพื่อยืนยัน schema ของ `todowrite`
- [x] ทดสอบกับ Codex จริงเพื่อยืนยัน `todo_list` ยังทำงาน



### ขั้นตอนการทำ

- [x] 1. อัปเดต `docs/FEATURES.md` ให้มี checklist
- [x] 2. เพิ่ม `TodoItem` + `Todos` event ใน Rust backend
- [x] 3. แปลง OpenCode `todowrite` → `Todos`
- [x] 4. แปลง Codex `todo_list` → `Todos`
- [x] 5. เพิ่ม frontend types + handlers
- [x] 6. เพิ่ม UI component + ผูกกับ assistant message
- [x] 7. รัน `cargo test` + `npm run build` ให้ผ่าน
- [x] 8. ทดสอบ UI mock ใน dev แล้ว (เหลือต้องยืนยันกับ OpenCode/Codex จริง)

---



## 9. Checklist: Feature #8 — Export chat เป็น Markdown



### เป้าหมาย

- ผู้ใช้สามารถบันทึกแชทเป็นไฟล์ `.md` เพื่อแชร์หรือเก็บถาวร
- ไฟล์ export รวมข้อความ, model ID, thinking, ไฟล์แนบ, และ todo checklist



### ความปลอดภัย

- [x] ใช้ `tauri-plugin-dialog` ให้ผู้ใช้เลือก path เอง — ไม่เขียนไฟล์ลับโดยอัตโนมัติ
- [x] ขอสิทธิ์ `fs:allow-write-text-file` เท่านั้น
- [x] Export ไม่รวบรวม API key, permission details, หรือข้อมูลลับอื่น



### ขั้นตอนการทำ

- [x] 1. สร้าง `export-chat.ts` แปลง `ChatSession` → Markdown
- [x] 2. เพิ่ม `fs:allow-write-text-file` ใน capabilities
- [x] 3. เพิ่มปุ่ม Export chat ใน `ChatMessagePanel`
- [x] 4. อัปเดต `docs/FEATURES.md`
- [x] 5. รัน `npm run build` + `cargo check` ให้ผ่าน

---



## 10. Checklist: Features #1 + #11 — Notifications & First-run wizard



### Feature #1: Desktop notifications



#### เป้าหมาย

- ผู้ใช้ได้รับการแจ้งเตือนเมื่องาน Cowork เสร็จ หรือมี action รออนุญาต โดยเฉพาะตอนแอปไม่ active



#### ความปลอดภัย + UX

- [x] แจ้งเตือนเฉพาะตอน window ไม่ focus หรือ hidden (ไม่กวนผู้ใช้ที่กำลังใช้งาน)
- [x] ขอ permission ส่ง notification ก่อนใช้ครั้งแรก
- [x] ไม่ส่งข้อความลับ (prompt/key) ใน notification body



#### ขั้นตอนการทำ

- [x] 1. ติดตั้ง `@tauri-apps/plugin-notification` + `tauri-plugin-notification`
- [x] 2. ลงทะเบียน plugin ใน `lib.rs`
- [x] 3. เพิ่ม `notification:*` permissions ใน capabilities
- [x] 4. สร้าง `features/notifications/notify.ts`
- [x] 5. ผูกกับ `useChat`: ตรวจ `isLoading` false → notify task done; permission count เพิ่ม → notify pending
- [x] 6. รัน `npm run build` + `cargo check` ให้ผ่าน



### Feature #11: First-run wizard



#### เป้าหมาย

- ผู้ใช้ใหม่เปิดแอปครั้งแรก → Wizard ตรวจเครื่องอัตโนมัติ แล้วพาติดตั้ง agent และเปิด MCP ที่แนะนำ
- ผู้ใช้เลือกได้ว่าจะติดตั้งอะไร: OpenCode (แนะนำ), Codex, Gemini CLI, Cursor Agent
- แสดง command ที่จะรันทั้งหมดก่อนยืนยัน ไม่รันอะไรแอบ
- ติดตั้งเสร็จ → เปิด MCP starter set (Word, fetch, memory, sequential-thinking, playwright, filesystem) ให้เลือก
- UI สวย มี animation, ไม่งง
- สามารถเปิด wizard ซ้ำจาก Settings → Agents



#### โครงสร้างระบบ

- **Rust** `commands/setup/`: `detect.rs` หา node/npm/git/brew/uv/agent; `recipes.rs` คำนวณคำสั่งติดตั้งตาม platform; `simulate.rs` จำลองเครื่องใหม่สำหรับ test (`MALI_SIMULATE_NEW_USER=1`)
- **Tauri commands**: `setup_scan`, `setup_plan`, `setup_install` (streaming log), `setup_cancel`, `setup_codex_login`
- **Frontend** `features/onboarding/`: `api.ts`, `catalog.ts`, `context.ts`, `store.ts`, `ui.tsx`, `wizard.tsx`, `first-run-wizard.tsx`
- **Steps**: Welcome → Pick agents → Review plan → Install (live terminal) → Recommended MCP → Done
- **Auto open**: `App.tsx` เปิด wizard ถ้ายังไม่เคย finish; `VITE_ONBOARDING=always` เปิดทุกครั้งสำหรับ test



#### ความปลอดภัย + UX

- [x] อ่านสถานะการตั้งค่าจาก store ที่มีอยู่แล้ว ไม่เก็บข้อมูลใหม่
- [x] รันคำสั่งติดตั้งเท่านั้นหลังผู้ใช้กด Continue ในหน้า Review plan
- [x] แสดงทุกคำสั่งที่จะรันก่อน confirm; ไม่มี hidden command
- [x] ติดตั้งทีละตัว พร้อม log streaming ให้ผู้ใช้เห็นว่าเกิดอะไรขึ้น
- [x] รองรับ cancel process tree และ timeout 15 นาที
- [x] ใช้ `NONINTERACTIVE=1`, `CI=1`, `HOMEBREW_NO_AUTO_UPDATE=1` เพื่อไม่ให้ installer ถามคำถามกลางดึก
- [x] ถ้าล้มเหลว แสดงสาเหตุ + hint เฉพาะทาง (permission / network / Node.js เก่า)
- [x] MCP ที่เปิดใน wizard คือตัวเดียวกับ Settings → MCP; ผู้ใช้ยกเลิก/เปิดเองได้ภายหลัง



#### ขั้นตอนการทำ

- [x] 1. สร้าง `features/onboarding/wizard.tsx` (multi-step dialog + animation)
- [x] 2. สร้าง `features/onboarding/context.ts` สำหรับ share state ระหว่าง steps
- [x] 3. สร้าง/อัปเดต `features/onboarding/api.ts`, `catalog.ts`, `store.ts`, `ui.tsx`
- [x] 4. ต่อ API กับ Tauri commands `setup_scan`, `setup_plan`, `setup_install`
- [x] 5. เปิด wizard อัตโนมัติจาก `App.tsx` เมื่อยังไม่ finish
- [x] 6. ปุ่มเปิด wizard ซ้ำใน Settings → Agents
- [x] 7. ผูก MCP recommended toggle กับ `features/mcp/store.ts`
- [x] 8. อัปเดต `docs/FEATURES.md`
- [x] 9. รัน `npm run build` + `cargo check` ให้ผ่าน

---



## 11. Checklist: Features #2 + #3 — Undo/Checkpoint ต่อรอบ + แผงไฟล์ที่ถูกแก้



### เป้าหมาย

- ก่อน agent เริ่มแต่ละรอบ (โหมด Cowork, ทุก agent: OpenCode / Codex / Gemini / Cursor) แอปจำสภาพโฟลเดอร์ที่ agent แก้ได้
- จบรอบ → แสดงรายการไฟล์ที่ agent สร้าง/แก้/ลบ พร้อม Undo / Redo, Preview และ diff



### โครงสร้างระบบ

1. **Rust** `commands/checkpoint/store.rs` — เก็บเนื้อหาไฟล์แบบ content-addressed (SHA-256) ที่ `<app data>/mali-cowork/checkpoints/objects`; บน APFS ใช้ clone (ไม่กินพื้นที่จนกว่าไฟล์จะถูกแก้)
2. `checkpoint/snapshot.rs` — สแกนโฟลเดอร์ (ข้าม `.git`, `node_modules`, `target`, `.venv` ฯลฯ) + index cache ต่อโฟลเดอร์ (size + mtime + hash) ทำให้รอบถัดไปอ่านเฉพาะไฟล์ที่เปลี่ยน; `diff()` หาไฟล์ added / modified / deleted
3. `checkpoint/mod.rs` — commands: `checkpoint_begin`, `checkpoint_add_folder` (โฟลเดอร์ที่อนุญาตกลางรอบ), `checkpoint_finish`, `checkpoint_restore` (before = undo, after = redo), `checkpoint_diff`, `checkpoint_preview`, `checkpoint_open`
4. `checkpoint/docx.rs` — แปลง `.docx` เป็น Markdown สำหรับ preview (หัวข้อ, ตัวหนา/เอียง, list, ตาราง)
5. **Frontend** `features/checkpoints/` — `FilesChanged` (แผงใต้คำตอบ), `FilePreviewDialog` (Preview / Changes / Open / Show in Finder), `DiffView`
6. `use-chat.tsx` — begin ก่อน `generateStream`, finish หลังจบรอบ แล้วเก็บผลไว้ที่ `ChatMessage.turn`



### ความปลอดภัย + ความถูกต้อง

- [x] Restore แบบ all-or-nothing: ไฟล์ที่ถูกแก้หลังจบรอบ = conflict → ไม่แตะอะไรจนผู้ใช้กด "Undo anyway"
- [x] เขียนไฟล์คืนผ่าน temp file + rename (ไม่มีไฟล์ครึ่ง ๆ กลาง ๆ), คืน permission เดิม
- [x] Preview / diff / open รับเฉพาะ path ที่อยู่ใน checkpoint นั้น — ใช้อ่านไฟล์อื่นไม่ได้; checkpoint id ถูกตรวจก่อนใช้เป็นชื่อไฟล์
- [x] ไม่เก็บเนื้อหาไฟล์ลับ (`.env`, `.ssh`, key ฯลฯ) และไฟล์ > 50 MB — แสดงในรายการแต่ Undo ไม่ได้ (มีคำเตือน)
- [x] Blob เก็บแบบ owner-only (`0600`), docx preview escape ข้อความทั้งหมด (ไม่มี HTML/Markdown แฝง)
- [x] ไม่ snapshot ทั้ง home folder หรือ root drive; โฟลเดอร์ใหญ่เกิน (> 50,000 ไฟล์ หรือสแกนเกิน 20 วินาที) → รอบนั้นไม่มี Undo แต่ agent ทำงานต่อได้
- [x] เก็บ checkpoint 30 วัน (สูงสุด 200 รอบ) แล้วลบเนื้อหาที่ไม่มีใครใช้
- [x] ปุ่ม Undo ปิดระหว่าง agent กำลังทำงานในแชทนั้น
- [ ] ยืนยัน UI ในแอปจริง (โดยเฉพาะ PDF preview ใน WKWebView — ต้องใช้ `frame-src blob:` ที่เพิ่มใน CSP แล้ว)



### ข้อจำกัดที่รู้อยู่

- Agent ไม่รู้ว่าผู้ใช้กด Undo — แผงจะบอกให้ผู้ใช้แจ้ง agent เองถ้าทำงานต่อ
- Undo ไม่ลบโฟลเดอร์ว่างที่ agent สร้าง (ลบเฉพาะไฟล์)
- รอบแรกของโฟลเดอร์ต้องอ่านไฟล์ทั้งหมดหนึ่งครั้ง (รอบต่อไปเร็ว เพราะมี index cache)



### ขั้นตอนการทำ

- [x] 1. Backend: store + snapshot + diff + restore + tests (undo/redo/conflict/force)
- [x] 2. Backend: preview (md/code/รูป/PDF/docx) + diff รายบรรทัด (`similar`) + open/reveal
- [x] 3. Frontend: API + types + `FilesChanged` + `FilePreviewDialog` + `DiffView`
- [x] 4. ผูกกับ `useChat` (begin/finish/add folder) และ `ChatMessageItem`
- [x] 5. CSP `frame-src blob:` สำหรับ PDF preview
- [x] 6. รัน `cargo test` + `npm run build` ให้ผ่าน

---



## 12. Checklist: แผง Git



### โครงสร้าง (แยกหน้าที่)

- **Rust** `commands/git/`: `runner.rs` (รัน git อย่างปลอดภัย) · `status.rs` · `diff.rs` · `actions.rs` (stage/unstage/discard/commit/init) · `history.rs` · `branches.rs` · `remote.rs` (fetch/pull/push) · `mod.rs` (Tauri commands)
- **Rust** `commands/file_diff.rs`: โมเดล diff กลาง (parse `git diff` + เทียบสองข้อความ) ใช้ทั้ง Git และ checkpoint
- **Frontend** `features/git/`: `git-context.tsx` (state กลาง + toast + confirm) · `git-panel.tsx` · `git-bar.tsx` · `changes-view.tsx` · `commits-view.tsx` · `branches-view.tsx` · `commit-menu.tsx` · `file-diff-list.tsx` · `commit-message.ts` (AI) · `api.ts` · `use-git-status.ts`
- **Frontend** `components/diff/`: `CodeDiff` (highlight แบบ PR) · `DiffView` (Unified/Split, ใช้ใน checkpoint) · `components/app/confirm-dialog.tsx`



### ขั้นตอนการทำ

- [x] 1. Backend git + tests กับ repo จริง (stage → commit → log → branch → discard → push ไม่มี remote)
- [x] 2. Diff model กลาง + parser + tests
- [x] 3. แผง Git แบบ PR (Changes / Commits / Branches) + แถบเหนือช่องพิมพ์ + ซ่อนเมื่อไม่ใช่ repo
- [x] 4. เขียน commit message ด้วย AI (ใช้โมเดลของโหมด Chat)
- [x] 5. รัน `cargo test` + `npm run build` ให้ผ่าน
- [ ] 6. ทดสอบ UI ในแอปจริง + push/pull กับ remote จริง (GitHub HTTPS / SSH)

---



## 13. Checklist: Features #6 + #5 + #9 — SQLite/Keychain, Projects, Skill library



### Feature #6: ประวัติแชทไป SQLite + key ไป Keychain

- **Rust** `commands/storage/history.rs` — SQLite (`rusqlite`, bundled) ที่ `<app data>/mali-cowork/history.sqlite3`: ตาราง `chats` (id, project_id, title, pinned, เวลา + JSON ทั้งแชท), `projects`, `meta`; WAL, `PRAGMA user_version` สำหรับ migration; commands `history_load`, `history_save` (upsert/delete แบบ transaction), `history_import_legacy`
- **Rust** `commands/storage/secrets.rs` — vault JSON เดียวใน OS keychain (`keyring`: apple-native / windows-native), แบ่ง chunk ≤ 1000 ตัวอักษร (Windows จำกัด 2560 bytes) และเขียนแบบ generation ใหม่ก่อนสลับ header (crash กลางทางไม่ทำ vault เดิมเสีย); Linux ใช้ไฟล์ `0600`
- **Frontend** `lib/db-sync.ts` — บันทึกเฉพาะแถวที่เปลี่ยน (เทียบ object identity) แบบ throttle, retry เมื่อบันทึกล้ม; `features/secrets/vault.ts` + `bindSecrets()` ผูก field ลับของ store เข้า vault (provider `apiKey`, MCP env, custom MCP headers)
- [x] ย้ายแชทจาก localStorage ครั้งแรกอัตโนมัติ (ไม่เขียนทับแชทที่มีใน DB แล้ว) แล้วลบ key เดิม
- [x] Key เก่าที่เป็น plain text ย้ายเข้า keychain และลบออกจาก localStorage **หลัง** บันทึก keychain สำเร็จเท่านั้น
- [x] Keychain ใช้ไม่ได้ → เก็บแบบเดิม (ไม่ทำ key หาย) + แจ้งใน Settings → Models
- [x] Sync provider / MCP รอ vault โหลดเสร็จก่อน (ไม่ส่ง key ว่างไปทับ)
- [x] ตรวจ id ทุกแถว (`[A-Za-z0-9_-]`), จำกัดขนาด, ไฟล์ DB `0600`; ลบ project → แชทกลับไปประวัติปกติ
- [x] `cargo test` (history: save/update/delete, legacy import, bad id, 0600; secrets: validate)
- [ ] ทดสอบในแอปจริง: ย้ายข้อมูลจากเวอร์ชันเก่า, macOS Keychain prompt (dev build ที่ไม่ได้ sign จะถามสิทธิ์), Windows Credential Manager



### Feature #5: Projects

- **Frontend** `features/projects/store.ts` (เก็บใน SQLite ตาราง `projects`), `pages/projects/` (รายการ, หน้า project, dialog สร้าง/แก้), sidebar group **Projects**, เมนู **Move to project** ในแชท, chip ชื่อ project เหนือข้อความ
- `buildInstructions(state, project)` เพิ่ม section `# Project` + project skills; `/` picker รวม project skills
- [x] สร้าง / แก้ / ลบ project, instructions บันทึกอัตโนมัติ, project skills ใช้ SkillsManager ตัวเดียวกับ Settings
- [x] แชทใหม่ใน project ได้ `projectId` (รวมถึงแชทต่อจาก summary), Cowork เริ่มในโฟลเดอร์ project (ขอสิทธิ์โฟลเดอร์ตอนเลือก)
- [ ] ทดสอบ UI ในแอปจริง



### Feature #9: Skill library

- **Rust** `commands/storage/skills.rs` — `skills_fetch_url` (GitHub repo / `tree` / `blob` ผ่าน GitHub API + raw, หรือ `SKILL.md` ที่ https URL ใดก็ได้), `skills_scan_folder` (หา `SKILL.md` ในโฟลเดอร์ทีม/repo ที่ clone ไว้), `skills_export_folder` (เขียน `<name>/SKILL.md`)
- **Frontend** `features/instructions/library.ts` + `pages/settings/skills/` — ปุ่ม Import (ไฟล์ / GitHub-ลิงก์-โฟลเดอร์), เลือกทีละ skill พร้อมอ่าน instructions ก่อน import, ชื่อซ้ำ = อัปเดต, Export SKILL.md / Copy as SKILL.md / Export all
- [x] https เท่านั้น, จำกัด 256 KB/ไฟล์ และ 100 skills, อ่านเฉพาะข้อความ `SKILL.md` — ไม่ดาวน์โหลดหรือรันสคริปต์ในโฟลเดอร์ skill
- [x] ชื่อโฟลเดอร์ export ถูกตรวจ (ออกนอกโฟลเดอร์ไม่ได้, รองรับชื่อภาษาไทย); front matter เขียนแบบ quote ปลอดภัย, อ่าน YAML แบบ `>` / `|` / quote ได้
- [x] `cargo test` (parse ลิงก์ GitHub, กัน http/file://, slug, scan folder) + live test ดึงจาก `anthropics/skills` ผ่าน
- [ ] ยังไม่รองรับ private repo (ใช้ Import from folder กับ repo ที่ clone ไว้แทน)

---



## 14. Checklist: Connectors — MCP Registry, ติดตั้งผ่านแชท, Sign in (OAuth)



### เป้าหมาย

- หน้า Settings → **Connectors** หน้าตาแบบ Claude (Your connectors / Discover / Popular / Add)
- รายการ MCP มาจาก **MCP Registry ทางการ** (`registry.modelcontextprotocol.io/v0.1/servers`) พร้อม icon, ชื่อ, คำอธิบาย, วิธีติดตั้ง
- ติดตั้ง / เชื่อมต่อผ่าน **แชท agent** ได้ และ connector ที่ต้อง login ใช้ **OAuth ในเบราว์เซอร์** อย่างปลอดภัย



### โครงสร้างระบบ

- **Rust** `commands/mcp_registry.rs` — `mcp_registry_search` (search + cursor, `version=latest`), `mcp_registry_get` (หลายชื่อพร้อมกัน), `mcp_registry_icon` (ลอง icon ของ registry → GitHub avatar ของ publisher → apple-touch-icon / favicon → DuckDuckGo icons; คืน data URL, cache)
- **Rust** `commands/mcp.rs` — `mcp_auth` (OpenCode `POST /mcp/{id}/auth/authenticate`: เปิดเบราว์เซอร์, รอ callback 5 นาที), `mcp_auth_remove` (sign out)
- **Frontend** `features/mcp/registry.ts` — แปลง package/remote ของ registry เป็นวิธีติดตั้ง: `npx -y pkg@ver`, `uvx pkg==ver`, `docker run -i --rm … image`, remote URL (+ `{variables}`), env vars / headers / arguments เป็นช่องกรอก
- `features/mcp/connectors.ts` — สถานะ live ร่วมกัน, `applyConnector`, `installConnector`, `signInConnector`, `requestConnectorInstall` (เปิด dialog จากที่ไหนก็ได้)
- `features/mcp/agent-install.ts` — คำสั่งให้ AI ตอบ ```` ```connector {"query"|"name"|"url"} ```` (ใส่ใน system prompt เฉพาะเมื่อข้อความพูดถึงการติดตั้ง/เชื่อมต่อ) + ตัวแยก block ออกจากคำตอบ
- UI: `pages/settings/mcp/mcp-settings.tsx` (Connectors), `discover-view.tsx`, `registry-install-dialog.tsx` (mount ใน `AppLayout`), `connector-icon.tsx`, `chat/components/message/connector-suggestions.tsx` (การ์ดในแชท)



### ความปลอดภัย

- [x] AI **ไม่ติดตั้งเอง** — ได้แค่เสนอการ์ด; ผู้ใช้เห็น publisher, คำสั่งที่จะรัน/URL และกดยืนยันเอง (มีป้าย "Suggested by the AI")
- [x] AI ถูกสั่งห้ามขอ key/token ในแชท; key กรอกใน dialog → เก็บใน **Keychain** (env → `mcp-env:*`, headers → `mcp-headers:*`)
- [x] OAuth: token อยู่กับ OpenCode (`~/.local/share/opencode`, ไฟล์ owner-only, webview อ่านไม่ได้ตาม fs scope) — ไม่ผ่าน webview / แชท / model
- [x] ตรวจชื่อ npm / PyPI / Docker image / version, ทุก argument ต้องอยู่ในชุดอักขระปลอดภัย (ไม่มี `& | < > ^ % " '` หรือช่องว่าง — กัน injection ผ่าน `npx.cmd` บน Windows); secret ใน argument ไม่รองรับ (Docker `-e NAME={secret}` แปลงเป็น env ให้)
- [x] remote ต้อง `https://`; registry entry ที่ใช้ไม่ได้ (mcpb, websocket, http) ถูกตัดทิ้งที่ backend
- [x] icon โหลดผ่าน backend: https เท่านั้น, ไม่เรียก localhost / IP ภายใน (รวมหลัง redirect), ≤ 512 KB, ตรวจ magic bytes, แสดงผ่าน `<img>` (SVG ไม่รัน script)
- [x] `cargo test` (กรอง package/remote, icon, ชื่อ registry, sniff รูป) + live test ค้น registry / ดึง icon จริงผ่าน; ทดสอบสร้างคำสั่งกับ 422 วิธีติดตั้งจาก 400+ entries จริงใน registry ผ่านทั้งหมด
- [ ] ทดสอบ UI ในแอปจริง: Discover, ติดตั้ง npm/uvx/Docker, OAuth sign-in (เช่น Notion, Linear), การ์ดในแชท
- [ ] Codex ได้ config ของ remote connector แต่ต้อง login เองด้วย `codex mcp login <id>` (OAuth ในแอปผูกกับ OpenCode)
- [x] **Sign in ในนาม Mali Cowork**: แอปลงทะเบียน OAuth client ของตัวเอง (`client_name: "Mali Cowork"`, public client + PKCE) แทนชื่อ "OpenCode" ที่ OpenCode ฝังไว้ → หน้า consent ของผู้ให้บริการขึ้นชื่อ Mali Cowork, แอปเปิดเบราว์เซอร์เอง, รับ callback ที่ `127.0.0.1:19877` (ตรวจ `state`), แสดงหน้า "Connected" พร้อม icon ของแอป แล้วส่ง code ให้ OpenCode แลก token (token อยู่กับ OpenCode เหมือนเดิม); server ที่ไม่รองรับการลงทะเบียนแอปใช้ flow ของ OpenCode แทน — `commands/mcp_oauth.rs`
- [ ] icon บนหน้า consent ของผู้ให้บริการ: ต้องมี `logo_uri` ที่เป็น https สาธารณะ (repo เป็น private) — ตั้ง `LOGO_URI` / `CLIENT_URI` ใน `mcp_oauth.rs` เมื่อมีเว็บของแอป
- [x] **แชร์ connectors ให้ CLI อื่น**: Gemini CLI (`~/.gemini/settings.json`) และ Cursor (`~/.cursor/mcp.json`) ได้ connectors ที่เปิดอยู่อัตโนมัติ (เฉพาะเมื่อติดตั้ง CLI นั้น, ไม่แตะ server ที่ผู้ใช้เพิ่มเอง, ไม่แชร์ Filesystem/Exec) + เมนู **Export for other apps (.mcp.json)** สำหรับ Claude Code / Claude Desktop / VS Code (ไม่ใส่ key: env เป็น `${NAME}`) — `commands/mcp_clients.rs`, `features/mcp/export.ts`
- [x] **Keychain ถามรหัสผ่านหลายรอบ (bug)**: vault เดิมแยกเป็นหลาย item (header + chunks) และสร้าง item ใหม่ทุกครั้งที่บันทึก → macOS ถามทีละ item ทุกครั้ง; แก้เป็น item เดียว อัปเดตในที่เดิม, เขียนเฉพาะเมื่อข้อมูลเปลี่ยน, ย้ายข้อมูลรูปแบบเก่าให้ครั้งเดียว; dev build (`tauri dev` ถูก sign ใหม่ทุกครั้งที่ rebuild) ใช้ไฟล์ `0600` แทน (release ยังใช้ Keychain)
- [x] **บริการที่จำกัด OAuth เฉพาะแอปที่อนุมัติ** (เช่น Figma: remote server รับเฉพาะ client ใน Figma MCP Catalog → หน้า login ขึ้น `OAuth app with client id … doesn't exist`): แอปรู้ล่วงหน้าจาก `features/mcp/oauth-limits.ts`, ปิดตัวเลือก remote พร้อมเหตุผล และเสนอ **Figma desktop app (local)** `http://127.0.0.1:3845/mcp` แทน (ไม่ต้อง OAuth; เปิดใน Figma desktop → Dev Mode → Enable desktop MCP server); connector Figma เดิมกด "Can’t sign in" → ปุ่มสลับไป desktop server ได้ และล้าง token เก่าให้
- [x] Sign in: กด **Cancel** ได้ระหว่างรอเบราว์เซอร์ และ **Start over** (ลบ client registration เก่าของ OpenCode แล้ว login ใหม่) เมื่อหน้า login ขึ้น error


---

## Code mode — แชท + แก้โค้ดในหน้าเดียว

เปิดจากแถบซ้าย → **Code** หรือแท็บ **Code** ด้านบน (ใช้ agent ตัวเดียวกับ Cowork)

- **Explorer + Editor (CodeMirror)**: เปิดหลายแท็บ, syntax highlight, `⌘S` บันทึก
- **Real-time**: agent แก้ไฟล์ไหน ไฟล์นั้นขึ้นจุดเขียวใน tree และบรรทัดที่เปลี่ยนจะกระพริบในตัวแก้ไข
- **Follow agent**: เปิดไฟล์ที่ agent กำลังแก้ให้อัตโนมัติ
- **Run / Check**: ตรวจหาคำสั่ง build / type check / test ของโปรเจกต์ให้เอง (npm/bun/pnpm, cargo, go, python, make) หรือเพิ่มคำสั่งเองได้
- **Problems**: ดึง error จาก output (tsc, rustc, go, eslint, python) — คลิกแล้วกระโดดไปที่บรรทัด, แสดงเส้นใต้สีแดงในตัวแก้ไข
- **Fix with AI**: ส่ง error ให้ agent แก้ในคลิกเดียว
- **Auto-check / Auto-fix** (ปิดไว้เป็นค่าเริ่มต้น): หลัง agent แก้ไฟล์ รันเช็คให้อัตโนมัติ ถ้าไม่ผ่านก็ส่ง error กลับไปให้แก้ (สูงสุด 3 รอบ) — จะไม่รันเองถ้า agent แก้ไฟล์ config ของ build (เช่น `package.json`) เพื่อไม่ให้ข้ามการขออนุญาตรันคำสั่ง
- **Ask about lines**: เลือกโค้ด → แนบไปกับข้อความถัดไป
- **ป้องกันการเขียนทับ**: ถ้า agent แก้ไฟล์ที่เรากำลังแก้ค้างไว้ จะให้เลือกว่าจะใช้เวอร์ชันไหน; ก่อนส่งข้อความแอปบันทึกไฟล์ที่แก้ไว้ให้ก่อน เพื่อให้ agent เห็นโค้ดล่าสุด
