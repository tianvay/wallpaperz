// kit3d.js: shared engine for the 3D flight wallpapers (Blossom Hill, Observatory Ridge, ...).
// Master copy lives in tools/kit3d/; each wallpaper folder holds a copy next to its lib/ (three.js r170).
// A scene calls createWorld(cfg), adds its content with the helpers, then calls world.finish().
//
// URL options understood by every scene:
//   ?speed=1  ?t=0 (start offset s)  ?day=60 (minutes per day)  ?tod=0.68 (0 midnight .25 sunrise .5 noon .75 sunset)
//   ?fps=60  ?bloom=1  ?hd=0  ?cam=x,y,z,lookX,lookY,lookZ (debug: fixed camera)
//   ?clock=11:59:40 (debug: start the wall clock at this time)  ?clockrate=1 (debug: wall clock runs this many times faster)
import * as THREE from 'three';
import { Reflector } from './lib/Reflector.js';
import { mergeGeometries } from './lib/BufferGeometryUtils.js';
import { EffectComposer } from './lib/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './lib/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/postprocessing/OutputPass.js';
import { ShaderPass } from './lib/postprocessing/ShaderPass.js';
export { THREE, mergeGeometries };

// ---------- palettes ----------
const C = (h) => new THREE.Color(h);
export const P = {   // Catppuccin Mocha (night)
  crust: C(0x11111b), mantle: C(0x181825), base: C(0x1e1e2e), s0: C(0x313244), s1: C(0x45475a), s2: C(0x585b70),
  o0: C(0x6c7086), o1: C(0x7f849c), o2: C(0x9399b2), text: C(0xcdd6f4), lav: C(0xb4befe), blue: C(0x89b4fa),
  sapph: C(0x74c7ec), sky: C(0x89dceb), teal: C(0x94e2d5), green: C(0xa6e3a1), yellow: C(0xf9e2af), peach: C(0xfab387),
  maroon: C(0xeba0ac), red: C(0xf38ba8), mauve: C(0xcba6f7), pink: C(0xf5c2e7), flam: C(0xf2cdcd), rose: C(0xf5e0dc),
};
export const L = {   // Catppuccin Latte (day)
  crust: C(0xdce0e8), mantle: C(0xe6e9ef), base: C(0xeff1f5), s0: C(0xccd0da), s1: C(0xbcc0cc), s2: C(0xacb0be),
  o0: C(0x9ca0b0), o1: C(0x8c8fa1), o2: C(0x7c7f93), sub0: C(0x6c6f85), text: C(0x4c4f69), lav: C(0x7287fd), blue: C(0x1e66f5),
  sapph: C(0x209fb5), sky: C(0x04a5e5), teal: C(0x179299), green: C(0x40a02b), yellow: C(0xdf8e1d), peach: C(0xfe640b),
  maroon: C(0xe64553), red: C(0xd20f39), mauve: C(0x8839ef), pink: C(0xea76cb), flam: C(0xdd7878), rose: C(0xdc8a78),
};
export const mix = (a, b, t) => a.clone().lerp(b, t);
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- noise ----------
function hash(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x, z, oct) {
  let s = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * noise(x, z); n += amp; const nx = x * 1.6 - z * 1.2, nz = x * 1.2 + z * 1.6; x = nx + 17.3; z = nz + 3.1; amp *= 0.5; }
  return s / n;
}
export function ridged(x, z, oct) {
  let s = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(noise(x, z)); s += amp * r * r; n += amp; const nx = x * 1.7 - z * 1.1, nz = x * 1.1 + z * 1.7; x = nx + 5.7; z = nz + 9.2; amp *= 0.5; }
  return s / n;
}
export function makeRng(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- wall clock ----------
// Everything else runs on seconds since the page loaded; scenes that tell the real time read wallClock() instead.
// Returns { h, m, s, hour, min } with s fractional, hour = h + m/60 + s/3600 and min = m + s/60.
// Inside a world, read W.clock instead: { c: wallClock() of this frame, struck: true on the frame the hour changes }.
const CLOCK_Q = new URLSearchParams(location.search), CLOCK_LOAD = Date.now(), CLOCK_RATE = CLOCK_Q.has('clockrate') ? parseFloat(CLOCK_Q.get('clockrate')) : 1;
let CLOCK_START = CLOCK_LOAD;
if (CLOCK_Q.has('clock')) { const [h, m = 0, s = 0] = CLOCK_Q.get('clock').split(':').map(Number); const d = new Date(CLOCK_LOAD); d.setHours(h, m, s, 0); CLOCK_START = d.getTime(); }
export function wallClock() {
  const d = new Date(CLOCK_START + (Date.now() - CLOCK_LOAD) * CLOCK_RATE);
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds() + d.getMilliseconds() / 1000;
  return { h, m, s, min: m + s / 60, hour: h + m / 60 + s / 3600 };
}

// ---------- the world ----------
// cfg: { seed, height(x,z), keys[], terrain:{size,seg,color(x,y,z,up,c)->glow}, water:{radius, ice}|null,
//        path(t)->[x,z], center:Vector3, clearance, hover:[base,amp] or ()=>[base,amp], lookAhead, centerPull, fogNear,
//        bloom:{threshold, day, night}, houseTones:{walls[], roofs[]} }
export function createWorld(cfg) {
  const Q = new URLSearchParams(location.search);
  const num = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
  const SPEED = num('speed', 1), T0 = num('t', 0), DAY = num('day', 60), TOD0 = num('tod', cfg.tod ?? 0.68), FPS = num('fps', 60);
  const BLOOM = num('bloom', 1) > 0, HD = num('hd', 0) > 0;
  const CAM = Q.has('cam') ? Q.get('cam').split(',').map(Number) : null;     // debug: fixed camera x,y,z,lookX,lookY,lookZ
  const rnd = makeRng(cfg.seed ?? 1234567);
  const height = cfg.height;
  const slopeAt = (x, z, d = 4) => (Math.abs(height(x + d, z) - height(x - d, z)) + Math.abs(height(x, z + d) - height(x, z - d))) / (2 * d);
  // height of the rendered (flat-shaded, triangulated) terrain mesh, which differs from height() between vertices
  const TS = cfg.terrain.size ?? 3800, TC = TS / (cfg.terrain.seg ?? 360);
  function groundAt(x, z) {
    const gx = (x + TS / 2) / TC, gz = (z + TS / 2) / TC, ix = Math.floor(gx), iz = Math.floor(gz), u = gx - ix, v = gz - iz;
    const X = ix * TC - TS / 2, Z = iz * TC - TS / 2;
    const ha = height(X, Z), hb = height(X, Z + TC), hc = height(X + TC, Z + TC), hd = height(X + TC, Z);
    return u + v <= 1 ? ha + u * (hd - ha) + v * (hb - ha) : hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);   // PlaneGeometry splits cells along a-b-d / b-c-d
  }

  // time of day: keyframes by sun elevation, interpolated into `cur`
  const KEYS = cfg.keys, cur = {};
  for (const k in KEYS[0]) cur[k] = KEYS[0][k].isColor ? KEYS[0][k].clone() : KEYS[0][k];
  function sampleKeys(e) {
    let i = 0; while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    let t = Math.min(1, Math.max(0, (e - a.e) / (b.e - a.e))); t = t * t * (3 - 2 * t);
    for (const k in a) { if (k === 'e') continue; if (a[k].isColor) cur[k].copy(a[k]).lerp(b[k], t); else cur[k] = a[k] + (b[k] - a[k]) * t; }
  }
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  function setTimeOfDay(p) {
    const e = 0.82 * Math.sin(2 * Math.PI * (p - 0.25));
    const az = 2 * Math.PI * p + (cfg.sunAz ?? 2.3), c = Math.sqrt(1 - e * e);
    sunDir.set(Math.cos(az) * c, e, Math.sin(az) * c);
    const me = Math.max(0.25, -e * 0.85), mc = Math.sqrt(1 - me * me);
    moonDir.set(-Math.cos(az + 0.5) * mc, me, -Math.sin(az + 0.5) * mc);
    sampleKeys(e);
    return e;
  }

  // renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ antialias: !BLOOM, powerPreference: 'high-performance' });
  renderer.setPixelRatio(HD ? devicePixelRatio : Math.min(devicePixelRatio, 1));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(cfg.fov ?? 55, innerWidth / innerHeight, 1, 12000);
  scene.fog = new THREE.FogExp2(cur.hor.clone(), cur.fogD);

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, cHor: { value: cur.hor }, cMid: { value: cur.mid }, cTop: { value: cur.top }, cSun: { value: cur.disc }, cGlow: { value: cur.glow } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 sunDir,cHor,cMid,cTop,cSun,cGlow; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 col = mix(cHor, cMid, smoothstep(0.0, 0.3, y));
        col = mix(col, cTop, smoothstep(0.25, 0.95, y));
        col = mix(col, cHor, smoothstep(0.02, -0.05, y));
        float s = max(dot(d, sunDir), 0.0), up = smoothstep(-0.25, 0.05, sunDir.y);
        col = mix(col, cGlow, pow(s, 5.0) * 0.6 * up * (1.0 - smoothstep(0.1, 0.6, y)));
        col = mix(col, cSun, pow(s, 60.0) * 0.8 * up);
        col += cSun * smoothstep(0.9993, 0.9996, s) * 2.0 * smoothstep(-0.03, 0.0, sunDir.y);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -2; scene.add(sky);

  // stars
  const stars = (() => {
    const n = 1500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), tints = [P.text, P.lav, P.rose, P.blue];
    for (let i = 0; i < n; i++) {
      const y = 0.1 + Math.pow(rnd(), 0.7) * 0.9, a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * rr * 7000, y * 7000, Math.sin(a) * rr * 7000], i * 3);
      const c = tints[(rnd() * 4) | 0].clone().multiplyScalar(0.4 + rnd() * rnd() * 2.2); col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ vertexColors: true, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 1, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.renderOrder = -1; scene.add(pts); return pts;
  })();

  // soft round sprite texture
  const soft = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();

  // crescent moon
  const moon = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'), halo = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    halo.addColorStop(0, 'rgba(245,224,220,.35)'); halo.addColorStop(1, 'rgba(245,224,220,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 128, 128);
    const mc = document.createElement('canvas'); mc.width = mc.height = 128; const m = mc.getContext('2d');
    m.fillStyle = '#f5e0dc'; m.beginPath(); m.arc(64, 64, 18, 0, 7); m.fill();
    m.globalCompositeOperation = 'destination-out'; m.beginPath(); m.arc(73, 58, 16, 0, 7); m.fill();
    g.drawImage(mc, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: new THREE.Color(1.6, 1.6, 1.6), transparent: true, fog: false, depthWrite: false }));
    sp.scale.set(560, 560, 1); sp.renderOrder = -1; sp.visible = !cfg.noMoon; scene.add(sp); return sp;
  })();

  // shooting stars
  const meteor = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([3, 3, 3.2, 0, 0, 0]), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    l.frustumCulled = false; l.userData = { age: 99, life: 1, start: new THREE.Vector3(), vel: new THREE.Vector3() }; scene.add(l); return l;
  })();

  // lights
  const hemi = new THREE.HemisphereLight(cur.hemi.clone(), cfg.groundLight ?? P.mantle, 1.5);
  const sun = new THREE.DirectionalLight(cur.light.clone(), 2.4);
  const moonLight = new THREE.DirectionalLight(mix(P.lav, P.blue, 0.4), 0);
  scene.add(hemi, sun, moonLight);

  // glowing materials (HDR at night so the bloom picks them up)
  const winMat = new THREE.MeshBasicMaterial({ color: P.yellow.clone() });
  const winMatDim = new THREE.MeshBasicMaterial({ color: P.peach.clone() });
  const glowMats = [];      // extra lantern colours: { mat, color, day, night }
  const glowMat = (color, day = 0.35, night = 2.2) => { const mat = new THREE.MeshBasicMaterial({ color: color.clone() }); glowMats.push({ mat, color: color.clone(), day, night }); return mat; };

  // terrain
  const glowScale = { value: 0.2 };
  {
    const { size = 3800, seg = 360, color } = cfg.terrain;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const nrm = g.attributes.normal, col = new Float32Array(p.count * 3), glow = new Float32Array(p.count), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      glow[i] = color(p.getX(i), p.getY(i), p.getZ(i), nrm.getY(i), c) || 0;
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.glowScale = glowScale;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow; varying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow; uniform float glowScale;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * glowScale;');
    };
    scene.add(new THREE.Mesh(g, mat));
  }

  // water: half-resolution mirror; `ice` makes it a frosted, still surface
  let water = null;
  if (cfg.water) {
    const ice = !!cfg.water.ice;
    water = new Reflector(new THREE.CircleGeometry(cfg.water.radius ?? 2000, 64), {
      textureWidth: Math.round(innerWidth * 0.5), textureHeight: Math.round(innerHeight * 0.5), clipBias: 0.003, color: cur.water,
      shader: {
        name: 'KitWater',
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, time: { value: 0 }, sunDir: { value: sunDir }, glintCol: { value: cur.disc }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
        vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
          #include <common>
          #include <fog_pars_vertex>
          void main(){ vUv = textureMatrix * vec4(position, 1.0); vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: `uniform vec3 color, sunDir, glintCol; uniform sampler2D tDiffuse; uniform float time; varying vec4 vUv; varying vec3 vWorld;
          #include <common>
          #include <fog_pars_fragment>
          float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
          void main(){
            vec2 p = vWorld.xz;
            ${ice ? `vec2 w = vec2(sin(p.x * 0.11 + p.y * 0.03), cos(p.y * 0.09 - p.x * 0.02)) * 0.35;`
                  : `vec2 w = vec2(sin(p.x * 0.045 + time * 0.7) + sin(p.y * 0.083 - time * 0.5) + 0.5 * sin((p.x + p.y) * 0.21 + time * 1.3),
                               cos(p.y * 0.052 + time * 0.6) + sin((p.x - p.y) * 0.031 + time * 0.4) + 0.5 * cos((p.x - p.y) * 0.19 - time * 1.1));`}
            vec4 uv = vUv; uv.xy += w * 0.0035 * uv.w;
            vec3 refl = min(texture2DProj(tDiffuse, uv).rgb, vec3(0.9));
            vec3 V = normalize(cameraPosition - vWorld);
            float fres = ${ice ? '0.22 + 0.45' : '0.45 + 0.5'} * pow(1.0 - max(V.y, 0.0), 4.0);
            vec3 col = mix(color, refl, fres);
            ${ice ? `float crack = smoothstep(0.985, 1.0, abs(sin(p.x * 0.05 + 3.0 * sin(p.y * 0.02)))) + smoothstep(0.985, 1.0, abs(sin(p.y * 0.043 + 2.0 * sin(p.x * 0.017))));
                     col = mix(col, color * 1.08, 0.25 * crack) + (h21(floor(p * 0.6)) - 0.5) * 0.015;`
                  : `vec3 N = normalize(vec3(w.x * 0.06, 1.0, w.y * 0.06));
                     float spec = pow(max(dot(reflect(-V, N), sunDir), 0.0), 60.0) * smoothstep(-0.02, 0.08, sunDir.y);
                     col += glintCol * min(spec, 1.0) * 0.18;`}
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      },
    });
    water.material.fog = true; water.rotateX(-Math.PI / 2); water.position.y = cfg.water.level ?? 0; scene.add(water);
  }

  // ---------- placement helpers ----------
  const keepClear = [], smokeSources = [], lampLights = [], animators = [], SIGHTS = [], wakeSources = [];
  const SOLID = [], GLOW = [], DIM = [];
  function findSpot({ a = null, spread = 0.3, rMin, rMax, hMin, hMax, flatR, wet = true, high = 0, tries = 4000, filter = null }) {
    let best = null, bestScore = 1e9;
    for (let i = 0; i < tries; i++) {
      const ang = a === null ? rnd() * Math.PI * 2 : a + (rnd() * 2 - 1) * spread;
      const r = rMin + rnd() * (rMax - rMin), x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const h = height(x, z); if (h < hMin || h > hMax) continue;
      if (filter && !filter(x, z, h)) continue;
      let rough = 0, isWet = false;
      for (let k = 0; k < 8; k++) {
        const ka = k * Math.PI / 4;
        rough += Math.abs(height(x + Math.cos(ka) * flatR, z + Math.sin(ka) * flatR) - h);
        if (height(x + Math.cos(ka) * flatR * 2.2, z + Math.sin(ka) * flatR * 2.2) < 0) isWet = true;
      }
      const score = rough - high * h;
      if ((!wet || isWet) && score < bestScore) { bestScore = score; best = { x, z, h, a: ang }; }
    }
    return best;
  }
  const tinted = (g, color) => {
    g = g.index ? g.toNonIndexed() : g;
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([color.r, color.g, color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
  };
  const plain = (g) => (g.index ? g.toNonIndexed() : g);
  function gable(w, d, rh) {
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, rh); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
  const place = (g, x, y, z, ry) => g.applyMatrix4(_m.compose(new THREE.Vector3(x, y, z), _q.setFromAxisAngle(Y, ry), ONE));
  const toWorld = (lx, ly, lz, x, y, z, ry) => new THREE.Vector3(lx, ly, lz).applyAxisAngle(Y, ry).add(new THREE.Vector3(x, y, z));
  function groundRange(x, z, ry, w, d) {
    let lo = 1e9, hi = -1e9;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const lx = sx * w / 2, lz = sz * d / 2, h = height(x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry));
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return [lo, hi];
  }
  const groundMin = (x, z, ry, w, d) => groundRange(x, z, ry, w, d)[0];
  function addLight(color, I, dist, x, y, z) {
    const Lt = new THREE.PointLight(color, 0, dist, 1.5); Lt.position.set(x, y, z); scene.add(Lt);
    const e = { L: Lt, I }; lampLights.push(e); return e;
  }
  const tones = cfg.houseTones ?? {
    walls: [mix(P.s0, P.s1, 0.3), mix(P.s1, P.s2, 0.3)], roofs: [P.mantle, P.base, mix(P.base, P.maroon, 0.25)],
  };
  function house(x, z, ry, w, d, H, opts = {}) {
    const [lo, hi] = groundRange(x, z, ry, w, d), base = lo - 1.2, Hb = H + 1.2 + (hi - lo);
    const top = base + Hb;
    SOLID.push(place(tinted(new THREE.BoxGeometry(w, Hb, d).translate(0, Hb / 2, 0), opts.wall || tones.walls[(rnd() * tones.walls.length) | 0]), x, base, z, ry));
    const rh = opts.roofH || w * (0.42 + rnd() * 0.15);
    SOLID.push(place(tinted(gable(w + 1.6, d + 1.6, rh).translate(0, Hb, 0), opts.roof || tones.roofs[(rnd() * tones.roofs.length) | 0]), x, base, z, ry));
    const rows = H > 9 ? [H * 0.32, H * 0.72] : [H * 0.5];
    for (const wy of rows) {
      const y = Hb - H + wy;
      const cols = w > 10 ? [-w / 4, w / 4] : [0];
      for (const sz of [1, -1]) for (const cx of cols) {
        if (rnd() < 0.22) continue;
        const pg = new THREE.PlaneGeometry(1.7, 2).rotateY(sz > 0 ? 0 : Math.PI).translate(cx, y, sz * (d / 2 + 0.05));
        (rnd() < 0.3 && !opts.lit ? DIM : GLOW).push(place(plain(pg), x, base, z, ry));
      }
      for (const sx of [1, -1]) {
        if (rnd() < 0.4) continue;
        const pg = new THREE.PlaneGeometry(1.7, 2).rotateY(sx * Math.PI / 2).translate(sx * (w / 2 + 0.05), y, 0);
        (rnd() < 0.3 && !opts.lit ? DIM : GLOW).push(place(plain(pg), x, base, z, ry));
      }
    }
    if (opts.chimney !== false && rnd() < 0.6) {
      const cx = w * 0.22, cz = d * 0.2, ch = Hb + rh * 0.6 + 2.5;
      SOLID.push(place(tinted(new THREE.BoxGeometry(1.4, ch, 1.4).translate(cx, ch / 2, cz), opts.chimneyColor || tones.walls[0]), x, base, z, ry));
      if (opts.smoke ?? smokeSources.length < 6) smokeSources.push(toWorld(cx, ch + 0.5, cz, x, base, z, ry));
    }
    return { base, top };
  }

  // drifting mist / cloud sprites, coloured by the time of day
  const drifters = [];
  function drifter(kind, opacity, sx, sy, x, y, z, drift, shade = 1) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, transparent: true, opacity, depthWrite: false }));
    sp.scale.set(sx, sy, 1); sp.position.set(x, y, z);
    sp.userData = { kind, a: Math.atan2(z, x), r: Math.hypot(x, z), y, drift, phase: rnd() * 6.28, shade };
    scene.add(sp); drifters.push(sp); return sp;
  }

  // falling particles around the camera (snow, petals): wrap inside a box that follows the camera
  function particles({ count = 800, size = 1.5, color, box = 260, fall = 3, sway = 1.5, dayScale = 1, nightScale = 0.35, additive = false }) {
    const pos = new Float32Array(count * 3), seeds = [];
    for (let i = 0; i < count; i++) { pos.set([(rnd() - 0.5) * box, (rnd() - 0.5) * box * 0.6, (rnd() - 0.5) * box], i * 3); seeds.push(rnd() * 6.28); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: soft, color: color.clone(), size, transparent: true, depthWrite: false, opacity: 0.9, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
    animators.push((t, night, dt) => {
      const a = pts.geometry.attributes.position.array, cp = camera.position, hb = box / 2, vb = box * 0.3;
      for (let i = 0; i < count; i++) {
        const o = i * 3, s = seeds[i];
        a[o] += Math.sin(t * 0.7 + s) * sway * dt; a[o + 1] -= fall * dt * (0.7 + 0.6 * ((s * 7) % 1)); a[o + 2] += Math.cos(t * 0.5 + s) * sway * dt;
        // wrap relative to the camera
        let dx = a[o] - cp.x, dy = a[o + 1] - cp.y, dz = a[o + 2] - cp.z;
        if (dx > hb) a[o] -= box; else if (dx < -hb) a[o] += box;
        if (dz > hb) a[o + 2] -= box; else if (dz < -hb) a[o + 2] += box;
        if (dy < -vb) a[o + 1] += vb * 2; else if (dy > vb) a[o + 1] -= vb * 2;
      }
      pts.geometry.attributes.position.needsUpdate = true;
      mat.color.copy(color).multiplyScalar(dayScale + (nightScale - dayScale) * night);
    });
    return pts;
  }

  // fireflies in a few swarms
  function fireflies(swarms, perSwarm = 12) {
    const base = [], n = swarms.length * perSwarm, pos = new Float32Array(Math.max(1, n) * 3);
    for (let i = 0; i < n; i++) {
      const c = swarms[i % swarms.length], a = rnd() * 6.28, d = 4 + rnd() * (c.r ?? 30);
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      base.push({ x, y: Math.max(height(x, z), 1) + 1.5 + rnd() * 5, z, p: rnd() * 100, s: 0.3 + rnd() * 0.5 });
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: soft, color: mix(P.yellow, P.green, 0.35).multiplyScalar(3), size: 1.8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; scene.add(pts);
    animators.push((t, night) => {
      const fo = Math.max(0, (night - 0.6) / 0.4); pts.material.opacity = 0.9 * fo; if (fo <= 0) return;
      const pa = g.attributes.position;
      for (let i = 0; i < n; i++) { const f = base[i], tt = t * f.s + f.p; pa.setXYZ(i, f.x + Math.sin(tt) * 6 + Math.sin(tt * 2.3) * 2, f.y + Math.sin(tt * 1.7) * 1.5, f.z + Math.cos(tt * 0.9) * 6); }
      pa.needsUpdate = true;
    });
  }

  // birds circling by day
  function birds({ n = 16, radius = 500, y = 230, speed = 0.035, color = P.mantle } = {}) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 12), info = [];
    for (let i = 0; i < n; i++) info.push({ off: new THREE.Vector3((rnd() - 0.5) * 50, (rnd() - 0.5) * 16, (rnd() - 0.5) * 50), ph: rnd() * 6.28, sp: 5 + rnd() * 2 });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 }));
    ls.frustumCulled = false; scene.add(ls);
    const fwd = new THREE.Vector3();
    animators.push((t, night, dt, e) => {
      const bo = (1 - night) * smooth(-0.05, 0.1, e); ls.material.opacity = 0.85 * bo; if (bo <= 0) return;
      const fa = -t * speed, fr = radius + 40 * Math.sin(t * 0.05), fy = y + 30 * Math.sin(t * 0.07), cx = Math.cos(fa) * fr, cz = Math.sin(fa) * fr;
      fwd.set(Math.sin(fa), 0, -Math.cos(fa));
      for (let i = 0; i < n; i++) {
        const b = info[i], flap = Math.sin(t * b.sp + b.ph) * 1.4, bx = cx + b.off.x, by = fy + b.off.y, bz = cz + b.off.z, rx = -fwd.z * 2.6, rz = fwd.x * 2.6;
        pos.set([bx - rx, by + flap, bz - rz, bx + fwd.x * 0.6, by, bz + fwd.z * 0.6, bx + fwd.x * 0.6, by, bz + fwd.z * 0.6, bx + rx, by + flap, bz + rz], i * 12);
      }
      g.attributes.position.needsUpdate = true;
    });
  }

  // ripples on open water (wakes and bobbing rings)
  function ripples() {
    const MAX = 240, geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), fade = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    geo.setAttribute('aFade', fade);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: { color: { value: new THREE.Color() }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: `attribute float aFade; varying float vFade; varying vec2 vUv;
        #include <common>
        #include <fog_pars_vertex>
        void main(){ vUv = uv; vFade = aFade; vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 color; varying float vFade; varying vec2 vUv;
        #include <common>
        #include <fog_pars_fragment>
        void main(){ float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.6, 0.86, r) * smoothstep(1.0, 0.87, r) + 0.12 * smoothstep(0.9, 0.3, r);
          float a = ring * vFade; if (a < 0.003) discard;
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX); mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
    const R = Array.from({ length: MAX }, () => ({ x: 0, z: 0, age: 1, life: 1, size: 0, grow: 0, str: 0 }));
    let next = 0;
    const emit = (x, z, size, grow, life, str) => { Object.assign(R[next], { x, z, age: 0, life, size, grow, str }); next = (next + 1) % MAX; };
    const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), q0 = new THREE.Quaternion(), v = new THREE.Vector3(), wl = cfg.water.level ?? 0;
    animators.push((t, night, dt) => {
      for (const w of wakeSources) {
        w.timer = (w.timer ?? Math.random() * 2) - dt; if (w.timer > 0) continue;
        if (w.obj.userData.moving) {
          v.set(-w.len * 0.5, 0, 0); w.obj.localToWorld(v); emit(v.x, v.z, w.len * 0.25, w.len * 1.3, 5.5, 0.65);
          v.set(w.len * 0.45, 0, 0); w.obj.localToWorld(v); emit(v.x, v.z, w.len * 0.15, w.len * 0.45, 1.6, 0.55);
          w.timer = 0.28;
        } else { emit(w.obj.position.x, w.obj.position.z, w.len * 0.55, w.len * 0.9, 4.5, 0.45); w.timer = 1.8 + Math.random() * 0.8; }
      }
      for (let i = 0; i < MAX; i++) {
        const r = R[i];
        if (r.age < r.life) {
          r.age += dt; const k = Math.min(1, r.age / r.life), s = r.size + r.grow * (1 - (1 - k) * (1 - k));
          fade.array[i] = r.str * Math.pow(1 - k, 1.5) * Math.min(1, k * 8); m4.compose(pos.set(r.x, wl + 0.12, r.z), q0, scl.set(s, 1, s));
        } else { fade.array[i] = 0; m4.compose(pos.set(0, -50, 0), q0, scl.set(0.001, 1, 0.001)); }
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true; fade.needsUpdate = true;
      mat.uniforms.color.value.copy(cur.mist).lerp(P.text, 0.3);
    });
  }

  // ---------- finish: merge statics, smoke, post-processing, start the loop ----------
  function finish() {
    if (SOLID.length) scene.add(new THREE.Mesh(mergeGeometries(SOLID), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    if (GLOW.length) scene.add(new THREE.Mesh(mergeGeometries(GLOW), winMat));
    if (DIM.length) scene.add(new THREE.Mesh(mergeGeometries(DIM), winMatDim));
    if (water && !cfg.water.ice) ripples();

    const smoke = [];
    for (const src of smokeSources) for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, transparent: true, opacity: 0, depthWrite: false }));
      sp.userData = { k: i / 10, src, wob: rnd() * 6.28 }; scene.add(sp); smoke.push(sp);
    }

    let composer = null, bloom = null, finalPass = null;
    const bl = cfg.bloom ?? {};
    if (BLOOM) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.65, bl.threshold ?? 0.92);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      finalPass = new ShaderPass({
        uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; d.x *= 1.25;
            c.rgb *= mix(0.8, 1.0, smoothstep(0.75, 0.2, length(d)));
            c.rgb += (fract(sin(dot(vUv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
            gl_FragColor = c; }`,
      });
      composer.addPass(finalPass);
    }

    // hover ([base, amp]) and lookDrop may be functions, read every frame (e.g. to fly lower at night)
    const center = cfg.center ?? new THREE.Vector3(0, 300, 0), live = (v, d) => (typeof v === 'function' ? v() : v ?? d);
    const lookAhead = cfg.lookAhead ?? 40, centerPull = cfg.centerPull ?? 0.3;
    const path = (t) => cfg.path(t * SPEED);
    const targetY = (t) => { let g = cfg.water ? (cfg.water.level ?? 0) : -1e9; for (let k = 0; k <= 8; k++) { const [x, z] = path(t + k * 5 / SPEED); g = Math.max(g, height(x, z)); } const [hoverBase, hoverAmp] = live(cfg.hover, [75, 60]); return g + hoverBase + hoverAmp * (0.5 + 0.5 * Math.sin(t * 0.017 * SPEED)); };
    let camY = null, last = performance.now(), acc = 0, prevT = null;
    const look = new THREE.Vector3(), ahead = new THREE.Vector3(), focus = new THREE.Vector3();

    function frame(now) {
      requestAnimationFrame(frame);
      acc += now - last; last = now; if (acc < 1000 / FPS - 2) return; acc = 0;
      const t = T0 + now / 1000, dt = prevT === null ? 0 : Math.min(t - prevT, 0.1); prevT = t;

      const e = setTimeOfDay((TOD0 + t / (DAY * 60)) % 1);
      scene.fog.color.copy(cur.hor); scene.fog.density = cur.fogD;
      sun.position.copy(sunDir).multiplyScalar(1000); sun.color.copy(cur.light); sun.intensity = cur.lightI * smooth(-0.02, 0.08, e);
      moonLight.position.copy(moonDir).multiplyScalar(1000); moonLight.intensity = (cfg.moonI ?? 0.9) * smooth(0.02, -0.2, e);   // a scene may retint it in an animator (runs after)
      hemi.color.copy(cur.hemi); hemi.intensity = cur.hemiI; glowScale.value = cur.snow;
      stars.material.opacity = cur.stars; stars.rotation.y = t * 0.0015;
      moon.position.copy(moonDir).multiplyScalar(6500); moon.material.opacity = 0.25 + 0.75 * smooth(0.25, -0.1, e);
      const night = cur.win;
      winMat.color.copy(P.yellow).multiplyScalar(0.3 + 1.9 * night);
      winMatDim.color.copy(P.peach).multiplyScalar(0.2 + 1.0 * night);
      for (const g of glowMats) g.mat.color.copy(g.color).multiplyScalar(g.day + (g.night - g.day) * night);
      for (const { L: Lt, I } of lampLights) Lt.intensity = I * night;
      if (bloom) bloom.strength = (bl.day ?? 0.35) + ((bl.night ?? 0.65) - (bl.day ?? 0.35)) * night;

      // camera: orbit, hover, glance at landmarks
      const [x, z] = path(t), ty = targetY(t);
      camY = camY === null ? ty : camY + (ty - camY) * Math.min(1, dt * 0.5);
      camera.position.set(x, camY, z);
      const [ax, az] = path(t + lookAhead / SPEED);
      ahead.set(ax, camY - live(cfg.lookDrop, 45), az);
      look.copy(ahead).lerp(center, centerPull);
      const ca = Math.atan2(z, x); let wsum = 0, pull = 0; focus.set(0, 0, 0);
      for (const sg of SIGHTS) {
        let d = Math.atan2(sg.z, sg.x) - ca; d = Math.atan2(Math.sin(d), Math.cos(d));
        const w = Math.exp(-Math.pow((d - (sg.lead ?? 0.3)) / 0.22, 2));
        if (w > 0.001) { focus.addScaledVector(sg, w); wsum += w; pull += w * (sg.pull ?? 0.55); }
      }
      if (wsum > 0.001) look.lerp(focus.divideScalar(wsum), (pull / wsum) * Math.min(1, wsum));
      camera.up.set(0, 1, 0);
      if (CAM) { camera.position.set(CAM[0], CAM[1], CAM[2]); camera.lookAt(CAM[3], CAM[4], CAM[5]); }
      else { camera.lookAt(look); camera.rotateZ(0.06 + 0.025 * Math.sin(t * 0.02)); }

      for (const sp of drifters) {
        const u = sp.userData; u.a += u.drift * dt * 0.3;
        sp.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(t * 0.15 + u.phase) * 4, Math.sin(u.a) * u.r);
        sp.material.color.copy(u.kind === 'cloud' ? cur.cloud : cur.mist).multiplyScalar(u.shade);
      }
      for (const sp of smoke) {
        const u = sp.userData, k = (u.k + t * 0.045) % 1;
        sp.position.set(u.src.x + k * 20 + Math.sin(t * 0.8 + k * 8 + u.wob) * 2, u.src.y + k * 42, u.src.z + k * 9);
        const sc = 3.5 + k * 15; sp.scale.set(sc, sc, 1);
        sp.material.opacity = 0.32 * Math.sin(Math.PI * k); sp.material.color.copy(cur.mist).lerp(P.o0, 0.35);
      }
      const mu = meteor.userData; mu.age += dt;
      if (mu.age > mu.life && cur.stars > 0.6 && Math.random() < dt / 18) {
        const a = Math.random() * 6.28, y = 0.35 + Math.random() * 0.4, c = Math.sqrt(1 - y * y);
        mu.start.set(Math.cos(a) * c, y, Math.sin(a) * c).multiplyScalar(6800);
        mu.vel.set(Math.random() - 0.5, -0.4 - Math.random() * 0.4, Math.random() - 0.5).cross(mu.start).normalize().multiplyScalar(3400);
        if (mu.vel.y > 0) mu.vel.negate(); mu.age = 0; mu.life = 0.7 + Math.random() * 0.6;
      }
      if (mu.age < mu.life) {
        const pa = meteor.geometry.attributes.position, hx = mu.start.x + mu.vel.x * mu.age, hy = mu.start.y + mu.vel.y * mu.age, hz = mu.start.z + mu.vel.z * mu.age;
        pa.array.set([hx, hy, hz, hx - mu.vel.x * 0.22, hy - mu.vel.y * 0.22, hz - mu.vel.z * 0.22]); pa.needsUpdate = true;
        meteor.material.opacity = Math.sin(Math.PI * mu.age / mu.life) * cur.stars;
      } else meteor.material.opacity = 0;

      clock.c = wallClock(); clock.struck = clock.c.h !== clockH; clockH = clock.c.h;   // never struck on page load
      for (const f of animators) f(t, night, dt, e);
      if (water) water.material.uniforms.time.value = t;
      if (composer) { finalPass.uniforms.time.value = t % 100; composer.render(); } else renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight); if (composer) composer.setSize(innerWidth, innerHeight);
    });
  }

  const clock = { c: wallClock(), struck: false }; let clockH = clock.c.h;

  return {
    clock, THREE, P, L, mix, smooth, noise, fbm, ridged, rnd, height, groundAt, slopeAt, cur, sunDir, moonDir, scene, camera, renderer, soft, moonLight, hemi,
    winMat, winMatDim, glowMat, keepClear, smokeSources, lampLights, animators, SIGHTS, wakeSources, SOLID, GLOW, DIM,
    findSpot, tinted, plain, gable, place, toWorld, groundRange, groundMin, addLight, house, drifter, particles, fireflies, birds,
    mergeGeometries, finish,
  };
}
