import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { ExperienceConfig } from './config';
import { clamp, eio, eo, hash2, pad, ss } from './math';
import { createPlates, generatePlate } from './plates';
import { createProducts } from './products';
import { createPieceViewer } from './piece3d';
import { FRAG, VERT } from './shaders';

/**
 * Mounts the whole experience inside `root` (markup comes from components/Experience.tsx,
 * elements are found by their data-el attribute). Returns a cleanup function that removes every
 * listener, tween, ScrollTrigger, timer and GPU resource, so React Strict Mode and client-side
 * navigation are safe.
 */
export function mountExperience(root: HTMLElement, cfg: ExperienceConfig): () => void {
  gsap.registerPlugin(ScrollTrigger);

  const el = <T extends HTMLElement = HTMLElement>(name: string) => {
    const n = root.querySelector<T>(`[data-el="${name}"]`);
    if (!n) throw new Error(`Experience: missing [data-el="${name}"]`);
    return n;
  };
  const stage = el<HTMLCanvasElement>('stage');
  const hudEl = el('hud');
  const elTime = el('time'), elScene = el('scene'), elHint = el('hint'), elMeter = el('meter'), elSr = el('srTime');
  const elCur = el('cursor'), elCurL = el('cursorLabel'), elMail = el<HTMLButtonElement>('mail'), elAgain = el<HTMLButtonElement>('again');
  const toast = el('toast'), smearBtn = el<HTMLButtonElement>('smear');
  const secs = [...root.querySelectorAll<HTMLElement>('[data-sec]')];

  /* ---------- lifecycle bookkeeping ---------- */
  let alive = true;
  const offs: Array<() => void> = [];
  const timers = new Set<number>();
  const on = (t: EventTarget, ev: string, fn: (e: Event) => void, opts?: AddEventListenerOptions | boolean) => {
    t.addEventListener(ev, fn, opts);
    offs.push(() => t.removeEventListener(ev, fn, opts));
  };
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id: number) => { window.clearTimeout(id); timers.delete(id); };

  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const COARSE = matchMedia('(pointer: coarse)').matches;
  const NAME = cfg.name.toUpperCase();
  const EMAIL = cfg.email;
  const F = {
    d: '"Archivo", "Arial Black", Impact, sans-serif',
    s: '"Instrument Serif", "Times New Roman", serif',
    m: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    o: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  };
  const S = {
    t: 0, mx: 0, my: 0, tmx: 0, tmy: 0, ms: 0, hasPointer: false,
    down: false, holding: false, hold: 0, hx: 0, hy: 0, holdStart: 0,
    drag: { x: 0, y: 0, vx: 0, vy: 0 },
    sy: 0, psy: 0, vel: 0, amt: 0, boost: 0, flash: 0,
    reduced: RM.matches, smear: !RM.matches,
    introOn: true, introX: 0, slitA: 0, temp: cfg.temperatureC, mailT: -1,
    touching: false, lastTouch: -1e9, wander: false, swipeOff: 0, swipeV: 0, swipeH: false,
    overBtn: null as null | 'mail' | 'btn' | 'link',
    overPiece: -1, holdUsed: false,
  };
  const SMALL = () => innerWidth < 700;
  let Q = 1;   // dynamic resolution scale, lowered only if a phone can't hold the frame rate

  /* ---------- local time ---------- */
  /* the visitor's own clock and time zone */
  const fmt = new Intl.DateTimeFormat('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  let tzName = '';
  try {
    tzName = new Intl.DateTimeFormat(navigator.language, { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch { tzName = ''; }
  const T = { str: '00:00:00', tz: tzName, last: -1e9 };
  function updTime(ms: number) {
    if (ms - T.last < 200) return;
    T.last = ms;
    try {
      const parts = fmt.formatToParts(new Date());
      const g = (k: string) => parts.find(p => p.type === k)?.value ?? '';
      let h = g('hour'); if (h === '24') h = '00';
      T.str = `${h}:${g('minute')}:${g('second')}`;
    } catch {
      const d = new Date(); T.str = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }

  /* ---------- canvases & ink ---------- */
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = stage.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  } catch { gl = null; }
  const INK_RED = !!gl;      // with WebGL the 2D canvas is a data plate: R = light, G = ember
  const src = gl ? document.createElement('canvas') : stage;
  let c = src.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;   // the context scenes paint into
  const off = document.createElement('canvas');                                    // second layer for crossfades
  const oc = off.getContext('2d') as CanvasRenderingContext2D;
  // Everything is painted as INK DENSITY: 0 = white paper, 1 = black ink. With WebGL it goes into
  // the red channel (green is "signal" ink that never ghosts: the slit, markers); without WebGL the
  // same calls draw grey directly.
  const L = (v: number) => {
    const k = clamp(v);
    if (INK_RED) return `rgb(${Math.round(k * 255)},0,0)`;
    const l = Math.round(255 - k * 245); return `rgb(${l},${l},${l})`;
  };
  const ACC = INK_RED ? 'rgb(0,255,0)' : 'rgb(10,10,10)';
  const ACCa = (a: number) => INK_RED ? `rgba(0,255,0,${a})` : `rgba(10,10,10,${a})`;
  const PAPERa = (a: number) => INK_RED ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
  const WT = { name: 500, digits: 200, temp: 200, slit: 500 };   // Archivo weights
  let W = 0, H = 0, pr = 1, lastCW = 0, lastCH = 0;

  /* ---------- WebGL: the time machine ---------- */
  type U = Record<'uNow' | 'uHist' | 'uHead' | 'uN' | 'uAmt' | 'uLens' | 'uStrobe' | 'uFlash' | 'uTime' | 'uAspect' | 'uMouse', WebGLUniformLocation | null>;
  let prog: WebGLProgram | null = null, vao: WebGLVertexArrayObject | null = null;
  let texNow: WebGLTexture | null = null, texHist: WebGLTexture | null = null;
  let fbR: WebGLFramebuffer | null = null, fbD: WebGLFramebuffer | null = null;
  const shaders: WebGLShader[] = [];
  let N = 32, hw = 0, hh = 0, head = 0, pushAcc = 0, primed = false;
  const U = {} as U;

  function glInit(g: WebGL2RenderingContext) {
    const sh = (type: number, s: string) => {
      const o = g.createShader(type) as WebGLShader;
      g.shaderSource(o, s); g.compileShader(o);
      if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o) ?? 'shader');
      shaders.push(o);
      return o;
    };
    const p = g.createProgram() as WebGLProgram;
    g.attachShader(p, sh(g.VERTEX_SHADER, VERT)); g.attachShader(p, sh(g.FRAGMENT_SHADER, FRAG));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? 'link');
    prog = p;
    vao = g.createVertexArray();
    (Object.keys({ uNow: 0, uHist: 0, uHead: 0, uN: 0, uAmt: 0, uLens: 0, uStrobe: 0, uFlash: 0, uTime: 0, uAspect: 0, uMouse: 0 }) as Array<keyof U>)
      .forEach(k => { U[k] = g.getUniformLocation(p, k); });
    fbR = g.createFramebuffer(); fbD = g.createFramebuffer();
  }
  function glSize(g: WebGL2RenderingContext) {
    if (texNow) g.deleteTexture(texNow);
    if (texHist) g.deleteTexture(texHist);
    const small = Math.min(innerWidth, innerHeight) < 700;
    N = small ? 22 : 32;
    hw = Math.min(W, small ? 440 : 960); hh = Math.max(2, Math.round(H * hw / W));
    texNow = g.createTexture(); g.bindTexture(g.TEXTURE_2D, texNow);
    g.texStorage2D(g.TEXTURE_2D, 1, g.RG8, W, H);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    texHist = g.createTexture(); g.bindTexture(g.TEXTURE_2D_ARRAY, texHist);
    g.texStorage3D(g.TEXTURE_2D_ARRAY, 1, g.RG8, hw, hh, N);
    g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.bindFramebuffer(g.READ_FRAMEBUFFER, fbR);
    g.framebufferTexture2D(g.READ_FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texNow, 0);
    g.bindFramebuffer(g.READ_FRAMEBUFFER, null);
    head = 0; primed = false;
  }
  function pushLayer(g: WebGL2RenderingContext, l: number) {
    g.bindFramebuffer(g.READ_FRAMEBUFFER, fbR);
    g.bindFramebuffer(g.DRAW_FRAMEBUFFER, fbD);
    g.framebufferTextureLayer(g.DRAW_FRAMEBUFFER, g.COLOR_ATTACHMENT0, texHist, 0, l);
    g.blitFramebuffer(0, 0, W, H, 0, 0, hw, hh, g.COLOR_BUFFER_BIT, g.LINEAR);
    g.bindFramebuffer(g.READ_FRAMEBUFFER, null); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null);
  }
  function glRender(g: WebGL2RenderingContext, dt: number) {
    g.bindTexture(g.TEXTURE_2D, texNow);
    g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
    g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, g.RG, g.UNSIGNED_BYTE, src);
    if (!primed) { for (let i = 0; i < N; i++) pushLayer(g, i); head = 0; primed = true; }
    else {
      pushAcc += dt;
      if (pushAcc >= 1 / 62) { pushAcc = Math.min(pushAcc - 1 / 60, 1 / 60); head = (head + 1) % N; pushLayer(g, head); }
    }
    g.viewport(0, 0, W, H);
    g.useProgram(prog);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, texNow); g.uniform1i(U.uNow, 0);
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D_ARRAY, texHist); g.uniform1i(U.uHist, 1);
    g.uniform1f(U.uHead, head); g.uniform1f(U.uN, N);
    g.uniform1f(U.uAmt, S.amt); g.uniform1f(U.uLens, 0.28);
    g.uniform1f(U.uStrobe, S.smear ? S.hold : 0); g.uniform1f(U.uFlash, S.flash);
    g.uniform1f(U.uTime, S.t); g.uniform1f(U.uAspect, W / H);
    g.uniform2f(U.uMouse, S.mx / W, S.my / H);
    g.bindVertexArray(vao); g.drawArrays(g.TRIANGLES, 0, 3);
    g.activeTexture(g.TEXTURE0);
  }
  if (gl) {
    try { glInit(gl); } catch (e) { console.warn(e); prog = null; }
  }
  const glReady = () => !!(gl && prog);

  /* ---------- sizing ---------- */
  let tops: number[] = [], hts: number[] = [], vh = innerHeight, maxS = 1;
  /* Section lengths in screen heights. Phones get shorter runs so each scene lands in fewer swipes.
     On touch devices the unit is frozen per orientation, so the address bar showing or hiding never
     shifts the timeline mid-scroll. */
  const SEC_D = [100, 110, 190, 210, 120, 100], SEC_M = [150, 100, 160, 190, 110, 100];
  const TR = 0.6;   // a scene-to-scene transition lasts 0.6 screen heights of scroll
  let unitPx = innerHeight / 100, unitW = -1;
  function layoutSections(force: boolean) {
    const w = innerWidth;
    if (!force && COARSE && w === unitW) return false;
    const u = innerHeight / 100;
    if (!force && w === unitW && Math.abs(u - unitPx) < 0.5) return false;
    unitW = w; unitPx = u;
    const arr = (w < 700 || (COARSE && w / innerHeight < 0.85)) ? SEC_M : SEC_D;
    secs.forEach((s, i) => { s.style.height = `${Math.round(arr[i] * unitPx)}px`; });
    // when the index wall scrolls inside its frame, size its section so the wall moves exactly with
    // the finger (1:1), then holds briefly before the next scene fades in
    const hl = heroLayout(w, stage.clientHeight || innerHeight, 1);
    if (hl.overflow > 0 && secs[0]) secs[0].style.height = `${Math.round(hl.overflow + (TR + 0.2) * 100 * unitPx)}px`;
    return true;
  }
  function cacheSections() {
    tops = secs.map(s => s.offsetTop - secs[0].offsetTop);
    hts = secs.map(s => s.offsetHeight);
    vh = unitPx * 100;
    maxS = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  }
  function resize(force: boolean) {
    const cw = innerWidth, ch = stage.clientHeight || innerHeight;
    const moved = layoutSections(force);
    cacheSections();
    if (moved && !force) ScrollTrigger.refresh();
    if (!force && cw === lastCW && Math.abs(ch - lastCH) < 140) return;
    lastCW = cw; lastCH = ch;
    // phones: a lighter canvas keeps every scroll frame inside budget (the 2D plate is re-uploaded to WebGL each frame)
    let p = Math.min(devicePixelRatio || 1, cw < 700 ? 1.5 : 1.5) * Q;
    p = Math.max(p, Math.min(1, devicePixelRatio || 1) * 0.8);
    const maxPx = cw < 700 ? 1.1e6 : 3.4e6;
    if (cw * ch * p * p > maxPx) p = Math.sqrt(maxPx / (cw * ch));
    pr = p; W = Math.max(2, Math.round(cw * p)); H = Math.max(2, Math.round(ch * p));
    stage.width = W; stage.height = H;
    if (src !== stage) { src.width = W; src.height = H; }
    off.width = W; off.height = H;
    if (gl && prog) glSize(gl);
    tempCv = null;
    if (!S.hasPointer) { S.mx = S.tmx = W * 0.5; S.my = S.tmy = H * 0.5; }
  }

  /* ---------- placeholder plates ---------- */
  const PLATES = createPlates();
  let plateI = 0;
  function genNext() {
    if (!alive || plateI >= PLATES.length) return;
    const i = plateI++;
    generatePlate(PLATES[i], i, { inkRed: INK_RED, scale: SMALL() ? 0.72 : 1, alive: () => alive, later }, () => later(genNext, 16));
  }

  /* ---------- sample products (drawn once, as ink cut-outs) ---------- */
  const PRODUCTS = createProducts();
  function renderProducts() {
    const size = SMALL() ? 260 : 360;
    PRODUCTS.forEach(pd => {
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
      g.fillStyle = L(0); g.fillRect(0, 0, size, size);
      g.scale(size / 100, size / 100);
      pd.draw(g, L);
      pd.cv = cv;
    });
  }
  renderProducts();

  /* ---------- compositing: smooth crossfades between scenes ---------- */
  function paintInto<R>(ctx: CanvasRenderingContext2D, fn: () => R): R {
    const prev = c; c = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    try { return fn(); } finally { c = prev; }
  }
  function withDrag<R>(fn: () => R, extraX = 0, extraY = 0): R {
    c.save(); c.translate(S.drag.x + extraX, S.drag.y + extraY);
    try { return fn(); } finally { c.restore(); }
  }
  /** scene B fades in over scene A while both drift a little vertically */
  function crossfade(aFn: () => void, bFn: () => void, e: number) {
    withDrag(aFn, 0, -e * H * 0.035);
    paintInto(oc, () => { oc.fillStyle = L(0); oc.fillRect(0, 0, W, H); withDrag(bFn, 0, (1 - e) * H * 0.035); });
    c.globalAlpha = e; c.drawImage(off, 0, 0); c.globalAlpha = 1;
  }
  const hasLS = 'letterSpacing' in c;
  function mono(size: number, a = 0.6, align: CanvasTextAlign = 'left') {
    c.font = `500 ${size}px ${F.m}`; c.fillStyle = L(a); c.textAlign = align; c.textBaseline = 'alphabetic';
    if (hasLS) c.letterSpacing = `${Math.round(size * 0.12)}px`;
  }
  function noSpacing() { if (hasLS) c.letterSpacing = '0px'; }
  const rowsFor = (portrait: boolean) => {
    const idx = [...NAME].map((_, i) => i);
    if (!portrait || idx.length < 4) return [idx];
    const h = Math.ceil(idx.length / 2);
    return [idx.slice(0, h), idx.slice(h)];
  };

  /* ---------- 00: index. Twelve forms hung like a gallery wall ---------- */
  let heroT0 = -1;
  /** grid geometry for the index wall, in device px (w, h are canvas px; k is the pixel ratio) */
  function heroLayout(w: number, h: number, k: number) {
    const portrait = w / h < 0.85;
    const cols = portrait ? (innerWidth >= 600 ? 3 : 2) : (w / h < 1.25 ? 4 : 6);
    const rows = Math.ceil(PRODUCTS.length / cols);
    const mx0 = w * (portrait ? 0.05 : 0.035);
    const top = portrait ? Math.max(h * 0.15, 122 * k) : Math.max(h * 0.11, 78 * k);
    const bottom = portrait ? Math.max(h * 0.13, 104 * k) : h * 0.09;
    const visRows = portrait ? (cols === 3 ? 4 : 3) : (cols === 4 ? 3 : 2);
    const cw = (w - mx0 * 2) / cols, rh = (h - top - bottom) / visRows;
    const overflow = Math.max(0, rows * rh - (h - top - bottom));
    return { cols, mx0, top, bottom, cw, rh, overflow };
  }
  const hov = PRODUCTS.map(() => ({ s: 1, v: 0 }));
  const heroHits: Array<{ i: number; x: number; y: number; w: number; h: number }> = [];
  function sceneHero(p: number, nowMs: number) {
    if (heroT0 < 0) heroT0 = nowMs;
    heroHits.length = 0; S.overPiece = -1;
    const { cols, mx0, top, bottom, cw, rh, overflow } = heroLayout(W, H, pr);
    const n = PRODUCTS.length;
    // the framed wall follows the page scroll pixel for pixel, like a native list
    const scrollY = overflow > 0 ? -clamp(S.sy * pr, 0, overflow) : -p * overflow;
    const box = Math.min(cw * 0.74, rh * 0.7);
    const cs = Math.max(9.5 * pr, Math.min(H * 0.0115, 11.5 * pr));

    // when the wall scrolls (phones, tablets) it scrolls inside a frame, clear of the top bar and footer
    const framed = overflow > 0, fTop = top - cs * 2.2, fBot = H - bottom * 0.55;
    if (framed) { c.save(); c.beginPath(); c.rect(0, fTop, W, fBot - fTop); c.clip(); }
    for (let i = 0; i < n; i++) {
      const pd = PRODUCTS[i]; if (!pd.cv) continue;
      const col = i % cols, row = Math.floor(i / cols);
      // on a wide screen the wall lifts away column by column as you scroll on
      const lift = overflow > 0 ? 0 : ss(0, 1, p) * H * 0.3 * (0.7 + 0.3 * (((col * 5) % cols) / cols));
      const cx = mx0 + cw * (col + 0.5), cy = top + rh * (row + 0.44) + scrollY - lift;
      if (cy + box < -H * 0.1 || cy - box > H * 1.1) continue;
      const r = S.reduced ? 1 : eo(clamp((nowMs - heroT0 - i * 70) / 900));
      const near = S.hasPointer && !COARSE && Math.abs(S.mx - cx) < cw * 0.45 && Math.abs(S.my - cy) < rh * 0.45;
      if (near) S.overPiece = i;
      const hv = hov[i];
      hv.s += ((near ? 1.035 : 1) - hv.s) * 0.12;               // eased, no spring bounce
      const sz = box * hv.s, x = cx - sz / 2, y = cy - sz / 2 + (1 - r) * H * 0.025;
      c.globalCompositeOperation = INK_RED ? 'lighten' : 'darken';
      c.globalAlpha = r;
      c.drawImage(pd.cv, x, y, sz, sz);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      if (!framed || (cy > fTop && cy < fBot)) heroHits.push({ i, x: cx - cw * 0.45, y: cy - rh * 0.45, w: cw * 0.9, h: rh * 0.9 });
      const ly = cy + box * 0.5 + cs * 2.2;
      mono(cs, 1, 'left');
      const t1 = pd.code, t2 = `  ${pd.name}`;
      const w1 = c.measureText(t1).width, w2 = c.measureText(t2).width, lx = cx - (w1 + w2) / 2;
      c.fillStyle = L((near ? 1 : 0.88) * r); c.fillText(t1, lx, ly);
      c.fillStyle = L((near ? 0.7 : 0.42) * r); c.fillText(t2, lx + w1, ly);
      noSpacing();
    }
    if (framed) {
      const fh = H * 0.05;
      let g = c.createLinearGradient(0, fTop, 0, fTop + fh); g.addColorStop(0, PAPERa(1)); g.addColorStop(1, PAPERa(0));
      c.fillStyle = g; c.fillRect(0, fTop, W, fh);
      g = c.createLinearGradient(0, fBot - fh, 0, fBot); g.addColorStop(0, PAPERa(0)); g.addColorStop(1, PAPERa(1));
      c.fillStyle = g; c.fillRect(0, fBot - fh, W, fh);
      c.restore();
    }
    mono(cs, 0.42, 'left');                                   // the heading stays put above the wall
    c.fillText('INDEX OF FORMS', mx0 + cw * 0.5 - box * 0.5, (framed ? fTop - cs * 0.4 : top - cs * 0.6 + scrollY));
    noSpacing();
  }

  /* ---------- 01: the name as a physical object, set off-centre on white ---------- */
  const spr = { c: [...NAME].map(() => 1), v: [...NAME].map(() => 0) };
  function sceneName(p: number) {
    const portrait = W / H < 0.85;
    const rows = rowsFor(portrait);
    noSpacing();
    c.font = `${WT.name} 100px ${F.d}`;
    const w100 = [...NAME].map(ch => c.measureText(ch).width * 0.97);
    const asc100 = c.measureText(NAME[0]).actualBoundingBoxAscent || 72;
    const tw = W * (portrait ? 0.84 : 0.8);
    const left = W * (portrait ? 0.08 : 0.06);
    let fs = Infinity;
    rows.forEach(r => { fs = Math.min(fs, 100 * tw / r.reduce((a, i) => a + w100[i], 0)); });
    fs = Math.min(fs, 100 * H * (portrait ? 0.25 : 0.5) / asc100);
    const cap = asc100 * fs / 100, gapY = cap * 0.08;
    const blockH = rows.length * cap + (rows.length - 1) * gapY;
    const stretch = 1 + ss(0, 1, p) * 0.35;
    const base0 = H * (portrait ? 0.5 : 0.56) - blockH / 2 + cap - p * H * 0.05;
    c.font = `${WT.name} ${fs}px ${F.d}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = L(1);
    let blockW = 0;
    rows.forEach((r, ri) => {
      const widths = r.map(i => w100[i] * fs / 100);
      const sum = widths.reduce((a, b) => a + b, 0);
      blockW = Math.max(blockW, sum);
      let x = left, acc = 0;
      const g = r.map((_, k) => {
        const cx = x + acc + widths[k] / 2; acc += widths[k];
        const d = (cx - S.mx) / (W * 0.17);
        return 1 + (S.hasPointer && !S.reduced ? 0.5 : 0) * Math.exp(-d * d) * (1 - p);
      });
      const avg = r.reduce((a, _, k) => a + widths[k] * g[k], 0) / sum;
      r.forEach((i, k) => { const tgt = g[k] / avg; spr.c[i] += (tgt - spr.c[i]) * 0.08; });
      const by = base0 + ri * (cap + gapY);
      r.forEach((i, k) => { c.save(); c.translate(x, by); c.scale(spr.c[i], stretch); c.fillText(NAME[i], 0, 0); c.restore(); x += widths[k] * spr.c[i]; });
    });
    // two quiet labels under the name
    const cs = Math.max(10 * pr, Math.min(fs * 0.06, 12 * pr));
    const yCap = base0 + (rows.length - 1) * (cap + gapY) + cs * 3.4;
    mono(cs, 0.85, 'left'); c.fillText(`CURRENTLY IN ${cfg.city.toUpperCase()}`, left + pr * 2, yCap);
    mono(cs, 0.45, portrait ? 'left' : 'right');
    c.fillText(`${T.str} ${T.tz}   ${S.temp}°C`, portrait ? left + pr * 2 : left + blockW, portrait ? yCap + cs * 1.9 : yCap);
    noSpacing();
  }

  /* ---------- 02: time runs sideways on a film strip ---------- */
  const dig = Array.from({ length: 8 }, () => ({ ch: '', prev: '', t0: -1e9 }));
  function syncDigits(nowMs: number) {
    for (let i = 0; i < 8; i++) {
      const ch = T.str[i] || '';
      if (dig[i].ch !== ch) { dig[i].prev = dig[i].ch; dig[i].ch = ch; dig[i].t0 = (dig[i].prev === '' || S.reduced) ? -1e9 : nowMs; }
    }
  }
  type Item = { k: 's' | 'b' | 'm' | 't'; s?: string; w?: number };
  function sceneTime(p: number, nowMs: number) {
    const portrait = W / H < 0.85;
    noSpacing();
    c.font = `${WT.digits} 100px ${F.d}`;
    const asc100 = c.measureText('0').actualBoundingBoxAscent || 72;
    const fb = 100 * H * (portrait ? 0.18 : 0.36) / asc100;
    c.font = `${WT.digits} ${fb}px ${F.d}`;
    const asc = asc100 * fb / 100;
    const cellW = Math.max(...'0123456789'.split('').map(d => c.measureText(d).width));
    const colW = c.measureText(':').width * 1.1;
    const mid = H * 0.5, base = mid + asc / 2;
    const fsS = fb * 0.17, fsM = fb * 0.07, gap = fb * 0.2;
    const items: Item[] = [
      { k: 's', s: 'currently in' }, { k: 'b', s: cfg.city.toUpperCase() }, { k: 's', s: 'and where you are it is' },
      { k: 't' }, { k: 'm', s: T.tz }, { k: 's', s: 'and' }, { k: 'b', s: `${S.temp}°C` }, { k: 's', s: 'in the air.' },
    ];
    items.forEach(it => {
      if (it.k === 'b') { c.font = `${WT.digits} ${fb}px ${F.d}`; it.w = c.measureText(it.s ?? '').width; }
      else if (it.k === 's') { c.font = `italic ${fsS}px ${F.s}`; it.w = c.measureText(it.s ?? '').width; }
      else if (it.k === 'm') { c.font = `500 ${fsM}px ${F.m}`; it.w = c.measureText(it.s ?? '').width; }
      else it.w = cellW * 6 + colW * 2;
    });
    const total = items.reduce((a, it) => a + (it.w ?? 0), 0) + gap * (items.length - 1);
    const x0 = W * 0.1 - p * (total - W * 0.8) + S.swipeOff * 1.4;
    // film edges, drawn as faint marks
    const sp = fb * 0.1, hw2 = fb * 0.03, hh2 = fb * 0.02;
    const yTop = mid - asc / 2 - fb * 0.26, yBot = mid + asc / 2 + fb * 0.22;
    c.fillStyle = L(0.12);
    const start = ((x0 % sp) + sp) % sp - sp;
    for (let x = start; x < W + sp; x += sp) {
      c.fillRect(x, yTop, hw2, hh2); c.fillRect(x, yBot, hw2, hh2);
      const idx = Math.round((x - x0) / sp);
      if (idx % 8 === 0) { mono(Math.max(9 * pr, fsM * 0.5), 0.3); c.fillText(`ALX ${pad(Math.abs(idx / 8), 3)}`, x, yBot + hh2 + fsM * 1.1); c.fillStyle = L(0.12); }
    }
    noSpacing();
    // playhead
    c.fillStyle = ACC; c.fillRect(W * 0.5 - pr * 0.5, yTop - fb * 0.1, pr, fb * 0.07); c.fillRect(W * 0.5 - pr * 0.5, yBot + hh2 + fb * 0.03, pr, fb * 0.07);
    mono(Math.max(9 * pr, fsM * 0.55), 0.55, 'center'); c.fillText('NOW', W * 0.5, yTop - fb * 0.15); noSpacing();
    let x = x0;
    items.forEach(it => {
      const w = it.w ?? 0;
      if (x > W + 20 || x + w < -20) { x += w + gap; return; }
      if (it.k === 'b') { c.font = `${WT.digits} ${fb}px ${F.d}`; c.fillStyle = L(1); c.textAlign = 'left'; c.fillText(it.s ?? '', x, base); }
      else if (it.k === 's') { c.font = `italic ${fsS}px ${F.s}`; c.fillStyle = L(0.5); c.textAlign = 'left'; c.fillText(it.s ?? '', x, base - asc + fsS * 0.75); }
      else if (it.k === 'm') { mono(fsM, 0.5); c.fillText(it.s ?? '', x, base - asc + fsM); noSpacing(); }
      else {
        c.font = `${WT.digits} ${fb}px ${F.d}`; c.textAlign = 'center'; c.fillStyle = L(1);
        let cx = x;
        for (let i = 0; i < 8; i++) {
          const ch = T.str[i];
          if (ch === ':') { c.fillText(':', cx + colW / 2, base); cx += colW; continue; }
          const D = dig[i], e = eo(clamp((nowMs - D.t0) / 460));
          c.save(); c.beginPath(); c.rect(cx, base - asc * 1.18, cellW, asc * 1.32); c.clip();
          if (e < 1 && D.prev) c.fillText(D.prev, cx + cellW / 2, base - e * asc * 1.3);
          c.fillText(D.ch, cx + cellW / 2, base + (1 - e) * asc * 1.3);
          c.restore();
          cx += cellW;
        }
      }
      x += w + gap;
    });
  }

  /* ---------- 03: isolated objects that assemble from slices, hung like a gallery ---------- */
  const LAY = [
    { x: 0.30, y: 0.78, h: 0.50, sp: 1.0 }, { x: 0.72, y: 1.25, h: 0.62, sp: 1.22 }, { x: 0.42, y: 1.9, h: 0.58, sp: 0.92 },
    { x: 0.76, y: 2.55, h: 0.5, sp: 1.12 }, { x: 0.25, y: 3.05, h: 0.6, sp: 1.0 }, { x: 0.6, y: 3.62, h: 0.42, sp: 1.04 },
  ];
  const PW = [0.86, 0.7, 0.8, 0.74, 0.84, 0.66];   // portrait: plates own the width, staggered
  function scenePlates(p: number) {
    const portrait = W / H < 0.85, travel = 3.25;
    const rects: Array<{ x: number; y: number; w: number; h: number; cy: number; i: number }> = [];
    let best = -1, bd = 1e9;
    LAY.forEach((l, i) => {
      const P = PLATES[i], ar = P.w / P.h;
      let dh: number, dw: number, cx: number, sp = l.sp;
      if (portrait) {
        dw = W * PW[i]; dh = dw / ar;
        if (dh > H * 0.46) { dh = H * 0.46; dw = dh * ar; }
        cx = W * (0.5 + (l.x - 0.5) * 0.22) + Math.sin(p * 6 + i * 1.7) * W * 0.025 * (S.reduced ? 0 : 1);
        sp = 1 + (l.sp - 1) * 0.3;          // gentler depth so stacked plates never collide
      } else {
        dh = H * l.h; dw = dh * ar;
        if (dw > W * 0.8) { dw = W * 0.8; dh = dw / ar; }
        cx = W * l.x;
      }
      const cy = H * (l.y - p * travel * sp);
      rects.push({ x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, cy, i });
      const d = Math.abs(cy - H * 0.5); if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) {
      const R = rects[best];
      noSpacing(); c.font = `${WT.digits} ${portrait ? Math.min(H * 0.72, W * 0.9) : H * 0.8}px ${F.d}`;
      c.fillStyle = L(0.05); c.textBaseline = 'alphabetic';
      const right = R.x + R.w / 2 > W / 2;
      c.textAlign = portrait ? 'center' : (right ? 'left' : 'right');
      c.fillText(pad(best + 1), portrait ? W / 2 : (right ? W * 0.04 : W * 0.96), portrait ? H * 0.62 : H * 0.84);
    }
    const cs = Math.max(9.5 * pr, H * 0.011);
    rects.forEach(R => {
      if (R.y > H * 1.15 || R.y + R.h < -H * 0.15) return;
      const P = PLATES[R.i], e = R.cy / H;
      const r = S.reduced ? 1 : ss(1.12, 0.72, e) * ss(-0.28, 0.16, e);
      if (P.cv) {
        c.globalCompositeOperation = INK_RED ? 'lighten' : 'darken';   // ink adds; paper never covers
        c.globalAlpha = r;
        c.drawImage(P.cv, R.x, R.y + (1 - r) * H * 0.04, R.w, R.h);
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      }
      mono(cs, 0.8 * r, 'center');
      c.fillText(`PLATE ${pad(R.i + 1)}`, R.x + R.w / 2, R.y + R.h * 0.97);
      mono(cs * 0.85, 0.35 * r, 'center');
      c.fillText('PLACEHOLDER', R.x + R.w / 2, R.y + R.h * 0.97 + cs * 1.7);
      noSpacing();
    });
    const ls = Math.max(9.5 * pr, H * 0.011), ly = Math.max(H * 0.14, 92 * pr);
    mono(ls, 0.4, 'left');
    const label = 'EXPOSURES · PLACEHOLDER IMAGERY, GENERATED IN YOUR BROWSER';
    if (c.measureText(label).width < W * 0.92) c.fillText(label, W * 0.04, ly);
    else { c.fillText('EXPOSURES · PLACEHOLDER IMAGERY,', W * 0.04, ly); c.fillText('GENERATED IN YOUR BROWSER', W * 0.04, ly + ls * 1.6); }
    noSpacing();
  }

  /* ---------- 04: air ---------- */
  let tempCv: { cv: HTMLCanvasElement; w: number; h: number } | null = null;
  function buildTemp() {
    const portrait = W / H < 0.85, t = `${S.temp}°`;
    const k = document.createElement('canvas'), kc = k.getContext('2d') as CanvasRenderingContext2D;
    kc.font = `${WT.temp} 100px ${F.d}`;
    let m = kc.measureText(t); const asc100 = m.actualBoundingBoxAscent || 72;
    const fs = Math.min(100 * H * (portrait ? 0.28 : 0.52) / asc100, 100 * W * (portrait ? 0.62 : 0.56) / m.width);
    kc.font = `${WT.temp} ${fs}px ${F.d}`; m = kc.measureText(t);
    const asc = asc100 * fs / 100, padd = Math.round(fs * 0.1);
    k.width = Math.ceil(m.width) + padd * 2; k.height = Math.ceil(asc * 1.04) + padd * 2;
    kc.font = `${WT.temp} ${fs}px ${F.d}`; kc.fillStyle = L(1); kc.textBaseline = 'alphabetic';
    kc.fillText(t, padd, padd + asc);
    tempCv = { cv: k, w: k.width, h: k.height };
  }
  function sceneTemp(p: number) {
    if (!tempCv) buildTemp();
    if (!tempCv) return;
    const portrait = W / H < 0.85;
    const { cv, w, h } = tempCv;
    const x0 = portrait ? W * 0.06 : W * 0.08;
    const y0 = H * 0.48 - h / 2 - (p - 0.5) * H * 0.1;
    const amp = (S.reduced || !S.smear) ? 0 : (0.35 + S.temp * 0.05) * pr;
    const step = Math.max(2, Math.round(3 * pr));
    for (let y = 0; y < h; y += step) {
      const yy = y0 + y, d = (yy - S.my) / (H * 0.13);
      const prox = S.hasPointer ? Math.exp(-d * d) * ss(W * 0.5, 0, Math.abs(S.mx - (x0 + w / 2)) - w * 0.3) : 0;
      const a = amp * (1 + 1.5 * prox);
      const off = Math.sin(y * 0.018 / pr + S.t * 1.2) * a + Math.sin(y * 0.047 / pr - S.t * 1.7) * a * 0.4;
      c.drawImage(cv, 0, y, w, step, x0 + off, yy, w, step);
    }
    // scale, in real units
    const sx = W * (portrait ? 0.86 : 0.87), top = H * 0.18, bot = H * 0.82, lo = -30, hi = 35;
    const ymap = (v: number) => bot - (v - lo) / (hi - lo) * (bot - top);
    const cs = Math.max(9.5 * pr, H * 0.011);
    c.fillStyle = L(0.25); c.fillRect(sx, top, Math.max(1, pr * 0.5), bot - top);
    mono(cs, 0.4, 'right');
    for (let v = lo; v <= hi; v += 5) {
      const y = ymap(v), big = v % 10 === 0;
      c.fillStyle = L(big ? 0.45 : 0.22); c.fillRect(sx - (big ? 12 : 6) * pr, y, (big ? 12 : 6) * pr, Math.max(1, pr * 0.5));
      if (big) { c.fillStyle = L(0.4); c.fillText(`${v > 0 ? '+' : ''}${v}`, sx - 18 * pr, y + cs * 0.35); }
    }
    const mv = lo + (S.temp - lo) * (S.reduced ? 1 : eo(clamp(p * 2.4 + 0.25)));
    const my = ymap(mv);
    c.fillStyle = ACCa(0.18); c.fillRect(0, my, sx, Math.max(1, pr * 0.5));
    c.fillStyle = ACC; c.fillRect(sx - 4 * pr, my - pr, 40 * pr, 2 * pr);
    if (portrait) { mono(cs, 1, 'right'); c.fillStyle = ACC; c.fillText(`${Math.round(mv)}°C`, W - 6 * pr, my - 8 * pr); }
    else { mono(cs, 1, 'left'); c.fillStyle = ACC; c.fillText(`${Math.round(mv)}°C`, sx + 10 * pr, my - 8 * pr); }
    noSpacing();
    const by = portrait ? H * 0.78 : H * 0.84;
    mono(cs, 0.85, 'left'); c.fillText(`AIR TEMPERATURE, ${cfg.city.toUpperCase()}`, x0 + pr * 2, by);
    mono(cs, 0.4, 'left');
    c.fillText(`LAST READING ${S.temp}°C`, x0 + pr * 2, by + cs * 1.9);
    noSpacing();
  }

  /* ---------- 05: the address ---------- */
  const mailRect = { x: 0, y: 0, w: 0, h: 0 };
  function sceneMail(p: number, nowMs: number) {
    if (S.mailT < 0) S.mailT = nowMs;
    const e = S.reduced ? 1 : clamp((nowMs - S.mailT - 120) / 1300);
    const se = eio(e);
    const portrait = W / H < 0.85;
    const at = EMAIL.indexOf('@');
    const lines = portrait && at > 0 ? [EMAIL.slice(0, at), EMAIL.slice(at)] : [EMAIL];
    noSpacing();
    c.font = `italic 100px ${F.s}`;
    const maxw100 = Math.max(...lines.map(l => c.measureText(l).width));
    const fs = Math.min(100 * W * (portrait ? 0.84 : 0.66) / maxw100, H * 0.24);
    const lh = fs * 0.98, blockH = lh * lines.length, top = H * 0.52 - blockH / 2 - (p - 0.5) * H * 0.06;
    const maxw = maxw100 * fs / 100;
    const left = W * (portrait ? 0.08 : 0.08);
    const cs = Math.max(9.5 * pr, H * 0.011);
    mono(cs, 0.85, 'left'); c.fillText(`WRITE TO ${NAME}`, left + pr * 2, top - cs * 1.4); noSpacing();
    c.save(); c.globalAlpha = se;
    c.font = `italic ${fs}px ${F.s}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = L(1);
    lines.forEach((l, i) => c.fillText(l, left, top + lh * (i + 0.78) + (1 - se) * H * 0.02));
    c.restore();
    mono(cs, 0.4, 'left');
    c.fillText(`IT IS ${T.str} WHERE YOU ARE`, left + pr * 2, top + blockH + cs * 2.6);
    noSpacing();
    mailRect.x = left; mailRect.y = top; mailRect.w = maxw; mailRect.h = blockH + lh * 0.1;
    return e >= 1;
  }

  type Scene = (p: number, nowMs: number, dt: number) => boolean | void;
  const SCENES: Scene[] = [sceneHero, sceneName, sceneTime, scenePlates, sceneTemp, sceneMail];
  const MAIL = SCENES.length - 1;
  const LABELS = ['Index', cfg.displayName, 'Local time', 'Exposures', 'Air', 'Address'];
  const HINTS = COARSE ? [
    'Tap an object to hold it.', 'Touch and drag. The present follows your finger.', 'Scroll. Time runs sideways. Swipe to push it.',
    'Press and hold, then scroll, for a long exposure.', 'Touch near the number. The air moves.', 'Tap the address to copy it.',
  ] : [
    'Select an object to hold it. Scroll to go on.', 'Move. The present follows your cursor.', 'Scroll. Time runs sideways.',
    'Hold anywhere for a long exposure.', 'Move near the number. The air moves.', 'Click the address to copy it.',
  ];

  /* ---------- scroll → scene state (one ScrollTrigger scrubs one proxy value) ---------- */
  function sceneState() {
    const y = S.sy;
    let cur = 0;
    for (let i = 0; i < tops.length; i++) if (y >= tops[i] - 0.5) cur = i;
    const p = pOf(cur);
    let t = 0;
    if (cur < tops.length - 1) t = clamp((y - (tops[cur + 1] - TR * vh)) / (TR * vh));
    return { cur, p, t };
  }
  function pOf(i: number) {
    const tail = i < tops.length - 1 ? TR * vh : vh;   // the last scene runs to the end of the page
    return clamp((S.sy - tops[i]) / Math.max(1, hts[i] - tail));
  }

  /* ---------- frame ---------- */
  const hud = { time: '', scene: -1, meter: -1, mail: null as boolean | null, mailKey: '' };
  /* If a phone can't hold ~45fps, step the render resolution down (never below ~0.8x) instead of
     dropping any effect. Desktop keeps its fixed resolution. */
  const perf = { acc: 0, n: 0, slow: 0 };
  function perfTick(dt: number) {
    if (!(COARSE || SMALL()) || S.introOn) return;
    perf.acc += dt; perf.n++;
    if (perf.acc < 1.5) return;
    const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0;
    perf.slow = avg > 0.022 ? perf.slow + 1 : 0;
    if (perf.slow >= 2 && Q > 0.62) { Q *= 0.82; perf.slow = 0; lastCW = -1; resize(false); }
  }
  let last = performance.now(), mailReady = false, raf = 0;
  function frame(now: number) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (piece.open) { last = now; return; }        // the piece page covers the stage; save the battery
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    S.t += dt;
    updTime(Date.now()); syncDigits(now);
    // touch: when no finger is down, the present eases back to the centre and rests there
    S.wander = COARSE && !S.touching && now - S.lastTouch > 1400;
    if (S.wander) { S.tmx = W * 0.5; S.tmy = H * 0.5; }
    if (!(S.touching && S.swipeH)) { S.swipeOff *= Math.pow(0.93, dt * 60); S.swipeV *= Math.pow(0.9, dt * 60); }
    perfTick(dt);
    // touch: follow the native (momentum) scroll position exactly, in step with this frame
    if (COARSE && !S.introOn) S.sy = clamp(window.scrollY, 0, maxS);
    // inputs
    const k = 1 - Math.pow(1 - (S.wander ? 0.03 : 0.14), dt * 60);
    const pmx = S.mx, pmy = S.my;
    S.mx += (S.tmx - S.mx) * k; S.my += (S.tmy - S.my) * k;
    const msp = Math.hypot(S.mx - pmx, S.my - pmy) / W / dt;
    S.ms += (msp - S.ms) * 0.12;
    const v = (S.sy - S.psy) / dt; S.psy = S.sy;
    S.vel += (v - S.vel) * 0.15;
    if (S.holding) S.holdUsed = true;
    S.hold += ((S.holding ? 1 : 0) - S.hold) * (1 - Math.pow(1 - 0.05, dt * 60));
    const dragOn = S.holding && !S.reduced && !S.touching;   // on touch the finger scrolls; it doesn't drag
    const tx = dragOn ? (S.mx - S.hx) * 0.25 : 0, ty = dragOn ? (S.my - S.hy) * 0.25 : 0;
    S.drag.vx += (tx - S.drag.x) * 0.09; S.drag.vy += (ty - S.drag.y) * 0.09;
    S.drag.vx *= 0.8; S.drag.vy *= 0.8; S.drag.x += S.drag.vx; S.drag.y += S.drag.vy;
    const st = sceneState();
    S.boost = S.introOn ? 0 : Math.sin(Math.PI * st.t);
    const amtT = S.smear ? clamp(0.22 + Math.abs(S.vel) / 4500 + S.ms * 0.25 + S.boost * 0.12, 0, 0.55) : 0;
    S.amt += (amtT - S.amt) * 0.06;
    // paint the plate
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; noSpacing();
    c.fillStyle = L(0); c.fillRect(0, 0, W, H);
    let curScene = st.cur;
    if (S.introOn) {
      withDrag(() => { sceneHero(0, now); });
      if (introTime && introTime.textContent !== T.str) introTime.textContent = T.str;
      curScene = 0;
    } else if (st.t > 0.0005 && st.cur < SCENES.length - 1) {
      // on narrow portrait screens the scenes are dense, so keep the overlap window short
      const e = eio(W / H < 0.85 ? clamp((st.t - 0.3) / 0.4) : st.t), a = st.cur, b = st.cur + 1;
      if (b !== MAIL) S.mailT = -1;
      crossfade(() => { SCENES[a](pOf(a), now, dt); }, () => { SCENES[b](pOf(b), now, dt); }, e);
      curScene = st.t > 0.5 ? b : a;
      mailReady = false;
    } else {
      if (st.cur !== MAIL) S.mailT = -1;
      const r = withDrag(() => SCENES[st.cur](st.p, now, dt));
      mailReady = st.cur === MAIL && r === true;
    }
    if (S.introOn || st.cur !== 0 || st.t > 0.0005) { heroHits.length = 0; S.overPiece = -1; }
    if (gl && glReady()) glRender(gl, dt);
    // HUD
    if (hud.time !== T.str) { hud.time = T.str; elTime.textContent = `${T.str} ${T.tz}`; elSr.textContent = `${T.str} ${T.tz}`; }
    if (hud.scene !== curScene) { hud.scene = curScene; elScene.textContent = `${pad(curScene + 1)} / ${pad(SCENES.length)} ${LABELS[curScene]}`; elHint.textContent = HINTS[curScene]; }
    const mv = Math.round(clamp(S.sy / maxS) * 1000) / 1000;
    if (mv !== hud.meter) { hud.meter = mv; elMeter.style.transform = `scaleX(${mv})`; }
    if (mailReady !== hud.mail) { hud.mail = mailReady; elMail.classList.toggle('on', mailReady); elAgain.classList.toggle('on', mailReady); }
    if (mailReady) {
      const key = `${Math.round((mailRect.x + S.drag.x) / pr)},${Math.round((mailRect.y + S.drag.y) / pr)},${Math.round(mailRect.w / pr)},${Math.round(mailRect.h / pr)}`;
      if (key !== hud.mailKey) {
        hud.mailKey = key; const [l, t, w, h] = key.split(',');
        Object.assign(elMail.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
      }
    }
    // cursor
    if (S.hasPointer && !COARSE) {
      elCur.style.opacity = '1';
      elCur.style.transform = `translate3d(${S.tmx / pr}px,${S.tmy / pr}px,0)`;
      elCurL.textContent = S.holding ? `EXPOSING ${((now - S.holdStart) / 1000).toFixed(1)}S` : (S.overBtn ? ({ mail: 'COPY', btn: 'PRESS', link: 'OPEN' } as const)[S.overBtn] : S.overPiece >= 0 ? 'VIEW' : 'NOW');
    }
  }

  /* ---------- input ---------- */
  const isBtn = (t: EventTarget | null) => !!(t instanceof Element && t.closest('button, a'));
  function setPointer(cx: number, cy: number) {
    S.tmx = cx * pr; S.tmy = cy * pr;
    if (!S.hasPointer) { S.mx = S.tmx; S.my = S.tmy; }
    S.hasPointer = true;
  }
  on(window, 'pointermove', e => {
    const pe = e as PointerEvent;
    setPointer(pe.clientX, pe.clientY);
    const b = pe.target instanceof Element ? pe.target.closest('button, a') : null;
    S.overBtn = b ? (b === elMail ? 'mail' : b.tagName === 'A' ? 'link' : 'btn') : null;
  }, { passive: true });

  let holdTimer = 0;
  /* touch: the finger is the lens; press-and-hold keeps a long exposure open even while it scrolls;
     a sideways swipe pushes the time strip; a tap on a piece opens its page */
  const tch = { x: 0, y: 0, lx: 0, lt: 0, dir: 0, moved: false, onBtn: false, lastTap: 0, tapX: 0, tapY: 0 };
  on(window, 'touchstart', e => {
    const te = e as TouchEvent, t = te.touches[0]; if (!t || piece.open) return;
    S.touching = true; S.lastTouch = performance.now();
    setPointer(t.clientX, t.clientY);
    Object.assign(tch, { x: t.clientX, y: t.clientY, lx: t.clientX, lt: performance.now(), dir: 0, moved: false, onBtn: isBtn(te.target) });
    S.swipeH = false;
    if (S.introOn) { if (introTl && introTl.time() > 0.25) skipIntro(); return; }
    S.holdUsed = false;
    if (tch.onBtn || te.touches.length > 1) return;
    cancel(holdTimer);
    holdTimer = later(() => { if (S.touching) { S.holding = true; S.holdStart = performance.now(); } }, 320);
  }, { passive: true });
  on(window, 'touchmove', e => {
    const t = (e as TouchEvent).touches[0]; if (!t) return;
    const now = performance.now(); S.lastTouch = now;
    setPointer(t.clientX, t.clientY);
    const ax = t.clientX - tch.x, ay = t.clientY - tch.y;
    if (!tch.moved && Math.hypot(ax, ay) > 10) tch.moved = true;
    if (!tch.dir && Math.hypot(ax, ay) > 12) tch.dir = Math.abs(ax) > Math.abs(ay) * 1.1 ? 1 : 2;
    if (tch.dir === 1) {
      S.swipeH = true;
      const dx = t.clientX - tch.lx, dts = Math.max(0.008, (now - tch.lt) / 1000);
      S.swipeOff = clamp(S.swipeOff + dx * pr, -W * 0.9, W * 0.9);
      S.swipeV = S.swipeV * 0.5 + (dx / dts) * 0.5;
    }
    tch.lx = t.clientX; tch.lt = now;
  }, { passive: true });
  const touchEnd = (e: Event) => {
    const te = e as TouchEvent;
    if (te.touches && te.touches.length) return;
    S.touching = false; S.swipeH = false; S.holding = false; S.down = false; cancel(holdTimer);
    S.lastTouch = performance.now();
  };
  on(window, 'touchend', touchEnd, { passive: true });
  on(window, 'touchcancel', touchEnd, { passive: true });
  on(window, 'contextmenu', e => { if (COARSE) e.preventDefault(); });
  on(window, 'pointerdown', e => {
    const pe = e as PointerEvent;
    if (piece.open) return;
    setPointer(pe.clientX, pe.clientY);
    if (S.introOn) { skipIntro(); return; }
    S.holdUsed = false;
    if (pe.pointerType === 'touch' || isBtn(pe.target)) return;
    S.down = true; S.hx = S.tmx; S.hy = S.tmy;
    cancel(holdTimer);
    holdTimer = later(() => { if (S.down) { S.holding = true; S.holdStart = performance.now(); } }, 180);
  });
  const up = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    S.down = false; S.holding = false; cancel(holdTimer);
  };
  on(window, 'pointerup', up); on(window, 'pointercancel', up);
  on(window, 'blur', () => { S.down = false; S.holding = false; S.touching = false; cancel(holdTimer); });
  function hitPiece(x: number, y: number) {
    for (const h of heroHits) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.i;
    return -1;
  }
  on(window, 'click', e => {
    const me = e as MouseEvent;
    if (S.holdUsed) { S.holdUsed = false; return; }       // a long press was an exposure, not a tap
    if (S.introOn || piece.open || isBtn(me.target) || (me.target instanceof Element && me.target.closest('[data-el="piece"]'))) return;
    const i = hitPiece(me.clientX * pr, me.clientY * pr);
    if (i >= 0) openPiece(i);
  });
  on(document, 'mouseleave', () => { S.tmx = W * 0.5; S.tmy = H * 0.5; });

  let toastT = 0;
  function say(msg: string) {
    toast.textContent = msg; toast.classList.add('on'); cancel(toastT);
    toastT = later(() => toast.classList.remove('on'), 2600);
  }
  on(elMail, 'click', () => {
    const ok = () => say(`Copied ${EMAIL}`);
    const fail = () => say(`Select and copy: ${EMAIL}`);
    try { navigator.clipboard.writeText(EMAIL).then(ok, fail); } catch { fail(); }
  });
  function setSmear(v: boolean) {
    S.smear = v; smearBtn.textContent = v ? 'Smear on' : 'Smear off'; smearBtn.setAttribute('aria-pressed', String(v));
  }
  on(smearBtn, 'click', () => setSmear(!S.smear));
  setSmear(S.smear);
  on(RM, 'change', e => { S.reduced = (e as MediaQueryListEvent).matches; setSmear(!S.reduced); });

  /* ---------- piece page: a quiet product page over the stage ---------- */
  const pieceEl = el('piece'), pieceCv = el<HTMLCanvasElement>('pieceCanvas');
  const pieceCode = el('pieceCode'), pieceName = el('pieceName'), pieceForm = el('pieceForm'), pieceIdx = el('pieceIndex');
  const pieceClose = el<HTMLButtonElement>('pieceClose');
  const piece = { open: false, i: -1, pushed: false, focusBack: null as HTMLElement | null };
  const viewer = createPieceViewer(pieceCv);
  const titleCase = (t: string) => t.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  const slugOf = (i: number) => `piece-${PRODUCTS[i].code}`;
  function drawPiece(i: number) {
    if (viewer.supported) { viewer.show(i); viewer.start(); return; }
    const r = pieceCv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const size = Math.max(2, Math.round(Math.min(r.width, r.height || r.width) * d));
    pieceCv.width = size; pieceCv.height = size;
    const g = pieceCv.getContext('2d'); if (!g) return;
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
    g.scale(size / 100, size / 100);
    PRODUCTS[i].draw(g, v => { const l = Math.round(255 - clamp(v) * 245); return `rgb(${l},${l},${l})`; });
  }
  function showPiece(i: number) {
    i = (i + PRODUCTS.length) % PRODUCTS.length;
    const pd = PRODUCTS[i];
    pieceCode.textContent = pd.code;
    pieceName.textContent = titleCase(pd.name);
    pieceForm.textContent = titleCase(pd.name);
    pieceIdx.textContent = `${pad(i + 1)} / ${pad(PRODUCTS.length)}`;
    if (!piece.open) {
      piece.open = true;
      piece.focusBack = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      lock(true); S.holding = false; S.down = false;
      pieceEl.hidden = false;
      requestAnimationFrame(() => { if (piece.open) pieceEl.classList.add('on'); });
      later(() => pieceEl.focus({ preventScroll: true }), 60);   // focus the dialog; Tab reaches Close next
    }
    piece.i = i;
    drawPiece(i);
    pieceEl.scrollTop = 0;
  }
  function openPiece(i: number) {
    showPiece(i);
    try { history.pushState(null, '', `#${slugOf(piece.i)}`); piece.pushed = true; } catch { piece.pushed = false; }
  }
  function stepPiece(d: number) {
    showPiece(piece.i + d);
    try { history.replaceState(null, '', `#${slugOf(piece.i)}`); } catch { /* ignore */ }
  }
  function hidePiece() {
    if (!piece.open) return;
    piece.open = false;
    viewer.stop();
    pieceEl.classList.remove('on');
    later(() => { if (!piece.open) pieceEl.hidden = true; }, 420);
    lock(false);
    piece.focusBack?.focus({ preventScroll: true });
  }
  function closePiece() {
    if (!piece.open) return;
    if (piece.pushed) { piece.pushed = false; history.back(); return; }   // hashchange/popstate hides it
    hidePiece();
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  }
  function syncPieceToUrl() {
    const m = location.hash.match(/^#piece-(\d+)$/);
    const i = m ? PRODUCTS.findIndex(p => p.code === m[1]) : -1;
    if (i >= 0) showPiece(i); else hidePiece();
  }
  on(window, 'popstate', syncPieceToUrl);
  on(window, 'hashchange', syncPieceToUrl);
  on(pieceClose, 'click', closePiece);
  on(el('piecePrev'), 'click', () => stepPiece(-1));
  on(el('pieceNext'), 'click', () => stepPiece(1));
  on(el('pieceEnquire'), 'click', () => {
    const ok = () => say(`Copied ${EMAIL}`), fail = () => say(`Write to ${EMAIL}`);
    try { navigator.clipboard.writeText(EMAIL).then(ok, fail); } catch { fail(); }
  });
  on(window, 'keydown', e => {
    if (!piece.open) return;
    const k = (e as KeyboardEvent).key;
    if (k === 'Escape') closePiece();
    else if (k === 'ArrowRight') stepPiece(1);
    else if (k === 'ArrowLeft') stepPiece(-1);
  });
  root.querySelectorAll<HTMLButtonElement>('[data-piece]').forEach(b => on(b, 'click', () => openPiece(Number(b.dataset.piece))));
  on(window, 'resize', () => { if (piece.open && !viewer.supported) drawPiece(piece.i); });

  /* ---------- intro: Alex's original page, line by line, then it glides into the top bar ---------- */
  let introTl: gsap.core.Timeline | null = null;
  const introEl = el('intro'), introBg = el('introBg');
  const introLines = [...root.querySelectorAll<HTMLElement>('[data-intro]')];
  const introTime = root.querySelector<HTMLElement>('[data-intro="time"]');
  const hudTargets = [...root.querySelectorAll<HTMLElement>('[data-hud]')];
  const hudRest = [...root.querySelectorAll<HTMLElement>('[data-hud-rest]')];
  const prevOverflow = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
  function lock(v: boolean) {
    document.documentElement.style.overflow = v ? 'hidden' : prevOverflow.html;
    document.body.style.overflow = v ? 'hidden' : prevOverflow.body;
  }
  function endIntro() {
    S.introOn = false; lock(false);
    introEl.hidden = true;
    gsap.set(hudEl, { opacity: 1 }); gsap.set([...hudTargets, ...hudRest], { opacity: 1 });
    if (heroT0 > performance.now() + 5000) heroT0 = performance.now();
    ScrollTrigger.refresh();
    syncPieceToUrl();          // a shared link to a piece opens it once the intro is done
  }
  function skipIntro() { if (introTl) introTl.progress(1); else endIntro(); }
  function runIntro(delay = 0.2) {
    S.introOn = true; lock(true);
    heroT0 = performance.now() + 1e7;                     // the index stays empty until the page turns white
    introTl?.kill();
    if (S.reduced) { endIntro(); heroT0 = performance.now(); return; }
    introEl.hidden = false;
    gsap.set(introBg, { opacity: 1 });
    gsap.set(introLines, { x: 0, y: 0, scale: 1, opacity: 0, filter: 'blur(0px)' });
    gsap.set(hudEl, { opacity: 1 }); gsap.set([...hudTargets, ...hudRest], { opacity: 0 });
    // measure where each line has to land
    const moves = introLines.map(line => {
      const key = line.dataset.intro ?? '';
      const target = root.querySelector<HTMLElement>(`[data-hud="${key}"]`);
      if (!target || getComputedStyle(target).display === 'none') return { line, target: null as HTMLElement | null, dx: 0, dy: 0, sc: 1 };
      const a = line.getBoundingClientRect(), b = target.getBoundingClientRect();
      const sc = b.height / Math.max(1, a.height);
      return { line, target, dx: b.left - a.left, dy: b.top - a.top + (b.height - a.height * sc) / 2, sc };
    });
    gsap.set(introLines, { y: 14, filter: 'blur(6px)' });
    const tl = gsap.timeline({ delay, onComplete: () => { introTl = null; endIntro(); } });
    introTl = tl;
    tl.to(introLines, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.1, ease: 'power2.out', stagger: 0.13 }, 0);
    const T0 = 2.4;                                        // after a short read, everything moves
    moves.forEach((m, k) => {
      const at = T0 + k * 0.07;
      if (m.target) {
        tl.to(m.line, { x: m.dx, y: m.dy, scale: m.sc, duration: 1.5, ease: 'power3.inOut' }, at);
        tl.to(m.line, { opacity: 0, duration: 0.45, ease: 'power1.in' }, at + 1.05);
        tl.to(m.target, { opacity: 1, duration: 0.55, ease: 'power1.out' }, at + 1.05);
      } else {
        tl.to(m.line, { opacity: 0, y: -10, filter: 'blur(4px)', duration: 0.7, ease: 'power2.in' }, T0 - 0.1);
      }
    });
    tl.to(introBg, { opacity: 0, duration: 1.5, ease: 'power2.inOut' }, T0 + 0.25);
    tl.call(() => { heroT0 = performance.now(); }, [], T0 + 0.6);
    tl.to(hudRest, { opacity: 1, duration: 0.8, ease: 'power1.out' }, T0 + 1.5);
  }
  ['wheel', 'keydown'].forEach(ev => on(window, ev, () => { if (S.introOn && introTl && introTl.time() > 0.25) skipIntro(); }, { passive: true }));
  on(elAgain, 'click', () => {
    window.scrollTo(0, 0);
    later(() => runIntro(0), S.reduced ? 0 : 900);
  });

  /* ---------- boot ---------- */
  const prevRestoration = history.scrollRestoration;
  try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  window.scrollTo(0, 0);
  ScrollTrigger.config({ ignoreMobileResize: true });
  resize(true);
  if (COARSE) { S.hasPointer = true; S.lastTouch = -1e9; }
  /* Touch screens already have native momentum scrolling, so the stage reads the scroll position
     directly every frame (see frame()). A scrub delay on top of momentum feels sticky on iOS.
     Mouse wheels step in notches, so desktop keeps a short scrub to smooth them. */
  const scrollTween = gsap.to(S, {
    sy: () => ScrollTrigger.maxScroll(window), ease: 'none',
    scrollTrigger: { start: 0, end: 'max', scrub: (S.reduced || COARSE) ? true : 0.6, invalidateOnRefresh: true },
  });
  const onRefresh = () => cacheSections();
  ScrollTrigger.addEventListener('refresh', onRefresh);
  let rT = 0;
  on(window, 'resize', () => { cancel(rT); rT = later(() => resize(false), 150); });
  updTime(Date.now()); syncDigits(0);
  raf = requestAnimationFrame(frame);
  later(genNext, 60);
  lock(true);
  const fontsReady: Promise<unknown> = document.fonts
    ? Promise.race([
        Promise.all([`200 100px ${F.d}`, `500 100px ${F.d}`, `italic 40px ${F.s}`, `500 12px ${F.m}`].map(f => document.fonts.load(f))),
        new Promise(r => later(() => r(null), 2600)),
      ])
    : Promise.resolve();
  fontsReady.catch(() => null).then(() => { if (!alive) return; tempCv = null; runIntro(0.05); });

  /* ---------- teardown ---------- */
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    timers.forEach(id => window.clearTimeout(id)); timers.clear();
    offs.forEach(off => off());
    introTl?.kill();
    scrollTween.scrollTrigger?.kill();
    scrollTween.kill();
    ScrollTrigger.removeEventListener('refresh', onRefresh);
    gsap.killTweensOf(S); gsap.killTweensOf(hudEl); gsap.killTweensOf([...introLines, introBg, ...hudTargets, ...hudRest]);
    viewer.destroy();
    lock(false);
    try { history.scrollRestoration = prevRestoration; } catch { /* ignore */ }
    if (gl) {
      if (texNow) gl.deleteTexture(texNow);
      if (texHist) gl.deleteTexture(texHist);
      if (fbR) gl.deleteFramebuffer(fbR);
      if (fbD) gl.deleteFramebuffer(fbD);
      if (vao) gl.deleteVertexArray(vao);
      if (prog) gl.deleteProgram(prog);
      shaders.forEach(s => gl?.deleteShader(s));
    }
  };
}
