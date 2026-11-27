# blender_assets.py: builds the models of the Blender prototype (wallpapers/proto-blossom) and exports them as glTF.
#
#   "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" -b --factory-startup -P tools/proto/blender_assets.py
#
# Needs the Poly Haven sources from fetch.py and the painted textures from textures.py (both in tools/proto/_src/).
# Writes wallpapers/proto-blossom/assets/buildings.glb (pagoda, hall, houses, torii, lanterns, pier, boat) and
# nature.glb (three sakura trees, shrub, grass tuft, boulder). Every object gets an ambient-occlusion bake in its vertex
# colours (Cycles), so the web page gets soft contact shadows for free: three.js multiplies base colour by COLOR_0.
# Objects whose material name starts with "glow" are lit windows/lanterns: the page drives their emission at night.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '_src')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'wallpapers', 'proto-blossom', 'assets'))
os.makedirs(OUT, exist_ok=True)
FAST = '--fast' in sys.argv                     # skip the AO bake (quick geometry iterations)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- materials
_imgs = {}
def img(path, non_color=False):
    if path not in _imgs:
        im = bpy.data.images.load(path)
        if non_color: im.colorspace_settings.name = 'Non-Color'
        _imgs[path] = im
    return _imgs[path]

_mats = {}
def pbr(name, tex=None, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, emit=None, alpha_png=None, double=False):
    """tex: Poly Haven texture name in _src/tex (diff/nor/arm); alpha_png: RGBA base colour with alpha (cards)."""
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if tex:
        d = nt.nodes.new('ShaderNodeTexImage'); d.image = img(os.path.join(SRC, 'tex', tex + '_diff.jpg'))
        nt.links.new(d.outputs['Color'], b.inputs['Base Color'])
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = img(os.path.join(SRC, 'tex', tex + '_nor.jpg'), True)
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        a = nt.nodes.new('ShaderNodeTexImage'); a.image = img(os.path.join(SRC, 'tex', tex + '_arm.jpg'), True)
        sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(a.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], b.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    if alpha_png:
        d = nt.nodes.new('ShaderNodeTexImage'); d.image = img(alpha_png)
        nt.links.new(d.outputs['Color'], b.inputs['Base Color']); nt.links.new(d.outputs['Alpha'], b.inputs['Alpha'])
        double = True
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = 1.0
    m.use_backface_culling = not double
    _mats[name] = m
    return m

M = {
    'roof': pbr('roof_tiles', 'grey_roof_tiles'),
    'plaster': pbr('plaster', 'white_plaster_rough_01'),
    'cedar': pbr('cedar', 'japanese_cedar_planks'),
    'hinoki': pbr('hinoki', 'hinoki_planks'),
    'lacquer': pbr('lacquer', 'lacquered_cherry_wood'),
    'stone': pbr('stone_wall', 'japanese_stone_wall'),
    'paving': pbr('paving', 'stone_pathway'),
    'bark': pbr('sakura_bark', 'sakura_bark'),
    'black': pbr('lacquer_black', color=(0.035, 0.03, 0.035), rough=0.35),
    'bronze': pbr('bronze', color=(0.55, 0.38, 0.16), rough=0.35, metal=1.0),
    'paper': pbr('glow_paper', color=(0.93, 0.88, 0.78), rough=0.9, emit=(1.0, 0.72, 0.42)),
    'lantern': pbr('glow_lantern', color=(0.9, 0.25, 0.2), rough=0.8, emit=(1.0, 0.45, 0.25), double=True),
    'flame': pbr('glow_flame', color=(1.0, 0.8, 0.5), rough=1.0, emit=(1.0, 0.7, 0.35)),
    'blossomA': pbr('blossom_a', alpha_png=os.path.join(SRC, 'gen', 'blossom_a.png'), rough=0.9),
    'blossomB': pbr('blossom_b', alpha_png=os.path.join(SRC, 'gen', 'blossom_b.png'), rough=0.9),
    'leaves': pbr('leaves_a', alpha_png=os.path.join(SRC, 'gen', 'leaves_a.png'), rough=0.8),
}

# ---------------------------------------------------------------- mesh building
def box_uv(bm, tile):
    """World-scale box projection: one texture repeat per `tile` metres on every face."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = ((co.x, co.y) if ax == 2 else (co.y, co.z) if ax == 0 else (co.x, co.z))
            l[uv].uv = (l[uv].uv[0] / tile, l[uv].uv[1] / tile)

def obj_from_bm(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    return ob

def densify(bm, step=0.9):
    """Split long edges: the AO bake samples vertices only, and a box whose corners all sit inside a post or beam
    would come out black. With interior vertices the walls get real values and dark seams where parts meet."""
    for _ in range(6):
        long = [e for e in bm.edges if e.calc_length() > step * 1.4]
        if not long: break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=True)

class Part:
    """Accumulates boxes/cylinders of one material, box-UV'd at `tile` metres."""
    def __init__(s, mat, tile=2.0, smooth=False): s.bm = bmesh.new(); s.mat = mat; s.tile = tile; s.smooth = smooth
    def box(s, cx, cy, cz, sx, sy, sz, rz=0.0):
        r = bmesh.ops.create_cube(s.bm, size=1.0)
        T = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((sx, sy, sz, 1))
        bmesh.ops.transform(s.bm, matrix=T, verts=r['verts'])
        return s
    def cyl(s, cx, cy, z0, z1, r0, r1=None, seg=12):
        r = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=seg, radius1=r0, radius2=r0 if r1 is None else r1, depth=z1 - z0)
        bmesh.ops.translate(s.bm, vec=(cx, cy, (z0 + z1) / 2), verts=r['verts'])
        return s
    def seg(s, a, b, r, seg=8):                  # cylinder between two points
        a, b = Vector(a), Vector(b); d = b - a
        rr = bmesh.ops.create_cone(s.bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.transform(s.bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=rr['verts'])
        return s
    def done(s, name):
        densify(s.bm)
        bmesh.ops.recalc_face_normals(s.bm, faces=s.bm.faces); box_uv(s.bm, s.tile)
        return obj_from_bm(name, s.bm, s.mat, s.smooth)

def hip_roof(name, cx, cy, z0, w, d, h, over=1.5, lift=0.8, mat=None, tile=1.4, thick=0.3, seg=12, cap=None):
    """Hip roof over a w×d footprint, concave East-Asian profile, corners lifting. Four patches with their own UVs, so
    the tile rows always run along the eaves. Returns the roof object plus ridge/hip caps (in `cap` material)."""
    swap = d > w
    if swap: w, d = d, w
    a, b = w / 2 + over, d / 2 + over
    H = lambda t, s: h * t ** 1.45 + lift * abs(s) ** 4 * (1 - t) ** 2
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    def patch(P):                                 # P(s, t) -> (x, y) and along-eave coordinate u
        grid = []; vs = [0.0] * (seg + 1)
        for j in range(seg + 1):
            t = j / seg; row = []
            for i in range(seg + 1):
                s_ = -1 + 2 * i / seg; x, y, u = P(s_, t); row.append((bm.verts.new((x, y, z0 + H(t, s_))), u))
            grid.append(row)
            if j: dz = H(t, 0) - H((j - 1) / seg, 0); vs[j] = vs[j - 1] + math.hypot(b / seg, dz)
        for j in range(seg):
            for i in range(seg):
                q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                try: f = bm.faces.new([v for v, _ in q])
                except ValueError: continue
                for l, (v, u), vv in zip(f.loops, q, [vs[j], vs[j], vs[j + 1], vs[j + 1]]): l[uvl].uv = (u / tile, vv / tile)
    for sg in (1, -1):
        patch(lambda s_, t, sg=sg: (s_ * (a - b * t), sg * b * (1 - t), s_ * (a - b * t) * sg))
        patch(lambda s_, t, sg=sg: (sg * (a - b * t), s_ * b * (1 - t), s_ * b * (1 - t) * -sg))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.01)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
    ob = obj_from_bm(name, bm, mat or M['roof'], smooth=True)
    sol = ob.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = thick; sol.offset = -1
    parts = [ob]
    if cap is not False:                         # ridge and hip caps
        cp = Part(cap or M['roof'], tile=1.0, smooth=True)
        if a - b > 0.05: cp.seg((-(a - b), 0, z0 + h + 0.12), ((a - b), 0, z0 + h + 0.12), 0.26, 10)
        for sx in (1, -1):
            for sy in (1, -1):
                pts = [(sx * (a - b * t), sy * b * (1 - t), z0 + H(t, 1) + 0.12) for t in [k / seg for k in range(seg + 1)]]
                for p0, p1 in zip(pts, pts[1:]): cp.seg(p0, p1, 0.17, 8)
        parts.append(cp.done(name + '_cap'))
    for p in parts:
        if swap: p.rotation_euler.z = math.pi / 2
        p.location = (cx, cy, 0)
    return parts

def join(name, objs):
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        uvs = o.data.uv_layers                      # one UV layer, same name everywhere, or join keeps several
        while len(uvs) > 1: uvs.remove(uvs[1])
        if len(uvs): uvs[0].name = 'UVMap'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name
    return ob

# ---------------------------------------------------------------- buildings
def posts_and_walls(objs, tag, w, d, z0, hgt, wall=True, posts=M['lacquer'], nx=None, ny=None, paper_frac=0.0, rnd=None):
    """A storey: timber posts on a grid, plaster panels between them (some as glowing paper screens), two beams."""
    P, B, W, G = Part(posts, 1.2), Part(M['cedar'], 1.6), Part(M['plaster'], 2.2), Part(M['paper'], 1.0)
    nx = nx or max(2, round(w / 2.4) + 1); ny = ny or max(2, round(d / 2.4) + 1)
    xs = [-w / 2 + w * i / (nx - 1) for i in range(nx)]; ys = [-d / 2 + d * j / (ny - 1) for j in range(ny)]
    for x in xs:
        for y in (ys[0], ys[-1]): P.box(x, y, z0 + hgt / 2, 0.34, 0.34, hgt)
    for y in ys[1:-1]:
        for x in (xs[0], xs[-1]): P.box(x, y, z0 + hgt / 2, 0.34, 0.34, hgt)
    for zz in (z0 + 0.25, z0 + hgt * 0.72, z0 + hgt - 0.18):
        B.box(0, d / 2, zz, w + 0.3, 0.28, 0.3); B.box(0, -d / 2, zz, w + 0.3, 0.28, 0.3)
        B.box(w / 2, 0, zz, 0.28, d + 0.3, 0.3); B.box(-w / 2, 0, zz, 0.28, d + 0.3, 0.3)
    if wall:
        for side, pos, n in (('x', d / 2, xs), ('x', -d / 2, xs), ('y', w / 2, ys), ('y', -w / 2, ys)):
            for p0, p1 in zip(n, n[1:]):
                L = p1 - p0 - 0.34; c = (p0 + p1) / 2
                paper = rnd is not None and rnd.random() < paper_frac
                tgt = G if paper else W
                hh = hgt * 0.72 - 0.4 if paper else hgt - 0.5
                zc = z0 + 0.4 + hh / 2
                if side == 'x': tgt.box(c, pos * 0.985, zc, L, 0.14, hh)
                else: tgt.box(pos * 0.985, c, zc, 0.14, L, hh)
                if paper:                           # lattice over the paper screen
                    for k in range(1, 4):
                        off = -L / 2 + L * k / 4
                        if side == 'x': B.box(c + off, pos * 1.0, zc, 0.06, 0.1, hh)
                        else: B.box(pos * 1.0, c + off, zc, 0.1, 0.06, hh)
                    if side == 'x': B.box(c, pos, zc, L, 0.1, 0.06)
                    else: B.box(pos, c, zc, 0.1, L, 0.06)
                    hu = hgt - 0.5 - hh - 0.1      # plaster above the screen
                    if side == 'x': W.box(c, pos * 0.985, z0 + hgt - 0.25 - hu / 2, L, 0.14, hu)
                    else: W.box(pos * 0.985, c, z0 + hgt - 0.25 - hu / 2, 0.14, L, hu)
    for part, n in ((P, 'posts'), (B, 'beams'), (W, 'walls'), (G, 'paper')):
        if part.bm.verts: objs.append(part.done(f'{tag}_{n}'))
        else: part.bm.free()

def pagoda():
    objs = []; rnd = random.Random(5)
    objs.append(Part(M['stone'], 2.0).box(0, 0, 0.6, 12.5, 12.5, 1.6).box(0, 7.4, 0.2, 4, 3, 0.8).done('pg_plinth'))
    z = 1.4; size = 8.0
    for i in range(5):
        hgt = 4.0 if i == 0 else 2.6
        posts_and_walls(objs, f'pg{i}', size, size, z, hgt, nx=4, ny=4, paper_frac=0.25 if i == 0 else 0.0, rnd=rnd)
        br = Part(M['lacquer'], 1.0)                 # bracket band (tokyō) under the eaves
        for k in range(12):
            a = k / 12 * 2 * math.pi; br.box(math.cos(a) * size * 0.56, math.sin(a) * size * 0.56, z + hgt + 0.25, 0.5, 0.5, 0.5)
        br.box(0, 0, z + hgt + 0.1, size + 0.9, size + 0.9, 0.4)
        objs.append(br.done(f'pg{i}_brackets'))
        objs += hip_roof(f'pg{i}_roof', 0, 0, z + hgt + 0.2, size, size, 1.5 + 0.15 * i, over=2.9 - 0.15 * i, lift=1.0, thick=0.35)
        z += hgt + 1.2; size -= 1.0
    sp = Part(M['bronze'], 1.0, smooth=True).cyl(0, 0, z - 0.6, z + 1.0, 0.7, 0.55, 16)
    for k in range(9): sp.cyl(0, 0, z + 1.0 + k * 0.62, z + 1.18 + k * 0.62, 0.55 - k * 0.03, None, 16)
    sp.cyl(0, 0, z + 1.0, z + 7.0, 0.14, 0.1, 10).cyl(0, 0, z + 7.0, z + 7.6, 0.3, 0.02, 10)
    objs.append(sp.done('pg_spire'))
    return join('pagoda', objs)

def hall():
    objs = []; rnd = random.Random(7)
    objs.append(Part(M['stone'], 2.0).box(0, 0, 0.8, 23, 16, 1.6).done('hl_plinth'))
    for k in range(5): objs.append(Part(M['stone'], 1.5).box(0, 8.6 + k * 0.6, 1.4 - k * 0.32, 7, 0.6, 0.32).done(f'hl_step{k}'))
    objs.append(Part(M['hinoki'], 2.0).box(0, 0, 1.75, 21.5, 14.5, 0.3).done('hl_deck'))
    posts_and_walls(objs, 'hl', 17, 11, 1.9, 5.2, nx=6, ny=4, paper_frac=0.55, rnd=rnd)
    ver = Part(M['lacquer'], 1.2)                      # veranda posts and railing
    for i in range(8):
        x = -10.2 + i * 20.4 / 7
        for y in (7.0, -7.0): ver.box(x, y, 1.9 + 2.3, 0.3, 0.3, 4.6)
    ver.box(0, 7.0, 2.6, 20.5, 0.14, 0.14).box(0, -7.0, 2.6, 20.5, 0.14, 0.14)
    objs.append(ver.done('hl_veranda'))
    objs += hip_roof('hl_roof_low', 0, 0, 6.4, 20.5, 14.5, 1.6, over=1.2, lift=0.6, thick=0.3)
    objs.append(Part(M['plaster'], 2.0).box(0, 0, 8.6, 15, 9.5, 2.4).done('hl_upper'))
    objs += hip_roof('hl_roof', 0, 0, 9.6, 15, 9.5, 5.0, over=3.2, lift=1.4, thick=0.4)
    return join('hall', objs)

def minka(name, seed, w, d, two=False):
    objs = []; rnd = random.Random(seed)
    objs.append(Part(M['stone'], 1.6).box(0, 0, 0.0, w + 1.0, d + 1.0, 1.6).done(name + '_plinth'))
    posts_and_walls(objs, name, w, d, 0.8, 3.2, posts=M['cedar'], paper_frac=0.45, rnd=rnd)
    if two:
        objs += hip_roof(name + '_skirt', 0, 0, 3.9, w, d, 1.0, over=1.0, lift=0.35, thick=0.25)
        posts_and_walls(objs, name + 'u', w * 0.7, d * 0.75, 4.1, 2.8, posts=M['cedar'], paper_frac=0.6, rnd=rnd)
        objs += hip_roof(name + '_roof', 0, 0, 6.85, w * 0.7, d * 0.75, 2.4, over=1.3, lift=0.5, thick=0.3)
    else:
        objs += hip_roof(name + '_roof', 0, 0, 3.95, w, d, 2.6, over=1.3, lift=0.5, thick=0.3)
    return join(name, objs)

def torii():
    objs = []
    p = Part(M['lacquer'], 1.0, smooth=True)
    for x in (-3.0, 3.0): p.cyl(x, 0, 0, 7.6, 0.42, 0.36, 16)
    p.box(0, 0, 6.0, 8.6, 0.42, 0.5).box(0, 0, 7.15, 0.5, 0.36, 1.8)
    objs.append(p.done('to_red'))
    objs.append(Part(M['black'], 1.0).cyl(-3.0, 0, 0, 0.7, 0.5, 0.5, 16).cyl(3.0, 0, 0, 0.7, 0.5, 0.5, 16).done('to_feet'))
    bm = bmesh.new(); r = bmesh.ops.create_grid(bm, x_segments=24, y_segments=1, size=1.0)  # kasagi: curved top beam
    k = Part(M['black'], 1.0, smooth=True)
    pts = [(x, 0, 8.1 + 0.55 * (abs(x) / 5.6) ** 2.4) for x in [-5.6 + 11.2 * i / 24 for i in range(25)]]
    bm.free()
    for p0, p1 in zip(pts, pts[1:]):
        c = ((p0[0] + p1[0]) / 2, 0, (p0[2] + p1[2]) / 2)
        k.box(c[0], 0, c[2], math.dist(p0, p1) + 0.02, 0.7, 0.55)
    objs.append(k.done('to_kasagi'))
    objs.append(Part(M['lacquer'], 1.0).box(0, 0, 7.75, 10.2, 0.5, 0.45).done('to_shimaki'))
    return join('torii', objs)

def stone_lantern():
    s = Part(M['stone'], 0.8, smooth=False)
    s.cyl(0, 0, 0, 0.35, 0.75, 0.7, 6).cyl(0, 0, 0.35, 1.5, 0.2, 0.18, 12).cyl(0, 0, 1.5, 1.75, 0.55, 0.5, 6)
    s.cyl(0, 0, 2.6, 2.8, 0.85, 0.8, 6).cyl(0, 0, 2.8, 3.25, 0.8, 0.12, 6).cyl(0, 0, 3.25, 3.5, 0.16, 0.05, 8)
    for k in range(6):                                 # light box: six posts around a glowing core
        a = k / 6 * 2 * math.pi + math.pi / 6; s.box(math.cos(a) * 0.42, math.sin(a) * 0.42, 2.17, 0.14, 0.14, 0.85)
    g = Part(M['flame'], 0.5).cyl(0, 0, 1.8, 2.55, 0.34, 0.34, 6)
    return join('stone_lantern', [s.done('sl_stone'), g.done('sl_glow')])

def chochin():
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=0.45)
    for v in bm.verts: v.co.z *= 1.35
    lan = obj_from_bm('ch_paper', bm, M['lantern'], smooth=True)
    caps = Part(M['black'], 0.5).cyl(0, 0, 0.5, 0.66, 0.24, 0.24, 12).cyl(0, 0, -0.66, -0.5, 0.24, 0.24, 12).done('ch_caps')
    return join('chochin', [lan, caps])

def pier():
    d = Part(M['hinoki'], 1.5)
    for i in range(16): d.box(0, i * 1.0, 0.0, 2.6, 0.92, 0.12)
    p = Part(M['cedar'], 1.0, smooth=True)
    for i in range(0, 17, 3):
        for x in (-1.15, 1.15): p.cyl(x, i * 1.0 - 0.4, -3.0, 0.9 if i % 6 == 0 else 0.0, 0.14, 0.14, 8)
    return join('pier', [d.done('pi_deck'), p.done('pi_posts')])

def boat():
    """Small wooden boat: lofted hull (cross-sections along the keel), seats, a mast stub."""
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')
    L, N, K = 7.0, 16, 9; rings = []
    for i in range(N + 1):
        t = i / N; y = -L / 2 + L * t
        w = 1.25 * math.sin(math.pi * min(1, max(0, t * 0.92 + 0.04))) ** 0.6 + 0.02
        sheer = 0.9 + 0.35 * (2 * t - 1) ** 4
        ring = []
        for k in range(K + 1):
            a = math.pi * k / K
            ring.append(bm.verts.new((math.cos(a) * w, y, -math.sin(a) * 0.75 * (w / 1.25) ** 0.5 + sheer - 0.9)))
        rings.append(ring)
    for i in range(N):
        for k in range(K):
            f = bm.faces.new([rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]])
            for l, (u, v) in zip(f.loops, [(i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k)]): l[uvl].uv = (u * 0.45, v * 0.28)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    hull = obj_from_bm('bt_hull', bm, M['cedar'], smooth=True)
    sol = hull.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 0.08
    seats = Part(M['hinoki'], 1.0).box(0, -1.2, 0.0, 2.0, 0.4, 0.08).box(0, 1.2, 0.0, 2.0, 0.4, 0.08).done('bt_seats')
    return join('boat', [hull, seats])

# ---------------------------------------------------------------- sakura trees
def sakura(name, seed, scale=1.0, leaf=None, upright=False):
    rnd = random.Random(seed)
    verts, edges, radius, tips = [Vector((0, 0, -1.2 * scale))], [], [0.46 * scale], []   # root sunk into the ground
    def grow(i0, d, length, r, depth):
        i = i0; p = verts[i0].copy(); nseg = 4
        for k in range(nseg):
            d = (d + Vector((rnd.uniform(-.25, .25), rnd.uniform(-.25, .25), rnd.uniform(-.1, .15) - 0.05 * depth))).normalized()
            p = p + d * (length / nseg); verts.append(p.copy()); radius.append(r * (1 - 0.35 * (k + 1) / nseg))
            edges.append((i, len(verts) - 1)); i = len(verts) - 1
            if depth >= 2: tips.append((p.copy(), depth))
        if depth < 4:
            n = 3 if depth == 0 else rnd.choice((2, 2, 3))
            base = rnd.uniform(0, 6.28)
            for c in range(n):
                a = base + c * 2 * math.pi / n + rnd.uniform(-.4, .4)
                spread = (0.9 if depth == 0 else 0.6) + rnd.uniform(-.15, .2)
                nd = (d * math.cos(spread) + Vector((math.cos(a), math.sin(a), 0)) * math.sin(spread)).normalized()
                if depth >= 1 and not upright: nd.z = nd.z * 0.6 + 0.12   # sakura crowns spread wide and flat
                if upright: nd.z = nd.z * 0.8 + 0.35                       # other trees: taller, rounder crowns
                grow(i, nd.normalized(), length * rnd.uniform(0.62, 0.78), r * 0.62, depth + 1)
        else:
            tips.append((p.copy(), depth + 1))
    grow(0, Vector((rnd.uniform(-.15, .15), rnd.uniform(-.15, .15), 1)).normalized(), 4.2 * scale, 0.42 * scale, 0)
    me = bpy.data.meshes.new(name + '_wood'); me.from_pydata([tuple(v) for v in verts], edges, []); me.update()
    wood = bpy.data.objects.new(name + '_wood', me); scene.collection.objects.link(wood)
    sk = wood.modifiers.new('skin', 'SKIN'); sk.use_smooth_shade = True
    for k, sv in enumerate(me.skin_vertices[0].data): sv.radius = (max(0.03, radius[k]),) * 2
    me.skin_vertices[0].data[0].use_root = True
    wood.modifiers.new('sub', 'SUBSURF').levels = 1
    bpy.context.view_layer.objects.active = wood; wood.select_set(True)
    for m in list(wood.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    wood.select_set(False)
    bm = bmesh.new(); bm.from_mesh(wood.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); box_uv(bm, 1.3 * scale); bm.to_mesh(wood.data); bm.free()
    wood.data.materials.append(M['bark'])
    dm = wood.modifiers.new('dec', 'DECIMATE'); dm.ratio = 0.12                # bark detail is mostly in the texture
    bpy.context.view_layer.objects.active = wood; bpy.ops.object.modifier_apply(modifier='dec')
    # blossom: clusters of crossed cards along the outer branches; normals bent outward from the crown centre
    centre = sum((t[0] for t in tips), Vector()) / len(tips); centre.z -= 1.2 * scale
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap'); cn = []
    for p, depth in tips:
        if rnd.random() < (0.55 if depth < 4 else 0.1): continue
        for c in range(5 if depth >= 4 else 2):
            q = p + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-.5, .8))) * 0.8 * scale
            s = rnd.uniform(1.3, 2.0) * scale
            R = (Matrix.Rotation(rnd.uniform(0, 6.28), 3, 'Z') @ Matrix.Rotation(rnd.uniform(-1.2, 1.2), 3, 'X'))
            vs = [bm.verts.new(q + R @ Vector((x * s / 2, 0, y * s / 2))) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            f = bm.faces.new(vs)
            for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): l[uvl].uv = uv
            for v in vs: cn.append(v)
    bm.verts.index_update()
    me2 = bpy.data.meshes.new(name + '_bloom'); bm.to_mesh(me2); bm.free()
    for p in me2.polygons: p.use_smooth = True
    me2.materials.append(leaf or (M['blossomA'] if seed % 2 else M['blossomB']))
    nrm = []
    for v in me2.vertices:
        n = (v.co - centre); n.z *= 0.7; n = (n.normalized() + Vector((0, 0, 0.6))).normalized(); nrm.append(n)
    me2.normals_split_custom_set_from_vertices(nrm)
    bloom = bpy.data.objects.new(name + '_bloom', me2); scene.collection.objects.link(bloom)
    # blossom shading in the vertex colours instead of a bake (the bake can't see through the cards' alpha):
    # dark deep inside the crown and underneath, bright on the outer shell and on top
    ca = me2.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER'); me2.color_attributes.active_color = ca
    rad = max((v.co - centre).length for v in me2.vertices)
    for li, l in enumerate(me2.loops):
        co = me2.vertices[l.vertex_index].co; d = (co - centre).length / rad; up = (co.z - centre.z) / rad
        a = max(0.35, min(1.0, 0.25 + 0.75 * d ** 1.3 + 0.25 * up))
        ca.data[li].color = (a, a, a, 1)
    return wood, bloom

# ---------------------------------------------------------------- Poly Haven models
def import_ph(name, target_tris=None, rename=None, pick=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, 'models', name, name + '.gltf'))
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if pick:                                      # keep one variant of a multi-variant asset
        for o in new:
            if o.name != pick: bpy.data.objects.remove(o)
        new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
        for c in o.children: c.parent = None
    for o in new:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    ob = join(rename or name, new) if len(new) > 1 else new[0]
    ob.name = rename or name
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if target_tris:                               # glTF import splits vertices at every seam: weld first
        bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005); bm.to_mesh(ob.data); bm.free()
    for _ in range(4):                            # decimation stalls on UV seams: repeat until near the target
        cur = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if not target_tris or cur <= target_tris * 1.15: break
        dm = ob.modifiers.new('dec', 'DECIMATE'); dm.ratio = target_tris / cur; dm.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier='dec')
    for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']: bpy.data.objects.remove(o)
    bb = [ob.matrix_world @ v.co for v in ob.data.vertices]                 # origin: centre of the footprint, on the ground
    c = Vector(((min(v.x for v in bb) + max(v.x for v in bb)) / 2, (min(v.y for v in bb) + max(v.y for v in bb)) / 2, min(v.z for v in bb)))
    ob.data.transform(Matrix.Translation(-c)); ob.location = (0, 0, 0)
    print(f'{name}: {tris} -> {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris, size {tuple(round(v, 2) for v in ob.dimensions)}')
    return ob

# ---------------------------------------------------------------- AO bake + export
def bake_ao(objs, distance):
    if FAST: return
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.device = 'CPU'
    if not scene.world: scene.world = bpy.data.worlds.new('w')
    scene.world.light_settings.distance = distance
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.02)); ground = bpy.context.active_object
    ground.data.materials.append(pbr('ground_tmp'))
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs:
        if 'AO' not in o.data.color_attributes: o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        o.data.color_attributes.active_color = o.data.color_attributes['AO']
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    bpy.data.objects.remove(ground)
    for o in objs:
        d = o.data.color_attributes['AO'].data; print(f'  AO {o.name}: mean {sum(c.color[0] for c in d) / max(1, len(d)):.2f}')

def spread(objs, gap=60):                          # lay assets out side by side so they don't occlude each other
    for i, o in enumerate(objs): o.location = ((i % 6) * gap, (i // 6) * gap, 0)
def export(path, objs):
    for o in objs: o.location = (0, 0, 0)
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_vertex_color='ACTIVE',
                              export_image_format='AUTO', export_apply=True, export_yup=True)
    print('wrote', path, round(os.path.getsize(path) / 1e6, 2), 'MB')

build = [pagoda(), hall(), minka('minka_a', 11, 8, 6), minka('minka_b', 12, 9, 7, two=True), minka('minka_c', 13, 12, 6),
         torii(), stone_lantern(), chochin(), pier(), boat()]
for o in build: print(o.name, len(o.data.polygons), 'faces')
spread(build); bake_ao(build, 4.0); export(os.path.join(OUT, 'buildings.glb'), build)
for o in build: bpy.data.objects.remove(o)        # out of the way: they would shadow the nature bake at the origin

trees = [(n, *sakura(n, sd, sc)) for n, sd, sc in (('sakura_a', 3, 1.0), ('sakura_b', 8, 1.15), ('sakura_c', 21, 0.85))]
trees += [(n, *sakura(n, sd, sc, M['leaves'], True)) for n, sd, sc in (('green_a', 31, 0.9), ('green_b', 44, 1.1))]
nature = [w for _, w, _ in trees]
nature += [import_ph('shrub_02', 700, 'shrub', 'shrub_02_b'), import_ph('shrub_02', 900, 'shrub_wide', 'shrub_02_c'), import_ph('boulder_01', 700, 'boulder')]

spread(nature, 40)
for i, (_, _, b) in enumerate(trees): b.location = (-300, i * 60, 0)   # blossoms away from their trunks during the bake
bake_ao(nature, 2.5)
for i, (n, w, b) in enumerate(trees):          # join each baked trunk with its blossom
    w.location = b.location = (0, 0, 0); nature[i] = join(n, [w, b])
for o in nature: print(o.name, sum(len(p.vertices) - 2 for p in o.data.polygons), 'tris')
export(os.path.join(OUT, 'nature.glb'), nature)
