#!/usr/bin/env python3
"""Infiniti Kryos's icons, composited from the gym's own mark.

The previous icons were lettering: OPEN above MAT, dropping to an OM monogram
at favicon sizes. The app is named after the gym now and carries the gym's
mark, so the icons do too.

scripts/brand-mark.png is the infinity symbol lifted off the banner photo Kyle
supplied and cut out onto transparency. It is committed rather than
regenerated, because the cutout came from a 400px photo and is not something
this script could reproduce from the original: if a cleaner logo file ever
turns up, replace brand-mark.png and run this again.

Two shapes of icon, and the difference matters:

  normal     the mark fills the tile, because iOS and the browser tab show the
             square as drawn.
  maskable   Android crops the tile to whatever shape the launcher uses, often
             a circle, so the mark sits inside the middle ~62% or its ends get
             cut off.

Everything is drawn at 4x and reduced with LANCZOS.

  python3 scripts/make-icons.py
"""
from PIL import Image
import numpy as np
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public")
MARK = os.path.join(HERE, "brand-mark.png")
SS = 4
# The app's own near-black, so the icon and the first screen agree.
BG = (10, 11, 14)

mark = Image.open(MARK)


def tile(size, fill):
    big = size * SS
    t = Image.new("RGB", (big, big), BG)
    want = int(big * fill)
    scale = want / mark.width
    m = mark.resize((max(1, int(mark.width * scale)),
                     max(1, int(mark.height * scale))), Image.LANCZOS)
    t.paste(m, ((big - m.width) // 2, (big - m.height) // 2), m)
    return t.resize((size, size), Image.LANCZOS)


def plate():
    """The mark as it appears in the app's own top bar, on every page.

    Not the cut-out. The cut-out is what the icons use and it is imperfect —
    the red bands of the banner sit close enough to the cloth behind them that
    separating one from the other eats pieces out of them, which a 512px icon
    shows. At the size a top bar uses, a small dark plate with the mark whole
    on it is both truer to the banner and cleaner to look at, and the cloth is
    near enough to the app's own background that on the dark theme the plate
    reads as the bar itself.

    The padding is filled with the cloth's own colour, taken from the corners
    of the photo rather than chosen, so there is no seam where the padding
    starts, and it exists because the loops run right to the edge of the crop
    and a logo touching its own frame looks like a mistake.
    """
    full = Image.open(MARK).convert("RGB")
    a = np.array(full)
    corners = np.concatenate([a[:30, :30].reshape(-1, 3), a[:30, -30:].reshape(-1, 3),
                              a[-30:, :30].reshape(-1, 3), a[-30:, -30:].reshape(-1, 3)])
    cloth = tuple(int(x) for x in np.median(corners, 0))
    px, py = int(0.05 * full.width), int(0.10 * full.height)
    c = Image.new("RGB", (full.width + 2 * px, full.height + 2 * py), cloth)
    c.paste(full, (px, py))
    # 360 wide covers a plate of about 54 css pixels on a 3x screen.
    w = 360
    return c.resize((w, int(w * c.height / c.width)), Image.LANCZOS)


def main():
    plate().save(os.path.join(OUT, "mark.png"), optimize=True)
    tile(192, 0.88).save(os.path.join(OUT, "icon-192.png"))
    tile(512, 0.88).save(os.path.join(OUT, "icon-512.png"))
    tile(192, 0.62).save(os.path.join(OUT, "icon-192-maskable.png"))
    tile(512, 0.62).save(os.path.join(OUT, "icon-512-maskable.png"))
    tile(180, 0.88).save(os.path.join(OUT, "apple-touch-icon.png"))
    tile(32, 0.92).save(os.path.join(OUT, "favicon-32.png"))
    tile(16, 0.96).save(os.path.join(OUT, "favicon-16.png"))
    tile(64, 0.92).save(os.path.join(OUT, "favicon.ico"),
                        sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons and mark.png written to", OUT)
    print("remember to bump the ?v= on the icon URLs in index.html and the")
    print("manifest, or every phone that already has the app keeps the old one")


if __name__ == "__main__":
    main()
