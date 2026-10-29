#!/usr/bin/env python3
"""Build the Google Play feature graphic (1024x500) for Coolerup."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1024, 500
BG = (10, 10, 12)
ACCENT = (225, 29, 72)      # rose-600, matches the app accent
WHITE = (255, 255, 255)
MUTED = (170, 170, 178)

canvas = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(canvas)

# Soft radial glow behind the logo, right side
glow = Image.new("RGB", (W, H), BG)
gd = ImageDraw.Draw(glow)
gd.ellipse((W - 520, -180, W + 180, 520), fill=(60, 8, 22))
glow = glow.filter(ImageFilter.GaussianBlur(110))
canvas = Image.blend(canvas, glow, 0.85)
d = ImageDraw.Draw(canvas)

# Subtle vertical accent bar on the far left
d.rectangle((0, 0, 8, H), fill=ACCENT)

# Logo, left side
logo = Image.open("public/icons/icon-512.png").convert("RGBA")
LOGO = 208
logo = logo.resize((LOGO, LOGO), Image.LANCZOS)
lx, ly = 96, (H - LOGO) // 2
# rounded mask so the square icon reads as an app icon
mask = Image.new("L", (LOGO, LOGO), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, LOGO - 1, LOGO - 1), radius=46, fill=255)
canvas.paste(logo, (lx, ly), mask)

# Type
bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
f_title = ImageFont.truetype(bold, 86)
f_sub = ImageFont.truetype(reg, 33)
f_tag = ImageFont.truetype(bold, 24)

tx = lx + LOGO + 56
d.text((tx, 138), "Coolerup", font=f_title, fill=WHITE)
d.text((tx, 240), "Share cool short videos", font=f_sub, fill=MUTED)
d.text((tx, 280), "with friends", font=f_sub, fill=MUTED)

# Small feature pills
pills = ["Shorts feed", "Groups", "LIVE"]
px = tx
py = 350
f_pill = ImageFont.truetype(bold, 22)
for p in pills:
    tw = d.textlength(p, font=f_pill)
    pad = 18
    d.rounded_rectangle((px, py, px + tw + pad * 2, py + 44), radius=22,
                        outline=(70, 70, 78), width=2, fill=(24, 24, 28))
    d.text((px + pad, py + 10), p, font=f_pill, fill=WHITE)
    px += tw + pad * 2 + 14

canvas.save("outputs/play-store/feature-graphic-1024x500.png", "PNG")
print("wrote feature-graphic-1024x500.png", canvas.size)
