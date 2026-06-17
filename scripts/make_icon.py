#!/usr/bin/env python3
"""Generate the 128x128 placeholder marketplace icon (SPEC §0).

VW monogram inside a warden's shield on a neutral dark ground with a single
indigo accent. Deliberately NOT Anthropic's clay (#D4A27F) so nothing implies
affiliation.
"""
from PIL import Image, ImageDraw

SIZE = 128
BG = (30, 36, 48, 255)        # neutral dark slate
ACCENT = (124, 156, 255, 255)  # single indigo accent
INK = (233, 238, 247, 255)     # near-white for the monogram

SCALE = 4  # supersample for smooth edges
S = SIZE * SCALE


def shield_points(cx, top, w, h):
    """A simple shield polygon centered horizontally at cx."""
    half = w / 2
    return [
        (cx - half, top + h * 0.06),
        (cx, top),
        (cx + half, top + h * 0.06),
        (cx + half, top + h * 0.52),
        (cx, top + h),
        (cx - half, top + h * 0.52),
    ]


def main():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded-square background.
    r = 26 * SCALE
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=BG)

    # Shield outline.
    pts = shield_points(S / 2, 20 * SCALE, 78 * SCALE, 92 * SCALE)
    d.polygon(pts, outline=ACCENT, width=4 * SCALE)

    # "W" chevron (evokes VW) inside the shield.
    lw = 6 * SCALE
    w_pts = [
        (40 * SCALE, 46 * SCALE),
        (52 * SCALE, 86 * SCALE),
        (64 * SCALE, 58 * SCALE),
        (76 * SCALE, 86 * SCALE),
        (88 * SCALE, 46 * SCALE),
    ]
    d.line(w_pts, fill=INK, width=lw, joint="curve")
    # Round the stroke caps.
    for x, y in (w_pts[0], w_pts[-1]):
        d.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], fill=INK)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    out = __file__.rsplit("/", 2)[0] + "/resources/icon.png"
    img.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
