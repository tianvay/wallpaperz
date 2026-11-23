"""Builds animated Catppuccin Mocha wallpapers from the images in wallpapers/_todos.

usage:  python -I build.py [scene ...]        (no args = all scenes)
Each scene: recolor -> effect mask (R water, G sky, B lights, A fog) -> overlay effects -> wallpapers/mocha-<name>/
"""
import json, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import mocha
from masks import *

ROOT = Path(__file__).resolve().parent.parent
TODO = ROOT / 'wallpapers' / '_todos'
OUT = Path(__file__).parent / '_out'
ENGINE = Path(__file__).parent / 'engine' / 'engine.js'

V_SOFT = dict(keep_light=0.5, light_weight=0.3, vivid=0.6)   # balanced
V_VIVID = dict(keep_light=0.6, light_weight=0.15, vivid=1.0)  # keeps neon / warm lights


# ---------------------------------------------------------------------------------------------- scenes
def city():
    src = TODO / '5813490.jpg'
    a, L = load(src)
    lit = (L - nd.median_filter(L, 15) > 18) & rect(0, 100, 2560, 1345) & ~rect(2440, 1280, 2560, 1360)
    fog = band(390, 520, 130) * 0.8
    far = small_bright(L, 22, 9, 6, rect(0, 405, 2560, 485))
    lab, n = nd.label(lit)
    sizes = nd.sum(lit, lab, range(1, n + 1))
    boxes = [(s[1].start, s[0].start, s[1].stop - s[1].start, s[0].stop - s[0].start)
             for i, s in enumerate(nd.find_objects(lab)) if s is not None and 6 <= sizes[i] <= 260]
    boxes = [b for b in boxes if 4 <= b[2] <= 34 and 3 <= b[3] <= 16 and b[2] * b[3] <= 420]

    def post(bg, scene):
        # each window gets the facade colour around it, so "off" looks like an unlit window, not a hole
        items = []
        for x, y, w, h in boxes:
            x0, y0, x1, y1 = max(x - 3, 0), max(y - 3, 0), min(x + w + 3, W), min(y + h + 3, H)
            ring = bg[y0:y1, x0:x1].reshape(-1, 3)
            inner = lit[y0:y1, x0:x1].reshape(-1)
            px = ring[~inner] if (~inner).sum() >= 4 else ring
            r, g, b = np.median(px, 0).astype(int)
            items.append([int(x), int(y), int(w), int(h), f'#{r:02x}{g:02x}{b:02x}'])
        scene['effects'].insert(0, dict(type='windows', items=items, off=0.12, onTime=[12, 80], offTime=[4, 30]))

    return dict(
        title='Mocha City (animated)', src=src, recolor=V_VIVID, post=post,
        mask=dict(a=fog),
        scene=dict(amp=dict(fog=0.3), fog=dict(color='lavender'), effects=[
            dict(type='beams', items=[
                dict(x=1570, y=60, w=200, h=200, color='teal', alpha=0.25),
                dict(x=1740, y=90, w=60, h=320, color='yellow', alpha=0.3),
                dict(x=1137, y=180, w=60, h=210, color='sky', alpha=0.3, sway=0.18),   # slowly sweeping searchlight
                dict(x=1815, y=110, w=110, h=240, color='teal', alpha=0.25)]),
            dict(type='glows', items=[
                dict(x=665, y=259, r=12, color='red', blink=True, speed=1.0, alpha=1),
                dict(x=745, y=259, r=12, color='red', blink=True, speed=1.0, alpha=1),
                dict(x=1137, y=383, r=12, color='red', blink=True, speed=0.8, alpha=1),
                dict(x=1737, y=405, r=12, color='red', blink=True, speed=0.9, alpha=1),
                dict(x=1290, y=312, r=60, color='teal', speed=0.6, alpha=0.35),
                dict(x=1785, y=1000, r=160, color='sky', speed=0.4, alpha=0.18)]),
            dict(type='stars', points=far, color='peach', scale=0.6, alpha=0.6),
            dict(type='plane', y=170, speed=16),
            dict(type='plane', y=125, speed=11, dir=-1),
            dict(type='shootingStar', x0=200, x1=2300, y0=110, y1=260, every=[15, 45], color='lavender')]))


def mountains():
    src = TODO / 'mountains-retreat-minimal-beautiful-4k-vl-2560x1440.jpg'
    a, L = load(src)
    lake = (YY > 1000) & (a[..., 2] > a[..., 0] + 15) & (L > 70)
    lake = nd.binary_opening(lake, iterations=2)
    clouds = (L > 215) & (rect(0, 40, 480, 330) | rect(1800, 100, 2450, 345) | rect(740, 180, 1050, 295))
    lights = (L > 150) & rect(935, 775, 1035, 828)      # cabin windows; the lantern only gets the round glow
    refl = rect(2020, 1203, 2095, 1238) & lake
    lake_in = nd.binary_erosion(lake, iterations=8)      # keep shorelines, boat and rocks crisp
    return dict(
        title='Mocha Mountains (animated)', src=src, recolor=V_SOFT,
        mask=dict(r=soft(lake_in, 3), b=soft(lights, 1.5), a=band(940, 1060, 80) * soft(L > 48, 3)),
        scene=dict(amp=dict(water=0.6, lights=1.2, fog=0.6), waterScale=0.8, lightCell=12, fog=dict(color='text'), effects=[
            dict(type='streaks', points=sample(lake_in & (YY > 1070), 800, 3), colors=['text', 'lavender'], count=28, len=90, speed=5, alpha=0.25),
            dict(type='smoke', x=1003, y=762, drift=-16, rise=8, color='overlay2', alpha=0.2),
            # rings where the fishing line meets the water, now and then a "fish" somewhere on the lake
            dict(type='ripples', points=[[1893, 1203]] * 8 + sample(lake_in & (YY > 1080), 12, 5), every=[2.5, 6], size=24, color='text', alpha=0.45),
            dict(type='birds', y0=300, y1=430, count=5, color='surface0', alpha=0.45),
            # fireflies like in Mocha Forest: along the trees and fence in front, a few around the cabin
            dict(type='motes', x0=120, x1=2450, y0=1180, y1=1400, count=22, colors=['yellow', 'yellow', 'peach'], core=True),
            dict(type='motes', x0=60, x1=520, y0=900, y1=1180, count=6, colors=['yellow', 'peach'], core=True),
            dict(type='motes', x0=820, x1=1150, y0=760, y1=880, count=5, size=0.7, colors=['yellow'], core=True),
            dict(type='glows', items=[
                dict(x=953, y=815, r=34, color='yellow', speed=0.7, alpha=0.5, flicker=0.15),
                dict(x=990, y=815, r=34, color='yellow', speed=0.9, alpha=0.5, flicker=0.15),
                dict(x=1015, y=787, r=20, color='yellow', speed=0.6, alpha=0.4),
                dict(x=2030, y=1156, r=46, color='yellow', speed=1.3, alpha=0.65, flicker=0.25),
                dict(x=1935, y=24, r=110, color='rosewater', speed=0.3, alpha=0.3)]),
            dict(type='glints', points=sample(lake_in & (YY > 1060), 600), colors=['text', 'lavender', 'white'], count=30, size=12),
            dict(type='glints', points=sample(refl, 120, 2), colors=['yellow', 'peach'], count=14, size=10, alpha=0.8)]))


def tranquility():
    src = TODO / 'tranquility-minimal-4k-6q-2560x1440.jpg'
    a, L = load(src)
    stars = [s for s in small_bright(L, 20, 7, 6, rect(0, 0, 2560, 430)) if not (1450 < s[0] < 1780 and 330 < s[1] < 620)]
    river = (YY > 1092) & (XX > 920) & (XX < 1790) & (L > 115)
    river = nd.binary_opening(river, iterations=2)
    river_in = nd.binary_erosion(river, iterations=6)
    fg = soft((L < 100) | (YY > 800), 1.0)
    return dict(
        title='Mocha Tranquility (animated)', src=src, recolor=V_SOFT,
        mask=dict(r=soft(river_in, 3), a=band(965, 1075, 55) * rect(480, 0, 2080, H) * soft(L > 70, 3)),
        fg=(fg, 380, 830),
        scene=dict(amp=dict(water=0.6, fog=0.4), waterScale=0.9, fog=dict(color='pink'), effects=[
            dict(type='shootingStar', x0=200, x1=2300, y0=30, y1=330, every=[10, 35], color='rosewater'),
            dict(type='motes', x0=520, x1=1050, y0=1120, y1=1360, count=10, colors=['yellow', 'peach'], core=True, coreR=2.5),
            dict(type='motes', x0=1680, x1=2060, y0=1120, y1=1330, count=8, colors=['yellow', 'peach'], core=True, coreR=2.5),
            dict(type='streaks', points=sample(river_in, 800, 3), colors=['rosewater', 'text'], count=22, len=50, speed=4, alpha=0.3),
            dict(type='clouds', y0=520, y1=770, count=7, size=1.4, speed=0.8, alpha=0.7, colors=['rosewater', 'flamingo', 'pink']),
            dict(type='stars', points=stars, color='lavender'),
            dict(type='glows', items=[dict(x=1612, y=478, r=260, color='rosewater', speed=0.3, alpha=0.3)]),
            dict(type='glints', points=sample(river_in, 700), colors=['rosewater', 'pink', 'white'], count=40, size=14)]))


def beach():
    src = TODO / 'wallpapersden.com_beach-minimalist-digital-art-5k_2560x1440.jpg'
    a, L = load(src)
    sea = (YY > 788) & (a[..., 2] > a[..., 0] + 12) & (L < 205)
    sea = nd.binary_opening(sea, iterations=2)
    foam = (YY > 780) & (L > 195) & (sat(a) < 0.2)
    skyref = a[:, 40:41, :]
    notsky = np.sqrt(((a - skyref) ** 2).sum(-1)) > 20
    fg = soft(notsky | (YY > 780), 1.0)
    sea_in = nd.binary_erosion(sea, iterations=10)
    foam = nd.binary_opening(foam, iterations=1)
    # Flat vector art: no pixel warping at all. Calm overlays in the same flat style instead.
    return dict(
        title='Mocha Beach (animated)', src=src, recolor=V_SOFT,
        mask=dict(),
        fg=(fg, 0, 800),
        layers={'foam.png': (soft(foam, 1.2), 780, 1440, 0.35)},
        scene=dict(effects=[
            dict(type='clouds', y0=140, y1=560, count=6, size=1.6, speed=0.7, alpha=0.6, colors=['rosewater', 'text', 'lavender']),
            dict(type='pulse', src='foam.png', y=780, min=0, max=0.55, speed=0.45),
            dict(type='streaks', points=sample(sea_in, 1200, 3), colors=['text', 'sky', 'lavender'], count=40, len=110, speed=5, alpha=0.28),
            dict(type='birds', y0=230, y1=480, count=4, color='surface0', alpha=0.55),
            dict(type='sailboat', y=785, x0=60, x1=690, speed=3, color='surface0', alpha=0.7),
            dict(type='ripples', points=sample(sea_in & (YY > 860), 40, 6), every=[4, 9], size=28, color='text', alpha=0.35),
            dict(type='glints', points=sample(sea_in, 900), colors=['text', 'white'], count=30, size=14, alpha=0.45)]))


def street():
    src = TODO / 'wallpapersden.com_k-lonely-japanese-city_2560x1440.jpg'
    a, L = load(src)
    road = poly([(0, 1262), (820, 1215), (1300, 1150), (1700, 1128), (2150, 1185), (2560, 1300), (2560, 1440), (0, 1440)])
    road &= ~rect(1735, 1000, 2110, 1212)
    skyp = poly([(880, 0), (2440, 0), (2440, 330), (2150, 330), (2000, 560), (1800, 690), (1700, 880), (1600, 960), (1500, 880), (1300, 500), (1150, 350), (880, 180)])
    sky = skyp & (L > 55) & (sat(a) > 0.25)
    warm = (a[..., 0] > 200) & (a[..., 1] > 130) & (L > 165) & (YY < 1180) & ~skyp
    boards = rect(675, 378, 798, 640) | rect(596, 746, 701, 890)
    lamps = [(2535, 701, 70), (1867, 816, 45), (1900, 834, 34), (2156, 733, 40), (2214, 694, 22)]
    road_in = nd.binary_erosion(road, iterations=6)
    near_dark = nd.binary_dilation(L < 85, iterations=14)
    stars = [p for p in small_bright(L, 28, 7, 5, skyp & (YY < 520) & ~near_dark)
             if sat(a)[int(p[1]), int(p[0])] < 0.4 and L[int(p[1]), int(p[0])] > 140]
    shine = road_in & (L > 140)      # bright reflections on the wet road
    # Painterly picture: sky and buildings stay completely still. Only the wet road reflections sway and glint.
    return dict(
        title='Mocha Street (animated)', src=src, recolor=V_VIVID,
        mask=dict(r=soft(road_in, 4)),
        scene=dict(amp=dict(water=0.5), waterScale=1.0, sparkle=0.6, effects=[
            dict(type='stars', points=stars, color='rosewater', scale=0.9, alpha=0.9),
            dict(type='shootingStar', x0=1000, x1=2300, y0=20, y1=230, every=[12, 40], color='rosewater'),
            dict(type='plane', y=120, speed=12, dir=-1, x0=900, x1=2420),
            # moths fluttering around the street lamps
            *[dict(type='motes', x0=x - 35, x1=x + 35, y0=y - 25, y1=y + 30, count=4, ax=[6, 18], ay=[4, 12], sizes=[3, 6],
                   colors=['peach', 'yellow'], alpha=0.6) for x, y, r in lamps[:4]],
            # fireflies in the bushes and planters
            dict(type='motes', x0=2160, x1=2540, y0=1000, y1=1230, count=8, colors=['yellow', 'yellow', 'peach'], core=True, coreR=2.5),
            dict(type='motes', x0=160, x1=700, y0=1030, y1=1180, count=6, colors=['yellow', 'peach'], core=True, coreR=2.5),
            dict(type='glints', points=sample(shine, 1500, 4), colors=['peach', 'yellow', 'rosewater', 'white'], count=60, size=10, alpha=0.6),
            dict(type='glows', items=[dict(x=x, y=y, r=r, color='peach', speed=0.8, alpha=0.5, flicker=0.1) for x, y, r in lamps] + [
                dict(x=737, y=508, r=170, color='sky', speed=0.5, alpha=0.2),
                dict(x=648, y=818, r=120, color='sky', speed=0.7, alpha=0.2)]),
            dict(type='glints', points=sample(road_in & (L > 90), 900), colors=['pink', 'lavender', 'sky'], count=30, size=14, alpha=0.4)]))


SCENES = dict(city=city, mountains=mountains, tranquility=tranquility, beach=beach, street=street)

INDEX = """<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>html,body{{margin:0;height:100%;background:#11111b;overflow:hidden}}canvas{{position:fixed;inset:0;width:100vw;height:100vh;display:block}}</style>
</head><body><canvas id="gl"></canvas><canvas id="fx"></canvas>
<script src="scene.js"></script><script src="engine.js"></script></body></html>
"""


def build(name):
    d = SCENES[name]()
    dest = ROOT / 'wallpapers' / f'mocha-{name}'
    dest.mkdir(parents=True, exist_ok=True)
    bg = mocha.recolor(str(d['src']), str(dest / 'background.jpg'), **d['recolor'])
    if 'post' in d: d['post'](np.asarray(bg).astype(float), d['scene'])   # scene tweaks that need the recolored pixels
    bg.resize((640, 360)).save(dest / 'preview.jpg', quality=85)
    m = d.get('mask', {})
    save_mask(dest / 'mask.png', m.get('r'), m.get('g'), m.get('b'), m.get('a'))
    scene = dict(width=W, height=H, background='background.jpg', mask='mask.png', **d['scene'])
    if 'fg' in d:
        fgm, y0, y1 = d['fg']
        cutout(dest / 'foreground.png', bg, fgm, y0, y1)
        scene['foreground'] = dict(src='foreground.png', y=y0)
    # extra image layers cut from the recolored picture, optionally lightened: name -> (mask, y0, y1, lighten)
    for fname, (lm, y0, y1, lighten) in d.get('layers', {}).items():
        arr = np.asarray(bg).astype(float)
        arr = arr + (255 - arr) * lighten
        cutout(dest / fname, Image.fromarray(arr.clip(0, 255).astype(np.uint8)), lm, y0, y1)
    (dest / 'scene.js').write_text('window.SCENE = ' + json.dumps(scene, separators=(',', ':')) + ';\n', encoding='utf-8')
    shutil.copy(ENGINE, dest / 'engine.js')
    (dest / 'index.html').write_text(INDEX.format(title=d['title']), encoding='utf-8')
    (dest / 'project.json').write_text(json.dumps(dict(file='index.html', preview='preview.jpg', title=d['title'], type='web'), indent=2), encoding='utf-8')
    pts = [(e['points'], (255, 255, 0)) for e in d['scene']['effects'] if e['type'] in ('stars',)]
    debug(OUT / f'dbg_{name}.jpg', bg, m.get('r'), m.get('g'), m.get('b'), m.get('a'), pts, d['fg'][0] if 'fg' in d else None)
    print(f'built {dest.name}')


if __name__ == '__main__':
    for n in (sys.argv[1:] or SCENES): build(n)
