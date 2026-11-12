from PIL import Image, ImageDraw

SRC = "../generated_images/generated_image_075ad592-012d-4d45-a025-8408aa32c462_0.png"
src = Image.open(SRC).convert("RGB")

# The generated art has baked-in rounded corners with white outside.
# Flood-fill just those white corner regions to black so we get a clean,
# full-bleed black square without clipping the wordmark.
for corner in [(0, 0), (src.width - 1, 0), (0, src.height - 1), (src.width - 1, src.height - 1)]:
    ImageDraw.floodfill(src, corner, (0, 0, 0), thresh=120)


def save(size, path):
    src.resize((size, size), Image.LANCZOS).save(path, "PNG", optimize=True)
    print("wrote", path, size)


# Standard icons
save(192, "public/icons/icon-192.png")
save(512, "public/icons/icon-512.png")

# Maskable: full-bleed black with logo inside the 80% safe zone
mask = Image.new("RGB", (512, 512), (0, 0, 0))
inner = src.resize((410, 410), Image.LANCZOS)
mask.paste(inner, ((512 - 410) // 2, (512 - 410) // 2))
mask.save("public/icons/icon-512-maskable.png", "PNG", optimize=True)
print("wrote public/icons/icon-512-maskable.png 512")

# Favicon referenced by manifest and root meta
save(192, "public/favicon.png")

# Alternate coolerup-named assets kept in sync
save(192, "public/icon-192-coolerup.png")
save(512, "public/icon-512-coolerup.png")
