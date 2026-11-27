# fetch.py: downloads the CC0 source assets of the Blender prototype from Poly Haven into tools/proto/_src/
# (not in git). Usage: python -I fetch.py
import json, os, sys, urllib.request

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_src')
UA = {'User-Agent': 'wallpaper-proto-fetch'}
TEX = {  # name: resolution
    'aerial_grass_rock': '2k', 'aerial_rocks_02': '2k', 'grass_path_2': '2k', 'coast_sand_01': '1k', 'stone_pathway': '1k',
    'grey_roof_tiles': '1k', 'japanese_cedar_planks': '1k', 'white_plaster_rough_01': '1k', 'japanese_stone_wall': '1k',
    'hinoki_planks': '1k', 'sakura_bark': '1k', 'lacquered_cherry_wood': '1k',
}
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'arm': 'arm'}
MODELS = {'shrub_02': '1k', 'boulder_01': '1k'}
SKIES = ['qwantani_dawn_puresky', 'qwantani_morning_puresky', 'qwantani_noon_puresky', 'qwantani_late_afternoon_puresky',
         'qwantani_sunset_puresky', 'qwantani_dusk_2_puresky', 'qwantani_night_puresky']

def api(path):
    with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/' + path, headers=UA)) as r:
        return json.loads(r.read().decode('utf-8'))

def get(url, dst):
    if os.path.exists(dst): return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    print('  ', os.path.relpath(dst, SRC), flush=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r, open(dst + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(dst + '.part', dst)

for name, res in TEX.items():
    files = api('files/' + name)
    for key, short in MAPS.items():
        get(files[key][res]['jpg']['url'], os.path.join(SRC, 'tex', f'{name}_{short}.jpg'))
for name, res in MODELS.items():
    g = api('files/' + name)['gltf'][res]['gltf']
    base = os.path.join(SRC, 'models', name)
    get(g['url'], os.path.join(base, name + '.gltf'))
    for rel, inc in g['include'].items():
        get(inc['url'], os.path.join(base, rel))
for name in SKIES:
    files = api('files/' + name)
    get(files['hdri']['1k']['hdr']['url'], os.path.join(SRC, 'sky', name + '.hdr'))
    get(files['tonemapped']['url'], os.path.join(SRC, 'sky', name + '.jpg'))
print('done')
