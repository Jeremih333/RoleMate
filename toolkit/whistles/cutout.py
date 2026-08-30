"""Cuts the whistle artwork out of its background and prepares it for the app.

The pack arrives as stickers photographed on a marbled grey card. What the gift
card needs is the whistle alone on transparency, trimmed to its own edges and
centred on a square canvas, so it can be laid on a backdrop the way Telegram
lays a collectible's model on one.

The background is flood-filled from the border rather than keyed by colour: the
card is a gradient, and every whistle carries a white outline that a colour key
would eat. Filling inward from the edges stops exactly at that outline, which is
the contour we want.

    python toolkit/whistles/cutout.py

Reads toolkit/whistles/raw/*.webp and writes apps/miniapp/public/gifts/*.webp.
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

RAW = Path(__file__).resolve().parent / "raw"
OUT = Path(__file__).resolve().parents[2] / "apps" / "miniapp" / "public" / "gifts"

# How far a pixel may sit from its neighbour and still count as more background.
TOLERANCE = 10
# The finished square. Big enough for the hero on a phone at three times the
# density, small enough that a whole pack is a few dozen kilobytes.
CANVAS = 384
# Air around the artwork inside that square.
MARGIN = 0.06

NAMES = {
    "Bell_DE": "bell",
    "Red_Whistle_DE": "red",
    "Blue_Whistle_DE": "blue",
    "Moon_Whistle_DE": "moon",
    "Black_Whistle_DE": "black",
    "White_Whistle_-_Lyza": "lyza",
    "White_Whistle_-_Ozen": "ozen",
    "White_Whistle_-_Bondrewd": "bondrewd",
    "White_Whistle_-_Srajo": "srajo",
    "White_Whistle_-_Wakuna": "wakuna",
    "White_Whistle_-_Riko": "riko",
    "White_Whistle_-_Aki": "aki",
}


def background_mask(pixels: np.ndarray) -> np.ndarray:
    """True where the pixel belongs to the card behind the sticker."""
    height, width, _ = pixels.shape
    seen = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        for y in (0, height - 1):
            queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            queue.append((y, x))
    for y, x in queue:
        seen[y, x] = True
    while queue:
        y, x = queue.popleft()
        here = pixels[y, x].astype(np.int16)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if ny < 0 or nx < 0 or ny >= height or nx >= width or seen[ny, nx]:
                continue
            if int(np.abs(pixels[ny, nx].astype(np.int16) - here).max()) <= TOLERANCE:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return seen


def largest_island(foreground: np.ndarray) -> np.ndarray:
    """The sticker itself, without the specks the fill leaves behind."""
    height, width = foreground.shape
    seen = np.zeros_like(foreground)
    best = np.zeros_like(foreground)
    best_size = 0
    for start_y in range(height):
        for start_x in range(width):
            if not foreground[start_y, start_x] or seen[start_y, start_x]:
                continue
            island = np.zeros_like(foreground)
            queue = deque([(start_y, start_x)])
            seen[start_y, start_x] = True
            island[start_y, start_x] = True
            size = 0
            while queue:
                y, x = queue.popleft()
                size += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if ny < 0 or nx < 0 or ny >= height or nx >= width:
                        continue
                    if foreground[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        island[ny, nx] = True
                        queue.append((ny, nx))
            if size > best_size:
                best_size, best = size, island
    return best


def fill_holes(shape: np.ndarray) -> np.ndarray:
    """Everything enclosed by the outline belongs to the object."""
    height, width = shape.shape
    outside = np.zeros_like(shape)
    queue = deque()
    for x in range(width):
        for y in (0, height - 1):
            if not shape[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    for y in range(height):
        for x in (0, width - 1):
            if not shape[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if ny < 0 or nx < 0 or ny >= height or nx >= width:
                continue
            if not shape[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                queue.append((ny, nx))
    return ~outside


def cut(path: Path, slug: str) -> None:
    source = Image.open(path).convert("RGB")
    pixels = np.asarray(source)
    # The sticker is the one island the fill could not reach, and everything its
    # outline encloses belongs to it - a dark port inside a white whistle is not
    # background just because it is dark.
    mask = ~fill_holes(largest_island(~background_mask(pixels)))

    alpha = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), mode="L")
    # A one-pixel feather: the flood fill leaves a hard edge, and a hard edge on
    # a coloured backdrop looks like a cut-out rather than an object.
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))

    cut_out = source.convert("RGBA")
    cut_out.putalpha(alpha)
    bounds = cut_out.getbbox()
    if bounds is None:
        raise SystemExit(f"{path.name}: nothing left after the cut")
    cut_out = cut_out.crop(bounds)

    inner = int(CANVAS * (1 - 2 * MARGIN))
    scale = min(inner / cut_out.width, inner / cut_out.height)
    cut_out = cut_out.resize(
        (max(1, round(cut_out.width * scale)), max(1, round(cut_out.height * scale))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(
        cut_out,
        ((CANVAS - cut_out.width) // 2, (CANVAS - cut_out.height) // 2),
        cut_out,
    )

    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{slug}.webp"
    canvas.save(target, "WEBP", quality=92, method=6)
    print(f"{path.name} -> {target.name} ({target.stat().st_size // 1024} KiB)")


def main() -> int:
    files = sorted(RAW.glob("*.webp"))
    if not files:
        print("nothing in toolkit/whistles/raw", file=sys.stderr)
        return 1
    for path in files:
        slug = NAMES.get(path.stem)
        if not slug:
            print(f"skipping {path.name}: no slug for it", file=sys.stderr)
            continue
        cut(path, slug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
