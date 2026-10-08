"""Compose Mali mascot on a white rounded plate (macOS-style app icon)."""

from __future__ import annotations

from PIL import Image, ImageDraw

# Match common macOS dock icons (e.g. Arc): opaque plate ~84% of canvas, centered on alpha.
PLATE_SCALE = 216 / 256
CORNER_RADIUS_RATIO = 0.224
INSET_RATIO = 0.075
MASCOT_FILL = 0.88


def _rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def with_white_plate(foreground: Image.Image, out_size: int = 1024) -> Image.Image:
    """RGBA mascot (transparent) → square icon with white rounded background."""
    fg = foreground.convert("RGBA")
    plate_size = max(1, int(round(out_size * PLATE_SCALE)))
    ox = (out_size - plate_size) // 2
    oy = (out_size - plate_size) // 2
    radius = max(2, int(plate_size * CORNER_RADIUS_RATIO))
    inset = int(plate_size * INSET_RATIO)

    plate_layer = Image.new("RGBA", (plate_size, plate_size), (0, 0, 0, 0))
    white = Image.new("RGBA", (plate_size, plate_size), (255, 255, 255, 255))
    plate_layer = Image.composite(white, plate_layer, _rounded_mask(plate_size, radius))

    hairline = max(1, round(plate_size / 512))
    border = Image.new("RGBA", (plate_size, plate_size), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (hairline / 2, hairline / 2, plate_size - 1 - hairline / 2, plate_size - 1 - hairline / 2),
        radius=radius,
        outline=(0, 0, 0, 22),
        width=hairline,
    )
    plate_layer.alpha_composite(border)

    out = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    out.paste(plate_layer, (ox, oy), plate_layer)

    blob = fg.getbbox()
    if not blob:
        return out

    mascot = fg.crop(blob)
    inner = plate_size - 2 * inset
    target = max(1, int(inner * MASCOT_FILL))
    mascot = mascot.copy()
    mascot.thumbnail((target, target), Image.Resampling.LANCZOS)
    x = ox + (plate_size - mascot.width) // 2
    y = oy + (plate_size - mascot.height) // 2
    out.paste(mascot, (x, y), mascot)
    return out
