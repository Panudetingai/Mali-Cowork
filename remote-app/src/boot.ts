// @ts-nocheck
import { setActiveScreen, setSheetOpen } from "./components/ios-app-shell";

export function initRemote(): void {
  // Thai unless the phone was switched to English (menu → Language).
  const LANG_KEY = "mali.remote.lang";
  let th = (() => { try { return localStorage.getItem(LANG_KEY) !== "en"; } catch { return true; } })();
  const STRINGS = {
    connectTitle: ["Connect to Mali", "เชื่อมต่อกับ Mali"],
    connectBody: ["Scan the QR code from Mali on your computer to control it from this phone.", "สแกน QR code จาก Mali บนคอม เพื่อสั่งงานจากมือถือเครื่องนี้"],
    scan: ["Scan QR code", "สแกน QR code"],
    pasteLink: ["Paste a link instead", "วางลิงก์แทน"],
    connect: ["Connect", "เชื่อมต่อ"],
    backToApp: ["Back", "กลับ"],
    how1: ["Open Mali on your computer", "เปิด Mali บนคอม"],
    how1b: ["Settings → Mobile", "ไปที่ Settings → มือถือ"],
    how2: ["Turn on the remote", "เปิดสวิตช์รีโมต"],
    how2b: ["A QR code appears", "จะมี QR code ขึ้นมา"],
    how3: ["Scan it here", "สแกนจากที่นี่"],
    how3b: ["Same Wi-Fi, or Tailscale on both", "ใช้ Wi-Fi เดียวกัน หรือเปิด Tailscale ทั้งสองเครื่อง"],
    fine: ["Only devices on your network can reach Mali.", "เฉพาะอุปกรณ์ในเครือข่ายของคุณเท่านั้นที่เข้าถึง Mali ได้"],
    expired: ["This pairing no longer works — the code was reset on the computer. Scan the new one.", "รหัสจับคู่เดิมใช้ไม่ได้แล้ว (ถูกรีเซ็ตบนคอม) — สแกน QR ใหม่อีกครั้ง"],
    badQr: ["That isn't a Mali pairing code.", "QR นี้ไม่ใช่รหัสจับคู่ของ Mali"],
    noQr: ["No QR code found in the photo — try again closer.", "ไม่พบ QR ในรูป — ลองถ่ายใกล้ขึ้นอีกนิด"],
    reading: ["Reading the code…", "กำลังอ่าน QR…"],
    aim: ["Point at the QR code on your computer", "เล็งกล้องไปที่ QR code บนจอคอม"],
    camDenied: ["Camera not allowed — taking a photo instead.", "ใช้กล้องสดไม่ได้ — เปลี่ยนเป็นถ่ายรูปแทน"],
    paired: ["Connected", "เชื่อมต่อแล้ว"],
    waitTitle: ["Waiting for approval", "รอการอนุมัติบนคอม"],
    waitBody: ["Open Mali on your computer → Settings → Mobile, and allow this phone under Phones. It connects by itself once you do.", "เปิด Mali บนคอม → Settings → มือถือ แล้วกด Allow ให้มือถือเครื่องนี้ในส่วน Phones — อนุมัติแล้วจะเชื่อมต่อเอง"],
    ipBlocked: ["This phone isn't allowed yet — open Mali on your Mac → Settings → Mobile and approve its IP.", "มือถือเครื่องนี้ยังไม่ได้รับอนุญาต — เปิด Mali บนคอม → Settings → มือถือ แล้วกด Allow IP"],
    online: ["Connected to your computer", "เชื่อมต่อกับคอมแล้ว"],
    offline: ["Reconnecting…", "กำลังเชื่อมต่อใหม่…"],
    offlineLong: ["Can't reach Mali — is the computer awake and on the same network?", "ติดต่อ Mali ไม่ได้ — คอมเปิดอยู่และอยู่เครือข่ายเดียวกันไหม"],
    morning: ["Good morning", "สวัสดีตอนเช้า"],
    afternoon: ["Good afternoon", "สวัสดีตอนบ่าย"],
    evening: ["Good evening", "สวัสดีตอนเย็น"],
    ask1: ["What can ", "วันนี้ให้ "],
    ask2: ["Mali", "Mali"],
    ask3: [" help with?", " ช่วยอะไรดี?"],
    chat: ["Chat", "แชท"],
    chatBody: ["Ask any model, right here", "ถามโมเดลได้ทันที"],
    cowork: ["Cowork", "Cowork"],
    coworkBody: ["Work in the folder on your computer", "สั่งงานในโฟลเดอร์บนคอม"],
    needs: ["Needs your OK", "รอคุณตอบ"],
    working: ["Working now", "กำลังทำงาน"],
    recent: ["Recent", "ล่าสุด"],
    noChats: ["Nothing yet — ask Mali something below.", "ยังไม่มีแชท — ลองพิมพ์ถาม Mali ด้านล่างได้เลย"],
    allow: ["Allow", "อนุญาต"],
    always: ["Always", "อนุญาตเสมอ"],
    deny: ["Deny", "ปฏิเสธ"],
    answer: ["Answer", "ตอบ"],
    skip: ["Skip", "ข้าม"],
    own: ["Your own answer…", "พิมพ์คำตอบเอง…"],
    asks: ["Mali asks to", "Mali ขออนุญาต"],
    question: ["Mali has a question", "Mali มีคำถาม"],
    steps: ["{n} steps", "{n} ขั้นตอน"],
    files: ["Files changed · {n}", "ไฟล์ที่แก้ · {n}"],
    plan: ["Plan · {d}/{n}", "แผนงาน · {d}/{n}"],
    working1: ["Working…", "กำลังทำงาน…"],
    writing: ["Writing the answer…", "กำลังเขียนคำตอบ…"],
    clipped: ["Cut short — the full answer is in the app.", "ตัดให้สั้นลง ดูฉบับเต็มในแอป"],
    stop: ["Stop", "หยุด"],
    stopping: ["Stopping…", "กำลังหยุด…"],
    placeholder: ["Ask something here…", "ถามอะไรก็ได้…"],
    placeholderChat: ["Reply…", "พิมพ์ตอบ…"],
    placeholderCowork: ["What should Mali do?", "ให้ Mali ทำอะไร?"],
    defaultModel: ["Same as the app", "ตามที่ตั้งในแอป"],
    model: ["Model", "โมเดล"],
    sendWith: ["Send with", "ส่งด้วย"],
    search: ["Search models", "ค้นหาโมเดล"],
    setupOnMac: ["Set up on your Mac first", "ตั้งค่าในแอปบนคอมก่อน"],
    coworkNote: ["Cowork works in the folder picked in Mali on your computer.", "Cowork จะทำงานในโฟลเดอร์ที่เลือกไว้ในแอปบนคอม"],
    menu: ["Mali Remote", "Mali Remote"],
    rescan: ["Connect another computer", "เชื่อมต่อคอมเครื่องอื่น"],
    rescanBody: ["Scan a new QR code", "สแกน QR code ใหม่"],
    install: ["Add to Home Screen", "เพิ่มไปยังหน้าจอโฮม"],
    installBody: ["Open Mali like an app", "เปิด Mali ได้เหมือนแอป"],
    unpair: ["Disconnect this phone", "ยกเลิกการเชื่อมต่อ"],
    unpairBody: ["You'll need to scan again", "ต้องสแกนใหม่เพื่อใช้อีกครั้ง"],
    installIos: ["Tap Share ", "แตะปุ่มแชร์ "],
    installIos2: [", then “Add to Home Screen”.", " แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”"],
    installAndroid: ["Open the ⋮ menu, then “Add to Home screen”.", "เปิดเมนู ⋮ แล้วเลือก “เพิ่มลงในหน้าจอหลัก”"],
    failed: ["Error", "ผิดพลาด"],
    waiting: ["Waiting", "รออนุมัติ"],
    live: ["Running", "กำลังทำ"],
    loading: ["Loading…", "กำลังโหลด…"],
    inFolder: ["in {f}", "ใน {f}"],
    language: ["Language", "ภาษา"],
    languageBody: ["Menus and buttons on this phone", "เมนูและปุ่มบนมือถือเครื่องนี้"],
    chooseModel: ["Choose a model", "เลือกโมเดล"],
    all: ["All", "ทั้งหมด"],
    cliTag: ["CLI", "CLI"],
    freeTag: ["Free", "ฟรี"],
    needsKey: ["Add an API key on your computer first", "ต้องใส่ API key ในแอปบนคอมก่อน"],
    needsLogin: ["May need sign-in on your computer", "อาจต้อง sign in บนคอม"],
    notHere: ["Not available in this mode", "ใช้ในโหมดนี้ไม่ได้"],
    noMatch: ["No model matches", "ไม่พบโมเดลที่ค้นหา"],
    filesN: ["{n} files", "{n} ไฟล์"],
    planN: ["Plan {d}/{n}", "แผน {d}/{n}"],
    work: ["What it did", "สิ่งที่ทำ"],
    copied: ["Copied", "คัดลอกแล้ว"],
    copyFail: ["Couldn't copy", "คัดลอกไม่ได้"],
    copy: ["Copy", "คัดลอก"],
    needsYou: ["Needs your approval", "รอคุณอนุมัติ"],
    image: ["image", "รูปภาพ"],
    noSpeech: ["Dictation isn't available here — use the keyboard's mic.", "พิมพ์ด้วยเสียงไม่ได้ในเบราว์เซอร์นี้ — ใช้ไมค์บนคีย์บอร์ดแทน"],
  };
  const t = (key, vars) => {
    let s = (STRINGS[key] || [key, key])[th ? 1 : 0];
    for (const k in vars || {}) s = s.replace(`{${k}}`, vars[k]);
    return s;
  };

  // Icons: fixed markup, never data.
  const P = {
    scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
    wave: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    sparkle: '<path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8Z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7Z"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6Z"/><path d="M12 8v4M12 16h.01"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    target: '<circle cx="12" cy="12" r="8"/><path d="m9 12 2 2 4-4"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
    share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/>',
    unlink: '<path d="m18.8 13.4 1.7-1.7a5 5 0 0 0-7-7l-1.7 1.7M5.2 10.6l-1.7 1.7a5 5 0 0 0 7 7l1.7-1.7M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-9 9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    terminal: '<path d="m5 8 4 4-4 4M12 16h7"/><rect x="2.5" y="4" width="19" height="16" rx="3"/>',
    message: '<path d="M7 9h10M7 13h6"/><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  };
  function icon(name) {
    const span = document.createElement("span");
    span.style.display = "contents";
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
    return span.firstChild;
  }

  function applyStatic() {
    document.documentElement.lang = th ? "th" : "en";
    document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
    document.querySelectorAll("[data-lang]").forEach((el) => el.classList.toggle("on", (el.dataset.lang === "th") === th));
  }
  applyStatic();
  document.querySelectorAll("[data-icon]").forEach((el) => el.replaceWith(icon(el.dataset.icon)));

  const $ = (id) => document.getElementById(id);
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  let toastTimer;
  function toast(text) {
    document.querySelector(".toast")?.remove();
    const el = h("div", { class: "toast", role: "status" }, text);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  }

  // ── pairing: the key rides in the URL's fragment (never sent to a server),
  // and stays there so "Add to Home Screen" keeps it.
  const TOKEN_KEY = "mali.remote.token";
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("t");
  let token = fromHash || safeGet(TOKEN_KEY) || "";
  if (fromHash) safeSet(TOKEN_KEY, fromHash);

  function showConnect(reason) {
    stopStream();
    setActiveScreen("connect");
    $("app").classList.add("hidden");
    $("connect").classList.remove("hidden");
    $("connectNote").classList.toggle("hidden", reason !== "expired");
    if (reason === "expired") $("connectNote").replaceChildren(icon("alert"), h("span", {}, t("expired")));
    $("backToApp").classList.toggle("hidden", reason !== "rescan");
    window.scrollTo(0, 0);
  }
  function showApp() {
    setActiveScreen("app");
    $("connect").classList.add("hidden");
    $("app").classList.remove("hidden");
  }

  /** A scanned or pasted pairing link: here it pairs in place; another computer's opens there. */
  function pairWith(text) {
    const raw = String(text || "").trim();
    if (!raw) { toast(t("badQr")); return; }
    let key = null;
    let target = null;
    try {
      if (/^https?:\/\//i.test(raw)) {
        const url = new URL(raw);
        key = new URLSearchParams(url.hash.slice(1)).get("t");
        target = url.origin;
      } else if (raw.includes("#t=") || raw.startsWith("t=")) {
        const hash = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw;
        key = new URLSearchParams(hash.startsWith("?") ? hash.slice(1) : hash).get("t") || hash.replace(/^t=/, "");
        target = location.origin;
      } else if (/^[a-f0-9]{64}$/i.test(raw)) {
        key = raw;
        target = location.origin;
      }
    } catch { toast(t("badQr")); return; }
    if (!key || key.length < 32) { toast(t("badQr")); return; }
    if (target && target !== location.origin) {
      location.assign(`${target}/#t=${encodeURIComponent(key)}`);
      return;
    }
    token = key;
    safeSet(TOKEN_KEY, key);
    history.replaceState(null, "", `#t=${encodeURIComponent(key)}`);
    toast(t("paired"));
    start();
  }

  // ── scanning: a live camera where the browser allows it (HTTPS), else a photo.
  let jsqr;
  function loadJsQR() {
    jsqr ??= new Promise((resolve, reject) => {
      if (window.jsQR) return resolve(window.jsQR);
      const s = document.createElement("script");
      s.src = "/jsqr.js";
      s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error("jsQR")));
      s.onerror = () => { jsqr = undefined; reject(new Error("jsQR")); };
      document.head.append(s);
    });
    return jsqr;
  }
  const detector = "BarcodeDetector" in window ? (() => { try { return new BarcodeDetector({ formats: ["qr_code"] }); } catch { return null; } })() : null;

  async function decode(source, width, height) {
    if (detector) {
      try { const found = await detector.detect(source); if (found[0]) return found[0].rawValue; } catch {}
    }
    const canvas = document.createElement("canvas");
    // Large photos are slow to read and no better: fit them to 1024 px.
    const scale = Math.min(1, 1024 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const read = await loadJsQR();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return read(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" })?.data;
  }

  $("scanBtn").addEventListener("click", () => {
    loadJsQR().catch(() => undefined);
    if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) liveScan();
    else $("photo").click();
  });
  $("photo").addEventListener("change", async () => {
    const file = $("photo").files?.[0];
    $("photo").value = "";
    if (!file) return;
    toast(t("reading"));
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      const text = await decode(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      text ? pairWith(text) : toast(t("noQr"));
    } catch { toast(t("noQr")); }
  });

  async function liveScan() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch {
      toast(t("camDenied"));
      $("photo").click();
      return;
    }
    const video = h("video", { playsinline: true, muted: true, autoplay: true });
    video.muted = true;
    video.srcObject = stream;
    let open = true;
    const close = () => { open = false; stream.getTracks().forEach((tr) => tr.stop()); overlay.remove(); };
    const overlay = h("div", { class: "scanner" }, video, h("div", { class: "frame" }), h("div", { class: "say" }, t("aim")),
      h("button", { class: "close", type: "button", "aria-label": "Close", onclick: close }, icon("x")));
    document.body.append(overlay);
    await video.play().catch(() => undefined);
    const tick = async () => {
      if (!open) return;
      if (video.videoWidth) {
        const text = await decode(video, video.videoWidth, video.videoHeight).catch(() => null);
        if (text && open) { close(); pairWith(text); return; }
      }
      setTimeout(tick, 180);
    };
    tick();
  }

  $("pasteBtn").addEventListener("click", () => { $("pasteBox").classList.toggle("hidden"); $("pasteInput").focus(); });
  $("pasteGo").addEventListener("click", () => pairWith($("pasteInput").value));
  $("pasteInput").addEventListener("keydown", (e) => { if (e.key === "Enter") pairWith($("pasteInput").value); });
  $("backToApp").addEventListener("click", start);

  // ── talking to Mali
  async function command(body) {
    const res = await fetch("/api/command", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.status === 401) { showConnect("expired"); throw new Error("unauthorized"); }
    const data = await res.json().catch(() => ({ error: "bad reply" }));
    if (res.status === 403 && data.error === "ip_not_allowed") {
      // The home screen says so (and how to fix it): no toast on top.
      if (!awaitingApproval) { awaitingApproval = true; if (view === "home") renderHome(); }
      throw new Error("ip_not_allowed");
    }
    if (data.error) throw new Error(data.error);
    return data;
  }
  async function act(body, done) {
    try { const r = await command(body); if (done) done(r); return r; }
    catch (e) {
      if (e.message === "ip_not_allowed") toast(t("waitTitle"));
      else if (e.message !== "unauthorized") toast(e.message || t("offlineLong"));
    }
  }

  // ── state stream (server-sent events over fetch, so the key goes in a header)
  let state = { runs: [], sessions: [] };
  let lastData = 0;
  let controller;
  let backoff = 1000;
  let streaming = false;
  let wanted = false;
  let retry;
  /** Paired, but this computer hasn't allowed this phone yet. */
  let awaitingApproval = false;

  function stopStream() {
    wanted = false;
    clearTimeout(retry);
    controller?.abort();
  }
  async function connect() {
    if (streaming || !token || !wanted) return;
    streaming = true;
    controller = new AbortController();
    try {
      const res = await fetch("/api/events", { headers: { authorization: `Bearer ${token}` }, signal: controller.signal, cache: "no-store" });
      if (res.status === 401) { showConnect("expired"); return; }
      if (res.status === 403) {
        if (!awaitingApproval) { awaitingApproval = true; if (view === "home") renderHome(); }
        throw new Error("403");
      }
      if (!res.ok || !res.body) throw new Error(String(res.status));
      if (awaitingApproval) { awaitingApproval = false; toast(t("paired")); }
      setOnline(true);
      backoff = 1000;
      lastData = Date.now();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        lastData = Date.now();
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          onBlock(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
        }
      }
    } catch {}
    finally {
      streaming = false;
      setOnline(false);
      if (wanted) {
        retry = setTimeout(connect, awaitingApproval ? 3000 : backoff);
        backoff = Math.min(backoff * 2, 10000);
      }
    }
  }
  function onBlock(block) {
    let name = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (name !== "state" || !data.length) return;
    try {
      const next = JSON.parse(data.join("\n"));
      if (next) onState(next);
    } catch {}
  }
  // A stream that went quiet (pings come every 15 s) is dead: start again.
  setInterval(() => { if (streaming && Date.now() - lastData > 40000) controller?.abort(); }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !wanted) return;
    if (streaming && Date.now() - lastData > 20000) controller?.abort();
    else if (!streaming) { backoff = 1000; clearTimeout(retry); connect(); }
    if (view === "chat") loadChat();
  });

  let online = false;
  let offlineSince = Date.now();
  function setOnline(on) {
    if (on !== online) offlineSince = Date.now();
    online = on;
    $("status").classList.toggle("on", on);
    $("statusText").textContent = on ? t("online") : t("offline");
    if (view === "home") renderHome();
  }

  // ── views
  let view = "home";
  let chatId = null;
  let chat = null;
  let chatRev = "";
  let mode = safeGet("mali.remote.mode") === "cowork" ? "cowork" : "chat";
  /** Model picked per mode for new chats, and per chat; "" follows the app. */
  const picked = { chat: safeGet("mali.remote.model.chat") || "", cowork: safeGet("mali.remote.model.cowork") || "" };
  let chatModel = "";
  const models = {};

  function go(next, id) {
    view = next;
    chatId = id ?? null;
    if (next !== "chat") { chat = null; chatRev = ""; }
    $("home").classList.toggle("hidden", next !== "home");
    $("chat").classList.toggle("hidden", next !== "chat");
    $("back").classList.toggle("hidden", next === "home");
    $("logoSmall").classList.toggle("hidden", next !== "home");
    if (next === "home") { $("heading").textContent = "Mali"; renderHome(); }
    if (next === "chat") {
      chatModel = "";
      $("heading").textContent = state.sessions.find((s) => s.id === id)?.title || t("loading");
      $("chat").replaceChildren(h("div", { class: "empty" }, h("div", { class: "spin", style: "margin:0 auto 10px" }), t("loading")));
      loadChat();
    }
    updateDock();
    window.scrollTo(0, 0);
    setHash(next === "chat" ? id : null);
  }
  // The open chat survives a reload; the key stays for "Add to Home Screen".
  function setHash(c) {
    const params = new URLSearchParams(location.hash.slice(1));
    params.set("t", token);
    if (c) params.set("c", c); else params.delete("c");
    history.replaceState(null, "", `#${params}`);
  }
  $("back").addEventListener("click", () => go("home"));

  function onState(next) {
    const before = state;
    state = next;
    const waiting = next.runs.reduce((n, r) => n + r.permissions.length + r.questions.length, 0);
    const waitedBefore = before.runs.reduce((n, r) => n + r.permissions.length + r.questions.length, 0);
    if (waiting > waitedBefore && navigator.vibrate) navigator.vibrate([60, 40, 60]);
    document.title = waiting ? `(${waiting}) Mali` : "Mali";
    if (view === "home") renderHome();
    if (view === "chat") {
      const s = next.sessions.find((x) => x.id === chatId);
      if (s && s.rev !== chatRev) loadChat();
      else updateDock();
    }
  }

  // ── home
  function greeting() {
    const hour = new Date().getHours();
    return hour < 12 ? t("morning") : hour < 17 ? t("afternoon") : t("evening");
  }
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function renderHome() {
    const nodes = [];
    if (!standalone && !safeGet("mali.remote.installHidden")) nodes.push(installBanner());
    nodes.push(h("section", { class: "hello" },
      h("p", {}, greeting()),
      h("h1", {}, t("ask1"), h("span", {}, t("ask2")), t("ask3"))));
    nodes.push(h("div", { class: "actions" },
      actionCard("chat", "chat", t("chat"), t("chatBody"), ""),
      actionCard("cowork", "folder", t("cowork"), t("coworkBody"), "mint")));

    if (awaitingApproval) {
      nodes.splice(standalone || safeGet("mali.remote.installHidden") ? 0 : 1, 0, h("div", { class: "card ask", style: "margin-top:6px" },
        h("div", { class: "ask-top" },
          h("span", { class: "ask-ic" }, icon("shield")),
          h("div", { style: "min-width:0;flex:1" }, h("div", { class: "what" }, t("waitTitle")))),
        h("p", { class: "muted", style: "margin:10px 0 0;font-size:13.5px;line-height:1.55" }, t("waitBody")),
        h("div", { class: "now", style: "margin-top:12px" }, h("span", { class: "spin" }), h("span", { class: "txt" }, t("offline")))));
    } else if (!online && Date.now() - offlineSince > 4000) {
      nodes.push(h("div", { class: "note warn", style: "margin-top:12px" }, icon("alert"), h("span", {}, t("offlineLong"))));
    }

    const asks = state.runs.filter((r) => r.permissions.length || r.questions.length);
    if (asks.length) {
      const n = asks.reduce((c, r) => c + r.permissions.length + r.questions.length, 0);
      nodes.push(section(t("needs"), n));
      for (const run of asks) {
        for (const p of run.permissions) nodes.push(permissionCard(run.chatId, p, run.title));
        for (const q of run.questions) nodes.push(questionCard(run.chatId, q, run.title));
      }
    }
    if (state.runs.length) {
      nodes.push(section(t("working"), state.runs.length));
      for (const run of state.runs) nodes.push(runCard(run));
    }
    const idle = state.sessions.filter((s) => !s.running);
    nodes.push(section(t("recent")));
    nodes.push(idle.length
      ? h("div", { class: "card list" }, idle.map(sessionRow))
      : h("div", { class: "card empty" }, h("div", { class: "art" }, icon("message")), t("noChats")));
    $("home").replaceChildren(...nodes);
  }

  function section(title, count) {
    return h("div", { class: "section" }, h("h2", {}, title), count ? h("span", { class: "count" }, count) : null);
  }

  function actionCard(m, ic, title, body, tone) {
    return h("button", {
      class: `action${mode === m ? " on" : ""}`, type: "button",
      onclick: () => { setMode(m); $("input").focus(); },
    }, h("span", { class: `ic ${tone}` }, icon(ic)), h("span", {}, h("b", {}, title), h("small", {}, body)));
  }

  function installBanner() {
    const how = ios
      ? [t("installIos"), h("span", { class: "inline-ico" }, icon("share")), t("installIos2")]
      : [t("installAndroid")];
    const el = h("div", { class: "banner" },
      h("span", { class: "ico" }, icon("phone")),
      h("div", { style: "flex:1;min-width:0" }, h("b", { style: "display:block;font-weight:650" }, t("install")), h("span", { class: "muted" }, how)),
      h("button", { class: "x", type: "button", "aria-label": "Close", onclick: () => { safeSet("mali.remote.installHidden", "1"); el.remove(); } }, icon("x")));
    return el;
  }

  function runCard(run) {
    const current = run.steps.filter((s) => !s.done).at(-1);
    const done = run.todos.filter((x) => x.done).length;
    return h("div", { class: "card run", onclick: () => go("chat", run.chatId) },
      h("div", { class: "head" },
        h("div", { class: "body" },
          h("div", { class: "ttl" }, run.title || "Mali"),
          h("div", { class: "meta" }, modeLabel(run.mode), " · ", h("span", { "data-since": run.startedAt || "" }, since(run.startedAt)))),
        h("button", { class: "ghost", type: "button", onclick: (e) => { e.stopPropagation(); stop(run.chatId); } }, icon("stop"), t("stop"))),
      h("div", { class: "now" }, h("span", { class: "spin" }), h("span", { class: "txt" }, current ? current.title : t("working1"))),
      workChips(run.stepCount, run.files, run.todos),
      run.todos.length ? h("div", { class: "bar", style: "margin-top:10px" }, h("i", { style: `width:${Math.round((done / run.todos.length) * 100)}%` })) : null);
  }

  /** Steps, files and plan as small counts: the details live in the chat. */
  function workChips(stepCount, files, todos) {
    const chips = [];
    if (stepCount) chips.push(h("span", { class: "mini" }, icon("list"), t("steps", { n: stepCount })));
    if (files?.length) chips.push(h("span", { class: "mini files" }, icon("file"), t("filesN", { n: files.length })));
    if (todos?.length) chips.push(h("span", { class: "mini plan" }, icon("target"), t("planN", { d: todos.filter((x) => x.done).length, n: todos.length })));
    return chips.length ? h("div", { class: "chips-row" }, chips) : null;
  }

  function sessionRow(s) {
    let tag = null;
    if (s.waiting) tag = h("span", { class: "tag wait" }, t("waiting"));
    else if (s.failed) tag = h("span", { class: "tag bad" }, t("failed"));
    const meta = [modeLabel(s.mode), s.folder, s.model].filter(Boolean).join(" · ");
    return h("button", { class: "item", type: "button", onclick: () => go("chat", s.id) },
      h("span", { class: `badge ${s.mode}` }, icon(s.mode === "cowork" ? "folder" : "chat")),
      h("span", { class: "body" },
        h("span", { class: "line1" }, h("span", { class: "ttl" }, s.title), tag || h("span", { class: "when" }, ago(s.updatedAt))),
        s.preview ? h("span", { class: "pv" }, s.preview) : h("span", { class: "meta" }, meta)));
  }

  // ── pieces
  function modeLabel(m) { return m === "cowork" ? "Cowork" : t("chat"); }
  function stepsList(steps, live) {
    if (!steps || !steps.length) return null;
    return h("ul", { class: "steps" }, steps.map((s) => {
      const running = live && !s.done;
      return h("li", { class: running ? "live" : "" },
        running ? h("span", { class: "spin", style: "margin:2px" }) : h("span", { class: `mk ${s.done ? "done" : "dot"}` }, s.done ? icon("check") : null),
        h("span", {}, s.title));
    }));
  }
  function filesBlock(files, limit) {
    if (!files || !files.length) return null;
    const shown = limit ? files.slice(0, limit) : files;
    return h("div", { class: "block" },
      h("div", { class: "block-title" }, icon("file"), t("files", { n: files.length })),
      h("ul", { class: "files" }, shown.map((f) =>
        h("li", {},
          h("span", { class: `k ${f.kind}` }, f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : "M"),
          h("span", { class: "p", title: f.path }, h("bdi", {}, f.path)),
          f.additions || f.deletions
            ? h("span", { class: "n" }, h("span", { class: "plus" }, `+${f.additions || 0}`), " ", h("span", { class: "minus" }, `−${f.deletions || 0}`))
            : null))),
      limit && files.length > limit ? h("div", { class: "more" }, `+${files.length - limit}`) : null);
  }
  function todosBlock(todos) {
    if (!todos || !todos.length) return null;
    const done = todos.filter((x) => x.done).length;
    return h("div", { class: "block" },
      h("div", { class: "block-title" }, icon("target"), t("plan", { d: done, n: todos.length })),
      h("div", { class: "bar" }, h("i", { style: `width:${Math.round((done / todos.length) * 100)}%` })),
      h("ul", { class: "todos" }, todos.map((x) => h("li", { class: x.done ? "done" : x.active ? "active" : "" }, x.text))));
  }

  function permissionCard(chatKey, p, title) {
    const card = h("div", { class: "card ask" },
      h("div", { class: "ask-top" },
        h("span", { class: "ask-ic" }, icon("shield")),
        h("div", { style: "min-width:0;flex:1" },
          h("div", { class: "ask-label" }, t("needsYou")),
          title ? h("div", { class: "from" }, title) : null)),
      h("div", { class: "what", style: "margin-top:10px" }, p.title),
      p.command && p.command !== p.title ? h("pre", { class: "cmd" }, p.command) : null);
    const buttons = [];
    const reply = (r) => () => {
      buttons.forEach((b) => (b.disabled = true));
      act({ kind: "permission", chatId: chatKey, id: p.id, reply: r }, () => card.remove())
        .finally(() => buttons.forEach((b) => (b.disabled = false)));
    };
    buttons.push(
      h("button", { class: "btn no", type: "button", onclick: reply("reject") }, t("deny")),
      h("button", { class: "btn soft", type: "button", onclick: reply("always") }, t("always")),
      h("button", { class: "btn yes", type: "button", onclick: reply("once") }, icon("check"), t("allow")));
    card.append(h("div", { class: "choices" }, buttons));
    return card;
  }

  function questionCard(chatKey, q, title) {
    const picks = q.questions.map(() => new Set());
    const own = q.questions.map(() => "");
    const card = h("div", { class: "card ask" },
      h("div", { class: "ask-top" },
        h("span", { class: "ask-ic" }, icon("message")),
        h("div", { style: "min-width:0;flex:1" },
          h("div", { class: "ask-label" }, t("question")),
          title ? h("div", { class: "from" }, title) : null)));
    q.questions.forEach((item, i) => {
      card.append(h("div", { class: "what", style: "margin-top:10px" }, item.header ? `${item.header}: ${item.question}` : item.question));
      const opts = item.options.map((o) => {
        const input = h("input", { type: item.multiple ? "checkbox" : "radio", name: `${q.id}-${i}` });
        const row = h("label", { class: "opt" }, input, h("span", {}, h("div", { style: "font-weight:600" }, o.label), o.description ? h("div", { class: "muted", style: "font-size:12.5px;color:var(--muted)" }, o.description) : null));
        input.addEventListener("change", () => {
          if (!item.multiple) picks[i].clear();
          if (input.checked) picks[i].add(o.label); else picks[i].delete(o.label);
          opts.forEach((r) => r.classList.toggle("on", r.querySelector("input").checked));
        });
        return row;
      });
      card.append(...opts);
      if (item.custom) {
        const text = h("input", { class: "text", placeholder: t("own") });
        text.addEventListener("input", () => (own[i] = text.value));
        card.append(text);
      }
    });
    const send = (answers) => act({ kind: "answer", chatId: chatKey, id: q.id, answers }, () => card.remove());
    card.append(h("div", { class: "choices", style: "grid-template-columns:1fr 1.6fr" },
      h("button", { class: "btn soft", type: "button", onclick: () => send(q.questions.map(() => [])) }, t("skip")),
      h("button", { class: "btn grad", type: "button", onclick: () => send(picks.map((set, i) => [...set, ...(own[i].trim() ? [own[i].trim()] : [])])) }, t("answer"))));
    return card;
  }


  // ── markdown: answers are built as DOM nodes (never innerHTML), and
  // pictures are shown as links, so nothing loads from outside the network.
  const FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
  const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^\s{0,3}>\s?/;
  const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;
  const startsBlock = (l) => FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || LIST.test(l);

  function markdown(text) {
    const box = h("div", { class: "md" });
    box.append(...blocks(String(text || "").replace(/\r\n?/g, "\n").split("\n"), 0));
    return box;
  }

  function blocks(lines, depth) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m = line.match(FENCE);
      if (m) {
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(m[1])) buf.push(lines[i++]);
        i++;
        out.push(codeBlock(buf.join("\n"), m[2]));
        continue;
      }
      if ((m = line.match(HEADING))) {
        out.push(h(`h${Math.min(m[1].length, 4)}`, {}, inline(m[2])));
        i++;
        continue;
      }
      if (HR.test(line)) { out.push(h("hr")); i++; continue; }
      if (QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) buf.push(lines[i++].replace(QUOTE, ""));
        out.push(h("blockquote", {}, depth < 6 ? blocks(buf, depth + 1) : buf.join("\n")));
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
        const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const head = cells(line);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(h("div", { class: "tablewrap" }, h("table", {},
          h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, inline(c))))),
          h("tbody", {}, rows.map((r) => h("tr", {}, head.map((_, k) => h("td", {}, inline(r[k] ?? "")))))))));
        continue;
      }
      if (LIST.test(line)) {
        const [list, next] = listOf(lines, i, depth);
        out.push(list);
        i = next;
        continue;
      }
      const para = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(lines[i].includes("|") && TABLE_RULE.test(lines[i + 1] || ""))) para.push(lines[i++].trim());
      out.push(h("p", {}, inline(para.join("\n"))));
    }
    return out;
  }

  function listOf(lines, i, depth) {
    const first = lines[i].match(LIST);
    const ordered = /\d/.test(first[2]);
    const base = indentOf(first[1]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const list = h(ordered ? "ol" : "ul", ordered && start !== 1 ? { start } : {});
    while (i < lines.length) {
      const m = lines[i].match(LIST);
      if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
      const inner = [m[3]];
      const pad = base + m[2].length + 1;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          if (i + 1 < lines.length && lines[i + 1].trim() && indentOf(lines[i + 1]) > base) { inner.push(""); i++; continue; }
          break;
        }
        const lm = l.match(LIST);
        if (lm && indentOf(lm[1]) <= base) break;
        if (!lm && indentOf(l) <= base && startsBlock(l)) break;
        inner.push(l.slice(Math.min(indentOf(l), pad)));
        i++;
      }
      let first = inner[0];
      const task = first.match(/^\[([ xX])\]\s+/);
      const li = h("li", task ? { class: "task" } : {});
      if (task) {
        li.append(h("span", { class: `box${task[1].trim() ? " on" : ""}` }, task[1].trim() ? icon("check") : null));
        inner[0] = first.slice(task[0].length);
      }
      const body = depth < 6 ? blocks(inner, depth + 1) : [inner.join("\n")];
      // A one-line item is just its text, not a paragraph.
      if (body.length === 1 && body[0].tagName === "P") li.append(...body[0].childNodes);
      else li.append(...body);
      list.append(li);
    }
    return [list, i];
  }

  const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])|(\*\*|__)(?=\S)([\s\S]*?\S)\8|\*(?=[^\s*])([\s\S]*?[^\s*])\*|_(?=\S)([\s\S]*?\S)_(?!\w)|~~(?=\S)([\s\S]*?\S)~~|\n/g;

  function inline(src, depth = 0) {
    const out = [];
    const re = new RegExp(INLINE.source, "g");
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
      // An underscore inside a word (snake_case) is not emphasis.
      if (m[11] !== undefined && m.index > 0 && /\w/.test(src[m.index - 1])) continue;
      if (m.index > last) out.push(src.slice(last, m.index));
      const deeper = (s) => (depth < 6 ? inline(s, depth + 1) : [s]);
      if (m[1]) out.push(h("code", {}, m[2]));
      else if (m[4] !== undefined) out.push(linkTo(m[4], [icon("image"), m[3] || t("image")], "img-link"));
      else if (m[5]) out.push(linkTo(m[6], deeper(m[5])));
      else if (m[7]) out.push(linkTo(m[7], [m[7]]));
      else if (m[8]) out.push(h("strong", {}, deeper(m[9])));
      else if (m[10] !== undefined) out.push(h("em", {}, deeper(m[10])));
      else if (m[11] !== undefined) out.push(h("em", {}, deeper(m[11])));
      else if (m[12]) out.push(h("del", {}, deeper(m[12])));
      else out.push(h("br"));
      last = re.lastIndex;
    }
    if (last < src.length) out.push(src.slice(last));
    return out;
  }

  /** Web links open in a new tab; anything else (javascript:, file:) stays text. */
  function linkTo(url, children, cls) {
    let safe = null;
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") safe = u.href;
    } catch {}
    return safe
      ? h("a", { href: safe, target: "_blank", rel: "noopener noreferrer nofollow", class: cls || null }, children)
      : h("span", {}, children);
  }

  function codeBlock(code, lang) {
    return h("div", { class: "codeblock" },
      h("div", { class: "code-head" }, h("span", {}, lang || "code"), copyButton(() => code)),
      h("pre", {}, h("code", {}, code)));
  }

  function copyButton(text) {
    return h("button", {
      class: "icon-btn", type: "button", "aria-label": t("copy"),
      onclick: async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text()); toast(t("copied")); }
        catch { toast(t("copyFail")); }
      },
    }, icon("copy"));
  }

  // ── chat view
  let loading = false;
  let again = false;
  async function loadChat() {
    if (!chatId) return;
    if (loading) { again = true; return; }
    loading = true;
    const id = chatId;
    try {
      const { chat: next } = await command({ kind: "chat", chatId: id });
      if (chatId !== id) return;
      const stick = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120 || !chat;
      chat = next;
      chatRev = state.sessions.find((s) => s.id === id)?.rev ?? chatRev;
      renderChat();
      updateDock();
      if (stick) requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    } catch (e) {
      if (e.message !== "unauthorized" && view === "chat" && !chat) $("chat").replaceChildren(h("div", { class: "card empty" }, e.message));
    } finally {
      loading = false;
      if (again) { again = false; loadChat(); }
    }
  }

  function renderChat() {
    if (!chat) return;
    $("heading").textContent = chat.title;
    const nodes = [h("div", { class: "chat-meta" }, h("span", {}, modeLabel(chat.mode)), chat.folder ? h("span", {}, t("inFolder", { f: chat.folder })) : null)];
    nodes.push(...chat.messages.map(messageNode));
    for (const p of chat.permissions) nodes.push(permissionCard(chat.id, p));
    for (const q of chat.questions) nodes.push(questionCard(chat.id, q));
    $("chat").replaceChildren(...nodes);
  }

  /** Which "what it did" panels are open, so a refresh doesn't fold them again. */
  const opened = new Set();

  function messageNode(m) {
    if (m.role === "user") return h("div", { class: "msg user" }, h("div", { class: "bubble" }, m.text));
    if (m.role === "error") return h("div", { class: "msg" }, h("div", { class: "card err" }, icon("alert"), h("span", {}, m.text)));
    const live = !!m.writing;
    const parts = [h("div", { class: "reply-head" },
      h("img", { src: "/icon-180.png", alt: "" }),
      h("b", {}, "Mali"),
      h("span", { class: "grow" }, [m.model, !live && m.durationMs ? duration(m.durationMs) : ""].filter(Boolean).join(" · ")),
      !live && m.text ? copyButton(() => m.text) : null)];
    if (live) {
      const current = (m.steps || []).filter((s) => !s.done).at(-1);
      parts.push(h("div", { class: "now", style: "margin-top:0" }, h("span", { class: "spin" }), h("span", { class: "txt" }, current ? current.title : m.stepCount ? t("working1") : t("writing"))));
    }
    if (!live && m.text) parts.push(markdown(m.text));
    if (!live && m.clipped) parts.push(h("div", { class: "more" }, t("clipped")));
    const hasWork = m.stepCount || m.files?.length || m.todos?.length;
    if (hasWork) {
      const summary = [
        m.stepCount ? t("steps", { n: m.stepCount }) : "",
        m.files?.length ? t("filesN", { n: m.files.length }) : "",
      ].filter(Boolean).join(" · ");
      const box = h("details", { class: "work", style: "margin-top:10px", open: opened.has(m.id) },
        h("summary", {}, icon("list"), summary || t("work"), h("span", { class: "chev" }, icon("down"))),
        stepsList(m.steps, live),
        todosBlock(m.todos),
        filesBlock(m.files, 0));
      box.addEventListener("toggle", () => (box.open ? opened.add(m.id) : opened.delete(m.id)));
      parts.push(box);
    }
    return h("div", { class: "msg" }, h("div", { class: `card reply${live ? " live" : ""}` }, parts));
  }

  // ── dock
  const input = $("input");
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  $("mic").classList.toggle("hidden", !Speech);

  function setMode(m) {
    mode = m;
    safeSet("mali.remote.mode", m);
    if (view === "home") renderHome();
    updateDock();
  }
  function running() {
    return view === "chat" && !!(chat?.running || state.runs.some((r) => r.chatId === chatId));
  }
  function currentModelId() {
    return view === "chat" ? chatModel : picked[mode];
  }
  function ctxLabel() {
    const m = view === "chat" ? chat?.mode || "chat" : mode;
    const list = models[m]?.models || [];
    const id = currentModelId() || (view === "chat" ? chat?.modelId : models[m]?.selected) || "";
    const name = list.find((x) => x.id === id)?.name;
    return [modeLabel(m), name].filter(Boolean).join(" · ");
  }
  function updateDock() {
    const m = view === "chat" ? chat?.mode || "chat" : mode;
    input.placeholder = view === "chat" ? t("placeholderChat") : m === "cowork" ? t("placeholderCowork") : t("placeholder");
    $("ctxText").textContent = ctxLabel();
    $("ctxMode").className = `dot-mode ${m}`;
    $("ctxMode").replaceChildren(icon(m === "cowork" ? "folder" : "chat"));
    const orb = $("orb");
    const busy = running();
    const typed = !!input.value.trim();
    orb.classList.toggle("stop", busy && !typed);
    orb.replaceChildren(icon(busy && !typed ? "stop" : typed ? "up" : "wave"));
    orb.setAttribute("aria-label", busy && !typed ? t("stop") : "Send");
    if (!models[m]) loadModels(m);
  }
  const modelLoads = {};
  function loadModels(m) {
    modelLoads[m] ??= command({ kind: "models", mode: m })
      .then((data) => { models[m] = data; updateDock(); return data; })
      .catch(() => { delete modelLoads[m]; return null; });
    return modelLoads[m];
  }

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    updateDock();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(hover: hover)").matches) { e.preventDefault(); send(); }
  });
  $("orb").addEventListener("click", () => {
    if (input.value.trim()) return send();
    if (running()) return stop(chatId);
    if (Speech) return dictate();
    input.focus();
  });
  $("mic").addEventListener("click", dictate);
  $("plus").addEventListener("click", openOptions);
  $("ctx").addEventListener("click", openOptions);
  $("menuBtn").addEventListener("click", openMenu);

  let listening = null;
  function dictate() {
    if (!Speech) { toast(t("noSpeech")); return; }
    if (listening) { listening.stop(); return; }
    const rec = new Speech();
    rec.lang = th ? "th-TH" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    const before = input.value ? `${input.value.trimEnd()} ` : "";
    rec.onresult = (e) => {
      let said = "";
      for (const r of e.results) said += r[0].transcript;
      input.value = before + said;
      input.dispatchEvent(new Event("input"));
    };
    rec.onerror = () => toast(t("noSpeech"));
    rec.onend = () => { listening = null; $("mic").classList.remove("listening"); };
    listening = rec;
    $("mic").classList.add("listening");
    try { rec.start(); } catch { listening = null; $("mic").classList.remove("listening"); toast(t("noSpeech")); }
  }

  async function send() {
    const prompt = input.value.trim();
    if (!prompt) return;
    $("orb").disabled = true;
    const modelId = currentModelId() || undefined;
    const body = view === "chat" ? { kind: "send", chatId, prompt, modelId } : { kind: "send", mode, prompt, modelId };
    const result = await act(body);
    $("orb").disabled = false;
    if (!result) return;
    input.value = "";
    input.style.height = "auto";
    if (view === "home") go("chat", result.chatId);
    else loadChat();
    updateDock();
  }

  function stop(id) {
    if (!id) return;
    toast(t("stopping"));
    act({ kind: "stop", chatId: id });
  }

  // ── sheets
  function openSheet(...content) {
    setSheetOpen(true);
    if (!content.some((el) => el?.classList?.contains("sheet-head"))) $("sheet").classList.remove("tall");
    $("sheetBody").replaceChildren(...content);
    $("scrim").classList.remove("hidden");
    requestAnimationFrame(() => { $("scrim").classList.add("open"); $("sheet").classList.add("open"); });
  }
  function closeSheet() {
    setSheetOpen(false);
    $("scrim").classList.remove("open");
    $("sheet").classList.remove("open");
    setTimeout(() => $("scrim").classList.add("hidden"), 220);
  }
  $("scrim").addEventListener("click", closeSheet);

  /** A provider's colour, the same every time. */
  function hueOf(text) {
    let n = 0;
    for (const c of String(text)) n = (n * 31 + c.charCodeAt(0)) % 360;
    return n;
  }
  function initials(text) {
    const words = String(text).replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
    return ((words[0]?.[0] || "?") + (words[1]?.[0] || "")).toUpperCase();
  }

  async function openOptions() {
    const m = view === "chat" ? chat?.mode || "chat" : mode;
    $("sheet").classList.add("tall");
    const listBox = h("div", { class: "scroll" }, h("div", { class: "empty" }, h("div", { class: "spin", style: "margin:0 auto" })));
    const search = h("input", { class: "field", type: "search", placeholder: t("search"), autocomplete: "off", enterkeyhint: "search" });
    const chips = h("div", { class: "chips" });
    const content = [h("div", { class: "sheet-head" },
      h("h3", {}, t("chooseModel")),
      h("button", { class: "x", type: "button", "aria-label": "Close", onclick: closeSheet }, icon("x")))];
    if (view !== "chat") {
      content.push(h("div", { class: "seg" },
        h("button", { class: mode === "chat" ? "on" : "", type: "button", onclick: () => { setMode("chat"); openOptions(); } }, icon("chat"), t("chat")),
        h("button", { class: mode === "cowork" ? "on" : "", type: "button", onclick: () => { setMode("cowork"); openOptions(); } }, icon("folder"), "Cowork")));
      if (mode === "cowork") content.push(h("p", { class: "hint-note", style: "margin:-2px 4px 10px" }, t("coworkNote")));
    }
    content.push(h("div", { class: "searchbox" }, icon("search"), search), chips, listBox);
    openSheet(...content);
    const data = models[m] || (await loadModels(m));
    if (!data) { listBox.replaceChildren(h("div", { class: "empty" }, t("offlineLong"))); return; }
    const current = currentModelId();
    const choose = (id) => () => {
      if (view === "chat") chatModel = id;
      else { picked[mode] = id; safeSet(`mali.remote.model.${mode}`, id || null); }
      updateDock();
      closeSheet();
    };
    const appDefault = view === "chat" ? chat?.modelId : data.selected;
    const defaultName = data.models.find((x) => x.id === appDefault)?.name;
    // CLI agents first: they run on the computer's own sign-in.
    const ordered = [...data.models].sort((a, b) => Number(b.source === "cli") - Number(a.source === "cli"));
    const groups = [...new Set(ordered.map((x) => x.group))];
    let only = "";
    const drawChips = () => chips.replaceChildren(
      ...["", ...groups].map((g) => h("button", { class: `chip${only === g ? " on" : ""}`, type: "button", onclick: () => { only = g; drawChips(); draw(); } }, g || t("all"))));
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const rows = [];
      if (!q && !only) rows.push(modelRow({ name: t("defaultModel"), sub: defaultName, on: !current, onclick: choose(""), avatar: icon("sparkle"), hue: 258 }));
      let group = null;
      for (const x of ordered) {
        if (only && x.group !== only) continue;
        if (q && !`${x.name} ${x.group}`.toLowerCase().includes(q)) continue;
        if (x.group !== group && !only) { group = x.group; rows.push(h("div", { class: "group" }, group)); }
        const badges = [];
        if (x.source === "cli") badges.push(h("span", { class: "badge-sm cli" }, t("cliTag")));
        if (x.free) badges.push(h("span", { class: "badge-sm free" }, t("freeTag")));
        const hint = x.note === "key" ? t("needsKey") : x.note === "issue" ? t("notHere") : x.note === "login" ? t("needsLogin") : "";
        if (hint) badges.push(h("span", { class: "badge-sm warn" }, hint));
        rows.push(modelRow({
          name: x.name, badges, on: current === x.id, disabled: x.disabled,
          onclick: x.disabled ? () => toast(hint || t("needsKey")) : choose(x.id),
          avatar: x.source === "cli" ? icon("terminal") : initials(x.group), hue: hueOf(x.group),
        }));
      }
      if (rows.length === 0) rows.push(h("div", { class: "empty" }, t("noMatch")));
      listBox.replaceChildren(...rows);
    };
    search.addEventListener("input", draw);
    drawChips();
    draw();
  }
  function modelRow({ name, sub, badges = [], on, onclick, disabled, avatar, hue }) {
    return h("button", { class: `mrow${on ? " on" : ""}${disabled ? " disabled" : ""}`, type: "button", onclick },
      h("span", { class: "av", style: `--h:${hue}` }, avatar),
      h("span", { class: "lab" },
        h("span", { class: "nm" }, name),
        sub || badges.length ? h("span", { class: "sub" }, badges, sub ? h("span", {}, sub) : null) : null),
      on ? h("span", { class: "chk" }, icon("check")) : null);
  }

  function openMenu() {
    const rows = [
      menuRow("scan", t("rescan"), t("rescanBody"), () => { closeSheet(); showConnect("rescan"); }),
    ];
    if (!standalone) rows.push(menuRow("phone", t("install"), ios ? `${t("installIos").trim()} → ${t("install")}` : t("installAndroid"), () => {
      closeSheet(); safeSet("mali.remote.installHidden", null); if (view === "home") renderHome(); window.scrollTo(0, 0);
    }));
    rows.push(h("div", { class: "row-btn" },
      h("span", { class: "ico" }, icon("globe")),
      h("span", { class: "lab" }, t("language"), h("small", {}, t("languageBody"))),
      h("div", { class: "seg" },
        h("button", { class: th ? "on" : "", type: "button", onclick: () => { setLang(true); openMenu(); } }, "ไทย"),
        h("button", { class: th ? "" : "on", type: "button", onclick: () => { setLang(false); openMenu(); } }, "EN"))));
    rows.push(menuRow("unlink", t("unpair"), t("unpairBody"), () => {
      closeSheet(); token = ""; safeSet(TOKEN_KEY, null); history.replaceState(null, "", "#"); showConnect();
    }, true));
    openSheet(h("h3", {}, t("menu")), ...rows);
  }
  function menuRow(ic, title, sub, onclick, danger) {
    return h("button", { class: `row-btn${danger ? " danger" : ""}`, type: "button", onclick },
      h("span", { class: "ico" }, icon(ic)), h("span", { class: "lab" }, title, h("small", {}, sub)));
  }

  // ── time
  function since(at) { return at ? duration(Date.now() - at) : ""; }
  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function ago(at) {
    const rtf = new Intl.RelativeTimeFormat(th ? "th" : "en", { numeric: "auto", style: "short" });
    const s = Math.round((Date.now() - at) / 1000);
    if (s < 60) return rtf.format(-s, "second");
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
    return rtf.format(-Math.round(s / 86400), "day");
  }
  addEventListener("scroll", () => document.querySelector(".top").classList.toggle("scrolled", scrollY > 4), { passive: true });
  setInterval(() => document.querySelectorAll("[data-since]").forEach((el) => {
    const at = Number(el.dataset.since);
    if (at) el.textContent = since(at);
  }), 1000);

  function setLang(isThai) {
    th = isThai;
    safeSet(LANG_KEY, isThai ? "th" : "en");
    applyStatic();
    $("statusText").textContent = online ? t("online") : t("offline");
    if (view === "home") renderHome();
    else renderChat();
    updateDock();
  }
  document.querySelectorAll("[data-lang]").forEach((el) => el.addEventListener("click", () => setLang(el.dataset.lang === "th")));

  // ── start
  function start() {
    if (!token) { showConnect(); return; }
    showApp();
    setOnline(false);
    const opened = new URLSearchParams(location.hash.slice(1)).get("c");
    go(opened ? "chat" : "home", opened || undefined);
    stopStream();
    wanted = true;
    backoff = 1000;
    const begin = () => (streaming ? setTimeout(begin, 50) : connect());
    begin();
  }
  start();
}
