"""Writes installer/app.ico: the tray's purple crescent (see TrayApp.MakeIcon) at all Windows icon sizes."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'installer' / 'app.ico'
BASE, PURPLE = (0x1e, 0x1e, 0x2e, 255), (0xcb, 0xa6, 0xf7, 255)


def draw(size):
    s = 8  # supersample, then shrink for smooth edges
    im = Image.new('RGBA', (32 * s, 32 * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    box = lambda x, y, w, h: (x * s, y * s, (x + w) * s, (y + h) * s)
    d.ellipse(box(1, 1, 30, 30), fill=BASE)
    d.ellipse(box(6, 6, 20, 20), fill=PURPLE)
    d.ellipse(box(11, 4, 18, 18), fill=BASE)  # cut out the crescent
    return im.resize((size, size), Image.LANCZOS)


sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
draw(256).save(OUT, sizes=[(n, n) for n in sizes], append_images=[draw(n) for n in sizes])
print('wrote', OUT)
