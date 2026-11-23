"""Precise window detection for Mocha City + an inpainted 'lights off' layer."""
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from masks import load, rect, W, H

def detect(src, bg):
    a, L = load(src)
    lit = (L - nd.median_filter(L, 15) > 18) & rect(0, 100, 2560, 1345) & ~rect(2440, 1280, 2560, 1360)
    lab, n = nd.label(lit)
    idx = np.arange(1, n + 1)
    area = nd.sum(lit, lab, idx)
    keep = np.zeros(n + 1, bool)
    boxes = []
    for i, s in enumerate(nd.find_objects(lab)):
        if s is None: continue
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        ar = area[i]
        if not (6 <= ar <= 220): continue                  # window sized
        if not (3 <= w <= 30 and 2 <= h <= 14): continue
        if ar / (w * h) < 0.6: continue                     # compact / rectangular, not a diagonal edge
        if w / h > 7 or h / w > 3.5: continue               # not a thin light strip
        keep[i + 1] = True
    win = keep[lab]
    # cover the anti-aliased rim of each window too
    win_d = nd.binary_dilation(win, iterations=1)
    lab2, n2 = nd.label(win_d)
    for s in nd.find_objects(lab2):
        boxes.append([int(s[1].start), int(s[0].start), int(s[1].stop - s[1].start), int(s[0].stop - s[0].start)])
    # inpaint: each window pixel takes the nearest facade pixel (anything not lit)
    blocked = nd.binary_dilation(lit, iterations=1)
    _, (iy, ix) = nd.distance_transform_edt(blocked, return_indices=True)
    bgarr = np.asarray(bg).astype(np.uint8)
    filled = bgarr[iy, ix]
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[..., :3] = np.where(win_d[..., None], filled, 0)
    rgba[..., 3] = win_d * 255
    return boxes, rgba, win_d
