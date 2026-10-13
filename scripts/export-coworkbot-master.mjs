#!/usr/bin/env node
/**
 * Render the yellow Mochi CoworkBot (idle, no shadow) to a transparent PNG master,
 * then optionally run regenerate-brand-from-master.sh.
 *
 *   node scripts/export-coworkbot-master.mjs
 *   node scripts/export-coworkbot-master.mjs --bot jelly
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const bot = process.argv.includes("--bot")
  ? process.argv[process.argv.indexOf("--bot") + 1] || "mochi"
  : "mochi";
const outMaster = path.join(root, "docs/brand/mali-cowork-icon-transparent.png");
const VIEW = 1200;

function servePublic() {
  const publicDir = path.join(root, "public");
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";
      const file = path.join(publicDir, rel.replace(/^\//, ""));
      if (!file.startsWith(publicDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(file);
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".png": "image/png",
          ".svg": "image/svg+xml",
        };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function main() {
  const { server, port } = await servePublic();
  const pageUrl = `http://127.0.0.1:${port}/anim/cowork-bots.html?embed=${encodeURIComponent(bot)}&state=idle&shadow=0&theme=dark&v=15`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: VIEW, height: VIEW },
      deviceScaleFactor: 2,
    });
    await page.goto(pageUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.querySelector("#embed svg stop[stop-color]"),
      { timeout: 15000 },
    );
    await page.evaluate(() => {
      window.postMessage({ state: "idle", paused: true }, "*");
    });
    await page.waitForTimeout(400);

    const canvas = page.locator("#embed .bot-canvas");
    await canvas.waitFor({ state: "visible" });
    const png = await canvas.screenshot({ type: "png", omitBackground: true });

    fs.mkdirSync(path.dirname(outMaster), { recursive: true });
    fs.writeFileSync(outMaster, png);
    console.log("wrote", outMaster, `(${bot}, ${png.length} bytes)`);
  } finally {
    await browser.close();
    server.close();
  }

  await new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(root, "scripts/regenerate-brand-from-master.sh"), outMaster], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`regenerate exit ${code}`))));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
