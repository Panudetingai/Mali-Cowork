# 08 — Plugins

Plugin คือ "กล่อง" ที่รวม skills, slash commands, bots, connectors (MCP), templates, instructions และ panels
ไว้ด้วยกัน ติดตั้ง เปิด/ปิด อัปเดต หรือถอนได้ในครั้งเดียว — **Settings → Plugins**

ใช้โครงสร้างเดียวกับ **Claude Code plugins** จึงติดตั้ง plugin และ marketplace ที่เผยแพร่อยู่แล้วได้ทันที
(เช่น `affaan-m/ecc`, `anthropics/claude-plugins-official`)

## 8.1 โครงสร้าง plugin

```
my-plugin/
├── .claude-plugin/
│   ├── plugin.json          # name, version, description, author, license, keywords…
│   └── marketplace.json     # (ถ้าเป็น marketplace) รายการ plugin ให้เลือก
├── skills/<name>/SKILL.md   → Skills (พร้อม scripts/references ในโฟลเดอร์เดียวกัน)
├── commands/*.md            → Slash commands (/name)
├── agents/*.md              → Bots ในทีม (Settings → Team)
├── .mcp.json                → Connectors (MCP)
└── mali/                    # ส่วนที่ Mali ใช้เท่านั้น
    ├── instructions.md      → ใส่ในทุกแชทขณะ plugin เปิดอยู่ (≤ 32 KB)
    ├── templates/*.docx     → Templates เอกสาร Word
    └── panels/*.html        → หน้าของ plugin ในแอป (sandbox)
```

ทุกส่วนไม่บังคับ แต่ต้องมีอย่างน้อยหนึ่งอย่าง ไม่มี `plugin.json` ก็ได้ (ชื่อจะมาจากชื่อโฟลเดอร์/repo)

### `plugin.json`

```json
{
  "name": "hello-mali",
  "version": "1.0.0",
  "description": "…",
  "author": { "name": "…" },
  "skills": ["./more-skills/"],
  "commands": ["./extra/commands/"],
  "agents": "./bots/",
  "mcpServers": "./config/mcp.json",
  "mali": {
    "instructions": "./mali/instructions.md",
    "templates": ["./mali/templates/"],
    "panels": [{ "id": "notes", "title": "Quick notes", "entry": "./mali/panels/notes.html", "icon": "notebook-pen" }]
  }
}
```

- `skills` / `commands` / `agents`: path ที่ระบุ**เพิ่มจาก**โฟลเดอร์ default (กติกาเดียวกับ Claude Code)
- `mcpServers`: path, รายการ path, หรือ object ของ servers — ถ้าระบุจะ**แทน** `.mcp.json`
  (`"mcpServers": {}` = ไม่มี connector แม้ repo จะมี `.mcp.json` ของตัวเอง)
- `mali.panels`: ถ้าไม่ระบุ ทุก `.html` ใน `mali/panels/` เป็น panel หนึ่งหน้า

ตัวอย่างครบชุด: [`docs/examples/hello-mali-plugin`](examples/hello-mali-plugin)

## 8.2 แต่ละส่วนกลายเป็นอะไรใน Mali

| ส่วนของ plugin | ใน Mali | หมายเหตุ |
|---|---|---|
| `skills/*/SKILL.md` | Skill ใน library | ไฟล์ข้าง SKILL.md ติดตั้งด้วย (ไม่รวมไฟล์โปรแกรม `.exe` `.dylib` …) |
| `commands/*.md` | Skill แบบ "slash only" | ไม่อยู่ใน system prompt — ส่งไปเฉพาะตอนพิมพ์ `/name`; `$ARGUMENTS` = ข้อความหลัง `/name` |
| `agents/*.md` | Bot ในทีม | `description` → หน้าที่, เนื้อหา → วิธีทำงาน, `tools` → สิทธิ์ไฟล์ (ไม่ระบุ = อ่านอย่างเดียว); lead ต้องขออนุญาตก่อนเรียก; ชื่อซ้ำ bot เดิมจะไม่ถูกเพิ่ม (หนึ่งหน้าที่ หนึ่ง bot) |
| `.mcp.json` | Connector (ปิดอยู่) | ผู้ใช้กด Connect และใส่ key เองในหน้า connector; `${VAR}` ใน `env` กลายเป็นช่องให้กรอก |
| `mali/instructions.md` | Instructions | อยู่ในทุกแชทขณะ plugin เปิด |
| `mali/templates/*.docx` | Template | เข้า template library พร้อม `/` skill ของมัน |
| `mali/panels/*.html` | Panel | เปิดจาก Settings → Plugins หรือแถบซ้าย More → Plugins |

**ไม่รองรับ (แจ้งผู้ใช้ตอนติดตั้ง):** hooks, output styles, LSP servers, `userConfig`
และ MCP server ที่รันไฟล์ใน plugin เอง (`${CLAUDE_PLUGIN_ROOT}`) เมื่อติดตั้งจาก GitHub
— ติดตั้งจากโฟลเดอร์บนเครื่องแทนได้ (Mali จะแทน path ให้)

## 8.3 ติดตั้ง / เปิด-ปิด / อัปเดต / ถอน

- **ติดตั้ง:** วาง `owner/repo`, ลิงก์ GitHub (รวม `…/tree/<ref>/<folder>`), `/plugin marketplace add owner/repo`
  หรือเลือกโฟลเดอร์ → Mali อ่านทุกส่วนแล้วเปิดหน้าให้เลือกว่าจะเอาอะไร **ก่อน**เขียนอะไรลงเครื่อง
  - plugin ใหญ่ (skills > 25, commands > 40, agents > 3) เริ่มแบบยังไม่เลือก เพราะ skill ทุกตัวเพิ่มบรรทัดใน prompt
- **ปิด:** ทุกอย่างของ plugin หยุด (skills ปิด, bots พัก, connectors ตัดการเชื่อมต่อ, templates ปิด)
  — **เปิด** อีกครั้งกลับมาเหมือนตอนก่อนปิด
- **อัปเดต:** "Check for updates" เทียบ revision ของโฟลเดอร์บน GitHub (และ version) — กด Update
  จะเปิดหน้าเลือกเดิม โดยติ๊กของที่ติดตั้งอยู่ไว้ให้ และติดป้าย **New** ให้ของใหม่
- **ถอน:** ลบทุกอย่างที่ plugin เพิ่ม รวมไฟล์ panels และข้อมูลที่ panel เก็บไว้

ระบบจำว่าแต่ละ skill / bot / connector / template มาจาก plugin ไหน (`plugin` field) — ของที่ผู้ใช้สร้างเองไม่ถูกแตะ
และถ้าชื่อ skill ซ้ำกับของผู้ใช้ ตัวของ plugin จะถูกข้าม

## 8.4 Marketplace

`.claude-plugin/marketplace.json` แบบ Claude Code — `source` ของแต่ละ plugin รองรับ:

| source | ตัวอย่าง |
|---|---|
| path ใน marketplace | `"./plugins/formatter"` (บวก `metadata.pluginRoot` ให้) |
| GitHub | `{ "source": "github", "repo": "owner/repo", "ref": "v2" }` |
| git URL (GitHub) | `{ "source": "url", "url": "https://github.com/o/r.git" }` |
| git-subdir (GitHub) | `{ "source": "git-subdir", "url": "…", "path": "tools/x" }` |
| npm / pip / git นอก GitHub | ยังไม่รองรับ — แสดงเหตุผลในรายการ |

Marketplace ที่มี plugin เดียวอยู่ที่ root (เช่น ECC) ถือเป็น plugin นั้นเลย

## 8.5 Panels (UI extension แบบ sandbox)

Panel คือหน้าเว็บของ plugin ที่เปิดในแอป:

- เสิร์ฟจาก scheme แยก `mali-plugin://localhost/<plugin>/<file>` (Windows: `http://mali-plugin.localhost/…`)
  อ่านได้เฉพาะไฟล์ใน `panels/` ของ plugin นั้น
- อยู่ใน `<iframe sandbox="allow-scripts">` (ไม่มี `allow-same-origin`) → origin ทึบ: ไม่มี cookies,
  localStorage หรือคำสั่งของ Mali
- CSP ของหน้า: `connect-src 'none'` (ห้ามเรียกเน็ต), script/style ได้เฉพาะ inline และไฟล์ของ plugin เอง
- ไฟล์ละ ≤ 2 MB, รวม ≤ 8 MB, ≤ 12 panels — โหลดเฉพาะตอนเปิดหน้า (ไม่กิน RAM ตอนไม่ได้ใช้)

### Bridge: คุยกับแอปด้วย `postMessage`

```js
const send = (m) => parent.postMessage({ mali: 1, ...m }, "*");
send({ type: "ready" });                       // → { type: "init", theme, locale, plugin }
send({ type: "prompt", text: "…", mode: "cowork" }); // เปิดแชทใหม่ พร้อมข้อความในช่อง (ผู้ใช้กดส่งเอง)
send({ type: "toast", text: "Saved" });
send({ type: "copy", text: "…" });
send({ type: "open", url: "https://…" });      // https เท่านั้น
send({ type: "storage.get", id: "1" });        // → { type: "result", id: "1", value }
send({ type: "storage.set", id: "2", value }); // JSON ≤ 256 KB ต่อ plugin
```

แอปส่ง `{ mali: 1, type: "theme", theme }` เมื่อธีมเปลี่ยน — message อื่นนอกจากนี้ถูกละทิ้ง

## 8.6 ติดตั้ง skill ด้วยคำสั่ง (skillfish / skills)

Settings → Skills → Import รับคำสั่งที่คัดลอกมาจากหน้า skill ได้เลย — Mali **อ่าน**คำสั่ง แล้วดาวน์โหลดเอง
(ไม่รัน npm/npx)

```
npx skillfish add affaan-m/ecc quarkus-verification   # เฉพาะ skill ชื่อนี้
npx skillfish add owner/repo                          # ทุก skill ใน repo
skillfish add owner/repo@v1.0.0                       # ที่ ref
skillfish add owner/repo/path/to/skill                # ตาม path
skillfish add owner/repo --path skills/foo
npx skills add https://github.com/o/r --skill frontend-design
pnpm dlx skills add o/r -s a,b
bunx add-skill o/r
```

ชื่อ skill จับคู่กับชื่อโฟลเดอร์ก่อน (ถ้าซ้ำหลายที่ เลือกที่ตื้นที่สุด เช่น `skills/x` แทน `docs/es/skills/x`)
ไม่เจอค่อยดู `name:` ใน front matter — `--agent`, `--global`, `--yes`, `--all` ฯลฯ ถูกข้าม

## 8.7 โค้ด

| ส่วน | ไฟล์ |
|---|---|
| อ่าน plugin / marketplace (Rust) | `src-tauri/src/commands/plugins/{mod,manifest,marketplace}.rs` |
| เก็บไฟล์ panel/template, serve `mali-plugin://` | `src-tauri/src/commands/plugins/files.rs` |
| รายการไฟล์ GitHub/โฟลเดอร์ที่ใช้ร่วมกับ skills | `src-tauri/src/commands/storage/skills/tree.rs` |
| อ่านคำสั่ง skillfish/skills | `src-tauri/src/commands/storage/skills/command.rs` |
| ติดตั้ง/อัปเดต/เปิด-ปิด/ถอน | `src/features/plugins/install.ts` |
| แปลง command/agent/MCP | `src/features/plugins/convert.ts` |
| Panel bridge | `src/features/plugins/bridge.ts`, `src/pages/plugins/index.tsx` |
| หน้า Settings → Plugins | `src/pages/settings/plugins/` |
