# Video Export (Deterministic Frame-by-Frame Rendering)

สคริปต์แปลง animation ที่เขียนด้วยโค้ด (Three.js / WebGL shader / GSAP / CSS / DOM) เป็นไฟล์วิดีโอ
แบบ **Offline Deterministic Rendering** ไม่ใช่การอัดหน้าจอ จึงไม่มี frame drop หรือความเร็วเพี้ยน

```
[ หน้าเว็บ animation ] ──► หยุดเวลา → เลื่อนไปทีละ 1/fps วินาที ──► จับภาพทีละเฟรม ──► FFmpeg ──► .mp4 / .mov / .webm / .gif
                                                                                  ▲
                                                           [ เพลงจาก code (.wav) ] ┘  (--audio)
```

## สิ่งที่ต้องมี

- Node.js 22 ขึ้นไป (ไม่ต้องติดตั้ง npm package เพิ่ม)
- `ffmpeg` (`brew install ffmpeg`)
- Chrome / Chromium / Edge / Brave ตัวใดก็ได้ (หาให้อัตโนมัติ หรือระบุ `--chrome <path>` / `CHROME_PATH`)

## ใช้งานเร็ว ๆ

```bash
# ดูว่าหน้านี้มีตัวไหน / action ไหนให้ export
bun run export:video scripts/export/example --list

# โหมดถาม-ตอบ: ไม่ใส่ option ก็จะถามให้เลือก ตัวไหน, action ไหน, ความชัด, fps, format, คุณภาพ
bun run export:video scripts/export/example

# ระบุครบในบรรทัดเดียว
node scripts/export/export-video.mjs scripts/export/example -t robot -a wave -r 4k -f 60 -q high

# export ทุก action ของตัวนั้น
node scripts/export/export-video.mjs scripts/export/example -t robot -a all -r 1080p -f 30

# พื้นหลังโปร่งใส สำหรับเอาไปซ้อนในโปรแกรมตัดต่อ
node scripts/export/export-video.mjs scripts/export/example -t title -a intro -c prores --transparent

# ใส่เพลง (เช่น .wav ที่ generate จาก Python)
node scripts/export/export-video.mjs scripts/export/example -t title -a intro --audio music.wav
```

ไฟล์จะออกที่ `./exports/<ชื่อ>-<ตัว>-<action>-<WxH>-<fps>fps.<ext>` (เปลี่ยนได้ด้วย `--out-dir` หรือ `-o`)

## ตัวเลือกหลัก

| ตัวเลือก | ความหมาย | ค่าเริ่มต้น |
|---|---|---|
| `-t, --target` | ตัวไหน (object/character) | ถามหรือเลือกตัวแรก |
| `-a, --action` | action ไหน, หรือ `all` | ถามหรือเลือกตัวแรก |
| `-r, --resolution` | `360p` `480p` `720p` `1080p` `1440p` `4k` `720p-v` `1080p-v` `4k-v` `square` หรือ `WxH` | `1080p` |
| `-f, --fps` | เฟรมต่อวินาที | `30` |
| `-q, --quality` | `low` `medium` `high` `lossless` | `high` |
| `--crf` | กำหนด CRF เอง (แทน `--quality`) | – |
| `-c, --codec` | `h264` (mp4), `h265` (mp4), `prores` (mov), `vp9` (webm), `gif`, `frames` (PNG sequence) | `h264` |
| `-d, --duration` | ความยาว (วินาที) ถ้าหน้าเว็บไม่ได้บอกมา | จากหน้าเว็บ |
| `--start` | เริ่มที่วินาทีที่ | `0` |
| `--viewport` | ขนาด layout ของหน้าเว็บ (CSS px) | ด้านสั้น = 1080 |
| `--transparent` | พื้นหลังโปร่งใส (ใช้กับ `prores`, `vp9`, `frames`) | ปิด |
| `--frame-format jpeg` | จับภาพเป็น JPEG (เร็วกว่า PNG เล็กน้อย) | `png` |
| `--audio` | ไฟล์เสียงที่จะใส่ (ตัดให้ยาวเท่าวิดีโอ) | – |
| `--keep-frames` | เก็บภาพแต่ละเฟรมไว้ด้วย | ปิด |
| `-y, --yes` | ไม่ถามอะไร ใช้ค่าเริ่มต้นทั้งหมด | – |

**ความชัด:** layout ของหน้าเว็บจะคงที่ (ค่าเริ่มต้น 1920×1080 CSS px สำหรับจอแนวนอน) แล้ว render
ด้วย device-pixel-ratio ให้ได้ความละเอียดที่ขอ เช่น `-r 4k` ได้ภาพคมขึ้น 2 เท่า โดยตำแหน่งทุกอย่างเหมือนเดิม

## ทำให้หน้าเว็บของคุณ export ได้

### แบบที่ 1: ใส่ bridge `window.__EXPORT__` (แนะนำ)

```js
window.__EXPORT__ = {
  // (ไม่บังคับ) บอกว่ามีตัวไหน action ไหน และยาวกี่วินาที
  list: () => ({
    robot: { wave: 2.5, jump: 2.15 },
    title: { intro: 3.5 },
  }),

  // เตรียมฉากสำหรับ target/action ที่เลือก แล้ว return ความยาว (วินาที)
  prepare({ target, action, width, height, fps }) {
    tl = buildTimeline(target, action); // เช่น gsap.timeline({ paused: true })
    return tl.duration();
  },

  // render ภาพ ณ เวลา t วินาทีให้ตรงเป๊ะ (async ได้)
  seek(t) {
    tl.time(t, false);
    material.uniforms.uTime.value = t;
    renderer.render(scene, camera);
  },
};
```

หน้าเว็บจะได้ query `?export=1&target=…&action=…` ด้วย เอาไว้ซ่อน UI ตอน export ได้
ดูตัวอย่างเต็มที่ [`example/index.html`](example/index.html) (Three.js + GLSL shader + GSAP)

### แบบที่ 2: ไม่ต้องแก้หน้าเว็บ

ถ้าหน้าไม่มี `__EXPORT__` สคริปต์จะใช้ **virtual clock** แทน: แช่ `performance.now()`, `Date`,
`requestAnimationFrame` และ CSS / Web Animations ไว้ แล้วเลื่อนเวลาเองทีละเฟรม
animation ที่ขับด้วย rAF (Three.js `setAnimationLoop`, GSAP ticker, `THREE.Clock`) หรือ CSS จะออกมาตรงเฟรม
แค่ต้องบอกความยาวด้วย `--duration`

```bash
node scripts/export/export-video.mjs path/to/page.html -d 12 -r 1080p -f 60
```

ข้อจำกัด: `setTimeout`/`setInterval` ยังเป็นเวลาจริง และ `<video>` ไม่ถูกควบคุม ถ้าต้องใช้ให้ทำแบบที่ 1

## Input ที่รับได้

- ไฟล์ `.html` หรือโฟลเดอร์ที่มี `index.html` (จะเปิด http server ชั่วคราวให้ เพื่อให้ ES module / texture / model โหลดได้)
- URL เช่น `http://localhost:5173/scene.html` (dev server ของ Vite)
