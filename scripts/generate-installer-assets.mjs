#!/usr/bin/env node
/**
 * Generate installer branding assets for Tauri:
 * - 256x256 / 512x512 app icon variants (with rounded corners)
 * - NSIS installer icon (150x57 banner-style, right-aligned)
 * - Windows .ico with multi-resolution entries
 * - macOS .icns (kept as PNG set; Tauri can build icns via tauri icon command)
 *
 * Run: node scripts/generate-installer-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(process.cwd());
const iconSrc = path.join(root, "public", "icon.png");
const outDir = path.join(root, "src-tauri", "icons");

const BRAND_YELLOW = "#f3c354";
const BRAND_DARK = "#1a1c23";
const ACCENT = "#ff9f43";

async function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function composeAppIcon(size, radius = size * 0.22) {
  // Base: solid dark rounded square
  const roundedRect = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BRAND_DARK}"/></svg>`
  );

  // Centered blob logo resized to ~70%
  const logoSize = Math.round(size * 0.62);
  const logo = await sharp(iconSrc)
    .resize(logoSize, logoSize, { fit: "contain", background: "#00000000" })
    .toBuffer();

  const offset = Math.round((size - logoSize) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_DARK },
  })
    .composite([
      { input: roundedRect, blend: "dest-in" },
      { input: logo, left: offset, top: offset },
    ])
    .png()
    .toBuffer();
}

async function generateWindowsIco() {
  const sizes = [256, 128, 64, 48, 32, 16];
  const buffers = [];
  for (const s of sizes) {
    const buf = await composeAppIcon(s, s * 0.2);
    buffers.push({ size: s, buf });
  }

  // Sharp can not write .ico directly. Use @fiahboom/ico or just multi-size PNGs fallback.
  // Simpler: write a 256x256 high-quality PNG that Tauri bundler will pack.
  await sharp(buffers.find((b) => b.size === 256).buf)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, "icon.png"));

  // For Windows .ico we keep the existing file and let tauri icon regenerate.
  console.log("  icon.png written (256x256) — run `bun tauri icon` to regenerate .ico/.icns");
}

async function generateNSISBanner() {
  const w = 493;
  const h = 58;
  const canvas = sharp({
    create: { width: w, height: h, channels: 4, background: "#ffffff" },
  });

  const logoSize = 38;
  const logo = await sharp(iconSrc)
    .resize(logoSize, logoSize, { fit: "contain", background: "#00000000" })
    .toBuffer();

  const header = Buffer.from(`<svg width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${BRAND_DARK}"/>
        <stop offset="60%" stop-color="#202330"/>
        <stop offset="100%" stop-color="#ffffff"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
  </svg>`);

  const text = Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <text x="62" y="29" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="${BRAND_YELLOW}" text-anchor="start" dominant-baseline="middle">Mali Cowork</text>
    <text x="62" y="46" font-family="Arial, sans-serif" font-size="10" fill="#9a9fb3" text-anchor="start" dominant-baseline="middle">Desktop coworking assistant</text>
  </svg>`);

  await canvas
    .composite([
      { input: header, left: 0, top: 0 },
      { input: logo, left: 16, top: 10 },
      { input: text, left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(root, "public", "installer-banner.png"));
  console.log("  installer-banner.png written (NSIS/WiX banner 493x58)");
}

async function generateNSISSidebar() {
  const w = 164;
  const h = 314;
  const canvas = sharp({
    create: { width: w, height: h, channels: 4, background: BRAND_DARK },
  });

  const logoSize = 80;
  const logo = await sharp(iconSrc)
    .resize(logoSize, logoSize, { fit: "contain", background: "#00000000" })
    .toBuffer();

  const text = Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <text x="${w / 2}" y="${h / 2 + 60}" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${BRAND_YELLOW}" text-anchor="middle" dominant-baseline="middle">Mali Cowork</text>
    <text x="${w / 2}" y="${h / 2 + 80}" font-family="Arial, sans-serif" font-size="9" fill="#9a9fb3" text-anchor="middle" dominant-baseline="middle">AI coworking</text>
  </svg>`);

  await canvas
    .composite([
      { input: logo, left: Math.round((w - logoSize) / 2), top: Math.round((h - logoSize) / 2 - 30) },
      { input: text, left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(root, "public", "installer-sidebar.png"));
  console.log("  installer-sidebar.png written (NSIS/WiX sidebar 164x314)");
}

async function main() {
  await ensureDir(outDir);
  console.log("Generating installer assets...");
  await generateWindowsIco();
  await generateNSISBanner();
  await generateNSISSidebar();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
