"""Рисует значки «Где что лежит» в docs/icons: светлая коробка с лупой на коричневом."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
BG, FG, DARK, ACCENT = "#9a5b2a", "#f6e7d4", "#6e3f1b", "#f2b632"


def draw(size, maskable):
    s = 4  # рисуем крупнее и уменьшаем — так края гладкие
    n = size * s
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, n, n], fill=BG)
        k = 0.6
    else:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * 0.22, fill=BG)
        k = 0.78
    c = n / 2
    u = n * k / 2
    w = max(2, int(n * 0.045 * k))
    # коробка
    top, bot, left, right = c - u * 0.35, c + u * 0.8, c - u * 0.9, c + u * 0.55
    d.rounded_rectangle([left, top, right, bot], radius=w, fill=FG)
    d.polygon([(left - u * 0.08, top), (right + u * 0.08, top), (right, top - u * 0.32), (left, top - u * 0.32)], fill=FG)
    d.line([(left, top + w * 0.2), (right, top + w * 0.2)], fill=DARK, width=w)
    d.rectangle([c - u * 0.3, top - u * 0.32, c - u * 0.05, top + u * 0.35], fill=DARK)
    # лупа
    r = u * 0.42
    cx, cy = c + u * 0.45, c + u * 0.35
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BG, outline=ACCENT, width=int(w * 1.4))
    d.line([(cx + r * 0.7, cy + r * 0.7), (cx + r * 1.55, cy + r * 1.55)], fill=ACCENT, width=int(w * 1.8))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
draw(192, False).save(OUT / "icon-192.png")
draw(512, False).save(OUT / "icon-512.png")
draw(512, True).save(OUT / "maskable-512.png")
print("ok")
