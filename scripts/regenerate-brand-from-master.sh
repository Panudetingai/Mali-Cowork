#!/usr/bin/env bash
# Regenerate Mali Cowork brand + app icons from Luke's white-background master PNG.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="${1:-$ROOT/mali-cowork-icon.png}"

if [[ ! -f "$MASTER" ]]; then
  echo "error: master icon not found at: $MASTER" >&2
  exit 1
fi

python3 << PY
from PIL import Image
from pathlib import Path
master = Path("$MASTER")
im = Image.open(master)
print("master", master, im.size, im.mode)
if im.size[0] < 1000 or im.size[1] < 1000:
    raise SystemExit(
        f"expected ~1337x1177 master from chat attachment, got {im.size}"
    )
PY

mkdir -p "$ROOT/docs/brand"
cp "$MASTER" "$ROOT/docs/brand/mali-cowork-icon.png"

python3 << PY
from PIL import Image
from pathlib import Path

root = Path("$ROOT")
master = Image.open(root / "docs/brand/mali-cowork-icon.png").convert("RGBA")

# Transparent variant: white -> alpha
px = master.load()
w, h = master.size
transparent = Image.new("RGBA", (w, h))
for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        if r > 245 and g > 245 and b > 245:
            transparent.putpixel((x, y), (255, 255, 255, 0))
        else:
            transparent.putpixel((x, y), (r, g, b, a))
transparent.save(root / "docs/brand/mali-cowork-icon-transparent.png")

# Square 1024 canvas (fit blob, white bg) for tauri icon CLI
blob = transparent.getbbox()
if not blob:
    raise SystemExit("no opaque pixels in master")
cropped = transparent.crop(blob)
side = max(cropped.size)
canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
ox = (side - cropped.width) // 2
oy = (side - cropped.height) // 2
canvas.paste(cropped, (ox, oy), cropped)
up = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
up.convert("RGB").save(root / "docs/brand/mali-cowork-icon-1024.png", optimize=True)

# Public web icons (square crop of blob on white)
for size in (16, 32, 180, 512):
    out = up.resize((size, size), Image.Resampling.LANCZOS).convert("RGB")
    if size == 180:
        out.save(root / "public/apple-touch-icon.png", optimize=True)
    elif size == 512:
        out.save(root / "public/icon-512.png", optimize=True)
        out.save(root / "public/icon.png", optimize=True)
    else:
        out.save(root / f"public/favicon-{size}x{size}.png", optimize=True)
Image.open(root / "public/favicon-32x32.png").save(root / "public/favicon.png")
print("wrote docs/brand + public icons")
PY

(
  cd "$ROOT/src-tauri"
  npm exec --yes @tauri-apps/cli -- icon ../docs/brand/mali-cowork-icon-1024.png -o icons
)

echo "done: regenerated from $MASTER"
