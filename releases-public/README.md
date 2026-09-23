<p align="center">
  <img src="./docs/brand/mali-cowork-icon.png" width="128" height="128" alt="Mali Cowork logo: yellow blob with two dark pill-shaped eyes" />
</p>

<h1 align="center">Mali Cowork</h1>

<p align="center">
  <strong>Desktop AI — chat and Cowork agents on your machine</strong><br />
  <strong>แอป AI บนเครื่องคุณ — แชทและให้ agent ทำงานในโฟลเดอร์ที่อนุญาต</strong>
</p>

<p align="center">
  <a href="https://github.com/Panudetingai/Mali-Cowork-Releases/releases/latest"><strong>⬇️ Download latest release</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Panudetingai/Mali-Cowork-Releases/issues/new/choose"><strong>Report a bug / แจ้งบัค</strong></a>
  &nbsp;·&nbsp;
  <a href="./docs/LANDING.md"><strong>Docs / เอกสาร</strong></a>
</p>

---

This repository is **public** and contains **installers, documentation, and issue tracking only**. Application source code is not published here.

---

## English — Quick start

1. Open **[Releases](https://github.com/Panudetingai/Mali-Cowork-Releases/releases/latest)** and download for your platform:
   - **macOS** (Apple Silicon + Intel): `Mali Cowork_<version>_universal.dmg`
   - **Windows 10/11**: `Mali Cowork_<version>_x64-setup.exe`
2. Install and launch. On first macOS open, use **Right click → Open** if Gatekeeper blocks the app (builds are not notarized yet).
3. Complete the in-app setup (agents, API keys, or signed-in CLIs).
4. Use **Chat** for Q&A, or **Cowork** to let an agent change files only in folders you approve.

**Updates:** Newer builds check for updates in-app. Older builds may need a manual download from Releases.

**Help:** [User guide (Thai)](./docs/LANDING.md) · [Feature list](./docs/FEATURES.md) · [Issues](https://github.com/Panudetingai/Mali-Cowork-Releases/issues/new/choose)

---

## ไทย — ติดตั้งและใช้งาน

รายละเอียดขั้นตอนติดตั้ง macOS / Windows, วิธีแจ้งบัค, และคำถามที่พบบ่อย อยู่ในส่วนด้านล่างของ README นี้ (ภาษาไทย) และใน [`docs/LANDING.md`](./docs/LANDING.md)

### 1. ดาวน์โหลด

ไปที่หน้า [**Releases**](https://github.com/Panudetingai/Mali-Cowork-Releases/releases/latest) แล้วเลือกไฟล์ตามเครื่อง:

| เครื่อง | ไฟล์ |
|--------|------|
| macOS (ทั้ง Apple Silicon และ Intel) | `Mali Cowork_<เวอร์ชัน>_universal.dmg` |
| Windows 10/11 | `Mali Cowork_<เวอร์ชัน>_x64-setup.exe` |

ต้องใช้ macOS 10.13 ขึ้นไป หรือ Windows 10 ขึ้นไป

### 2. ติดตั้งบน macOS

1. เปิดไฟล์ `.dmg` แล้วลาก **Mali Cowork** ไปใส่โฟลเดอร์ **Applications**
2. เปิดครั้งแรก: แอปยังไม่ได้ลงทะเบียนกับ Apple ระบบจึงอาจเตือน — ใช้ **คลิกขวา → Open** หรือ **System Settings → Privacy & Security → Open Anyway**
3. ถ้าขึ้นว่าแอปเสียหาย รันใน Terminal:

   ```sh
   xattr -cr "/Applications/Mali Cowork.app"
   ```

4. ครั้งแรกที่บันทึก API key macOS จะถามรหัสผ่าน Keychain — กด **Always Allow** ได้

### 3. ติดตั้งบน Windows

1. ดับเบิลคลิก `…_x64-setup.exe`
2. ถ้า SmartScreen ขึ้น ให้กด **More info → Run anyway**
3. เปิดจากเมนู Start หลังติดตั้งเสร็จ

### 4. เริ่มใช้งาน

1. ทำตาม **หน้าตั้งค่าเริ่มต้น** ในแอป
2. ใส่ API key ที่ **Settings → Models** หรือใช้ agent ที่ sign in ไว้แล้ว (OpenCode, Codex, Cursor ฯลฯ)
3. **Chat** = ถามตอบ · **Cowork** = agent แก้ไฟล์เฉพาะโฟลเดอร์ที่อนุญาต

### แจ้งปัญหา / ข้อเสนอแนะ

ใช้ [**Issues → New issue**](https://github.com/Panudetingai/Mali-Cowork-Releases/issues/new/choose) — มีเทมเพลต **Bug** และ **Feature request**

- เวอร์ชันแอป, OS, model/agent ที่ใช้
- ขั้นตอนที่ทำ และสิ่งที่เกิดขึ้น
- ภาพหน้าจอหรือข้อความ error

> 🔒 **ห้ามแปะ API key, รหัสผ่าน หรือไฟล์ลับใน Issue**

### เอกสารเพิ่มเติม

| เอกสาร | เนื้อหา |
|--------|---------|
| [LANDING.md](./docs/LANDING.md) | ภาพรวม ความปลอดภัย FAQ |
| [FEATURES.md](./docs/FEATURES.md) | รายการฟีเจอร์ |
| [docs/README.md](./docs/README.md) | ดัชนีเอกสาร (รวม architecture notes สำหรับผู้สนใจเทคนิค) |

### อัปเดตและถอนการติดตั้ง

- **อัปเดต:** แอปเวอร์ชันใหม่ตรวจอัปเดตอัตโนมัติ; ถ้าไม่มี ให้ดาวน์โหลดจาก Releases แล้วติดตั้งทับ
- **ถอน:** macOS — ลากออกจาก Applications · Windows — Settings → Apps → Uninstall

---

## Repository scope

| มีใน repo นี้ | ไม่มีใน repo นี้ |
|---------------|------------------|
| GitHub Releases (`.dmg`, `.exe`) | Source code |
| User & product documentation | Private keys / `.env` |
| Bug & feature issue templates | Internal CI secrets |

Releases are published here automatically when the private development repository tags a version.
