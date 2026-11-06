import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { ExperienceConfig } from './config';
import { clamp, eio, eo, hash2, pad, ss } from './math';
import { createPlates, generatePlate } from './plates';
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
    overBtn: null as null | 'mail' | 'btn',
  };
  const SMALL = () => innerWidth < 700;
  let Q = 1;   // dynamic resolution scale, lowered only if a phone can't hold the frame rate

  /* ---------- local time ---------- */
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' });
  const T = { str: '00:00:00', tz: 'ET', last: -1e9 };
  function updTime(ms: number) {
    if (ms - T.last < 200) return;
    T.last = ms;
    try {
      const parts = fmt.formatToParts(new Date());
      const g = (k: string) => parts.find(p => p.type === k)?.value ?? '';
      let h = g('hour'); if (h === '24') h = '00';
      T.str = `${h}:${g('minute')}:${g('second')}`;
      T.tz = g('timeZoneName') || 'ET';
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
  const c = src.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  const tmp = document.createElement('canvas');
  const tc = tmp.getContext('2d') as CanvasRenderingContext2D;
  const L = (v: number) => INK_RED
    ? `rgb(${Math.round(clamp(v) * 255)},0,0)`
    : `rgb(${Math.round(clamp(v) * 236)},${Math.round(clamp(v) * 232)},${Math.round(clamp(v) * 223)})`;
  const ACC = INK_RED ? 'rgb(0,255,0)' : 'rgb(255,79,28)';
  const ACCa = (a: number) => INK_RED ? `rgba(0,255,0,${a})` : `rgba(255,79,28,${a})`;
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
    g.uniform1f(U.uAmt, S.amt); g.uniform1f(U.uLens, 0.2);
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
  const SEC_D = [160, 320, 320, 320, 180, 140], SEC_M = [140, 260, 300, 260, 150, 120];
  let unitPx = innerHeight / 100, unitW = -1;
  function layoutSections(force: boolean) {
    const w = innerWidth;
    if (!force && COARSE && w === unitW) return false;
    const u = innerHeight / 100;
    if (!force && w === unitW && Math.abs(u - unitPx) < 0.5) return false;
    unitW = w; unitPx = u;
    const arr = (w < 700 || (COARSE && w / innerHeight < 0.85)) ? SEC_M : SEC_D;
    secs.forEach((s, i) => { s.style.height = `${Math.round(arr[i] * unitPx)}px`; });
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
    let p = Math.min(devicePixelRatio || 1, cw < 700 ? 1.75 : 1.5) * Q;
    p = Math.max(p, Math.min(1, devicePixelRatio || 1) * 0.8);
    const maxPx = cw < 700 ? 1.6e6 : 3.4e6;
    if (cw * ch * p * p > maxPx) p = Math.sqrt(maxPx / (cw * ch));
    pr = p; W = Math.max(2, Math.round(cw * p)); H = Math.max(2, Math.round(ch * p));
    stage.width = W; stage.height = H;
    if (src !== stage) { src.width = W; src.height = H; }
    tmp.width = W; tmp.height = H;
    if (gl && prog) glSize(gl);
    slit.cv = null; tempCv = null;
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

  /* ---------- the signature move: a scan with a photo-finish streak ---------- */
  function streak(x: number, dir: number, sw: number, alpha = 0.9) {
    sw = Math.round(sw); if (sw < 2) return;
    const sxp = clamp(Math.round(x) - (dir > 0 ? 2 : 0), 0, W - 2);
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, sw, H);
    tc.drawImage(src, sxp, 0, 2, H, 0, 0, sw, H);
    tc.globalCompositeOperation = 'destination-in';
    const g = tc.createLinearGradient(0, 0, sw, 0);
    if (dir > 0) { g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); }
    else { g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); }
    tc.fillStyle = g; tc.fillRect(0, 0, sw, H);
    tc.globalCompositeOperation = 'source-over';
    c.save(); c.globalAlpha = alpha;
    c.drawImage(tmp, 0, 0, sw, H, dir > 0 ? x : x - sw, 0, sw, H);
    c.restore();
  }
  function slitLine(x: number, a = 1) {
    c.fillStyle = ACCa(a); c.fillRect(Math.round(x - pr), 0, Math.max(1, Math.round(2 * pr)), H);
  }
  function withDrag<R>(fn: () => R, extraX = 0): R {
    c.save(); c.translate(S.drag.x + extraX, S.drag.y);
    try { return fn(); } finally { c.restore(); }
  }
  function wipe(x: number, leftFn: () => void, rightFn: () => void, dir: number, k: number) {
    c.save(); c.beginPath(); c.rect(0, 0, Math.max(0, x), H); c.clip(); leftFn(); c.restore();
    c.save(); c.beginPath(); c.rect(x, 0, W - x, H); c.clip(); rightFn(); c.restore();
    if (S.smear) streak(x, dir, W * 0.24 * k, 0.92);
    if (k > 0.01) slitLine(x, clamp(k * 1.6));
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

  /* ---------- before: the page as it was ---------- */
  function sceneOriginal() {
    const k = Math.min(H / 525, W / 740 * 1.35);
    const fs = 24 * k, x = W * 0.236;
    c.font = `${fs}px ${F.o}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; noSpacing();
    c.fillStyle = L(0.97);
    const ys = [0.396, 0.469, 0.541, 0.613].map(v => H * 0.5 + (v - 0.5) * 525 * k);
    c.fillText(cfg.displayName, x, ys[0]);
    c.fillText(`currently in ${cfg.city}`, x, ys[1]);
    c.fillText(T.str, x, ys[2]);
    c.fillText(`${S.temp}°C`, x, ys[3]);
    c.fillStyle = L(0.56); c.fillText(EMAIL, x, H * 0.5 + (0.741 - 0.5) * 525 * k);
    c.fillText(`${cfg.handle} · ${cfg.note}`, x, H * 0.5 + (0.813 - 0.5) * 525 * k);
  }

  /* ---------- 01: the name as a physical object ---------- */
  const spr = { c: [...NAME].map(() => 1), v: [...NAME].map(() => 0) };
  function sceneName(p: number) {
    const portrait = W / H < 0.85;
    const rows = rowsFor(portrait);
    noSpacing();
    c.font = `900 100px ${F.d}`;
    const w100 = [...NAME].map(ch => c.measureText(ch).width * 0.985);
    const asc100 = c.measureText(NAME[0]).actualBoundingBoxAscent || 72;
    const tw = W * (portrait ? 0.84 : 0.9);
    let fs = Infinity;
    rows.forEach(r => { fs = Math.min(fs, 100 * tw / r.reduce((a, i) => a + w100[i], 0)); });
    fs = Math.min(fs, 100 * H * (portrait ? 0.27 : 0.6) / asc100);
    const cap = asc100 * fs / 100, gapY = cap * 0.1;
    const blockH = rows.length * cap + (rows.length - 1) * gapY;
    const stretch = 1 + p * p * 2.8;
    const base0 = H * 0.5 - blockH / 2 + cap - p * H * 0.05;
    c.font = `900 ${fs}px ${F.d}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = L(1);
    rows.forEach((r, ri) => {
      const widths = r.map(i => w100[i] * fs / 100);
      const sum = widths.reduce((a, b) => a + b, 0);
      let x = (W - sum) / 2, acc = 0;
      const g = r.map((_, k) => {
        const cx = x + acc + widths[k] / 2; acc += widths[k];
        const d = (cx - S.mx) / (W * 0.17);
        return 1 + (S.hasPointer && !S.reduced ? 1.2 : 0) * Math.exp(-d * d) * (1 - p);
      });
      const avg = r.reduce((a, _, k) => a + widths[k] * g[k], 0) / sum;
      r.forEach((i, k) => { const tgt = g[k] / avg; spr.v[i] += (tgt - spr.c[i]) * 0.14; spr.v[i] *= 0.74; spr.c[i] += spr.v[i]; });
      const by = base0 + ri * (cap + gapY);
      r.forEach((i, k) => { c.save(); c.translate(x, by); c.scale(spr.c[i], stretch); c.fillText(NAME[i], 0, 0); c.restore(); x += widths[k] * spr.c[i]; });
    });
    const cs = Math.max(11 * pr, fs * 0.07);
    const yCap = base0 + (rows.length - 1) * (cap + gapY) + cs * 2.6;
    c.font = `italic ${cs * 1.55}px ${F.s}`; c.textAlign = 'right'; c.fillStyle = L(0.94);
    c.fillText(`currently in ${cfg.city}`, (W + tw) / 2, yCap);
    mono(cs * 0.78, 0.62, portrait ? 'right' : 'left');
    c.fillText(`${T.str} ${T.tz}   ${S.temp}°C`, portrait ? (W + tw) / 2 : (W - tw) / 2, portrait ? yCap + cs * 2 : yCap);
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
    c.font = `900 100px ${F.d}`;
    const asc100 = c.measureText('0').actualBoundingBoxAscent || 72;
    const fb = 100 * H * (portrait ? 0.2 : 0.42) / asc100;
    c.font = `900 ${fb}px ${F.d}`;
    const asc = asc100 * fb / 100;
    const cellW = Math.max(...'0123456789'.split('').map(d => c.measureText(d).width));
    const colW = c.measureText(':').width * 1.1;
    const mid = H * 0.5, base = mid + asc / 2;
    const fsS = fb * 0.2, fsM = fb * 0.085, gap = fb * 0.16;
    const items: Item[] = [
      { k: 's', s: 'currently in' }, { k: 'b', s: cfg.city.toUpperCase() }, { k: 's', s: 'where it is' },
      { k: 't' }, { k: 'm', s: T.tz }, { k: 's', s: 'and' }, { k: 'b', s: `${S.temp}°C` }, { k: 's', s: 'in the air.' },
    ];
    items.forEach(it => {
      if (it.k === 'b') { c.font = `900 ${fb}px ${F.d}`; it.w = c.measureText(it.s ?? '').width; }
      else if (it.k === 's') { c.font = `italic ${fsS}px ${F.s}`; it.w = c.measureText(it.s ?? '').width; }
      else if (it.k === 'm') { c.font = `500 ${fsM}px ${F.m}`; it.w = c.measureText(it.s ?? '').width; }
      else it.w = cellW * 6 + colW * 2;
    });
    const total = items.reduce((a, it) => a + (it.w ?? 0), 0) + gap * (items.length - 1);
    const x0 = W * 0.1 - p * (total - W * 0.8) + S.swipeOff * 1.4;
    // film edges
    const sp = fb * 0.1, hw2 = fb * 0.045, hh2 = fb * 0.03;
    const yTop = mid - asc / 2 - fb * 0.24, yBot = mid + asc / 2 + fb * 0.2;
    c.fillStyle = L(0.2);
    const start = ((x0 % sp) + sp) % sp - sp;
    for (let x = start; x < W + sp; x += sp) {
      c.fillRect(x, yTop, hw2, hh2); c.fillRect(x, yBot, hw2, hh2);
      const idx = Math.round((x - x0) / sp);
      if (idx % 8 === 0) { mono(fsM * 0.45, 0.34); c.fillText(`ALX ${pad(Math.abs(idx / 8), 3)}`, x, yBot + hh2 + fsM * 0.9); c.fillStyle = L(0.2); }
    }
    noSpacing();
    // playhead
    c.fillStyle = ACC; c.fillRect(W * 0.5 - pr, yTop - fb * 0.08, 2 * pr, fb * 0.06); c.fillRect(W * 0.5 - pr, yBot + hh2 + fb * 0.02, 2 * pr, fb * 0.06);
    mono(fsM * 0.5, 0.55, 'center'); c.fillText('NOW', W * 0.5, yTop - fb * 0.12); noSpacing();
    let x = x0;
    items.forEach(it => {
      const w = it.w ?? 0;
      if (x > W + 20 || x + w < -20) { x += w + gap; return; }
      if (it.k === 'b') { c.font = `900 ${fb}px ${F.d}`; c.fillStyle = L(1); c.textAlign = 'left'; c.fillText(it.s ?? '', x, base); }
      else if (it.k === 's') { c.font = `italic ${fsS}px ${F.s}`; c.fillStyle = L(0.9); c.textAlign = 'left'; c.fillText(it.s ?? '', x, base - asc + fsS * 0.75); }
      else if (it.k === 'm') { mono(fsM, 0.7); c.fillText(it.s ?? '', x, base - asc + fsM); noSpacing(); }
      else {
        c.font = `900 ${fb}px ${F.d}`; c.textAlign = 'center'; c.fillStyle = L(1);
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

  /* ---------- 03: exposures that assemble from slices ---------- */
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
      noSpacing(); c.font = `900 ${portrait ? Math.min(H * 0.72, W * 0.78) : H * 0.72}px ${F.d}`;
      c.strokeStyle = L(0.17); c.lineWidth = 1.2 * pr; c.textBaseline = 'alphabetic';
      const right = R.x + R.w / 2 > W / 2;
      c.textAlign = portrait ? 'center' : (right ? 'left' : 'right');
      c.strokeText(pad(best + 1), portrait ? W / 2 : (right ? W * 0.04 : W * 0.96), portrait ? H * 0.62 : H * 0.78);
    }
    const cs = Math.max(10 * pr, H * 0.0125);
    rects.forEach(R => {
      if (R.y > H * 1.15 || R.y + R.h < -H * 0.15) return;
      const P = PLATES[R.i], e = R.cy / H;
      const r = S.reduced ? 1 : ss(1.12, 0.72, e) * ss(-0.28, 0.16, e);
      if (!P.cv) { c.fillStyle = L(0.06 * r); c.fillRect(R.x, R.y, R.w, R.h); }
      else {
        const n = portrait ? 10 : 12, pw = P.cv.width, ph = P.cv.height;
        for (let k = 0; k < n; k++) {
          const a = clamp(r * 1.7 - hash2(k, R.i) * 0.7); if (a <= 0) continue;
          const off = (1 - r) * H * 0.55 * (hash2(k, R.i * 13 + 5) - 0.5) * 2;
          c.globalAlpha = a;
          c.drawImage(P.cv, k * pw / n, 0, pw / n, ph, R.x + k * R.w / n, R.y + off, R.w / n + 1, R.h);
        }
        c.globalAlpha = 1;
      }
      const m = 8 * pr, ln = 12 * pr;
      c.fillStyle = L(0.7 * r);
      ([[R.x - m, R.y - m, 1, 1], [R.x + R.w + m, R.y - m, -1, 1], [R.x - m, R.y + R.h + m, 1, -1], [R.x + R.w + m, R.y + R.h + m, -1, -1]] as const)
        .forEach(([x, y, sx, sy]) => {
          c.fillRect(sx > 0 ? x : x - ln, y - (sy > 0 ? 0 : pr), ln, pr);
          c.fillRect(x - (sx > 0 ? 0 : pr), sy > 0 ? y : y - ln, pr, ln);
        });
      mono(cs, 0.58 * r, 'left');
      const cap1 = `PLATE ${pad(R.i + 1)} / 06 · PLACEHOLDER`, cy1 = R.y + R.h + cs * 2.4;
      c.fillText(cap1, R.x, cy1);
      const fits = c.measureText(cap1).width + c.measureText(P.ar).width + cs * 2 < R.w;
      if (fits) { c.textAlign = 'right'; c.fillText(P.ar, R.x + R.w, cy1); }
      else c.fillText(P.ar, R.x, cy1 + cs * 1.6);
      noSpacing();
    });
    const ls = Math.max(10 * pr, H * 0.012), ly = Math.max(H * 0.14, 92 * pr);
    mono(ls, 0.45, 'left');
    const label = 'EXPOSURES · PLACEHOLDER IMAGERY, GENERATED IN YOUR BROWSER';
    if (c.measureText(label).width < W * 0.92) c.fillText(label, W * 0.04, ly);
    else { c.fillText('EXPOSURES · PLACEHOLDER IMAGERY,', W * 0.04, ly); c.fillText('GENERATED IN YOUR BROWSER', W * 0.04, ly + ls * 1.6); }
    noSpacing();
  }

  /* ---------- 04: photo-finish. One column of pixels, recorded over time ---------- */
  const slit = { cv: null as HTMLCanvasElement | null, cx: null as CanvasRenderingContext2D | null, off: 0, tick: 0, y: -1, sx: 0, acc: 0 };
  function sceneSlit(_p: number, _nowMs: number, dt: number) {
    const portrait = W / H < 0.85;
    const sx = Math.round(W * (portrait ? 0.72 : 0.64));
    noSpacing();
    c.font = `900 100px ${F.d}`;
    const asc100 = c.measureText(NAME[0]).actualBoundingBoxAscent || 72;
    const fs = 100 * H * (portrait ? 0.17 : 0.3) / asc100 * (1 + 0.35 * S.hold);
    const cap = asc100 * fs / 100;
    c.font = `900 ${fs}px ${F.d}`;
    const ww = c.measureText(NAME).width + fs * 0.3;
    if (slit.y < 0) slit.y = H * 0.5;
    slit.y += ((S.hasPointer ? S.my : H * 0.5) - slit.y) * 0.07;
    const wob = (S.smear && !S.reduced) ? Math.sin(S.t * 1.1) * H * 0.05 : 0;
    const by = clamp(slit.y + wob, cap * 0.7, H - cap * 0.5) + cap / 2;
    if (!slit.cv || !slit.cx || slit.sx !== sx || slit.cv.height !== H) {
      slit.sx = sx; slit.cv = document.createElement('canvas'); slit.cv.width = sx; slit.cv.height = H;
      slit.cx = slit.cv.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
      slit.cx.fillStyle = '#000'; slit.cx.fillRect(0, 0, sx, H);
      slit.cx.font = `900 ${fs}px ${F.d}`; slit.cx.fillStyle = L(1); slit.cx.textBaseline = 'alphabetic';
      for (let x = sx + slit.off - ww; x > -ww; x -= ww) slit.cx.fillText(NAME, x, by);
    }
    const k = (S.reduced || !S.smear) ? clamp(Math.abs(S.vel) / 500) : 1;
    const f = dt * 60;
    const s = 2.6 * pr * k * f;
    // a sideways swipe on touch drives the subject too: left runs it faster, right mirrors it
    const v = 2.6 * pr * f * clamp(1 + S.vel * 0.0011 - S.swipeV * 0.0035, -5, 7) * ((S.reduced || !S.smear) ? k : 1);
    slit.off = (((slit.off - v) % ww) + ww) % ww;
    c.save(); c.beginPath(); c.rect(sx, 0, W - sx, H); c.clip();
    c.font = `900 ${fs}px ${F.d}`; c.fillStyle = L(1); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    for (let x = sx + slit.off - ww; x < W; x += ww) c.fillText(NAME, x, by);
    c.restore();
    slit.acc += s; const shift = Math.floor(slit.acc); slit.acc -= shift;
    if (shift > 0) {
      slit.cx.drawImage(slit.cv, -shift, 0);
      slit.cx.drawImage(src, sx, 0, 1, H, sx - shift, 0, shift, H);
      slit.tick += shift;
    }
    c.drawImage(slit.cv, 0, 0);
    const g = c.createLinearGradient(0, 0, sx * 0.7, 0);
    g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, sx, H);
    // timing ruler
    const P = 60 * 2.6 * pr, ry = H * 0.86, cs = Math.max(10 * pr, H * 0.012);
    c.fillStyle = L(0.35); c.fillRect(0, ry, sx, pr);
    mono(cs, 0.5, 'center');
    for (let i = 0; ; i++) {
      const x = sx - (slit.tick % P) - i * P; if (x < -P) break;
      c.fillStyle = L(0.5); c.fillRect(x, ry - 8 * pr, pr, 8 * pr);
      c.fillText(`${Math.floor(slit.tick / P) - i}s`, x, ry + cs * 1.8);
    }
    mono(cs, 0.7, 'left');
    c.fillText('SLIT · 1 PX', sx + 10 * pr, H * 0.14);
    c.fillText('LIVE', sx + 10 * pr, ry + cs * 1.8);
    c.textAlign = 'right'; c.fillStyle = L(0.5); c.fillText('RECORDED', sx - 10 * pr, H * 0.14);
    noSpacing();
    slitLine(sx, 1);
  }

  /* ---------- 05: air ---------- */
  let tempCv: { cv: HTMLCanvasElement; w: number; h: number } | null = null;
  function buildTemp() {
    const portrait = W / H < 0.85, t = `${S.temp}°`;
    const k = document.createElement('canvas'), kc = k.getContext('2d') as CanvasRenderingContext2D;
    kc.font = `900 100px ${F.d}`;
    let m = kc.measureText(t); const asc100 = m.actualBoundingBoxAscent || 72;
    const fs = Math.min(100 * H * (portrait ? 0.3 : 0.6) / asc100, 100 * W * (portrait ? 0.66 : 0.62) / m.width);
    kc.font = `900 ${fs}px ${F.d}`; m = kc.measureText(t);
    const asc = asc100 * fs / 100, padd = Math.round(fs * 0.1);
    k.width = Math.ceil(m.width) + padd * 2; k.height = Math.ceil(asc * 1.04) + padd * 2;
    kc.font = `900 ${fs}px ${F.d}`; kc.fillStyle = L(1); kc.textBaseline = 'alphabetic';
    kc.fillText(t, padd, padd + asc);
    tempCv = { cv: k, w: k.width, h: k.height };
  }
  function sceneTemp(p: number) {
    if (!tempCv) buildTemp();
    if (!tempCv) return;
    const portrait = W / H < 0.85;
    const { cv, w, h } = tempCv;
    const x0 = portrait ? (W - w) / 2 - W * 0.04 : W * 0.06;
    const y0 = H * 0.5 - h / 2 - (p - 0.5) * H * 0.1;
    const amp = (S.reduced || !S.smear) ? 0 : (1.5 + S.temp * 0.22) * pr;
    const step = Math.max(2, Math.round(3 * pr));
    for (let y = 0; y < h; y += step) {
      const yy = y0 + y, d = (yy - S.my) / (H * 0.13);
      const prox = S.hasPointer ? Math.exp(-d * d) * ss(W * 0.5, 0, Math.abs(S.mx - (x0 + w / 2)) - w * 0.3) : 0;
      const a = amp * (1 + 3.5 * prox);
      const off = Math.sin(y * 0.022 / pr + S.t * 2.4) * a + Math.sin(y * 0.061 / pr - S.t * 3.7) * a * 0.5;
      c.drawImage(cv, 0, y, w, step, x0 + off, yy, w, step);
    }
    // scale, in real units
    const sx = W * (portrait ? 0.86 : 0.87), top = H * 0.18, bot = H * 0.82, lo = -30, hi = 35;
    const ymap = (v: number) => bot - (v - lo) / (hi - lo) * (bot - top);
    const cs = Math.max(10 * pr, H * 0.012);
    c.fillStyle = L(0.4); c.fillRect(sx, top, pr, bot - top);
    mono(cs, 0.5, 'right');
    for (let v = lo; v <= hi; v += 5) {
      const y = ymap(v), big = v % 10 === 0;
      c.fillStyle = L(big ? 0.6 : 0.35); c.fillRect(sx - (big ? 14 : 7) * pr, y, (big ? 14 : 7) * pr, pr);
      if (big) { c.fillStyle = L(0.5); c.fillText(`${v > 0 ? '+' : ''}${v}`, sx - 20 * pr, y + cs * 0.35); }
    }
    const mv = lo + (S.temp - lo) * (S.reduced ? 1 : eo(clamp(p * 2.4 + 0.25)));
    const my = ymap(mv);
    c.fillStyle = ACCa(0.35); c.fillRect(0, my, sx, Math.max(1, pr));
    c.fillStyle = ACC; c.fillRect(sx - 4 * pr, my - 1.5 * pr, 46 * pr, 3 * pr);
    if (portrait) { mono(cs * 1.1, 1, 'right'); c.fillStyle = ACC; c.fillText(`${Math.round(mv)}°C`, W - 6 * pr, my - 8 * pr); }
    else { mono(cs * 1.1, 1, 'left'); c.fillStyle = ACC; c.fillText(`${Math.round(mv)}°C`, sx + 10 * pr, my - 8 * pr); }
    noSpacing();
    const by = portrait ? H * 0.78 : H * 0.86;
    c.font = `italic ${portrait ? Math.min(cs * 2.6, W * 0.065) : cs * 2.6}px ${F.s}`; c.textAlign = 'left'; c.fillStyle = L(0.92);
    c.fillText(`air temperature in ${cfg.city}`, W * 0.06, by);
    mono(cs, 0.5, 'left');
    const rd = `LAST READING ${S.temp}°C · DEGREES CELSIUS`;
    c.fillText(c.measureText(rd).width < sx - W * 0.12 ? rd : `LAST READING ${S.temp}°C`, W * 0.06, by + cs * 2.4);
    noSpacing();
  }

  /* ---------- 06: the address ---------- */
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
    const fs = Math.min(100 * W * 0.88 / maxw100, H * 0.3);
    const lh = fs * 0.95, blockH = lh * lines.length, top = H * 0.5 - blockH / 2 - (p - 0.5) * H * 0.06;
    const maxw = maxw100 * fs / 100;
    const cs = Math.max(10 * pr, H * 0.0125);
    mono(cs, 0.55, 'left'); c.fillText(`WRITE TO ${NAME}`, (W - maxw) / 2, top - cs * 1.6); noSpacing();
    const scanX = W * se;
    c.save(); c.beginPath(); c.rect(0, 0, scanX, H); c.clip();
    c.font = `italic ${fs}px ${F.s}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = L(1);
    lines.forEach((l, i) => c.fillText(l, W / 2, top + lh * (i + 0.78)));
    c.restore();
    if (e > 0 && e < 1) { if (S.smear) streak(scanX, 1, W * 0.3 * Math.sin(Math.PI * e), 0.9); slitLine(scanX, 1); }
    c.font = `italic ${cs * 2.2}px ${F.s}`; c.textAlign = 'right'; c.fillStyle = L(0.8);
    c.fillText(`It is ${T.str} in ${cfg.city}.`, (W + maxw) / 2, top + blockH + cs * 3.2);
    mono(cs, 0.55, 'right'); c.fillText(`${cfg.handle} · ${cfg.note}`.toUpperCase(), (W + maxw) / 2, top + blockH + cs * 5.6); noSpacing();
    mailRect.x = (W - maxw) / 2; mailRect.y = top; mailRect.w = maxw; mailRect.h = blockH + lh * 0.1;
    return e >= 1;
  }

  type Scene = (p: number, nowMs: number, dt: number) => boolean | void;
  const SCENES: Scene[] = [sceneName, sceneTime, scenePlates, sceneSlit, sceneTemp, sceneMail];
  const LABELS = [cfg.displayName, 'Local time', 'Exposures', 'The slit', 'Air', 'Address'];
  const HINTS = COARSE ? [
    'Touch and drag. The present follows your finger. Double-tap to flash.', 'Scroll. Time runs sideways. Swipe to push it.',
    'Press and hold, then scroll, for a long exposure.', 'Scroll to run the slit. Swipe right to mirror it.',
    'Touch near the number. The air bends.', 'Tap the address to copy it.',
  ] : [
    'Move. The present follows your cursor. Double-click to flash.', 'Scroll. Time runs sideways.', 'Hold anywhere for a long exposure.',
    'Scroll to run the slit. Scroll back to mirror it.', 'Move near the number. The air bends.', 'Click the address to copy it.',
  ];

  /* ---------- scroll → scene state (one ScrollTrigger scrubs one proxy value) ---------- */
  function sceneState() {
    const y = S.sy;
    let cur = 0;
    for (let i = 0; i < tops.length; i++) if (y >= tops[i] - 0.5) cur = i;
    const p = clamp((y - tops[cur]) / Math.max(1, hts[cur] - vh));
    let t = 0;
    if (cur < tops.length - 1) t = clamp((y - (tops[cur + 1] - vh)) / vh);
    return { cur, p, t };
  }
  const pOf = (i: number) => clamp((S.sy - tops[i]) / Math.max(1, hts[i] - vh));

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
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    S.t += dt;
    updTime(Date.now()); syncDigits(now);
    // touch: when no finger is down, the present wanders on its own slow path
    S.wander = COARSE && !S.reduced && !S.touching && now - S.lastTouch > 1400;
    if (S.wander) { S.tmx = W * (0.5 + 0.3 * Math.sin(S.t * 0.41)); S.tmy = H * (0.5 + 0.2 * Math.sin(S.t * 0.29 + 1.3)); }
    if (!(S.touching && S.swipeH)) { S.swipeOff *= Math.pow(0.93, dt * 60); S.swipeV *= Math.pow(0.9, dt * 60); }
    perfTick(dt);
    // inputs
    const k = 1 - Math.pow(1 - (S.wander ? 0.045 : 0.2), dt * 60);
    const pmx = S.mx, pmy = S.my;
    S.mx += (S.tmx - S.mx) * k; S.my += (S.tmy - S.my) * k;
    const msp = Math.hypot(S.mx - pmx, S.my - pmy) / W / dt;
    S.ms += (msp - S.ms) * 0.12;
    const v = (S.sy - S.psy) / dt; S.psy = S.sy;
    S.vel += (v - S.vel) * 0.15;
    S.hold += ((S.holding ? 1 : 0) - S.hold) * (1 - Math.pow(1 - 0.06, dt * 60));
    const dragOn = S.holding && !S.reduced && !S.touching;   // on touch the finger scrolls; it doesn't drag
    const tx = dragOn ? (S.mx - S.hx) * 0.4 : 0, ty = dragOn ? (S.my - S.hy) * 0.4 : 0;
    S.drag.vx += (tx - S.drag.x) * 0.09; S.drag.vy += (ty - S.drag.y) * 0.09;
    S.drag.vx *= 0.8; S.drag.vy *= 0.8; S.drag.x += S.drag.vx; S.drag.y += S.drag.vy;
    const st = sceneState();
    S.boost = S.introOn ? Math.sin(Math.PI * S.introX) : Math.sin(Math.PI * st.t);
    const amtT = S.smear ? clamp(0.55 + Math.abs(S.vel) / 2200 + S.ms * 0.7 + S.boost * 0.45) : 0;
    S.amt += (amtT - S.amt) * 0.1;
    // paint the plate
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; noSpacing();
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    let curScene = st.cur;
    if (S.introOn) {
      const x = W * S.introX;
      wipe(x, () => withDrag(() => sceneName(0)), () => withDrag(sceneOriginal), 1, Math.sin(Math.PI * S.introX));
      if (S.introX <= 0 && S.slitA > 0) slitLine(Math.max(2 * pr, x), S.slitA);
      curScene = 0;
    } else if (st.t > 0.0005 && st.cur < SCENES.length - 1) {
      const e = eio(st.t), x = W * (1 - e), a = st.cur, b = st.cur + 1;
      if (b !== 5) S.mailT = -1;
      wipe(x,
        () => withDrag(() => { SCENES[a](pOf(a), now, dt); }, -e * W * 0.06),
        () => withDrag(() => { SCENES[b](pOf(b), now, dt); }, (1 - e) * W * 0.06),
        -1, Math.sin(Math.PI * st.t));
      curScene = st.t > 0.5 ? b : a;
      mailReady = false;
    } else {
      if (st.cur !== 5) S.mailT = -1;
      const r = withDrag(() => SCENES[st.cur](st.p, now, dt));
      mailReady = st.cur === 5 && r === true;
    }
    if (gl && glReady()) glRender(gl, dt);
    // HUD
    if (hud.time !== T.str) { hud.time = T.str; elTime.textContent = `${T.str} ${T.tz}`; elSr.textContent = `${T.str} ${T.tz}`; }
    if (hud.scene !== curScene) { hud.scene = curScene; elScene.textContent = `${pad(curScene + 1)} / 06 ${LABELS[curScene]}`; elHint.textContent = HINTS[curScene]; }
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
      elCurL.textContent = S.holding ? `EXPOSING ${((now - S.holdStart) / 1000).toFixed(1)}S` : (S.overBtn ? (S.overBtn === 'mail' ? 'COPY' : 'PRESS') : 'NOW');
    }
  }

  /* ---------- input ---------- */
  const isBtn = (t: EventTarget | null) => !!(t instanceof Element && t.closest('button'));
  function setPointer(cx: number, cy: number) {
    S.tmx = cx * pr; S.tmy = cy * pr;
    if (!S.hasPointer) { S.mx = S.tmx; S.my = S.tmy; }
    S.hasPointer = true;
  }
  const flash = (from = 1, dur = 1.5) => {
    S.flash = from; gsap.to(S, { flash: 0, duration: dur, ease: 'power2.out', overwrite: true });
  };
  on(window, 'pointermove', e => {
    const pe = e as PointerEvent;
    setPointer(pe.clientX, pe.clientY);
    const b = pe.target instanceof Element ? pe.target.closest('button') : null;
    S.overBtn = b ? (b === elMail ? 'mail' : 'btn') : null;
  }, { passive: true });

  let holdTimer = 0;
  /* touch: the finger is the lens; press-and-hold keeps a long exposure open even while it scrolls;
     a sideways swipe pushes the time strip and steers the slit; double-tap flashes */
  const tch = { x: 0, y: 0, lx: 0, lt: 0, dir: 0, moved: false, onBtn: false, lastTap: 0, tapX: 0, tapY: 0 };
  on(window, 'touchstart', e => {
    const te = e as TouchEvent, t = te.touches[0]; if (!t) return;
    S.touching = true; S.lastTouch = performance.now();
    setPointer(t.clientX, t.clientY);
    Object.assign(tch, { x: t.clientX, y: t.clientY, lx: t.clientX, lt: performance.now(), dir: 0, moved: false, onBtn: isBtn(te.target) });
    S.swipeH = false;
    if (S.introOn) { if (introTl && introTl.time() > 0.25) skipIntro(); return; }
    if (tch.onBtn || te.touches.length > 1) return;
    cancel(holdTimer);
    holdTimer = later(() => { if (S.touching) { S.holding = true; S.holdStart = performance.now(); } }, 220);
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
    if (tch.moved || tch.onBtn || S.introOn || S.reduced) return;
    const now = performance.now();
    if (now - tch.lastTap < 320 && Math.hypot(tch.x - tch.tapX, tch.y - tch.tapY) < 40) { tch.lastTap = 0; flash(); }
    else { tch.lastTap = now; tch.tapX = tch.x; tch.tapY = tch.y; }
  };
  on(window, 'touchend', touchEnd, { passive: true });
  on(window, 'touchcancel', touchEnd, { passive: true });
  on(window, 'contextmenu', e => { if (COARSE) e.preventDefault(); });
  on(window, 'pointerdown', e => {
    const pe = e as PointerEvent;
    setPointer(pe.clientX, pe.clientY);
    if (S.introOn) { skipIntro(); return; }
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
  on(window, 'dblclick', e => { if (S.reduced || isBtn(e.target)) return; flash(); });
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
    if (!S.reduced) flash(0.6, 1.1);
  });
  function setSmear(v: boolean) {
    S.smear = v; smearBtn.textContent = v ? 'Smear on' : 'Smear off'; smearBtn.setAttribute('aria-pressed', String(v));
  }
  on(smearBtn, 'click', () => setSmear(!S.smear));
  setSmear(S.smear);
  on(RM, 'change', e => { S.reduced = (e as MediaQueryListEvent).matches; setSmear(!S.reduced); });

  /* ---------- intro: the old page is exposed into the new one ---------- */
  let introTl: gsap.core.Timeline | null = null;
  const prevOverflow = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
  function lock(v: boolean) {
    document.documentElement.style.overflow = v ? 'hidden' : prevOverflow.html;
    document.body.style.overflow = v ? 'hidden' : prevOverflow.body;
  }
  function endIntro() {
    S.introOn = false; S.introX = 1; lock(false);
    gsap.to(hudEl, { opacity: 1, duration: 0.8, ease: 'power2.out' });
    ScrollTrigger.refresh();
  }
  function skipIntro() { if (introTl) introTl.progress(1); else endIntro(); }
  function runIntro(delay = 0.2) {
    S.introOn = true; S.introX = 0; S.slitA = 0; lock(true);
    if (S.reduced) { endIntro(); return; }
    introTl?.kill();
    introTl = gsap.timeline({ delay, onComplete: () => { introTl = null; endIntro(); } });
    introTl.to(S, { slitA: 1, duration: 0.45, ease: 'power2.out' }, 1.0)
           .to(S, { introX: 1, duration: 1.7, ease: 'expo.inOut' }, 1.35);
  }
  ['wheel', 'keydown'].forEach(ev => on(window, ev, () => { if (S.introOn && introTl && introTl.time() > 0.25) skipIntro(); }, { passive: true }));
  on(elAgain, 'click', () => {
    window.scrollTo(0, 0);
    gsap.to(hudEl, { opacity: 0, duration: 0.4 });
    later(() => runIntro(0), S.reduced ? 0 : 1000);
  });

  /* ---------- boot ---------- */
  const prevRestoration = history.scrollRestoration;
  try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  window.scrollTo(0, 0);
  ScrollTrigger.config({ ignoreMobileResize: true });
  resize(true);
  if (COARSE) { S.hasPointer = true; S.lastTouch = -1e9; }
  const scrollTween = gsap.to(S, {
    sy: () => ScrollTrigger.maxScroll(window), ease: 'none',
    scrollTrigger: { start: 0, end: 'max', scrub: S.reduced ? true : 0.9, invalidateOnRefresh: true },
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
        Promise.all([`900 100px ${F.d}`, `italic 40px ${F.s}`, `500 12px ${F.m}`].map(f => document.fonts.load(f))),
        new Promise(r => later(() => r(null), 2600)),
      ])
    : Promise.resolve();
  fontsReady.catch(() => null).then(() => { if (!alive) return; tempCv = null; slit.cv = null; runIntro(0.05); });

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
    gsap.killTweensOf(S); gsap.killTweensOf(hudEl);
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
