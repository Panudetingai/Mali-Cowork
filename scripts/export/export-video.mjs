#!/usr/bin/env node
/**
 * Deterministic frame-by-frame video exporter for code-driven animations
 * (Three.js / WebGL / GSAP / CSS / DOM).
 *
 * Instead of screen-recording, the page's clock is frozen and stepped exactly
 * 1/fps seconds per frame; each frame is captured from headless Chrome and
 * piped straight into FFmpeg, so the output has a perfectly even frame rate.
 *
 * No npm dependencies: talks to Chrome over the DevTools Protocol using
 * Node's built-in WebSocket (Node >= 22). Needs `ffmpeg` on PATH and a
 * Chromium-based browser (auto-detected, or pass --chrome / CHROME_PATH).
 *
 * Usage:  node scripts/export/export-video.mjs <page.html | dir | http-url> [options]
 * Run with --help for all options, or see scripts/export/README.md.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const RESOLUTIONS = {
  '360p': [640, 360],
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '2k': [2560, 1440],
  '4k': [3840, 2160],
  '2160p': [3840, 2160],
  // vertical (Reels / TikTok / Shorts) and square
  '720p-v': [720, 1280],
  '1080p-v': [1080, 1920],
  '4k-v': [2160, 3840],
  square: [1080, 1080],
};

const CODECS = {
  h264: { ext: 'mp4', alpha: false },
  h265: { ext: 'mp4', alpha: false },
  prores: { ext: 'mov', alpha: true },
  vp9: { ext: 'webm', alpha: true },
  gif: { ext: 'gif', alpha: false },
  frames: { ext: '', alpha: true }, // PNG sequence only, no encoding
};

const QUALITIES = ['low', 'medium', 'high', 'lossless'];

const HELP = `
Export a code-driven animation to video, frame by frame.

Usage
  node scripts/export/export-video.mjs <input> [options]

  <input>  local .html file, a folder containing index.html, or an http(s) URL
           (local files are served over a temporary http server so ES modules work)

What to export
  -t, --target <name>      object / character to export (from the page's __EXPORT__.list())
  -a, --action <name>      action / scene to export; "all" exports every action of the target
      --list               print the available targets and actions, then exit
  -d, --duration <sec>     length in seconds (default: duration reported by the page)
      --start <sec>        start time offset in seconds (default 0)

Quality
  -r, --resolution <res>   ${Object.keys(RESOLUTIONS).join(', ')} or WxH  (default 1080p)
      --viewport <WxH>     CSS layout size of the page; output is rendered at a
                           device-pixel-ratio so it fills --resolution
                           (default: resolution scaled so its short side is 1080)
  -f, --fps <n>            frames per second (default 30)
  -q, --quality <q>        ${QUALITIES.join(', ')}  (default high)
      --crf <n>            explicit CRF, overrides --quality
  -c, --codec <c>          ${Object.keys(CODECS).join(', ')}  (default h264)
      --transparent        transparent background (use with prores, vp9 or frames)
      --frame-format <f>   png | jpeg capture format (default png; jpeg is faster)

Output
  -o, --output <file>      output file (single export only)
      --out-dir <dir>      output folder (default ./exports)
      --audio <file>       mux an audio track (.wav/.mp3), trimmed to the video length
      --keep-frames        also keep the PNG/JPEG frames next to the video

Runtime
      --chrome <path>      browser executable (or env CHROME_PATH)
      --ready-timeout <s>  how long to wait for window.__EXPORT__ (default 10)
      --wait <ms>          extra settle time after load before frame 0 (default 200)
      --headful            show the browser window (debugging)
  -y, --yes                never prompt; use defaults for anything not given
  -h, --help               show this help

Examples
  node scripts/export/export-video.mjs scripts/export/example --list
  node scripts/export/export-video.mjs scripts/export/example -t robot -a wave -r 4k -f 60
  node scripts/export/export-video.mjs scripts/export/example -t robot -a all -r 720p -f 30 -q medium
  node scripts/export/export-video.mjs http://localhost:5173/intro.html -d 12 -c prores --transparent
`;

function parseCli() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: 'string', short: 't' },
      action: { type: 'string', short: 'a' },
      list: { type: 'boolean' },
      duration: { type: 'string', short: 'd' },
      start: { type: 'string' },
      resolution: { type: 'string', short: 'r' },
      viewport: { type: 'string' },
      fps: { type: 'string', short: 'f' },
      quality: { type: 'string', short: 'q' },
      crf: { type: 'string' },
      codec: { type: 'string', short: 'c' },
      transparent: { type: 'boolean' },
      'frame-format': { type: 'string' },
      output: { type: 'string', short: 'o' },
      'out-dir': { type: 'string' },
      audio: { type: 'string' },
      'keep-frames': { type: 'boolean' },
      chrome: { type: 'string' },
      'ready-timeout': { type: 'string' },
      wait: { type: 'string' },
      headful: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  return { input: positionals[0], ...values };
}

function parseSize(str, label) {
  const preset = RESOLUTIONS[str.toLowerCase()];
  if (preset) return [...preset];
  const m = /^(\d+)\s*[x×:]\s*(\d+)$/i.exec(str.trim());
  if (!m) fail(`Invalid ${label} "${str}". Use a preset (${Object.keys(RESOLUTIONS).join(', ')}) or WxH.`);
  return [Number(m[1]), Number(m[2])];
}

function positiveNumber(str, label) {
  const n = Number(str);
  if (!Number.isFinite(n) || n <= 0) fail(`${label} must be a positive number, got "${str}"`);
  return n;
}

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Interactive prompts (only for options not given on the command line)
// ---------------------------------------------------------------------------

const interactive = () => process.stdin.isTTY && process.stdout.isTTY;
let rl;

async function choose(question, choices, fallback) {
  if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n${question}`);
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.label}${c.value === fallback ? '  (default)' : ''}`));
  for (;;) {
    const answer = (await rl.question('> ')).trim();
    if (!answer && fallback !== undefined) return fallback;
    const byIndex = choices[Number(answer) - 1];
    if (byIndex) return byIndex.value;
    const byValue = choices.find((c) => String(c.value).toLowerCase() === answer.toLowerCase());
    if (byValue) return byValue.value;
    if (choices.allowCustom && answer) return answer;
    console.log('  Pick a number from the list.');
  }
}

// ---------------------------------------------------------------------------
// Browser discovery + minimal CDP client
// ---------------------------------------------------------------------------

function findChrome(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);

  // Puppeteer's headless shell is the best fit, so prefer it when present.
  const newest = (dir) => {
    try {
      return readdirSync(dir).sort().reverse().map((v) => join(dir, v));
    } catch {
      return [];
    }
  };
  const cache = join(homedir(), '.cache', 'puppeteer');
  for (const v of newest(join(cache, 'chrome-headless-shell'))) {
    for (const sub of newest(v)) candidates.push(join(sub, 'chrome-headless-shell'));
  }
  if (process.platform === 'darwin') {
    for (const root of ['/Applications', join(homedir(), 'Applications')]) {
      candidates.push(
        `${root}/Google Chrome.app/Contents/MacOS/Google Chrome`,
        `${root}/Chromium.app/Contents/MacOS/Chromium`,
        `${root}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
        `${root}/Brave Browser.app/Contents/MacOS/Brave Browser`,
      );
    }
  } else if (process.platform === 'win32') {
    const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const p of pf) {
      candidates.push(`${p}\\Google\\Chrome\\Application\\chrome.exe`, `${p}\\Microsoft\\Edge\\Application\\msedge.exe`);
    }
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium');
  }
  for (const v of newest(join(cache, 'chrome'))) {
    for (const sub of newest(v)) {
      candidates.push(
        join(sub, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        join(sub, 'chrome'),
        join(sub, 'chrome.exe'),
      );
    }
  }
  return candidates.find((p) => existsSync(p));
}

async function launchChrome(executable, { headful }) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'mali-export-chrome-'));
  const isShell = basename(executable).startsWith('chrome-headless-shell');
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-extensions',
    '--enable-unsafe-swiftshader', // WebGL fallback when no GPU is available
    '--ignore-gpu-blocklist',
    'about:blank',
  ];
  if (!headful && !isShell) args.unshift('--headless=new');
  const proc = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const timer = setTimeout(() => rej(new Error(`Browser did not start:\n${buf}`)), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        res(m[1]);
      }
    });
    proc.on('exit', (code) => rej(new Error(`Browser exited (${code}):\n${buf}`)));
  });

  const cdp = await CDP.connect(wsUrl);
  const close = () => {
    try {
      cdp.ws.close();
    } catch {}
    proc.kill('SIGKILL');
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  };
  return { cdp, close };
}

class CDP {
  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.onopen = () => res(new CDP(ws));
      ws.onerror = () => rej(new Error(`Cannot connect to ${url}`));
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.rej(new Error(`${p.method}: ${msg.error.message}`)) : p.res(msg.result);
      } else {
        for (const l of this.listeners) l(msg);
      }
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.rej(new Error('Browser connection closed'));
      this.pending.clear();
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej, method }));
  }

  once(method, sessionId, timeoutMs = 30000) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.listeners.delete(l);
        rej(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const l = (msg) => {
        if (msg.method === method && msg.sessionId === sessionId) {
          clearTimeout(timer);
          this.listeners.delete(l);
          res(msg.params);
        }
      };
      this.listeners.add(l);
    });
  }

  on(fn) {
    this.listeners.add(fn);
  }
}

class Page {
  static async open(cdp) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    return new Page(cdp, sessionId);
  }

  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text);
    }
    return r.result.value;
  }
}

// ---------------------------------------------------------------------------
// Virtual clock, injected before any page script runs.
// Freezes performance.now / Date.now / requestAnimationFrame / CSS & Web
// Animations so time only moves when the exporter says so.
// ---------------------------------------------------------------------------

const VIRTUAL_CLOCK = String.raw`(() => {
  if (window.__VCLOCK__) return;
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const epoch = Date.now();
  const NativeDate = Date;
  let now = 0;
  let nextId = 0;
  let callbacks = new Map();

  performance.now = () => now;
  const VDate = function (...args) {
    if (!new.target) return new NativeDate(epoch + now).toString();
    return args.length ? new NativeDate(...args) : new NativeDate(epoch + now);
  };
  VDate.prototype = NativeDate.prototype;
  VDate.now = () => epoch + now;
  VDate.parse = NativeDate.parse;
  VDate.UTC = NativeDate.UTC;
  window.Date = VDate;

  window.requestAnimationFrame = (cb) => { const id = ++nextId; callbacks.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { callbacks.delete(id); };

  const born = new WeakMap();
  function syncAnimations() {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (!born.has(a)) { born.set(a, now); a.pause(); }
      a.currentTime = now - born.get(a);
    }
  }

  window.__VCLOCK__ = {
    get time() { return now; },
    nativeRAF,
    advanceTo(ms) {
      now = ms;
      syncAnimations();
      const run = callbacks;
      callbacks = new Map();
      for (const cb of run.values()) {
        try { cb(now); } catch (e) { console.error(e); }
      }
    },
  };
})();`;

// ---------------------------------------------------------------------------
// Static server for local inputs (so ES module imports work)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glsl': 'text/plain',
  '.frag': 'text/plain',
  '.vert': 'text/plain',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

async function resolveInput(input) {
  if (/^https?:\/\//i.test(input)) return { url: input, name: new URL(input).pathname.split('/').filter(Boolean).pop()?.replace(/\.html?$/, '') || 'export', close() {} };

  let file = resolve(input);
  if (!existsSync(file)) fail(`Input not found: ${input}`);
  if (statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) fail(`No index.html in ${input}`);

  const root = dirname(file);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let target = resolve(root, '.' + path);
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(target).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const name = basename(file) === 'index.html' ? basename(root) : basename(file, extname(file));
  return { url: `http://127.0.0.1:${port}/${encodeURIComponent(basename(file))}`, name, close: () => server.close() };
}

// ---------------------------------------------------------------------------
// FFmpeg
// ---------------------------------------------------------------------------

function crfFor(codec, quality) {
  const table = {
    h264: { low: 28, medium: 23, high: 18, lossless: 0 },
    h265: { low: 30, medium: 26, high: 21, lossless: 0 },
    vp9: { low: 40, medium: 33, high: 24, lossless: 0 },
  };
  return table[codec]?.[quality];
}

function ffmpegArgs({ codec, quality, crf, fps, width, height, transparent, frameFormat, audio, duration, output }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', frameFormat === 'jpeg' ? 'mjpeg' : 'png', '-i', '-'];
  if (audio) args.push('-i', audio);

  const scale = `scale=${width}:${height}:flags=lanczos`;
  const lossless = quality === 'lossless' && crf === undefined;
  const q = String(crf ?? crfFor(codec, quality));

  switch (codec) {
    case 'h264':
      args.push('-vf', scale, '-c:v', 'libx264', '-preset', quality === 'low' ? 'veryfast' : 'slow', '-crf', q);
      args.push('-pix_fmt', lossless ? 'yuv444p' : 'yuv420p', '-movflags', '+faststart');
      break;
    case 'h265':
      args.push('-vf', scale, '-c:v', 'libx265', '-preset', quality === 'low' ? 'fast' : 'slow', '-tag:v', 'hvc1');
      args.push(...(lossless ? ['-x265-params', 'lossless=1:log-level=error', '-pix_fmt', 'yuv444p'] : ['-crf', q, '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p']));
      args.push('-movflags', '+faststart');
      break;
    case 'vp9':
      args.push('-vf', scale, '-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', quality === 'low' ? 'realtime' : 'good');
      args.push(...(lossless ? ['-lossless', '1'] : ['-crf', q, '-b:v', '0']));
      args.push('-pix_fmt', transparent ? 'yuva420p' : 'yuv420p');
      break;
    case 'prores': {
      // 4444 keeps alpha; HQ otherwise. ProRes has no CRF — quality maps to the profile.
      const profile = transparent ? '4' : { low: '0', medium: '2', high: '3', lossless: '4' }[quality];
      args.push('-vf', scale, '-c:v', 'prores_ks', '-profile:v', profile, '-vendor', 'apl0');
      args.push('-pix_fmt', profile === '4' ? 'yuva444p10le' : 'yuv422p10le');
      break;
    }
    case 'gif': {
      const colors = { low: 64, medium: 128, high: 256, lossless: 256 }[quality];
      args.push('-filter_complex', `${scale},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0');
      break;
    }
  }
  if (audio && codec !== 'gif') {
    args.push('-map', '0:v', '-map', '1:a', '-c:a', codec === 'vp9' ? 'libopus' : codec === 'prores' ? 'pcm_s16le' : 'aac', '-b:a', '192k', '-t', duration.toFixed(3));
  }
  args.push(output);
  return args;
}

function startFfmpeg(args) {
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((res, rej) => {
    proc.on('error', (e) => rej(e.code === 'ENOENT' ? new Error('ffmpeg not found on PATH (brew install ffmpeg)') : e));
    proc.on('exit', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited with ${code}\n${stderr}`))));
  });
  const write = (buf) =>
    new Promise((res, rej) => {
      if (!proc.stdin.write(buf, (e) => e && rej(e))) proc.stdin.once('drain', res);
      else res();
    });
  return { write, finish: () => (proc.stdin.end(), done), kill: () => proc.kill('SIGKILL'), done };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function loadPage(browser, url, { viewport, dpr, transparent, target, action, readyTimeout, wait }) {
  const page = await Page.open(browser);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  browser.on((msg) => {
    if (msg.sessionId !== page.sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') console.error('  [page error]', msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') console.error('  [page console]', msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await page.send('Emulation.setDeviceMetricsOverride', { width: viewport[0], height: viewport[1], deviceScaleFactor: dpr, mobile: false });
  if (transparent) await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: VIRTUAL_CLOCK });

  const u = new URL(url);
  u.searchParams.set('export', '1');
  if (target) u.searchParams.set('target', target);
  if (action) u.searchParams.set('action', action);
  const loaded = browser.once('Page.loadEventFired', page.sessionId, 60000);
  const nav = await page.send('Page.navigate', { url: u.toString() });
  if (nav.errorText) throw new Error(`Cannot open ${url}: ${nav.errorText}`);
  await loaded;
  await page.eval('document.fonts ? document.fonts.ready.then(() => true) : true');

  // Poll with real timers: the page's Date/performance clocks are frozen.
  const hasProtocol = await page.eval(`new Promise((res) => {
    let waited = 0;
    (function check() {
      if (window.__EXPORT__ && typeof window.__EXPORT__.seek === 'function') return res(true);
      if ((waited += 50) > ${readyTimeout * 1000}) return res(false);
      setTimeout(check, 50);
    })();
  })`);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return { page, hasProtocol };
}

async function listActions(page) {
  const list = await page.eval('window.__EXPORT__.list ? window.__EXPORT__.list() : null');
  // Normalise to { target: { action: durationSeconds | null } }
  if (!list) return {};
  if (Array.isArray(list)) {
    const out = {};
    for (const item of list) (out[item.target ?? 'default'] ??= {})[item.action] = item.duration ?? null;
    return out;
  }
  return list;
}

async function renderOne(browser, url, job) {
  const { page, hasProtocol } = await loadPage(browser, url, job);
  let duration = job.duration;

  if (hasProtocol) {
    const reported = await page.eval(
      `Promise.resolve(window.__EXPORT__.prepare ? window.__EXPORT__.prepare(${JSON.stringify({
        target: job.target ?? null,
        action: job.action ?? null,
        width: job.width,
        height: job.height,
        fps: job.fps,
      })}) : undefined)`,
    );
    if (duration === undefined && typeof reported === 'number') duration = reported;
    if (duration === undefined && typeof reported?.duration === 'number') duration = reported.duration;
  }
  if (duration === undefined) {
    throw new Error(
      hasProtocol ? 'The page did not report a duration from __EXPORT__.prepare(); pass --duration.' : 'This page has no window.__EXPORT__ bridge, so pass --duration <sec> (time will be driven by the virtual clock).',
    );
  }

  const totalFrames = Math.max(1, Math.round(duration * job.fps));
  const ext = CODECS[job.codec].ext;
  mkdirSync(dirname(job.output), { recursive: true });
  const framesDir = job.codec === 'frames' ? job.output : job.keepFrames ? job.output.replace(/\.[^.]+$/, '') + '_frames' : null;
  if (framesDir) mkdirSync(framesDir, { recursive: true });

  const ff = job.codec === 'frames' ? null : startFfmpeg(ffmpegArgs({ ...job, duration: totalFrames / job.fps }));
  const shot = { format: job.frameFormat, optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true };
  if (job.frameFormat === 'jpeg') shot.quality = 95;

  const t0 = Date.now();
  try {
    for (let i = 0; i < totalFrames; i++) {
      const t = job.start + i / job.fps;
      await page.eval(`(async () => {
        ${hasProtocol ? `await window.__EXPORT__.seek(${t});` : ''}
        window.__VCLOCK__.advanceTo(${t * 1000});
        await new Promise((r) => window.__VCLOCK__.nativeRAF(() => r()));
      })()`);
      const { data } = await page.send('Page.captureScreenshot', shot);
      const buf = Buffer.from(data, 'base64');
      if (framesDir) writeFileSync(join(framesDir, `frame_${String(i).padStart(6, '0')}.${job.frameFormat === 'jpeg' ? 'jpg' : 'png'}`), buf);
      if (ff) await ff.write(buf);
      progress(i + 1, totalFrames, t0);
    }
    if (ff) await ff.finish();
  } catch (e) {
    ff?.kill();
    throw e;
  } finally {
    process.stdout.write('\n');
    await browser.send('Target.closeTarget', { targetId: (await page.send('Target.getTargetInfo')).targetInfo.targetId }).catch(() => {});
  }
  return { output: job.output, frames: totalFrames, duration: totalFrames / job.fps, seconds: (Date.now() - t0) / 1000, ext };
}

function progress(done, total, t0) {
  if (!process.stdout.isTTY && done !== total) return;
  const pct = done / total;
  const width = 28;
  const bar = '█'.repeat(Math.round(pct * width)).padEnd(width, '░');
  const elapsed = (Date.now() - t0) / 1000;
  const eta = done ? (elapsed / done) * (total - done) : 0;
  const line = `  ${bar} ${(pct * 100).toFixed(0).padStart(3)}%  frame ${done}/${total}  ${(done / Math.max(elapsed, 0.001)).toFixed(1)} fps  ETA ${eta.toFixed(0)}s`;
  process.stdout.write(process.stdout.isTTY ? `\r${line}` : line);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9ก-๙]+/gi, '-').replace(/^-|-$/g, '') || 'x';
}

async function main() {
  const opts = parseCli();
  const ask = interactive() && !opts.yes;

  const chrome = findChrome(opts.chrome);
  if (!chrome) fail('No Chromium-based browser found. Install Google Chrome, or run `npx @puppeteer/browsers install chrome-headless-shell@stable`, or pass --chrome <path>.');

  const source = await resolveInput(opts.input);
  const { cdp, close } = await launchChrome(chrome, { headful: opts.headful });
  const cleanup = () => {
    close();
    source.close();
    rl?.close();
  };
  process.on('SIGINT', () => {
    cleanup();
    console.log('\nCancelled.');
    process.exit(130);
  });

  try {
    const readyTimeout = opts['ready-timeout'] !== undefined ? positiveNumber(opts['ready-timeout'], '--ready-timeout') : 10;
    const wait = opts.wait !== undefined ? Number(opts.wait) : 200;

    // Probe the page once to discover targets/actions.
    const probe = await loadPage(cdp, source.url, { viewport: [1280, 720], dpr: 1, readyTimeout, wait: 0 });
    const catalog = probe.hasProtocol ? await listActions(probe.page) : {};
    await cdp.send('Target.closeTarget', { targetId: (await probe.page.send('Target.getTargetInfo')).targetInfo.targetId }).catch(() => {});

    if (opts.list) {
      if (!probe.hasProtocol) console.log('This page has no window.__EXPORT__ bridge; export it with --duration <sec>.');
      else if (!Object.keys(catalog).length) console.log('The page exposes __EXPORT__ but no list() of targets/actions.');
      for (const [target, actions] of Object.entries(catalog)) {
        console.log(`\n${target}`);
        for (const [action, dur] of Object.entries(actions)) console.log(`  - ${action}${dur ? `  (${dur}s)` : ''}`);
      }
      return;
    }

    // --- what to export --------------------------------------------------
    const targets = Object.keys(catalog);
    let target = opts.target;
    if (target && targets.length && !catalog[target]) fail(`Unknown target "${target}". Available: ${targets.join(', ')}`);
    if (!target && targets.length === 1) target = targets[0];
    if (!target && targets.length > 1) {
      target = ask ? await choose('Which target (ตัวไหน)?', targets.map((t) => ({ label: t, value: t })), targets[0]) : targets[0];
    }

    const actionsOf = target ? Object.keys(catalog[target] ?? {}) : [];
    let action = opts.action;
    if (action && action !== 'all' && actionsOf.length && !actionsOf.includes(action)) fail(`Unknown action "${action}" for "${target}". Available: ${actionsOf.join(', ')}`);
    if (!action && actionsOf.length === 1) action = actionsOf[0];
    if (!action && actionsOf.length > 1) {
      const choices = [...actionsOf.map((a) => ({ label: `${a}${catalog[target][a] ? `  (${catalog[target][a]}s)` : ''}`, value: a })), { label: 'all actions', value: 'all' }];
      action = ask ? await choose('Which action (action ไหน)?', choices, actionsOf[0]) : actionsOf[0];
    }
    const actions = action === 'all' ? actionsOf : [action];

    // --- quality ---------------------------------------------------------
    let resolution = opts.resolution;
    if (!resolution && ask) {
      resolution = await choose(
        'Resolution (ความชัด)?',
        ['720p', '1080p', '1440p', '4k', '1080p-v', 'square'].map((r) => ({ label: `${r}  ${RESOLUTIONS[r].join('×')}`, value: r })),
        '1080p',
      );
    }
    let [width, height] = parseSize(resolution ?? '1080p', 'resolution');

    let fps = opts.fps;
    if (!fps && ask) fps = await choose('Frame rate (fps)?', [24, 25, 30, 50, 60].map((f) => ({ label: `${f} fps`, value: f })), 30);
    fps = positiveNumber(fps ?? 30, '--fps');

    let codec = opts.codec?.toLowerCase();
    if (!codec && ask) {
      codec = await choose(
        'Format?',
        [
          { label: 'MP4 (H.264) — plays everywhere', value: 'h264' },
          { label: 'MP4 (H.265/HEVC) — smaller file', value: 'h265' },
          { label: 'MOV (ProRes) — for editing, supports transparency', value: 'prores' },
          { label: 'WebM (VP9) — web, supports transparency', value: 'vp9' },
          { label: 'GIF', value: 'gif' },
          { label: 'PNG frames only', value: 'frames' },
        ],
        'h264',
      );
    }
    codec ??= 'h264';
    if (!CODECS[codec]) fail(`Unknown codec "${codec}". Use: ${Object.keys(CODECS).join(', ')}`);

    let quality = opts.quality?.toLowerCase();
    if (!quality && !opts.crf && ask && codec !== 'frames') {
      quality = await choose('Quality?', QUALITIES.map((q) => ({ label: q, value: q })), 'high');
    }
    quality ??= 'high';
    if (!QUALITIES.includes(quality)) fail(`Unknown quality "${quality}". Use: ${QUALITIES.join(', ')}`);
    rl?.close();
    rl = undefined;

    if (opts.transparent && !CODECS[codec].alpha) fail(`--transparent needs prores, vp9 or frames (${codec} has no alpha channel).`);
    if (['h264', 'h265', 'vp9'].includes(codec) && (width % 2 || height % 2)) {
      width += width % 2;
      height += height % 2;
      console.log(`  note: ${codec} needs even dimensions, using ${width}×${height}`);
    }

    // CSS viewport vs. output pixels: keep the layout size stable and raise DPR for sharper output.
    let viewport;
    if (opts.viewport) viewport = parseSize(opts.viewport, 'viewport');
    else {
      const k = 1080 / Math.min(width, height);
      viewport = [Math.round(width * k), Math.round(height * k)];
    }
    const dpr = width / viewport[0];

    const outDir = resolve(opts['out-dir'] ?? 'exports');
    if (opts.output && actions.length > 1) fail('--output can only be used when exporting a single action; use --out-dir instead.');
    const audio = opts.audio ? resolve(opts.audio) : undefined;
    if (audio && !existsSync(audio)) fail(`Audio file not found: ${opts.audio}`);

    const base = {
      width,
      height,
      viewport,
      dpr,
      fps,
      codec,
      quality,
      crf: opts.crf !== undefined ? Number(opts.crf) : undefined,
      transparent: !!opts.transparent,
      frameFormat: opts.transparent ? 'png' : opts['frame-format'] === 'jpeg' ? 'jpeg' : 'png',
      start: opts.start ? Number(opts.start) : 0,
      duration: opts.duration ? positiveNumber(opts.duration, '--duration') : undefined,
      keepFrames: !!opts['keep-frames'],
      audio,
      readyTimeout,
      wait,
    };

    console.log(`\nBrowser : ${chrome}`);
    console.log(`Page    : ${source.url}${probe.hasProtocol ? '' : '  (no __EXPORT__ bridge — virtual clock only)'}`);
    console.log(`Output  : ${width}×${height} @ ${fps} fps, ${codec}${codec !== 'frames' ? `, ${quality}` : ''}  (viewport ${viewport.join('×')}, dpr ${dpr.toFixed(2)})`);

    const results = [];
    for (const act of actions) {
      const name = [source.name, target, act].filter(Boolean).map(slug).join('-');
      const suffix = `${width}x${height}-${fps}fps`;
      const ext = CODECS[codec].ext;
      const output = opts.output ? resolve(opts.output) : join(outDir, ext ? `${name}-${suffix}.${ext}` : `${name}-${suffix}`);
      console.log(`\n▶ ${[target, act].filter(Boolean).join(' / ') || source.name}`);
      results.push(await renderOne(cdp, source.url, { ...base, target, action: act, output }));
    }

    console.log('\nDone:');
    for (const r of results) console.log(`  ✔ ${r.output}  (${r.frames} frames, ${r.duration.toFixed(2)}s, rendered in ${r.seconds.toFixed(1)}s)`);
  } finally {
    cleanup();
  }
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
});
