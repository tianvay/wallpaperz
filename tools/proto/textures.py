# textures.py: paints the procedural textures of the Blender prototype (blossom cards, falling petal) and prepares the
# sky panoramas (downscaled, sun direction measured from the HDR). Usage: python -I textures.py
import json, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '_src')
GEN = os.path.join(SRC, 'gen')                       # inputs for Blender
OUT = os.path.join(HERE, '..', '..', 'wallpapers', 'proto-blossom', 'tex')
os.makedirs(GEN, exist_ok=True); os.makedirs(OUT, exist_ok=True)
Image.MAX_IMAGE_PIXELS = None

def flower(draw, cx, cy, r, rot, col, centre):
    for k in range(5):
        a = rot + k * 2 * math.pi / 5
        px, py = cx + math.cos(a) * r * 0.55, cy + math.sin(a) * r * 0.55
        pts = []
        for j in range(24):                           # a petal: ellipse with a notch at the tip
            t = j / 24 * 2 * math.pi
            ex, ey = math.cos(t) * r * 0.55, math.sin(t) * r * 0.36
            if ex > r * 0.45: ex -= r * 0.12 * max(0, 1 - abs(ey) / (r * 0.12))
            pts.append((px + ex * math.cos(a) - ey * math.sin(a), py + ex * math.sin(a) + ey * math.cos(a)))
        draw.polygon(pts, fill=col)
    draw.ellipse([cx - r * 0.18, cy - r * 0.18, cx + r * 0.18, cy + r * 0.18], fill=centre)

def blossom_card(seed, path, n=170, S=1024):
    rnd = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    pal = [(245, 194, 231), (242, 205, 205), (250, 222, 236), (255, 240, 246), (236, 170, 205), (248, 212, 228)]
    # clumps: flowers gather in a few round bunches inside the card, so the silhouette reads as blossom, not a square
    clumps = [(rnd.uniform(0.3, 0.7) * S, rnd.uniform(0.3, 0.7) * S, rnd.uniform(0.16, 0.26) * S) for _ in range(5)]
    items = []
    for i in range(n):
        cx, cy, cr = rnd.choice(clumps)
        a, rr = rnd.uniform(0, 2 * math.pi), cr * math.sqrt(rnd.random())
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        if not (60 < x < S - 60 and 60 < y < S - 60): continue
        depth = rr / cr
        items.append((depth, x, y))
    items.sort(reverse=True)                           # outer flowers first, inner ones on top
    for depth, x, y in items:
        r = rnd.uniform(26, 42) * S / 1024
        c = rnd.choice(pal); sh = 0.82 + 0.18 * (1 - depth)
        col = tuple(int(v * sh) for v in c) + (255,)
        flower(d, x, y, r, rnd.uniform(0, 6.3), col, (200, 110, 140, 255))
    im.save(path)

blossom_card(1, os.path.join(GEN, 'blossom_a.png'))
blossom_card(2, os.path.join(GEN, 'blossom_b.png'), n=230)

def leaf_card(seed, path, n=260, S=1024):
    """Green foliage card: pointed leaves in round bunches, lighter on top of each bunch."""
    rnd = random.Random(seed)
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    pal = [(96, 140, 74), (118, 160, 86), (140, 178, 98), (82, 122, 70), (160, 190, 112)]
    clumps = [(rnd.uniform(0.3, 0.7) * S, rnd.uniform(0.3, 0.7) * S, rnd.uniform(0.18, 0.28) * S) for _ in range(5)]
    items = []
    for i in range(n):
        cx, cy, cr = rnd.choice(clumps); a, rr = rnd.uniform(0, 6.283), cr * math.sqrt(rnd.random())
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        if 50 < x < S - 50 and 50 < y < S - 50: items.append((rr / cr, x, y, cy))
    items.sort(reverse=True)
    for depth, x, y, cy in items:
        L = rnd.uniform(34, 56) * S / 1024; W = L * 0.42; a = rnd.uniform(0, 6.283)
        c = rnd.choice(pal); sh = 0.75 + 0.3 * (1 - depth) + 0.12 * (cy - y) / (S * 0.25)
        col = tuple(max(0, min(255, int(v * sh))) for v in c) + (255,)
        pts = [(x + math.cos(a) * L * t - math.sin(a) * W * math.sin(math.pi * t) * sg, y + math.sin(a) * L * t + math.cos(a) * W * math.sin(math.pi * t) * sg)
               for sg in (1, -1) for t in ([k / 10 for k in range(11)] if sg == 1 else [1 - k / 10 for k in range(11)])]
        d.polygon(pts, fill=col)
    im.save(path)

leaf_card(5, os.path.join(GEN, 'leaves_a.png'))

# a single falling petal for the particle sprite (white, tinted in the shader)
S = 128; im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
d.ellipse([20, 40, 108, 88], fill=(255, 255, 255, 255)); d.polygon([(100, 50), (112, 64), (100, 78)], fill=(0, 0, 0, 0))
im.filter(ImageFilter.GaussianBlur(1.2)).save(os.path.join(OUT, 'petal.png'))

# ---- skies: keep the upper half (plus a little below the horizon), 4096 wide ----
def read_hdr(path):                                    # minimal Radiance RGBE reader (new-style RLE)
    with open(path, 'rb') as f: data = f.read()
    i = data.index(b'\n\n') + 2; j = data.index(b'\n', i); dims = data[i:j].split(); H, W = int(dims[1]), int(dims[3]); p = j + 1
    img = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        p += 4
        for c in range(4):
            x = 0
            while x < W:
                n = data[p]; p += 1
                if n > 128: n -= 128; img[y, x:x + n, c] = data[p]; p += 1
                else: img[y, x:x + n, c] = np.frombuffer(data[p:p + n], np.uint8); p += n
                x += n
    e = img[..., 3].astype(np.float32)
    return img[..., :3].astype(np.float32) * np.ldexp(1.0, (e - 136).astype(np.int32))[..., None]

SKIES = ['qwantani_dawn_puresky', 'qwantani_morning_puresky', 'qwantani_noon_puresky', 'qwantani_late_afternoon_puresky',
         'qwantani_sunset_puresky', 'qwantani_dusk_2_puresky']
meta = []
for name in SKIES:
    hdr = read_hdr(os.path.join(SRC, 'sky', name + '.hdr')); H, W, _ = hdr.shape
    lum = hdr[: H // 2 + 8].sum(2); y, x = np.unravel_index(np.argmax(lum), lum.shape)
    az = (x + 0.5) / W * 2 * math.pi; el = math.pi / 2 - (y + 0.5) / H * math.pi
    # three.js equirect: u = atan(dir.z, dir.x) / 2pi + 0.5, v = asin(dir.y) / pi + 0.5
    phi = az - math.pi
    sun = [math.cos(el) * math.cos(phi), math.sin(el), math.cos(el) * math.sin(phi)]
    up = hdr[: H // 2]; amb = (up.reshape(-1, 3).mean(0)); sunc = hdr[max(0, y - 2):y + 3, max(0, x - 2):x + 3].reshape(-1, 3).mean(0)
    im = Image.open(os.path.join(SRC, 'sky', name + '.jpg')).convert('RGB')
    im = im.resize((4096, 2048), Image.LANCZOS)
    if sunc.max() > 100:                               # paint the sun disk (and lens star) out: the page draws its own sun
        a = np.asarray(im).astype(np.float32); cx, cy = (x + 0.5) / W * 4096, (y + 0.5) / H * 2048; R = 5.5 * 4096 / 360
        yy, xx = np.mgrid[0:2048, 0:4096]; d = np.hypot(xx - cx, yy - cy)
        ring = a[(d > R * 1.15) & (d < R * 1.45)].mean(0)
        k = np.clip((R * 1.15 - d) / (R * 0.4), 0, 1)[..., None]; k = k * k * (3 - 2 * k)
        a = a * (1 - k) + ring * k
        blur = np.asarray(Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(70))).astype(np.float32)
        k2 = np.clip((R * 4.2 - d) / (R * 2.4), 0, 1)[..., None]; k2 = k2 * k2 * (3 - 2 * k2)   # lens star: blur it away
        a = a * (1 - k2) + blur * k2
        im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
    im = im.crop((0, 0, 4096, 1152))
    short = name.replace('qwantani_', '').replace('_puresky', '')
    im.save(os.path.join(OUT, f'sky_{short}.jpg'), quality=86)
    meta.append({'name': short, 'sun': [round(v, 4) for v in sun], 'elev': round(math.degrees(el), 2),
                 'sunColor': [round(float(v), 3) for v in sunc / max(1e-6, sunc.max())], 'sunPeak': round(float(sunc.max()), 1),
                 'ambient': [round(float(v), 4) for v in amb]})
    print(short, meta[-1])
json.dump(meta, open(os.path.join(OUT, 'skies.json'), 'w'), indent=1)

# ---- terrain textures for the page: colour at 2k, normal + ARM at 1k ----
for name in ['aerial_grass_rock', 'aerial_rocks_02', 'grass_path_2', 'coast_sand_01']:
    for m, size in (('diff', 2048), ('nor', 1024), ('arm', 1024)):
        im = Image.open(os.path.join(SRC, 'tex', f'{name}_{m}.jpg')).convert('RGB')
        if im.width > size: im = im.resize((size, size), Image.LANCZOS)
        im.save(os.path.join(OUT, f'{name}_{m}.jpg'), quality=88)
for m in ('diff', 'nor'):                               # stone retaining walls of the terraces
    Image.open(os.path.join(SRC, 'tex', f'japanese_stone_wall_{m}.jpg')).convert('RGB').save(os.path.join(OUT, f'japanese_stone_wall_{m}.jpg'), quality=88)
