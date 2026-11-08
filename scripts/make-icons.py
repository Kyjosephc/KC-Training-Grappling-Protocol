#!/usr/bin/env python3
"""Open Mat's icons, drawn here rather than exported from anywhere.

The mark is the name: OPEN outlined above MAT solid, teal on near-black. The
icon this replaced had STRENGTH MATRIX set small and grey around a dumbbell,
which is two problems — the wrong name, and lettering too small to read at the
size an app icon is actually seen. This is set to fill the tile, so it still
reads on a home screen and in a browser tab.

The favicons drop to an OM monogram. Two words cannot survive sixteen pixels,
and a smudge is worse than a smaller mark.

Everything is drawn at 4x and reduced with LANCZOS: PIL's own antialiasing on
letterforms this heavy is not good enough to put on somebody's home screen.

  python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw, ImageFont

OUT = "public"
SS = 4
FONT = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
BG_TOP, BG_BOTTOM = (21, 24, 26), (5, 6, 7)
T_TOP, T_BOT = (47, 240, 210), (0, 184, 156)


def vgrad(size, top, bottom):
    g = Image.new("RGB", (1, size), bottom)
    px = g.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return g.resize((size, size), Image.BILINEAR)


def _widths(text, font):
    d = ImageDraw.Draw(Image.new("L", (8, 8)))
    out = []
    for ch in text:
        bb = d.textbbox((0, 0), ch, font=font, anchor="lt")
        out.append((bb[2] - bb[0], bb[0]))
    return out


def fit(text, box_w, tracking):
    """The largest size at which the line still fits the box, tracking included."""
    lo, hi = 10, 4000
    while lo < hi:
        mid = (lo + hi + 1) // 2
        f = ImageFont.truetype(FONT, mid)
        w = sum(w for w, _ in _widths(text, f)) + tracking * mid * (len(text) - 1)
        if w <= box_w:
            lo = mid
        else:
            hi = mid - 1
    return ImageFont.truetype(FONT, lo)


def line(size, text, font, tracking, cy, outline=0):
    """One line, letter-spaced by hand and centred on its own ink rather than
    on the font's metrics, which are full of space this mark does not use."""
    layer = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(layer)
    ws = _widths(text, font)
    total = sum(w for w, _ in ws) + tracking * font.size * (len(text) - 1)
    x = size / 2 - total / 2
    for ch, (w, lsb) in zip(text, ws):
        if outline:
            d.text((x - lsb, cy), ch, font=font, fill=0, anchor="lm",
                   stroke_width=outline, stroke_fill=255)
        else:
            d.text((x - lsb, cy), ch, font=font, fill=255, anchor="lm")
        x += w + tracking * font.size
    return layer


def wordmark(size, s=1.0):
    m = Image.new("L", (size, size), 0)
    box = size * 0.70 * s
    f = min((fit("OPEN", box, 0.04), fit("MAT", box, 0.04)), key=lambda f: f.size)
    m.paste(255, (0, 0), line(size, "OPEN", f, 0.04, size / 2 - size * 0.125 * s,
                              outline=max(1, round(size * 0.013 * s))))
    m.paste(255, (0, 0), line(size, "MAT", f, 0.04, size / 2 + size * 0.155 * s))
    return m


def monogram(size, s=1.0):
    f = fit("OM", size * 0.74 * s, -0.04)
    return line(size, "OM", f, -0.04, size / 2)


def plate(size, mark, s=1.0):
    big = size * SS
    base = vgrad(big, BG_TOP, BG_BOTTOM)
    base.paste(vgrad(big, T_TOP, T_BOT), (0, 0), mark(big, s))
    return base.resize((size, size), Image.LANCZOS)


def write(name, img):
    img.save(f"{OUT}/{name}")
    print(f"  {name}  {img.size[0]}x{img.size[1]}")


print("Open Mat icons")
# Full bleed, no corners baked in: iOS and Android apply their own mask, and a
# rounded square sitting inside their rounding leaves a dark rim around it.
write("icon-512.png", plate(512, wordmark))
write("icon-192.png", plate(192, wordmark))
write("apple-touch-icon.png", plate(180, wordmark))
# Maskable: Android crops these to whatever shape it likes, so the mark sits
# inside the safe circle — 80% of the tile — rather than being bitten into.
write("icon-512-maskable.png", plate(512, wordmark, 0.72))
write("icon-192-maskable.png", plate(192, wordmark, 0.72))
# A tab is not a home screen.
write("favicon-32.png", plate(32, monogram))
write("favicon-16.png", plate(16, monogram))
plate(64, monogram).save(f"{OUT}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("  favicon.ico  16/32/48")
