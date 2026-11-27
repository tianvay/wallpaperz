// Blossom Hill, Blender prototype: the same idea as mocha-blossom (a terraced temple hill in cherry blossom, ringed by a
// lake), rebuilt to test a textured, physically lit style. Models come from Blender (tools/proto/blender_assets.py) with
// baked ambient occlusion; terrain, sky and water use CC0 photo textures from Poly Haven.
//
// URL options: ?tod=0.5 (fixed time of day: 0 midnight, .25 sunrise, .5 noon, .75 sunset; default: the real clock)
//   ?day=4 (minutes per simulated day, overrides the clock)  ?fps=30  ?hd=1 (full device pixel ratio)  ?speed=1 (flight)
//   ?t=0 (flight start, s)  ?cam=x,y,z,lx,ly,lz (fixed camera)  ?bloom=0  ?shadows=0
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
import { Water } from './lib/objects/Water.js';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';
import { ShaderPass } from './lib/postprocessing/ShaderPass.js';

const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
const FPS = num('fps', 30), SPEED = num('speed', 1), T0 = num('t', 0);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- noise
function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x, z, oct) {
  let s = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * noise(x, z); n += amp; const nx = x * 1.6 - z * 1.2, nz = x * 1.2 + z * 1.6; x = nx + 17.3; z = nz + 3.1; amp *= 0.5; }
  return s / n;
}
function ridged(x, z, oct) {
  let s = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(noise(x, z)); s += amp * r * r; n += amp; const nx = x * 1.7 - z * 1.1, nz = x * 1.1 + z * 1.7; x = nx + 5.7; z = nz + 9.2; amp *= 0.5; }
  return s / n;
}
function rng(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = rng(1234);

// ---------------------------------------------------------------- land: hill, terraces, lake ring, far mountains
const PLATEAU = 56;                                      // summit plaza radius
function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = 66 * Math.exp(-Math.pow(r / 205, 2.4)) + 4 * fbm(x * 0.008, z * 0.008, 3);
  h -= 13 * Math.exp(-Math.pow((r - 430) / 95, 2)) * (0.7 + 0.5 * (fbm(x * 0.004, z * 0.004 + 5, 3) * 0.5 + 0.5));
  h += 12 * smooth(480, 640, r) * (0.6 + 0.6 * (fbm(x * 0.006 + 40, z * 0.006, 3) * 0.5 + 0.5));
  h += 260 * smooth(820, 1350, r) * (0.35 + 0.9 * ridged(x * 0.0035 + 3, z * 0.0035, 5));
  h += 1.2 * fbm(x * 0.05, z * 0.05, 2);
  const tw = smooth(250, 200, r) * smooth(5, 12, h);       // terraces on the town hill
  if (tw > 0) { const st = 5.5, u = h / st, f = u - Math.floor(u); h += (st * (Math.floor(u) + smooth(0.78, 1, f)) - h) * tw; }
  return h - 3;
}
const TOP = rawHeight(0, 0) + 1.5;
function height0(x, z) {
  const r = Math.hypot(x, z), h = rawHeight(x, z);
  return h + (TOP - h) * smooth(PLATEAU + 14, PLATEAU, r);
}
// pilgrim path: spirals up from a torii on the south shore to the plaza, terrain carved to a smoothed profile
const PX = [], PZ = [], PH = [];
{
  const N = 1400;
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = 330 - (330 - PLATEAU + 4) * t, a = Math.PI / 2 + 1.7 * Math.PI * t + 0.15 * Math.sin(t * 19);
    PX.push(Math.cos(a) * r); PZ.push(Math.sin(a) * r);
  }
  let h = PX.map((x, i) => height0(x, PZ[i]));
  for (let pass = 0; pass < 3; pass++) {
    const o = h.slice();
    for (let i = 0; i < h.length; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - 14); j <= Math.min(h.length - 1, i + 14); j++) { s += o[j]; n++; } h[i] = s / n; }
  }
  for (let i = 0; i < h.length; i++) PH.push(Math.max(0.8, h[i]));
}
const PCELL = 12, PGRID = new Map();
PX.forEach((x, i) => { const k = Math.floor(x / PCELL) * 4096 + Math.floor(PZ[i] / PCELL); if (!PGRID.has(k)) PGRID.set(k, []); PGRID.get(k).push(i); });
let PN_I = -1;
function pathDist(x, z) {
  const ix = Math.floor(x / PCELL), iz = Math.floor(z / PCELL); let best = 1e18; PN_I = -1;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = PGRID.get((ix + a) * 4096 + iz + b); if (!l) continue;
    for (const i of l) { const dx = PX[i] - x, dz = PZ[i] - z, d = dx * dx + dz * dz; if (d < best) { best = d; PN_I = i; } }
  }
  return PN_I < 0 ? 1e9 : Math.sqrt(best);
}
function height(x, z) {
  const h = height0(x, z), d = pathDist(x, z);
  return d > 12 ? h : h + (PH[PN_I] - h) * smooth(12, 4, d);
}

// ---------------------------------------------------------------- renderer, camera
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.get('hd') === '1' ? devicePixelRatio : Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = Q.get('shadows') !== '0'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 1, 12000);
scene.fog = new THREE.FogExp2(0xbfcde0, 0.0006);
const texLoader = new THREE.TextureLoader();
function tex(name, srgb = true, rep = true) {
  const t = texLoader.load('tex/' + name);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- sky: two photo panoramas cross-faded, own sun, night
const SKY_META = await (await fetch('tex/skies.json')).json();
const SKY = {};
for (const m of SKY_META) { const t = tex(`sky_${m.name}.jpg`, true, false); t.wrapS = THREE.RepeatWrapping; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; SKY[m.name] = { ...m, tex: t, phi: Math.atan2(m.sun[2], m.sun[0]) }; }
// keys through the day: sky panorama, sun elevation (deg), sun/env strength, night amount (sky turns Mocha + stars)
const KEYS = [
  { tod: 0.000, sky: 'dusk_2', night: 1, elev: -40, sun: 0.0, env: 0.18, fog: 0.00055 },
  { tod: 0.215, sky: 'dusk_2', night: 1, elev: -12, sun: 0.0, env: 0.18, fog: 0.00055 },
  { tod: 0.255, sky: 'dawn', night: 0, elev: -1, sun: 0.25, env: 0.55, fog: 0.0009 },
  { tod: 0.310, sky: 'morning', night: 0, elev: 16, sun: 2.4, env: 0.9, fog: 0.0007 },
  { tod: 0.500, sky: 'noon', night: 0, elev: 52, sun: 3.0, env: 1.0, fog: 0.00045 },
  { tod: 0.665, sky: 'late_afternoon', night: 0, elev: 19, sun: 2.6, env: 0.95, fog: 0.0006 },
  { tod: 0.730, sky: 'sunset', night: 0, elev: 5, sun: 1.8, env: 0.8, fog: 0.00075 },
  { tod: 0.775, sky: 'dusk_2', night: 0, elev: -3, sun: 0.0, env: 0.5, fog: 0.0007 },
  { tod: 0.835, sky: 'dusk_2', night: 1, elev: -14, sun: 0.0, env: 0.18, fog: 0.00055 },
  { tod: 1.000, sky: 'dusk_2', night: 1, elev: -40, sun: 0.0, env: 0.18, fog: 0.00055 },
];
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { tA: { value: null }, tB: { value: null }, rotA: { value: 0 }, rotB: { value: 0 }, nA: { value: 0 }, nB: { value: 0 }, k: { value: 0 },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(1, 1, 1) }, sunVis: { value: 1 },
    moonDir: { value: new THREE.Vector3(-0.4, 0.5, -0.6).normalize() }, time: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
  fragmentShader: `
    uniform sampler2D tA, tB; uniform float rotA, rotB, nA, nB, k, sunVis, time; uniform vec3 sunDir, sunCol, moonDir; varying vec3 vDir;
    const float PI = 3.14159265;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float cfbm(vec2 p){ float s = 0., a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; } return s; }
    // soft cumulus band: a cloud deck projected onto a plane, thinning towards the zenith, lit from the sun side
    vec4 clouds(vec3 d){
      if (d.y < 0.005) return vec4(0.);
      vec2 p = d.xz / (d.y + 0.12) * 1.6 + vec2(time * 0.006, time * 0.002);
      float n = cfbm(p), cov = smoothstep(0.5, 0.78, n) * smoothstep(0.005, 0.09, d.y) * (1. - smoothstep(0.35, 0.9, d.y) * 0.7);
      float lit = clamp(0.55 + 0.6 * (cfbm(p + normalize(sunDir.xz + 1e-4) * 0.15) - n) * -4. , 0., 1.);
      return vec4(vec3(lit), cov);
    }
    vec3 pano(sampler2D t, float rot, vec3 d){
      float u = (atan(d.z, d.x) - rot) / (2. * PI) + 0.5;
      float v = (asin(clamp(d.y, -1., 1.)) / PI + 0.5 - 0.4375) / 0.5625;
      return texture2D(t, vec2(u, clamp(v, 0.004, 0.999))).rgb;
    }
    vec3 night(vec3 d, vec3 base){
      float y = max(d.y, 0.);
      vec3 col = mix(vec3(0.086, 0.086, 0.15), vec3(0.03, 0.03, 0.06), pow(y, 0.5));       // Mocha base -> crust
      col += vec3(0.20, 0.17, 0.32) * pow(1. - y, 8.) * 0.6;                                 // lavender glow on the horizon
      vec2 sp = vec2(atan(d.z, d.x) * 200., asin(clamp(d.y, -1., 1.)) * 200.);
      vec2 cell = floor(sp); float r = h21(cell);
      if (r > 0.985) { vec2 f = fract(sp) - 0.5 - (vec2(h21(cell + 7.1), h21(cell + 3.3)) - 0.5) * 0.6; float s = smoothstep(0.12, 0.0, length(f));
        col += vec3(0.85, 0.88, 1.0) * s * (0.4 + 0.6 * h21(cell + 1.7)) * (0.7 + 0.3 * sin(time * (1. + 3. * r) + r * 40.)) * smoothstep(0.0, 0.15, d.y); }
      float md = dot(d, moonDir); col += vec3(0.9, 0.9, 1.0) * smoothstep(0.99955, 0.9997, md) + vec3(0.35, 0.36, 0.55) * pow(max(md, 0.), 200.) * 0.5;
      return mix(col, base * 0.15, 0.08);
    }
    void main(){
      vec3 d = normalize(vDir);
      vec3 a = pano(tA, rotA, d), b = pano(tB, rotB, d);
      a = mix(a, night(d, a), nA); b = mix(b, night(d, b), nB);
      vec3 col = mix(a, b, k);
      vec4 cl = clouds(d);
      float nightAmt = mix(nA, nB, k);
      vec3 skyLit = mix(col, vec3(1.), 0.55);                                         // clouds take the sky's tint
      vec3 cc = mix(col * 0.82, skyLit + sunCol * sunVis * 0.25, cl.rgb);
      cc = mix(cc, vec3(0.12, 0.12, 0.2) + col * 0.4, nightAmt * 0.85);
      col = mix(col, cc, cl.a * 0.85);
      float sd = dot(d, sunDir);
      col += sunVis * sunCol * (smoothstep(0.99965, 0.9999, sd) * 6. + pow(max(sd, 0.), 900.) * 1.5 + pow(max(sd, 0.), 40.) * 0.12);
      col = mix(col, col * vec3(0.55, 0.6, 0.7), smoothstep(0.0, -0.25, d.y));             // below the horizon (far side of the lake)
      gl_FragColor = vec4(col, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 64, 32), skyMat); sky.frustumCulled = false; sky.renderOrder = -1;
scene.add(sky);

// horizon colours of each panorama (fog colour), read from a tiny copy of the image
async function horizonColour(t, rot) {
  await new Promise((res) => (t.image ? res() : (t.onUpdate = res, setTimeout(res, 3000))));
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 72; const g = cv.getContext('2d');
  g.drawImage(t.image, 0, 0, 256, 72); const row = g.getImageData(0, 56, 256, 6).data;
  let r = 0, gg = 0, b = 0; for (let i = 0; i < row.length; i += 4) { r += row[i]; gg += row[i + 1]; b += row[i + 2]; }
  const n = row.length / 4; return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

// ---------------------------------------------------------------- lights
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
Object.assign(sun.shadow.camera, { left: -300, right: 300, top: 300, bottom: -300, near: 10, far: 1800 });
sun.target.position.set(0, 20, 0); scene.add(sun, sun.target);
const warm = [];                                            // lantern light around the plaza at night
for (const [x, z] of [[0, 30], [-30, -5], [30, -5]]) { const l = new THREE.PointLight(0xffa860, 0, 70, 1.6); l.position.set(x, TOP + 5, z); scene.add(l); warm.push(l); }
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene(); const envSky = new THREE.Mesh(sky.geometry, skyMat); envScene.add(envSky);
let envRT = null;
function refreshEnv() { const old = envRT; envRT = pmrem.fromScene(envScene, 0, 1, 10000); scene.environment = envRT.texture; if (old) old.dispose(); }

// ---------------------------------------------------------------- terrain: splatted PBR textures
const T = {
  gD: tex('aerial_grass_rock_diff.jpg'), gN: tex('aerial_grass_rock_nor.jpg', false), gA: tex('aerial_grass_rock_arm.jpg', false),
  pD: tex('grass_path_2_diff.jpg'), pN: tex('grass_path_2_nor.jpg', false), pA: tex('grass_path_2_arm.jpg', false),
  rD: tex('aerial_rocks_02_diff.jpg'), rN: tex('aerial_rocks_02_nor.jpg', false), rA: tex('aerial_rocks_02_arm.jpg', false),
  sD: tex('coast_sand_01_diff.jpg'), sN: tex('coast_sand_01_nor.jpg', false),
  wD: tex('japanese_stone_wall_diff.jpg'), wN: tex('japanese_stone_wall_nor.jpg', false),
};
const srgb = (h) => new THREE.Color(h);              // Color() from hex converts sRGB -> linear
const TINT = { tintG: srgb(0x8fc27a), tintG2: srgb(0xa9c983), tintP: srgb(0xc9b3a3), tintR: srgb(0x9a97a8), tintS: srgb(0xe0d2bd), tintAmt: 0.72 };
const TER = 2800, SEG = 520;
const terrainGeo = new THREE.PlaneGeometry(2, 2, SEG, SEG).rotateX(-Math.PI / 2);
{
  const p = terrainGeo.attributes.position, warp = (u) => TER / 2 * (0.3 * u + 0.7 * u * u * u);   // dense in the middle
  for (let i = 0; i < p.count; i++) { const x = warp(p.getX(i)), z = warp(p.getZ(i)); p.setXYZ(i, x, height(x, z), z); }
  terrainGeo.computeVertexNormals();
  const n = terrainGeo.attributes.normal, splat = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), up = n.getY(i), r = Math.hypot(x, z);
    const nz = fbm(x * 0.02, z * 0.02, 3);
    let rock = smooth(0.86, 0.66, up + 0.06 * nz) + 0.7 * smooth(120, 220, y + 40 * nz);
    let sand = smooth(2.8, 0.6, y + 0.8 * nz) * (1 - smooth(500, 560, r) * 0.3);
    let path = smooth(4.2, 2.2, pathDist(x, z)) + (r < PLATEAU + 2 ? 0.8 : 0) + 0.45 * smooth(0.25, 0.7, nz) * smooth(260, 200, r);
    rock = Math.min(1, rock); sand = Math.min(1, sand) * (1 - rock); path = Math.min(1, path) * (1 - rock) * (1 - sand);
    const grass = Math.max(0, 1 - rock - sand - path);
    splat.set([grass, path, rock, sand], i * 4);
  }
  terrainGeo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
}
const terrainMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
terrainMat.onBeforeCompile = (sh) => {
  Object.entries(T).forEach(([k, t]) => (sh.uniforms[k] = { value: t }));
  Object.entries(TINT).forEach(([k, c]) => (sh.uniforms[k] = { value: c }));
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vW; varying vec3 vWN;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vW = (modelMatrix * vec4(transformed, 1.)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    uniform sampler2D gD, gN, gA, pD, pN, pA, rD, rN, rA, sD, sN, wD, wN; varying vec4 vSplat; varying vec3 vW; varying vec3 vWN;
    uniform vec3 tintG, tintG2, tintP, tintR, tintS; uniform float tintAmt;
    // photo detail, palette colour: keep the texture's light/dark pattern, recolour it towards a Catppuccin tint
    vec3 tint(vec3 c, sampler2D t, vec3 col){ vec3 avg = textureLod(t, vec2(0.5), 16.).rgb; float l = dot(c, vec3(.3,.59,.11)) / max(1e-3, dot(avg, vec3(.3,.59,.11)));
      return mix(c, col * l, tintAmt); }
    vec3 tn(sampler2D t, vec2 uv){ return texture2D(t, uv).xyz * 2. - 1.; }
    vec3 upN(vec3 n, vec3 N){ return normalize(vec3(n.x + N.x, abs(n.z) * N.y, -n.y + N.z)); }
    vec3 wSplat; vec3 wNrm; float wRough; float wAO;`)
    .replace('#include <map_fragment>', `
    vec3 N = normalize(vWN);
    vec4 w = vSplat;
    vec2 uvG = vW.xz / 6.5, uvG2 = vW.xz / 23.0, uvP = vW.xz / 5.0, uvS = vW.xz / 7.0;
    float macro = texture2D(gD, vW.xz / 211.).g * 2.0;                       // breaks the tiling of the grass at distance
    float mn = texture2D(pD, vW.xz / 97.).r;
    vec3 cG = tint(mix(texture2D(gD, uvG).rgb, texture2D(gD, uvG2 * 0.7).rgb, 0.4), gD, mix(tintG, tintG2, smoothstep(0.3, 0.7, mn))) * (0.85 + 0.25 * macro);
    vec3 cP = tint(texture2D(pD, uvP).rgb, pD, tintP), cS = tint(texture2D(sD, uvS).rgb, sD, tintS);
    vec3 tw = pow(abs(N), vec3(6.)); tw /= dot(tw, vec3(1.));             // rock: triplanar
    vec2 rx = vW.zy / 16., ry = vW.xz / 16., rz = vW.xy / 16.;
    vec3 cR = tint(texture2D(rD, rx).rgb * tw.x + texture2D(rD, ry).rgb * tw.y + texture2D(rD, rz).rgb * tw.z, rD, tintR);
    // height-aware blend: the path and rock show through in the gaps of the grass, not as a smear
    float hg = texture2D(gA, uvG).r, hp = texture2D(pA, uvP).r;
    w.y *= 0.6 + 0.8 * (1. - hg); w.z *= 0.7 + 0.6 * (1. - hg);
    w = pow(max(w, 0.), vec4(1.6)); w /= max(1e-4, dot(w, vec4(1.)));
    wSplat = cG * w.x + cP * w.y + cR * w.z + cS * w.w;
    // on the town hill the steep parts are terrace walls of dressed stone, not cliff
    float wallF = smoothstep(285., 245., length(vW.xz));
    vec2 wuv = (abs(N.x) > abs(N.z) ? vW.zy : vW.xy) / 3.2;
    cR = mix(cR, texture2D(wD, wuv).rgb * 0.95, wallF);
    vec3 nR = normalize(vec3(0., tn(rN, rx).y, tn(rN, rx).x) * tw.x + upN(tn(rN, ry), N) * tw.y + vec3(tn(rN, rz).xy, 0.) * tw.z + N * 0.6);
    nR = normalize(mix(nR, normalize(N + vec3(tn(wN, wuv).x * 0.6, tn(wN, wuv).y * 0.6, 0.)), wallF));
    wNrm = normalize(upN(tn(gN, uvG), N) * w.x + upN(tn(pN, uvP), N) * w.y + nR * w.z + upN(tn(sN, uvS), N) * w.w);
    vec3 aG = texture2D(gA, uvG).rgb, aP = texture2D(pA, uvP).rgb, aR = texture2D(rA, ry).rgb;
    wRough = aG.g * w.x + aP.g * w.y + aR.g * w.z + 0.95 * w.w;
    wAO = aG.r * w.x + aP.r * w.y + aR.r * w.z + 1. * w.w;
    float wet = smoothstep(1.2, -0.3, vW.y);                                 // damp sand at the waterline
    diffuseColor.rgb = wSplat * mix(1., 0.6, wet) * mix(1., wAO, 0.8);
    wRough = mix(wRough, 0.35, wet);`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
    .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wNrm, 0.)).xyz);');
};
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true; terrain.castShadow = true;
scene.add(terrain);

// ---------------------------------------------------------------- water
const water = new Water(new THREE.PlaneGeometry(6000, 6000), {
  textureWidth: 512, textureHeight: 512, waterNormals: tex('waternormals.jpg', false),
  sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff, waterColor: 0x2c4a5c, distortionScale: 1.6, fog: true,
});
water.rotation.x = -Math.PI / 2; water.position.y = 0; water.material.uniforms.size.value = 3.5;
scene.add(water);

// ---------------------------------------------------------------- models
const gltf = new GLTFLoader();
const [B, NAT] = await Promise.all([gltf.loadAsync('assets/buildings.glb'), gltf.loadAsync('assets/nature.glb')]);
const GLOW = [], BLOSSOM = [];
const wind = { value: 0 };
function prep(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const c = o.geometry.attributes.color;              // baked AO: keep RGB only (the bake leaves alpha undefined)
    if (c && c.itemSize === 4) {
      const a = new Float32Array(c.count * 3); for (let i = 0; i < c.count; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); }
      o.geometry.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    const m = o.material;
    if (m.name.startsWith('glow')) { GLOW.push(m); m.userData.base = m.emissive.clone(); }
    if (m.name.startsWith('blossom') || m.name.includes('grass') || m.name.includes('shrub') || m.alphaMap || (m.map && m.transparent)) {
      m.transparent = false; m.alphaTest = 0.5; m.side = THREE.DoubleSide; m.alphaToCoverage = false;
      const bl = m.name.startsWith('blossom'), lf = m.name.startsWith('leaves');
      if (bl || lf) {                                     // petals and leaves are thin: light shines through (fake translucency)
        BLOSSOM.push(m); m.emissiveMap = m.map; m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = bl ? 0.22 : 0.1; m.roughness = 0.85;
      }
      m.onBeforeCompile = (sh) => {                       // gentle sway, stronger towards the outside of the crown
        sh.uniforms.wind = wind;
        // foliage cards keep their (outward-bent) normal on the back face too, so a crown shades as one soft volume
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float wind;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vec4 wp = vec4(transformed, 1.);
            #ifdef USE_INSTANCING
              wp = instanceMatrix * wp;
            #endif
            float sway = sin(wind * 1.3 + wp.x * 0.11 + wp.z * 0.07) + 0.5 * sin(wind * 2.9 + wp.x * 0.3);
            transformed.x += sway * 0.06 * max(0., transformed.y - 1.0);
            transformed.z += sway * 0.04 * max(0., transformed.y - 1.0);`);
      };
    }
  });
}
prep(B.scene); prep(NAT.scene);
const part = (root, name) => { const o = root.getObjectByName(name); if (!o) console.warn('missing', name); return o; };
// instancing: one InstancedMesh per sub-mesh of a model, all sharing the same transforms
function instance(obj, mats) {
  const meshes = []; obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((o) => { if (o.isMesh) meshes.push([o, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)]); });
  for (const [o, local] of meshes) {
    const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, local)));
    im.castShadow = o.castShadow; im.receiveShadow = true; im.computeBoundingSphere();
    scene.add(im);
  }
}
const M4 = (x, y, z, ry = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
function groundRange(x, z, ry, w, d) {
  let lo = 1e9, hi = -1e9; const c = Math.cos(ry), s = Math.sin(ry);
  for (let i = -1; i <= 1; i += 0.5) for (let j = -1; j <= 1; j += 0.5) {
    const lx = i * w / 2, lz = j * d / 2, h = height(x + lx * c + lz * s, z - lx * s + lz * c); lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return [lo, hi];
}
const taken = [];                                         // circles kept free: [x, z, r]
const free = (x, z, r) => taken.every(([a, b, rr]) => Math.hypot(x - a, z - b) > r + rr);

// summit: pagoda and main hall on the plaza, torii at the foot of the path and halfway up
const place = (name, x, z, ry, yOff = 0) => { const o = part(B.scene, name).clone(); o.position.set(x, height(x, z) + yOff, z); o.rotation.y = ry; scene.add(o); return o; };
place('pagoda', -20, -14, 0.3, 0.2); taken.push([-20, -14, 12]);
place('hall', 20, 6, -0.35, -0.2); taken.push([20, 6, 16]);
{
  const k0 = 30, a0 = Math.atan2(PZ[k0 + 3] - PZ[k0], PX[k0 + 3] - PX[k0]);
  place('torii', PX[k0], PZ[k0], -a0 + Math.PI / 2, -0.3);
  const k1 = Math.floor(PX.length * 0.55), a1 = Math.atan2(PZ[k1 + 3] - PZ[k1], PX[k1 + 3] - PX[k1]);
  place('torii', PX[k1], PZ[k1], -a1 + Math.PI / 2, -0.3);
}
// stone lanterns along the path, both sides alternating
const lanterns = [];
for (let i = 40; i < PX.length - 20; i += 28) {
  const a = Math.atan2(PZ[i + 1] - PZ[i], PX[i + 1] - PX[i]), side = (i / 28) % 2 ? 1 : -1;
  const x = PX[i] - Math.sin(a) * 4.6 * side, z = PZ[i] + Math.cos(a) * 4.6 * side;
  lanterns.push(M4(x, height(x, z) - 0.1, z, rnd() * 6)); taken.push([x, z, 1.5]);
}
instance(part(B.scene, 'stone_lantern'), lanterns);
// houses on the terraces, facing downhill, never on the path
const HOUSE = ['minka_a', 'minka_b', 'minka_c'], houseMats = { minka_a: [], minka_b: [], minka_c: [] }, roofTops = [];
for (let tries = 0, n = 0; tries < 4000 && n < 42; tries++) {
  const r = 75 + rnd() * 175, a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
  const kind = HOUSE[(rnd() * 3) | 0], [w, d] = kind === 'minka_c' ? [13, 7] : kind === 'minka_b' ? [10, 8] : [9, 7];
  if (pathDist(x, z) < 10 + w / 2 || !free(x, z, w * 1.1)) continue;
  const ry = -a + Math.PI / 2 + (rnd() - 0.5) * 0.3;
  const [lo, hi] = groundRange(x, z, ry, w, d); if (hi - lo > 1.1 || lo < 2) continue;
  houseMats[kind].push(M4(x, hi - 0.55, z, ry)); taken.push([x, z, w * 0.62]); roofTops.push(new THREE.Vector3(x, hi + 6, z)); n++;
}
for (const k of HOUSE) instance(part(B.scene, k), houseMats[k]);
// paper lanterns hanging along the path (on short posts)
const chochin = [];
for (let i = 54; i < PX.length - 20; i += 28) {
  const a = Math.atan2(PZ[i + 1] - PZ[i], PX[i + 1] - PX[i]), side = (i / 28) % 2 ? -1 : 1;
  const x = PX[i] - Math.sin(a) * 4.2 * side, z = PZ[i] + Math.cos(a) * 4.2 * side;
  chochin.push(M4(x, height(x, z) + 2.4, z, a));
}
instance(part(B.scene, 'chochin'), chochin);
// sakura: around the houses, along the shore, in a grove behind the hall
const SAK = ['sakura_a', 'sakura_b', 'sakura_c', 'green_a', 'green_b'], sakMats = Object.fromEntries(SAK.map((k) => [k, []]));
for (let tries = 0, n = 0; tries < 14000 && n < 560; tries++) {
  const r = 40 + Math.sqrt(rnd()) * 300, a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, h = height(x, z);
  if (h < 1.2 || pathDist(x, z) < 7 || !free(x, z, 3)) continue;
  if (r > 260 && rnd() < 0.3) continue;
  const s = 0.8 + rnd() * 0.6;
  const green = fbm(x * 0.012 + 9, z * 0.012, 2) > 0.12 || rnd() < 0.18;    // green groves between the blossom
  sakMats[SAK[green ? 3 + ((rnd() * 2) | 0) : (rnd() * 3) | 0]].push(M4(x, h - 0.3, z, rnd() * 6.28, s)); taken.push([x, z, 4 * s]); n++;
}
for (const k of SAK) instance(part(NAT.scene, k), sakMats[k]);
// shrubs, boulders, grass
const shrubs = [], shrubsW = [], boulders = [];
for (let tries = 0; tries < 8000 && shrubs.length + shrubsW.length < 500; tries++) {
  const r = 30 + rnd() * 320, a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, h = height(x, z);
  if (h < 1 || pathDist(x, z) < 5 || !free(x, z, 2.5)) continue;
  (rnd() < 0.5 ? shrubs : shrubsW).push(M4(x, h - 0.15, z, rnd() * 6.28, 1.2 + rnd() * 1.2)); taken.push([x, z, 2]);
}
for (let tries = 0; tries < 3000 && boulders.length < 160; tries++) {
  const r = 60 + rnd() * 300, a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, h = height(x, z);
  if (h < -0.5 || pathDist(x, z) < 5 || !free(x, z, 2)) continue;
  boulders.push(M4(x, h - 0.4, z, rnd() * 6.28, 0.8 + rnd() * 2.2));
}
instance(part(NAT.scene, 'shrub'), shrubs); instance(part(NAT.scene, 'shrub_wide'), shrubsW); instance(part(NAT.scene, 'boulder'), boulders);
// piers on the shore, boats out on the lake
const piers = [];
for (const a of [0.4, 1.9, 2.9, 4.1, 5.3]) {
  let r = 260; while (height(Math.cos(a) * r, Math.sin(a) * r) > 0.4 && r < 420) r += 1;
  const x = Math.cos(a) * (r - 3), z = Math.sin(a) * (r - 3);
  piers.push(M4(x, 0.7, z, -a + Math.PI / 2 + Math.PI));
}
instance(part(B.scene, 'pier'), piers);
const boatSrc = part(B.scene, 'boat'), boats = [];
for (let i = 0; i < 6; i++) { const b = boatSrc.clone(); scene.add(b); boats.push({ o: b, r: 370 + rnd() * 80, a: rnd() * 6.28, w: (0.004 + rnd() * 0.004) * (i % 2 ? 1 : -1), ph: rnd() * 6 }); }

// ---------------------------------------------------------------- falling petals
const PETALS = 2500, petalGeo = new THREE.BufferGeometry(), pp = new Float32Array(PETALS * 3), pr = new Float32Array(PETALS);
for (let i = 0; i < PETALS; i++) { pp.set([(rnd() - 0.5) * 300, rnd() * 80, (rnd() - 0.5) * 300], i * 3); pr[i] = rnd(); }
petalGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3)); petalGeo.setAttribute('seed', new THREE.BufferAttribute(pr, 1));
const petalMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { map: { value: tex('petal.png', true, false) }, time: { value: 0 }, origin: { value: new THREE.Vector3() }, light: { value: new THREE.Color(1, 1, 1) }, scale: { value: innerHeight } },
  vertexShader: `attribute float seed; uniform float time, scale; uniform vec3 origin; varying float vRot; varying float vFade;
    void main(){
      vec3 p = position; float t = time * (0.6 + 0.5 * seed);
      p.x += t * 3.0 + sin(t * 0.7 + seed * 30.) * 4.; p.y -= t * 1.2; p.z += t * 1.4 + cos(t * 0.5 + seed * 20.) * 4.;
      p = mod(p - origin + vec3(150., 0., 150.), vec3(300., 80., 300.)) - vec3(150., 0., 150.) + origin;
      vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
      gl_PointSize = scale * 0.22 / -mv.z; vRot = t * (1. + seed * 2.) + seed * 6.28; vFade = smoothstep(260., 60., -mv.z) * smoothstep(2., 8., -mv.z);
    }`,
  fragmentShader: `uniform sampler2D map; uniform vec3 light; varying float vRot; varying float vFade;
    void main(){
      vec2 c = gl_PointCoord - 0.5; float s = sin(vRot), co = cos(vRot); c = mat2(co, -s, s, co) * c; c.y *= 1.0 + 0.6 * abs(sin(vRot * 0.7));
      vec4 t = texture2D(map, c + 0.5); if (t.a < 0.3) discard;
      gl_FragColor = vec4(vec3(1.0, 0.8, 0.88) * light, t.a * vFade);
      #include <colorspace_fragment>
    }`,
});
const petals = new THREE.Points(petalGeo, petalMat); petals.frustumCulled = false; scene.add(petals);

// ---------------------------------------------------------------- post: bloom, grade (soft pastel, a touch of Mocha in the shadows), vignette
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 0.92);
if (Q.get('bloom') !== '0') composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, night: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float night; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 0.92);                                          // slightly softer saturation
      c = c * 0.94 + vec3(0.045, 0.04, 0.07) * (1. - l);                  // lift the shadows towards Mocha lavender
      c = mix(c, c * vec3(0.92, 0.95, 1.08), night * 0.5);
      vec2 d = vUv - 0.5; c *= 1. - dot(d, d) * 0.45;                     // vignette
      gl_FragColor = vec4(c, 1.);
    }`,
});
composer.addPass(grade);

// ---------------------------------------------------------------- time of day
function todNow(t) {
  if (Q.has('tod')) return num('tod', 0.5) % 1;
  if (Q.has('day')) return (0.3 + t / (num('day', 4) * 60)) % 1;
  const d = new Date(); return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) / 24;
}
const fogCol = {}; await Promise.all(Object.values(SKY).map(async (s) => (fogCol[s.name] = await horizonColour(s.tex))));
const NIGHT_FOG = new THREE.Color(0x1e1e2e), _c1 = new THREE.Color(), _c2 = new THREE.Color();
let lastEnv = -1, lastEnvKey = '';
function applyTime(tod) {
  let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].tod <= tod) i++;
  const A = KEYS[i], Bk = KEYS[i + 1], k = smooth(0, 1, (tod - A.tod) / (Bk.tod - A.tod));
  const elev = lerp(A.elev, Bk.elev, k) * Math.PI / 180;
  const az = Math.PI * (tod - 0.25) / 0.5;                                // east (+x) at 6:00, south (+z) at noon, west at 18:00
  const sd = new THREE.Vector3(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az));
  const night = lerp(A.night, Bk.night, k), sunI = lerp(A.sun, Bk.sun, k);
  const sa = SKY[A.sky], sb = SKY[Bk.sky], u = skyMat.uniforms;
  u.tA.value = sa.tex; u.tB.value = sb.tex; u.rotA.value = az - sa.phi; u.rotB.value = az - sb.phi; u.nA.value = A.night; u.nB.value = Bk.night; u.k.value = k;
  const sc = _c1.fromArray(sa.sunColor).lerp(_c2.fromArray(sb.sunColor), k);
  u.sunDir.value.copy(sd); u.sunCol.value.copy(sc); u.sunVis.value = smooth(-0.04, 0.02, sd.y) * (1 - night);
  // light: the sun by day, a pale moon by night (same shadow-casting light)
  const moon = new THREE.Vector3(-0.45, 0.55, -0.7).normalize(), moonI = 0.35 * night;
  if (sunI > moonI) { sun.position.copy(sd).multiplyScalar(900).add(sun.target.position); sun.color.copy(sc).lerp(new THREE.Color(1, 1, 1), 0.35); sun.intensity = sunI * smooth(-0.03, 0.06, sd.y); }
  else { sun.position.copy(moon).multiplyScalar(900).add(sun.target.position); sun.color.setRGB(0.62, 0.66, 0.95); sun.intensity = moonI; }
  scene.environmentIntensity = lerp(A.env, Bk.env, k);
  scene.fog.density = lerp(A.fog, Bk.fog, k);
  scene.fog.color.copy(fogCol[sa.name]).lerp(NIGHT_FOG, A.night).lerp(_c2.copy(fogCol[sb.name]).lerp(NIGHT_FOG, Bk.night), k);
  water.material.uniforms.sunDirection.value.copy(sun.position).sub(sun.target.position).normalize();
  water.material.uniforms.sunColor.value.copy(sun.color).multiplyScalar(Math.min(1, sun.intensity / 2));
  water.material.uniforms.waterColor.value.setRGB(0.12, 0.2, 0.26).lerp(new THREE.Color(0.06, 0.06, 0.12), night);
  // lit windows and lanterns from dusk to dawn
  const glow = smooth(0.2, 0.85, night + (1 - smooth(-0.05, 0.12, sd.y)) * 0.6);
  for (const m of GLOW) m.emissive.copy(m.userData.base).multiplyScalar(glow * (m.name === 'glow_paper' ? 1.6 : 4));
  for (const l of warm) l.intensity = glow * 900;
  bloom.strength = lerp(0.18, 0.7, glow); bloom.threshold = lerp(0.95, 0.75, glow);
  petalMat.uniforms.light.value.setScalar(lerp(1, 0.25, night));
  grade.uniforms.night.value = night;
  const key = A.sky + Bk.sky;
  if (Math.abs(tod - lastEnv) > 0.004 || key !== lastEnvKey) { refreshEnv(); lastEnv = tod; lastEnvKey = key; }
}

// ---------------------------------------------------------------- flight
const CAM = Q.has('cam') ? Q.get('cam').split(',').map(Number) : null;
function fly(t) {
  if (CAM) { camera.position.set(CAM[0], CAM[1], CAM[2]); camera.lookAt(CAM[3], CAM[4], CAM[5]); return; }
  const a = t * 0.012 * SPEED + 1.2, r = 395 + 35 * Math.sin(t * 0.009 + 1);
  const x = Math.cos(a) * r, z = Math.sin(a) * r, y = Math.max(height(x, z) + 25, 34 + 26 * Math.sin(t * 0.013) ** 2);
  camera.position.set(x, y, z);
  camera.lookAt(Math.cos(a + 0.5) * 60, TOP * 0.55 + 6 * Math.sin(t * 0.02), Math.sin(a + 0.5) * 60);
}

// ---------------------------------------------------------------- loop
let vw = 0, vh = 0;
function fit() {                                          // also catches a page that started in a hidden (0×0) window
  if (innerWidth === vw && innerHeight === vh) return;
  vw = innerWidth; vh = innerHeight;
  renderer.setSize(vw, vh); composer.setSize(vw, vh);
  camera.aspect = vw / Math.max(1, vh); camera.updateProjectionMatrix(); petalMat.uniforms.scale.value = vh;
}
const clock = new THREE.Clock(); let acc = 1, last = 0, frame = 0;
renderer.shadowMap.autoUpdate = false;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta(); acc += dt; if (acc < 1 / FPS - 0.002) return; acc = 0;
  fit(); if (!vw || !vh) return;
  const t = clock.elapsedTime + T0;
  applyTime(todNow(t)); fly(t);
  wind.value = t; skyMat.uniforms.time.value = t;
  water.material.uniforms.time.value = t * 0.35;
  petalMat.uniforms.time.value = t; petalMat.uniforms.origin.value.copy(camera.position).setY(camera.position.y - 40);
  for (const b of boats) {
    b.a += b.w * Math.min(dt * FPS, 3) * 0.033 * 30 * (1 / FPS) * FPS / 30;
    const x = Math.cos(b.a) * b.r, z = Math.sin(b.a) * b.r;
    b.o.position.set(x, 0.15 + 0.08 * Math.sin(t * 1.3 + b.ph), z);
    b.o.rotation.set(0.03 * Math.sin(t * 0.9 + b.ph), -b.a + (b.w > 0 ? 0 : Math.PI), 0.04 * Math.sin(t * 1.1 + b.ph));
  }
  frame++;
  renderer.shadowMap.needsUpdate = frame % 3 === 1;         // the sun crawls; shadows needn't be redrawn every frame
  composer.render();
  last = t;
});
window.__ready = true; window.__dbg = { scene, camera, renderer, composer };   // for debugging from the console
