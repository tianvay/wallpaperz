import sys
from PIL import Image, ImageDraw
def grid(src, box, out, step=50, width=900):
    im = Image.open(src).convert('RGB'); x0, y0, x1, y1 = box
    s = width / (x1 - x0)
    c = im.crop(box).resize((width, int((y1 - y0) * s))); d = ImageDraw.Draw(c)
    for x in range((x0 // step + 1) * step, x1, step):
        d.line([((x - x0) * s, 0), ((x - x0) * s, c.height)], fill=(255, 0, 0)); d.text(((x - x0) * s + 2, 2), str(x), fill=(255, 255, 0))
    for y in range((y0 // step + 1) * step, y1, step):
        d.line([(0, (y - y0) * s), (c.width, (y - y0) * s)], fill=(0, 255, 0)); d.text((2, (y - y0) * s + 2), str(y), fill=(255, 255, 0))
    c.save(out, quality=88)
