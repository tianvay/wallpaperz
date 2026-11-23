"""Helpers for building effect masks and point lists from a source image (2560x1440)."""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

W, H = 2560, 1440
YY, XX = np.mgrid[0:H, 0:W]


def load(path):
    im = Image.open(path).convert('RGB')
    if im.size != (W, H): im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(float)
    return a, a @ [0.299, 0.587, 0.114]


def sat(a):
    mx, mn = a.max(-1), a.min(-1)
    return (mx - mn) / np.maximum(mx, 1)


def soft(mask, blur=3.0):
    return np.clip(nd.gaussian_filter(mask.astype(float), blur), 0, 1)


def rect(x0, y0, x1, y1):
    return (XX >= x0) & (XX < x1) & (YY >= y0) & (YY < y1)


def poly(points):
    img = Image.new('L', (W, H), 0)
    ImageDraw.Draw(img).polygon([tuple(p) for p in points], fill=255)
    return np.asarray(img) > 127


def band(y0, y1, feather=60):
    """1 between y0..y1, fading out over `feather` px on both sides."""
    up = np.clip((YY - (y0 - feather)) / feather, 0, 1)
    dn = np.clip(((y1 + feather) - YY) / feather, 0, 1)
    return np.minimum(up, dn)


def small_bright(L, thresh=28, size=7, maxblob=8, region=None):
    """Small points brighter than their surroundings (stars, distant lights). Returns [[x,y,size]]."""
    med = nd.median_filter(L, size)
    cand = (L - med > thresh)
    if region is not None: cand &= region
    lab, _ = nd.label(cand)
    out = []
    for s in nd.find_objects(lab):
        if s is None: continue
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if max(h, w) <= maxblob:
            out.append([round((s[1].start + s[1].stop) / 2, 1), round((s[0].start + s[0].stop) / 2, 1), max(h, w)])
    return out


def sample(mask, n, seed=1):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0: return []
    k = np.random.default_rng(seed).choice(len(xs), min(n, len(xs)), replace=False)
    return [[int(xs[i]), int(ys[i])] for i in k]


def save_mask(path, r=None, g=None, b=None, a=None):
    z = np.zeros((H, W))
    ch = [np.clip(c if c is not None else z, 0, 1) for c in (r, g, b, a)]
    ch[3] = np.maximum(ch[3], 1 / 255)   # never fully transparent: browsers may drop RGB under alpha 0
    Image.fromarray((np.dstack(ch) * 255 + 0.5).astype(np.uint8), 'RGBA').save(path, optimize=True)


def cutout(path, img_rgb, fg_mask, y0, y1):
    """Foreground cutout (rows y0..y1) used to hide overlay clouds behind cliffs/buildings."""
    a = np.clip(fg_mask[y0:y1], 0, 1)
    rgba = np.dstack([np.asarray(img_rgb)[y0:y1], a * 255]).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(path, optimize=True)


def debug(path, base_rgb, r=None, g=None, b=None, a=None, points=(), fg=None):
    im = np.asarray(base_rgb).astype(float).copy()
    for m, c in ((r, (255, 60, 60)), (g, (60, 255, 60)), (b, (60, 120, 255)), (a, (255, 255, 255)), (fg, (255, 0, 255))):
        if m is not None: im = im * (1 - 0.55 * m[..., None]) + np.array(c) * 0.55 * m[..., None]
    out = Image.fromarray(im.clip(0, 255).astype(np.uint8))
    d = ImageDraw.Draw(out)
    for (pts, c) in points:
        for p in pts: d.ellipse([p[0] - 7, p[1] - 7, p[0] + 7, p[1] + 7], outline=c, width=3)
    out.resize((1280, 720)).save(path, quality=85)
