#!/usr/bin/env bash
# Regenerate Mali Cowork brand + app icons from Luke's transparent master PNG (~1337×1177).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="${1:-$ROOT/mali-cowork-icon.png}"

if [[ ! -f "$MASTER" ]]; then
  echo "error: master icon not found at: $MASTER" >&2
  exit 1
fi

python3 << PY
import sys
from PIL import Image
from pathlib import Path

sys.path.insert(0, str(Path("$ROOT") / "scripts"))
from icon_white_plate import with_white_plate

root = Path("$ROOT")
master_path = Path("$MASTER")
master = Image.open(master_path).convert("RGBA")
print("master", master_path, master.size, master.mode)
if master.size[0] < 1000 or master.size[1] < 1000:
    raise SystemExit(f"expected ~1337x1177 master, got {master.size}")

corner = master.getpixel((0, 0))
if corner[3] > 16:
    print("warning: top-left pixel is not transparent:", corner)

brand_dir = root / "docs/brand"
brand_dir.mkdir(parents=True, exist_ok=True)

# Primary brand masters (transparent)
for dest in (
    root / "mali-cowork-icon.png",
    brand_dir / "mali-cowork-icon.png",
    brand_dir / "mali-cowork-icon-transparent.png",
):
    master.save(dest, optimize=True)

# Optional white-background export for GitHub social preview only (not used for app icons)
social = Image.new("RGBA", master.size, (255, 255, 255, 255))
social.paste(master, (0, 0), master)
social.convert("RGB").save(brand_dir / "mali-cowork-icon-social-preview.png", optimize=True)

# Square 1024 canvas, transparent — for Tauri icon CLI
blob = master.getbbox()
if not blob:
    raise SystemExit("no opaque pixels in master")
cropped = master.crop(blob)
side = max(cropped.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
ox = (side - cropped.width) // 2
oy = (side - cropped.height) // 2
canvas.paste(cropped, (ox, oy), cropped)
up = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
up.save(brand_dir / "mali-cowork-icon-1024-transparent.png", optimize=True)
app_icon = with_white_plate(up, 1024)
app_icon.save(brand_dir / "mali-cowork-icon-1024.png", optimize=True)

# Public web icons (white plate — matches dock / app)
public = root / "public"
public.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 180, 512):
    out = app_icon.resize((size, size), Image.Resampling.LANCZOS)
    if size == 180:
        out.save(public / "apple-touch-icon.png", optimize=True)
    elif size == 512:
        out.save(public / "icon-512.png", optimize=True)
        out.save(public / "icon.png", optimize=True)
    else:
        out.save(public / f"favicon-{size}x{size}.png", optimize=True)
out32 = Image.open(public / "favicon-32x32.png")
out32.save(public / "favicon.png", optimize=True)
print("wrote transparent docs/brand + public icons")
PY

(
  cd "$ROOT/src-tauri"
  npm exec --yes @tauri-apps/cli -- icon ../docs/brand/mali-cowork-icon-1024.png -o icons
)

echo "done: regenerated from $MASTER"
