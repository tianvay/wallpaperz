"""Catppuccin Mocha recolor: maps every colour smoothly onto the 26-colour palette in Oklab."""
import numpy as np
from PIL import Image

HEX = """f5e0dc f2cdcd f5c2e7 cba6f7 f38ba8 eba0ac fab387 f9e2af a6e3a1 94e2d5 89dceb 74c7ec 89b4fa b4befe
cdd6f4 bac2de a6adc8 9399b2 7f849c 6c7086 585b70 45475a 313244 1e1e2e 181825 11111b""".split()
PAL = np.array([[int(h[i:i+2], 16) for i in (0, 2, 4)] for h in HEX]) / 255.0

M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])

def _lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def _srgb(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
def oklab(rgb): return np.cbrt(_lin(rgb) @ M1.T) @ M2.T
def from_oklab(lab): return _srgb(((lab @ np.linalg.inv(M2).T) ** 3) @ np.linalg.inv(M1).T)

def build_lut(n=64, sigma=0.06, keep_light=0.4, light_weight=1.0, vivid=0.0):
    """light_weight < 1 matches more by hue than by brightness (keeps colourful areas colourful).
    vivid > 0 pushes chroma back towards the source chroma (capped at Mocha's accent chroma)."""
    g = np.linspace(0, 1, n)
    grid = np.stack(np.meshgrid(g, g, g, indexing='ij'), -1).reshape(-1, 3)
    lab = oklab(grid); pal = oklab(PAL)
    diff = lab[:, None, :] - pal[None]
    d2 = light_weight * diff[..., 0] ** 2 + diff[..., 1] ** 2 + diff[..., 2] ** 2
    w = np.exp(-d2 / (2 * sigma ** 2)); w /= w.sum(1, keepdims=True) + 1e-12
    m = w @ pal
    # lightness: blend palette lightness with the source lightness squeezed into Mocha's range (crust..text)
    lo, hi = oklab(PAL[[25]])[0, 0], oklab(PAL[[14]])[0, 0]
    m[:, 0] = (1 - keep_light) * m[:, 0] + keep_light * (lo + (hi - lo) * lab[:, 0])
    if vivid:
        c_src = np.hypot(lab[:, 1], lab[:, 2]); c_map = np.hypot(m[:, 1], m[:, 2]) + 1e-6
        target = np.minimum(np.maximum(c_map, c_src), 0.13)
        k = 1 + vivid * (target / c_map - 1)
        m[:, 1] *= k; m[:, 2] *= k
    return from_oklab(m).reshape(n, n, n, 3)

def apply_lut(img, lut):
    n = lut.shape[0]
    idx = img * (n - 1); i0 = np.floor(idx).astype(int).clip(0, n - 2); f = idx - i0
    out = np.zeros_like(img)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                wt = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out += wt[..., None] * lut[i0[..., 0] + dx, i0[..., 1] + dy, i0[..., 2] + dz]
    return out

def recolor(src, dst=None, size=(2560, 1440), **lut_args):
    im = Image.open(src).convert('RGB') if isinstance(src, str) else src
    if size and im.size != size: im = im.resize(size, Image.LANCZOS)
    out = apply_lut(np.asarray(im) / 255.0, build_lut(**lut_args))
    res = Image.fromarray((out * 255 + 0.5).clip(0, 255).astype(np.uint8))
    if dst: res.save(dst, quality=93)
    return res

if __name__ == '__main__':
    import sys
    recolor(sys.argv[1], sys.argv[2])
