"""Mocha Forest on the shared engine. Values are copied 1:1 from the original hand-written page
(kept in tools/_backup/mocha-forest-classic) so the look stays exactly the same.

usage: python -I forest_scene.py
"""
import json, shutil
from pathlib import Path

HERE = Path(__file__).parent
DEST = HERE.parent / 'wallpapers' / 'animated' / 'mocha-forest'
pts = (HERE / '_backup' / 'mocha-forest-classic' / 'points.js').read_text(encoding='utf-8')
P = json.loads(pts[pts.index('=') + 1:].strip().rstrip(';'))

scene = dict(
    width=2560, height=1440, background='background.jpg', glowStyle='classic',
    foreground=dict(src='foreground.png', y=0),
    effects=[
        # behind the trees
        dict(type='stars', layer='back', points=P['stars'], color='lavender', minSize=2, sizeK=0.5, alphaK=0.55, spMin=0.6),
        dict(type='streakClouds', count=16, y0=150, y1=540, speed=1),
        # in front
        dict(type='waterfall', falls=[dict(x=1185, y=1016, w=10, h=45), dict(x=1200, y=1011, w=27, h=50)],
             mist=dict(x0=1180, x1=1232, y=1060, count=10, color='rosewater')),
        dict(type='glints', points=P['river'], count=80, wMin=4, size=16, drift=3,
             colors=['text', 'sky', 'lavender', 'white'], nearY=1160, nearSize=10, nearColors=['yellow', 'rosewater', 'white']),
        dict(type='motes', x0=300, x1=2300, y0=900, y1=1400, count=26, ax=[20, 70], ay=[10, 35], sizes=[10, 22],
             colors=['yellow', 'yellow', 'peach'], alpha=0.75, core=True, coreR=2.5),
    ])

INDEX = """<!doctype html>
<html><head><meta charset="utf-8"><title>Mocha Forest</title>
<style>html,body{margin:0;height:100%;background:#11111b;overflow:hidden}canvas{position:fixed;inset:0;width:100vw;height:100vh;display:block}</style>
</head><body><canvas id="gl"></canvas><canvas id="fx"></canvas>
<script src="scene.js"></script><script src="engine.js"></script></body></html>
"""

(DEST / 'scene.js').write_text('window.SCENE = ' + json.dumps(scene, separators=(',', ':')) + ';\n', encoding='utf-8')
(DEST / 'index.html').write_text(INDEX, encoding='utf-8')
shutil.copy(HERE / 'engine' / 'engine.js', DEST / 'engine.js')
(DEST / 'project.json').write_text(json.dumps(dict(file='index.html', preview='preview.jpg', title='Mocha Forest', type='web'), indent=2), encoding='utf-8')
(DEST / 'points.js').unlink(missing_ok=True)
print('built mocha-forest:', len(P['stars']), 'stars,', len(P['river']), 'river points')
