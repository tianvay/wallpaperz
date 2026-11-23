/* Mocha wallpaper engine
 * Layer 1 (WebGL): the picture, with per-pixel effects driven by mask.png
 *   R = water   ripples the real pixels + moving sparkle streaks
 *   G = sky     slow flowing warp (clouds billow)
 *   B = lights  per-cell breathing / flicker (windows, lamps, foam)
 *   A = fog     drifting fog/haze tinted with scene.fog.color
 * Layer 2 (canvas 2D): overlay effects listed in scene.effects
 * Coordinates are image pixels (scene.width x scene.height); the page covers the screen like CSS "cover".
 * Debug: add #view=x,y,w,h to the URL to zoom onto a region.
 */
(() => {
  const S = window.SCENE;
  const IW = S.width || 2560, IH = S.height || 1440;
  const P = { rosewater:'#f5e0dc', flamingo:'#f2cdcd', pink:'#f5c2e7', mauve:'#cba6f7', red:'#f38ba8',
    maroon:'#eba0ac', peach:'#fab387', yellow:'#f9e2af', green:'#a6e3a1', teal:'#94e2d5', sky:'#89dceb',
    sapphire:'#74c7ec', blue:'#89b4fa', lavender:'#b4befe', text:'#cdd6f4', subtext1:'#bac2de',
    overlay2:'#9399b2', surface0:'#313244', base:'#1e1e2e', mantle:'#181825', crust:'#11111b', white:'#ffffff' };
  const col = c => P[c] || c;
  const rgb = c => { const h = col(c).slice(1); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const cfg = { fps: 30, paused: false, speed: 1 };

  const glc = document.getElementById('gl'), fx = document.getElementById('fx');
  const ctx = fx.getContext('2d');
  let dpr = 1, sc = 1, ox = 0, oy = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    for (const c of [glc, fx]) { c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr); }
    const m = /view=([\d.]+),([\d.]+),([\d.]+),([\d.]+)/.exec(location.hash);
    const [vx, vy, vw, vh] = m ? m.slice(1).map(Number) : [0, 0, IW, IH];
    sc = Math.max(fx.width / vw, fx.height / vh);
    ox = (fx.width - vw * sc) / 2 - vx * sc;
    oy = (fx.height - vh * sc) / 2 - vy * sc;
  }
  addEventListener('resize', resize); addEventListener('hashchange', resize); resize();

  const load = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = src; });

  // ------------------------------------------------------------------ WebGL base layer
  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
  const FS = `precision highp float;
uniform sampler2D img, msk; uniform vec2 res, isz, off; uniform float scl, t;
uniform vec4 amp; uniform vec3 fogc; uniform vec4 prm;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<4;i++){ s += a*n(p); p = p*2.03 + 7.1; a *= .5; } return s; }
void main(){
  vec2 fc = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec2 px = (fc - off) / scl;                 // image pixel
  vec2 uv = px / isz;
  vec4 m = texture2D(msk, uv);
  vec2 d = vec2(0.);
  // water: each row sways left/right on its own phase (standing pattern, nothing travels vertically)
  if (m.r > 0.) {
    float k = prm.x;
    float row = floor(px.y * 0.5 * k);
    float ph = h(vec2(row, 3.)) * 6.283;
    float wv = sin(t * (0.6 + h(vec2(row, 7.)) * 0.8) + ph + px.x * 0.006);
    d.x += wv * 1.4 * m.r * amp.x;
  }
  // sky: slow flowing warp
  if (m.g > 0.) {
    vec2 q = px * 0.0025;
    d += (vec2(fbm(q + vec2(t*0.03, 0.)), fbm(q + vec2(5.2, t*0.025))) - 0.5) * 18. * m.g * amp.y;
  }
  vec2 suv = (px + d) / isz;
  // don't pull pixels from outside the effect region (keeps shorelines crisp)
  if (texture2D(msk, suv).r + texture2D(msk, suv).g < 0.05 && (m.r + m.g) > 0.) suv = uv;
  vec3 c = texture2D(img, suv).rgb;
  if (m.r > 0. && prm.z > 0.) { // optional sparkle: short horizontal glints drifting sideways
    float s = n(vec2(px.x*0.03 - t*0.35, floor(px.y*0.4)));
    c += vec3(1.) * pow(max(s - 0.75, 0.) / 0.25, 3.) * 0.25 * m.r * prm.z;
  }
  if (m.b > 0.) { // lights: breathe in place; each area has its own phase and tempo, nothing moves across the image
    vec2 q = px / prm.y;
    float ph = n(q * 0.35) * 6.283, sp = 0.3 + n(q * 0.35 + 9.1) * 0.6;
    float br = 0.5 + 0.5 * sin(t * sp + ph * 3.);
    c *= mix(1., 0.88 + 0.24 * br, m.b * amp.z);
  }
  if (m.a > 0.) { // drifting fog
    float f = fbm(vec2(px.x * 0.0018 - t * 0.022, px.y * 0.006));
    f = smoothstep(0.3, 0.85, f);
    c = mix(c, fogc, f * m.a * amp.w);
  }
  gl_FragColor = vec4(c, 1.);
}`;
  let gl, prog, U = {}, glOK = false, baseImg = null;

  async function initGL() {
    baseImg = await load(S.background || 'background.jpg');
    const maskImg = S.mask ? await load(S.mask).catch(() => null) : null;
    gl = glc.getContext('webgl', { premultipliedAlpha: false, antialias: false });
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = (unit, im) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (im) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0])); };
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    tex(0, baseImg); tex(1, maskImg);
    for (const n of ['img', 'msk', 'res', 'isz', 'off', 'scl', 't', 'amp', 'fogc', 'prm']) U[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(U.img, 0); gl.uniform1i(U.msk, 1);
    const a = S.amp || {};
    gl.uniform4f(U.amp, a.water ?? 1, a.sky ?? 1, a.lights ?? 1, a.fog ?? 1);
    gl.uniform3fv(U.fogc, rgb((S.fog && S.fog.color) || 'lavender'));
    gl.uniform4f(U.prm, S.waterScale || 1, S.lightCell || 6, S.sparkle || 0, 0);
    glOK = true;
  }

  function drawGL(T) {
    if (!glOK) return;
    gl.viewport(0, 0, glc.width, glc.height);
    gl.uniform2f(U.res, glc.width, glc.height);
    gl.uniform2f(U.isz, IW, IH);
    gl.uniform2f(U.off, ox, oy);
    gl.uniform1f(U.scl, sc);
    gl.uniform1f(U.t, T);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ------------------------------------------------------------------ overlay helpers
  const sprites = {};
  // glow sprite; scene.glowStyle 'classic' = the softer 64px falloff used by Mocha Forest
  function glow(c) {
    if (sprites[c]) return sprites[c];
    const classic = S.glowStyle === 'classic', sz = classic ? 64 : 128, r = sz / 2;
    const s = document.createElement('canvas'); s.width = s.height = sz;
    const g = s.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
    const hx = col(c);
    if (classic) { gr.addColorStop(0, hx); gr.addColorStop(0.25, hx + 'aa'); gr.addColorStop(1, hx + '00'); }
    else { gr.addColorStop(0, hx); gr.addColorStop(0.2, hx + 'aa'); gr.addColorStop(0.5, hx + '33'); gr.addColorStop(1, hx + '00'); }
    g.fillStyle = gr; g.fillRect(0, 0, sz, sz);
    return (sprites[c] = s);
  }
  const drawGlow = (c, x, y, r, a) => { if (a <= 0) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(glow(c), x - r, y - r, r * 2, r * 2); };

  // ------------------------------------------------------------------ overlay effects
  const make = {
    // twinkling stars  {points:[[x,y,size]], color, scale, alpha, sizeK, alphaK, minSize, spMin, layer}
    stars(e) {
      const st = e.points.map(([x, y, s]) => ({ x, y, s: Math.max(e.minSize || 0, s || 2), ph: rnd(0, 6.28), sp: rnd(e.spMin ?? 0.5, 2.2) }));
      return { add: true, layer: e.layer, draw(T) { for (const s of st) { const k = 0.5 + 0.5 * Math.sin(T * s.sp + s.ph);
        drawGlow(e.color || 'lavender', s.x, s.y, (3 + k * 4 + s.s * (e.sizeK ?? 0.6)) * (e.scale || 1), (0.1 + k * (e.alphaK ?? 0.6)) * (e.alpha || 1)); } } };
    },
    // flat tapered cloud streaks drifting right (Mocha Forest style)  {count, y0, y1, speed}
    streakClouds(e) {
      const y0 = e.y0 ?? 150, y1 = e.y1 ?? 540;
      const mk = x => {
        const y = rnd(y0, y1), t = (y - y0) / (y1 - y0);
        const cols = t < 0.35 ? ['overlay2', 'blue'] : t < 0.7 ? ['blue', 'sapphire', 'lavender'] : ['lavender', 'sky', 'rosewater'];
        const parts = [], n = 1 + (Math.random() * 3 | 0);
        for (let i = 0; i < n; i++) parts.push({ dx: rnd(-80, 120), dy: i * rnd(9, 16), len: rnd(140, 460) * (1 - i * 0.2), h: rnd(3, 11) });
        return { x: x ?? rnd(-500, IW), y, parts, color: col(pick(cols)), a: rnd(0.18, 0.42) * (0.6 + t * 0.6), v: rnd(5, 16) * (0.6 + t * 0.6) };
      };
      const cs = Array.from({ length: e.count || 16 }, () => mk());
      return { layer: 'back', draw(T, dt) { for (const cl of cs) {
        cl.x += cl.v * (e.speed || 1) * dt;
        if (cl.x > IW + 100) Object.assign(cl, mk(-600));
        ctx.fillStyle = cl.color; ctx.globalAlpha = cl.a;
        for (const p of cl.parts) { const x = cl.x + p.dx, y = cl.y + p.dy, L = p.len, h = p.h;
          ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + L * 0.28, y); ctx.lineTo(x + L, y + h * 0.35); ctx.lineTo(x + L * 0.82, y + h);
          ctx.closePath(); ctx.fill(); }
      } } };
    },
    // falling water streaks clipped to the falls + mist puffs at the base  {falls:[{x,y,w,h}], mist:{x0,x1,y,count}}
    waterfall(e) {
      const falls = e.falls, streaks = [];
      for (const f of falls) for (let i = 0; i < f.w * 3; i++)
        streaks.push({ f, x: f.x + rnd(0, f.w), y: rnd(0, f.h), len: rnd(6, 18), v: rnd(35, 65),
          c: col(pick(['rosewater', 'white', 'white', 'yellow'])), a: rnd(0.3, 0.75), w: rnd(0.8, 1.6) });
      const M = e.mist;
      const newMist = init => ({ x: rnd(M.x0, M.x1), y: M.y, vx: rnd(-5, 5), vy: rnd(-7, -2), r: rnd(6, 14), life: init ? rnd(0, 3) : 0, max: rnd(2, 4) });
      const mist = Array.from({ length: M.count || 10 }, () => newMist(true));
      return { add: false, draw(T, dt) {
        ctx.save(); ctx.beginPath(); for (const f of falls) ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
        for (const s of streaks) {
          s.y += s.v * dt; if (s.y > s.f.h + s.len) { s.y = -s.len; s.x = s.f.x + rnd(0, s.f.w); }
          ctx.globalAlpha = s.a; ctx.fillStyle = s.c; ctx.fillRect(s.x, s.f.y + s.y, s.w, s.len);
        }
        ctx.restore();
        for (let i = 0; i < mist.length; i++) { const m = mist[i]; m.life += dt;
          if (m.life > m.max) { mist[i] = newMist(false); continue; }
          m.x += m.vx * dt; m.y += m.vy * dt;
          const k = m.life / m.max, r = m.r * (1 + k * 1.5);
          drawGlow(M.color || 'rosewater', m.x, m.y, r, Math.sin(k * Math.PI) * 0.22); }
      } };
    },
    // breathing light halo  {x,y,r,color,alpha,speed,blink}  blink = on/off beacon
    glows(e) {
      const gs = e.items.map(g => ({ ...g, ph: rnd(0, 6.3) }));
      return { add: true, draw(T) { for (const g of gs) {
        let k;
        if (g.blink) { const p = ((T * (g.speed || 1) + g.ph) % 2.2); k = p < 0.12 ? 1 : p < 0.24 ? 0.35 : 0; }
        else k = 0.75 + 0.25 * Math.sin(T * (g.speed || 1) + g.ph) + (g.flicker ? (Math.random() - 0.5) * g.flicker : 0);
        drawGlow(g.color || 'yellow', g.x, g.y, g.r * (g.blink ? 1 : (0.9 + 0.1 * k)), k * (g.alpha ?? 0.6));
      } } };
    },
    // short horizontal glints on water  {points:[[x,y]], colors, count, size, wMin, drift, nearY, nearColors, nearSize}
    glints(e) {
      const pts = e.points, live = [];
      const mk = () => { const [x, y] = pick(pts); const near = e.nearY != null && y < e.nearY;
        const size = near ? e.nearSize : (e.size || 12), cols = near ? e.nearColors : (e.colors || ['text', 'white']);
        return { x, y, w: e.wMin != null ? rnd(e.wMin, size) : rnd(0.5, 1) * size, life: 0, max: rnd(0.8, 2.6), c: col(pick(cols)) }; };
      for (let i = 0; i < (e.count || 60); i++) { const g = mk(); g.life = rnd(0, g.max); live.push(g); }
      return { add: true, draw(T, dt) { for (let i = 0; i < live.length; i++) { const g = live[i]; g.life += dt;
        if (g.life > g.max) { live[i] = mk(); continue; }
        g.y += (e.drift || 0) * dt;
        const k = Math.sin(g.life / g.max * Math.PI); ctx.globalAlpha = k * (e.alpha || 0.55); ctx.fillStyle = g.c;
        const w = g.w * (0.6 + 0.4 * k); ctx.fillRect(g.x - w / 2, g.y, w, (e.thick || 1.6)); } } };
    },
    // vertical light beams pulsing  {items:[{x,y,w,h,color}]}
    beams(e) {
      const bs = e.items.map(b => {
        const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
        const gr = g.createLinearGradient(0, 256, 0, 0); const hx = col(b.color || 'sky');
        gr.addColorStop(0, hx + 'cc'); gr.addColorStop(0.6, hx + '33'); gr.addColorStop(1, hx + '00');
        g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
        const hg = g.createLinearGradient(0, 0, 64, 0);
        hg.addColorStop(0, 'rgba(255,255,255,0)'); hg.addColorStop(0.5, 'rgba(255,255,255,1)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
        g.globalCompositeOperation = 'destination-in'; g.fillStyle = hg; g.fillRect(0, 0, 64, 256);
        return { ...b, c, ph: rnd(0, 6.3) };
      });
      return { add: true, draw(T) { for (const b of bs) {
        const sway = Math.sin(T * 0.25 + b.ph) * (b.sway || 0);
        ctx.globalAlpha = (b.alpha || 0.35) * (0.6 + 0.4 * Math.sin(T * 0.5 + b.ph));
        ctx.save(); ctx.translate(b.x, b.y + b.h); ctx.rotate(sway); ctx.drawImage(b.c, -b.w / 2, -b.h, b.w, b.h); ctx.restore();
      } } };
    },
    // chimney smoke  {x,y,color,drift}
    smoke(e) {
      const ps = [];
      return { add: false, draw(T, dt) {
        if (Math.random() < dt * (e.rate || 2.5)) ps.push({ x: e.x + rnd(-2, 2), y: e.y, r: rnd(4, 7), life: 0, max: rnd(5, 8) });
        for (let i = ps.length - 1; i >= 0; i--) { const p = ps[i]; p.life += dt; if (p.life > p.max) { ps.splice(i, 1); continue; }
          const k = p.life / p.max; p.y -= dt * (e.rise || 9); p.x += dt * (e.drift ?? -14) * (0.3 + k);
          drawGlow(e.color || 'overlay2', p.x, p.y, p.r * (1 + k * 4), Math.sin(k * Math.PI) * (e.alpha || 0.18)); } } };
    },
    // drifting flat clouds (puffy or streaks), drawn under the foreground cutout
    clouds(e) {
      const cs = [];
      const mk = x => { const y = rnd(e.y0, e.y1), s = rnd(0.6, 1.4) * (e.size || 1);
        const puffs = []; const n = 3 + (Math.random() * 4 | 0);
        for (let i = 0; i < n; i++) puffs.push({ dx: i * 34 * s + rnd(-8, 8), dy: -Math.sin(i / (n - 1) * Math.PI) * rnd(14, 30) * s, r: rnd(22, 38) * s * (1 - Math.abs(i / (n - 1) - 0.5) * 0.6) });
        return { x: x ?? rnd(-300, IW), y, s, puffs, w: n * 34 * s, v: rnd(4, 12) * (e.speed || 1), c: col(pick(e.colors || ['rosewater'])), a: rnd(0.25, 0.5) * (e.alpha || 1) }; };
      for (let i = 0; i < (e.count || 8); i++) cs.push(mk());
      return { layer: 'back', draw(T, dt) { for (let i = 0; i < cs.length; i++) { const c = cs[i]; c.x += c.v * dt;
        if (c.x > IW + 200) { cs[i] = mk(-c.w - 200); continue; }
        ctx.globalAlpha = c.a; ctx.fillStyle = c.c; ctx.beginPath();
        for (const p of c.puffs) { ctx.moveTo(c.x + p.dx + p.r, c.y + p.dy); ctx.arc(c.x + p.dx, c.y + p.dy, p.r, 0, 6.3); }
        ctx.rect(c.x - 10 * c.s, c.y, c.w + 10 * c.s, 14 * c.s); ctx.fill(); } } };
    },
    // thin flat light lines on water, drifting sideways and fading in/out  {points:[[x,y]], colors, count, len}
    streaks(e) {
      const pts = e.points, live = [];
      const mk = () => { const [x, y] = pick(pts); return { x, y, len: rnd(0.4, 1) * (e.len || 80), v: rnd(-1, 1) * (e.speed || 6),
        life: 0, max: rnd(3, 7), c: col(pick(e.colors || ['text'])) }; };
      for (let i = 0; i < (e.count || 30); i++) { const s = mk(); s.life = rnd(0, s.max); live.push(s); }
      return { add: false, draw(T, dt) { for (let i = 0; i < live.length; i++) { const s = live[i]; s.life += dt; s.x += s.v * dt;
        if (s.life > s.max) { live[i] = mk(); continue; }
        const k = Math.sin(s.life / s.max * Math.PI); ctx.globalAlpha = k * (e.alpha || 0.35); ctx.fillStyle = s.c;
        const l = s.len * (0.7 + 0.3 * k); ctx.fillRect(s.x - l / 2, s.y, l, e.thick || 2); } } };
    },
    // an image layer whose opacity swells and fades (e.g. foam washing in)  {src,x,y,min,max,speed}
    pulse(e) {
      const im = new Image(); im.src = e.src;
      return { add: !!e.add, draw(T) { if (!im.complete || !im.naturalWidth) return;
        const k = 0.5 + 0.5 * Math.sin(T * (e.speed || 0.5));
        ctx.globalAlpha = (e.min || 0) + ((e.max ?? 1) - (e.min || 0)) * k * k;
        ctx.drawImage(im, e.x || 0, e.y || 0); } };
    },
    // individual windows switching off and on  {items:[[x,y,w,h,'#facade']], off:0.1, onTime:[min,max], offTime:[min,max]}
    windows(e) {
      const on = e.onTime || [10, 70], off = e.offTime || [4, 25], fade = e.fade || 0.6;
      const ws = e.items.map(([x, y, w, h, c]) => {
        const lit = Math.random() > (e.off ?? 0.1);
        return { x, y, w, h, c, lit, at: -10, next: rnd(0, lit ? on[1] : off[1]) };
      });
      return { add: false, draw(T) { for (const w of ws) {
        if (T > w.next) { w.lit = !w.lit; w.at = T; w.next = T + (w.lit ? rnd(on[0], on[1]) : rnd(off[0], off[1])); }
        const k = Math.min(1, (T - w.at) / fade);       // 0..1 progress of the last switch
        const dark = w.lit ? 1 - k : k;                 // 1 = fully dark
        if (dark <= 0.01) continue;
        ctx.globalAlpha = dark * (e.alpha ?? 0.92); ctx.fillStyle = w.c;
        ctx.fillRect(w.x - 0.5, w.y - 0.5, w.w + 1, w.h + 1);
      } } };
    },
    // a blinking plane crossing the sky  {y, speed, dir (1 = to the right, -1 = to the left), x0, x1}
    plane(e) {
      const dir = e.dir || 1, x0 = e.x0 ?? -50, x1 = e.x1 ?? IW + 50, off = rnd(0, 1.4);
      let x = rnd(x0, x1), y = e.y;
      return { add: true, draw(T, dt) { x += dt * (e.speed || 18) * dir;
        if (dir > 0 ? x > x1 : x < x0) { x = dir > 0 ? x0 : x1; y = e.y + rnd(-40, 40); }
        const t = T + off, b = (t % 1.4) < 0.1;
        drawGlow('red', x, y, b ? 10 : 4, b ? 0.9 : 0.35); drawGlow('white', x + 6 * dir, y, 3, 0.5 + ((t + 0.7) % 1.4 < 0.08 ? 0.5 : 0)); } };
    },
    // rare shooting stars  {x0,x1,y0,y1, every:[min,max] seconds, color}
    shootingStar(e) {
      const every = e.every || [12, 40]; let next = rnd(3, every[1]), s = null;
      return { add: true, draw(T, dt) {
        if (!s && T > next) { const a = rnd(0.35, 0.7) * (Math.random() < 0.5 ? 1 : -1);
          s = { x: rnd(e.x0, e.x1), y: rnd(e.y0, e.y1), vx: Math.cos(a) * 520 * Math.sign(a), vy: Math.abs(Math.sin(a)) * 520, life: 0, max: rnd(0.6, 1.1) }; }
        if (!s) return;
        s.life += dt; const k = s.life / s.max;
        if (k >= 1) { s = null; next = T + rnd(every[0], every[1]); return; }
        const x = s.x + s.vx * s.life, y = s.y + s.vy * s.life, len = 0.18;
        const g = ctx.createLinearGradient(x, y, x - s.vx * len, y - s.vy * len);
        const hx = col(e.color || 'rosewater'); g.addColorStop(0, hx); g.addColorStop(1, hx + '00');
        ctx.globalAlpha = Math.sin(k * Math.PI) * (e.alpha || 0.9); ctx.strokeStyle = g; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s.vx * len, y - s.vy * len); ctx.stroke();
        drawGlow('white', x, y, 6, Math.sin(k * Math.PI) * 0.8);
      } };
    },
    // expanding flat rings on water  {points:[[x,y]], every:[min,max], size, color, alpha, squash}
    ripples(e) {
      const every = e.every || [2, 6], rs = []; let next = rnd(0, every[1]);
      return { add: false, draw(T, dt) {
        if (T > next) { const [x, y] = pick(e.points); rs.push({ x, y, life: 0, max: rnd(2.2, 3.5), n: Math.random() < 0.5 ? 2 : 1 }); next = T + rnd(every[0], every[1]); }
        ctx.strokeStyle = col(e.color || 'text'); ctx.lineWidth = e.width || 1.4;
        for (let i = rs.length - 1; i >= 0; i--) { const r = rs[i]; r.life += dt; const k = r.life / r.max;
          if (k >= 1) { rs.splice(i, 1); continue; }
          for (let j = 0; j < r.n; j++) { const kk = k - j * 0.25; if (kk <= 0) continue;
            const rad = (e.size || 22) * kk;
            ctx.globalAlpha = (1 - kk) * (e.alpha || 0.5);
            ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * (e.squash || 0.28), 0, 0, 6.283); ctx.stroke(); } }
      } };
    },
    // a small flat sailboat drifting along the horizon, fading in/out at the ends  {y, x0, x1, speed, color, scale}
    sailboat(e) {
      let x = rnd(e.x0, e.x1); const dir = e.dir || 1, s = e.scale || 1;
      return { add: false, draw(T, dt) { x += (e.speed || 4) * dir * dt;
        if (dir > 0 ? x > e.x1 : x < e.x0) x = dir > 0 ? e.x0 : e.x1;
        const edge = Math.min(x - e.x0, e.x1 - x) / 60, a = Math.max(0, Math.min(1, edge)) * (e.alpha || 0.8);
        const y = e.y + Math.sin(T * 1.3) * 0.6;
        ctx.globalAlpha = a; ctx.fillStyle = col(e.color || 'surface0');
        ctx.beginPath(); ctx.moveTo(x - 9 * s, y - 3 * s); ctx.lineTo(x + 9 * s, y - 3 * s); ctx.lineTo(x + 6 * s, y); ctx.lineTo(x - 6 * s, y); ctx.fill();   // hull
        ctx.beginPath(); ctx.moveTo(x, y - 4 * s); ctx.lineTo(x, y - 22 * s); ctx.lineTo(x + 8 * s, y - 5 * s); ctx.fill();                                   // main sail
        ctx.beginPath(); ctx.moveTo(x - 1.5 * s, y - 5 * s); ctx.lineTo(x - 1.5 * s, y - 17 * s); ctx.lineTo(x - 7 * s, y - 5 * s); ctx.fill();               // jib
      } };
    },
    // a few birds gliding and flapping  {y0,y1,count,color}
    birds(e) {
      const bs = Array.from({ length: e.count || 4 }, () => ({ x: rnd(0, IW), y: rnd(e.y0, e.y1), v: rnd(20, 35), ph: rnd(0, 6.3), s: rnd(0.7, 1.2) }));
      return { add: false, draw(T, dt) { ctx.strokeStyle = col(e.color || 'surface0'); ctx.lineWidth = 2; ctx.globalAlpha = e.alpha || 0.7;
        for (const b of bs) { b.x += b.v * dt; b.y += Math.sin(T * 0.4 + b.ph) * 0.1; if (b.x > IW + 40) { b.x = -40; b.y = rnd(e.y0, e.y1); }
          const f = Math.sin(T * 6 + b.ph) * 5 * b.s, w = 9 * b.s;
          ctx.beginPath(); ctx.moveTo(b.x - w, b.y - f); ctx.quadraticCurveTo(b.x - w / 2, b.y - 3 * b.s, b.x, b.y);
          ctx.quadraticCurveTo(b.x + w / 2, b.y - 3 * b.s, b.x + w, b.y - f); ctx.stroke(); } } };
    },
    // fireflies / floating motes  {x0,x1,y0,y1,count,colors}
    motes(e) {
      const ax = e.ax || [20, 60], ay = e.ay || [8, 30], sz = e.sizes || [8, 18];
      const ms = Array.from({ length: e.count || 20 }, () => ({ x: rnd(e.x0, e.x1), y: rnd(e.y0, e.y1), ph: rnd(0, 6.28), sp: rnd(0.15, 0.4),
        ax: rnd(ax[0], ax[1]), ay: rnd(ay[0], ay[1]), bl: rnd(0.4, 1.2), bp: rnd(0, 6.28), s: rnd(sz[0], sz[1]) * (e.size || 1), c: pick(e.colors || ['yellow']) }));
      return { add: true, draw(T) { for (const m of ms) { const b = Math.max(0, Math.sin(T * m.bl + m.bp));
        const x = m.x + Math.sin(T * m.sp + m.ph) * m.ax + Math.sin(T * m.sp * 2.3) * 8, y = m.y + Math.cos(T * m.sp * 1.3 + m.ph) * m.ay;
        drawGlow(m.c, x, y, m.s, 0.1 + b * (e.alpha || 0.75));
        if (e.core) drawGlow('white', x, y, e.coreR || 3, b * 0.9); } } };   // bright core, like the Mocha Forest fireflies
    },
  };

  const back = [], front = [];
  for (const e of S.effects || []) { const f = make[e.type] && make[e.type](e); if (f) ((e.layer || f.layer) === 'back' ? back : front).push(f); }
  let fg = null;

  // ------------------------------------------------------------------ loop
  let last = performance.now(), acc = 0, T = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const step = 1000 / cfg.fps; acc += now - last; last = now;
    if (acc < step || cfg.paused) return;
    const dt = Math.min(acc, 100) / 1000 * cfg.speed; acc %= step; T += dt;

    if (glOK) drawGL(T);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fx.width, fx.height);
    if (!glOK && baseImg) { ctx.setTransform(sc, 0, 0, sc, ox, oy); ctx.drawImage(baseImg, 0, 0, IW, IH); }
    ctx.setTransform(sc, 0, 0, sc, ox, oy);
    for (const f of back) { ctx.globalCompositeOperation = f.add ? 'lighter' : 'source-over'; f.draw(T, dt); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (fg && back.length) ctx.drawImage(fg, 0, S.foreground.y || 0);
    for (const f of front) { ctx.globalCompositeOperation = f.add ? 'lighter' : 'source-over'; f.draw(T, dt); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  (async () => {
    // Scenes without a mask need no WebGL: the picture is drawn into the same 2D canvas as the effects,
    // so additive glows blend straight onto the image (this is how Mocha Forest always rendered).
    if (S.mask) { try { await initGL(); } catch (err) { console.error('WebGL failed, falling back to 2D', err); } }
    if (!baseImg) baseImg = await load(S.background || 'background.jpg');
    if (S.foreground) fg = await load(S.foreground.src).catch(() => null);
    requestAnimationFrame(frame);
  })();

  // Wallpaper Engine-style property hook (optional)
  window.wallpaperPropertyListener = { applyGeneralProperties(p) { if (p.fps) cfg.fps = Math.max(10, p.fps); } };
})();
