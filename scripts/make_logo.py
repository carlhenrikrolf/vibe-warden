#!/usr/bin/env python3
"""Final logo: simplified Option A — a blocky robot head with a padlock on the
bottom-right corner. Square head (no rounded corners); only the padlock is
rounded, for legibility at 24px.

Outputs:
  resources/icon.png            128px colour marketplace icon (filled)
  resources/logo-preview.png    colour @128 next to the mono activity-bar look
The matching monochrome SVG is hand-authored in resources/vibe-warden.svg.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

G = 24.0  # design grid


def k(S, *v):
    return [x * S / G for x in v]


def draw_lock_body(d, S, fill):
    d.rounded_rectangle(k(S, 11.3, 14.0, 19.7, 21.0), radius=int(1.5 * S / G), fill=fill)


def draw_shackle(d, S, fill, w):
    # U-shaped shackle over the lock body.
    sw = int(w * S / G)
    d.arc(k(S, 13.6, 11.0, 17.4, 14.6), 180, 360, fill=fill, width=sw)
    d.line(k(S, 13.7, 12.6, 13.7, 14.2), fill=fill, width=sw)
    d.line(k(S, 17.3, 12.6, 17.3, 14.2), fill=fill, width=sw)


def keyhole(d, S, fill):
    d.ellipse(k(S, 14.7, 16.2, 16.3, 17.8), fill=fill)
    d.rectangle(k(S, 15.2, 17.0, 15.8, 19.0), fill=fill)


def robot_head_mask(S):
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    d.rectangle(k(S, 3.5, 5.0, 14.5, 14.5), fill=255)       # square head
    d.rectangle(k(S, 8.4, 3.0, 9.6, 5.0), fill=255)         # antenna stem
    d.ellipse(k(S, 7.9, 1.4, 10.1, 3.6), fill=255)          # antenna bulb
    d.rectangle(k(S, 2.3, 8.0, 3.5, 11.0), fill=255)        # left ear
    d.rectangle(k(S, 14.5, 8.0, 15.7, 11.0), fill=255)      # right ear
    return m


def lock_mask(S):
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    draw_lock_body(d, S, 255)
    draw_shackle(d, S, 255, 1.6)
    return m


def face_cutouts(d, S, color):
    d.ellipse(k(S, 5.2, 7.6, 8.0, 10.4), fill=color)        # left eye
    d.ellipse(k(S, 10.0, 7.6, 12.8, 10.4), fill=color)      # right eye
    d.rectangle(k(S, 6.3, 11.7, 11.7, 12.9), fill=color)    # mouth


def render_color(S=512):
    BG = (28, 33, 45, 255)
    ROBOT = (124, 156, 255, 255)
    LOCK = (242, 245, 250, 255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(bg).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(0.18 * S), fill=BG)
    img.alpha_composite(bg)

    mhead = robot_head_mask(S)
    mlock = lock_mask(S)
    gap = mlock.filter(ImageFilter.MaxFilter(25))
    robot_vis = Image.composite(mhead, Image.new("L", (S, S), 0), gap.point(lambda v: 255 - v))

    img.paste(Image.new("RGBA", (S, S), ROBOT), (0, 0), robot_vis)
    face_cutouts(ImageDraw.Draw(img), S, BG)
    img.paste(Image.new("RGBA", (S, S), LOCK), (0, 0), mlock)
    keyhole(ImageDraw.Draw(img), S, BG)
    return img.resize((128, 128), Image.LANCZOS)


def render_mono(S=512):
    """Monochrome silhouette matching the hand-authored SVG (filled head with
    knockout eyes/mouth, solid lock, gap), rendered smoothly."""
    INK = (232, 236, 244, 255)
    CARD = (60, 66, 78, 255)
    mhead = robot_head_mask(S)
    mlock = lock_mask(S)
    gap = mlock.filter(ImageFilter.MaxFilter(25))
    robot_vis = Image.composite(mhead, Image.new("L", (S, S), 0), gap.point(lambda v: 255 - v))
    from PIL import ImageChops
    sil = ImageChops.lighter(robot_vis, mlock)
    holes = Image.new("L", (S, S), 0)
    face_cutouts(ImageDraw.Draw(holes), S, 255)
    keyhole(ImageDraw.Draw(holes), S, 255)
    sil = Image.composite(Image.new("L", (S, S), 0), sil, holes)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    layer.paste(Image.new("RGBA", (S, S), INK), (0, 0), sil)
    small = layer.resize((24, 24), Image.LANCZOS)            # actual activity-bar size
    big = small.resize((120, 120), Image.LANCZOS)            # smooth zoom to inspect
    card = Image.new("RGBA", (120, 120), CARD)
    card.alpha_composite(big)
    return small, card


def main():
    icon = render_color()
    icon.save("resources/icon.png")
    print("wrote resources/icon.png")

    small24, mono_card = render_mono()
    pad, gap = 18, 28
    W = pad + 128 + gap + 120 + pad
    H = pad + 128 + pad + 22
    prev = Image.new("RGBA", (W, H), (44, 49, 60, 255))
    prev.alpha_composite(icon, (pad, pad))
    prev.alpha_composite(mono_card, (pad + 128 + gap, pad + 4))
    d = ImageDraw.Draw(prev)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
    d.text((pad, pad + 128 + 4), "colour @128 (marketplace)", fill=(205, 210, 220, 255), font=font)
    d.text((pad + 128 + gap, pad + 128 + 4), "mono @24 (activity bar)", fill=(205, 210, 220, 255), font=font)
    prev.save("resources/logo-preview.png")
    print("wrote resources/logo-preview.png")


if __name__ == "__main__":
    main()
