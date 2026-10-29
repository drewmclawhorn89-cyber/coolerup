#!/usr/bin/env python3
"""Generate Android launcher icons + splash from the Coolerup 512x512 source."""
from PIL import Image, ImageDraw
import os

SRC = "public/icons/icon-512.png"
RES = "android/app/src/main/res"

# Legacy launcher icon sizes (px) per density
LAUNCHER = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
# Adaptive icon foreground: 108dp canvas, art should occupy inner 72dp (~66%)
FOREGROUND = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}
# Splash screens (portrait) - use a comfortable square logo on black
SPLASH = {
    "drawable-port-mdpi": (320, 480, 128),
    "drawable-port-hdpi": (480, 800, 192),
    "drawable-port-xhdpi": (720, 1280, 288),
    "drawable-port-xxhdpi": (960, 1600, 384),
    "drawable-port-xxxhdpi": (1280, 1920, 512),
    "drawable-land-mdpi": (480, 320, 128),
    "drawable-land-hdpi": (800, 480, 192),
    "drawable-land-xhdpi": (1280, 720, 288),
    "drawable-land-xxhdpi": (1600, 960, 384),
    "drawable-land-xxxhdpi": (1920, 1280, 512),
}

src = Image.open(SRC).convert("RGBA")
print(f"source: {src.size} {src.mode}")

# --- legacy square/rounded launcher icons ---
for density, size in LAUNCHER.items():
    out = src.resize((size, size), Image.LANCZOS)
    d = os.path.join(RES, f"mipmap-{density}")
    os.makedirs(d, exist_ok=True)
    out.save(os.path.join(d, "ic_launcher.png"))
    # round variant: circular mask
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    rnd = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rnd.paste(out, (0, 0), mask)
    rnd.save(os.path.join(d, "ic_launcher_round.png"))
    print(f"  mipmap-{density}: {size}px launcher + round")

# --- adaptive icon foreground (transparent padding, art in safe zone) ---
for density, canvas in FOREGROUND.items():
    art = int(canvas * 0.66)
    fg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    scaled = src.resize((art, art), Image.LANCZOS)
    off = (canvas - art) // 2
    fg.paste(scaled, (off, off), scaled)
    d = os.path.join(RES, f"mipmap-{density}")
    os.makedirs(d, exist_ok=True)
    fg.save(os.path.join(d, "ic_launcher_foreground.png"))
    print(f"  mipmap-{density}: {canvas}px adaptive foreground")

# --- splash screens ---
for folder, (w, h, logo) in SPLASH.items():
    canvas = Image.new("RGB", (w, h), (0, 0, 0))
    lg = src.resize((logo, logo), Image.LANCZOS)
    canvas.paste(lg, ((w - logo) // 2, (h - logo) // 2), lg)
    d = os.path.join(RES, folder)
    os.makedirs(d, exist_ok=True)
    canvas.save(os.path.join(d, "splash.png"))
    print(f"  {folder}: {w}x{h}")

print("done")
