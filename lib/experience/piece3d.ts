/**
 * A small interactive 3D viewer for the piece page. Each object is a signed-distance shape,
 * ray-marched in a fragment shader on white, with a soft contact shadow.
 *
 * Play: drag to turn it (it keeps spinning a little when you let go), press to squash it,
 * tap to make it spin and hop. When left alone it turns slowly on its own.
 *
 * Shape indexes follow the order in products.ts.
 */

const VERT = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.-1., 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform mat3 uRot;
uniform vec3 uScale;
uniform float uLift;
uniform int uShape;
out vec4 o;

float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
float sdBox2(vec2 p, vec2 b){ vec2 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdCyl(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.) + length(max(d, 0.)); }
float sdCapsule(vec3 p, float h, float r){ p.y -= clamp(p.y, -h, h); return length(p) - r; }
float sdCone(vec3 p, float h, float r1, float r2){
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2, h), k2 = vec2(r2 - r1, 2. * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.) ? r1 : r2), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0., 1.);
  float s = (cb.x < 0. && ca.y < 0.) ? -1. : 1.;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
float sdPyramid(vec3 p, float h){
  float m2 = h * h + .25;
  p.xz = abs(p.xz); p.xz = (p.z > p.x) ? p.zx : p.xz; p.xz -= .5;
  vec3 q = vec3(p.z, h * p.y - .5 * p.x, h * p.x + .5 * p.y);
  float s = max(-q.x, 0.);
  float t = clamp((q.y - .5 * p.z) / (m2 + .25), 0., 1.);
  float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
  float b = m2 * (q.x + .5 * t) * (q.x + .5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
  float d2 = min(q.y, -q.x * m2 - q.y * .5) > 0. ? 0. : min(a, b);
  return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y));
}
float shape(vec3 p){
  if (uShape == 0) return length(p) - .78;                                   // sphere
  if (uShape == 1) return sdTorus(p.xzy, vec2(.6, .2));                      // ring, standing
  if (uShape == 2) return sdBox(p, vec3(.22, .88, .12)) - .015;              // monolith
  if (uShape == 3) return sdBox(p, vec3(.5)) - .05;                          // cube
  if (uShape == 4) {                                                         // arch
    vec2 q = p.xy;
    float outer = min(sdBox2(q - vec2(0., -.33), vec2(.56, .45)), length(q - vec2(0., .12)) - .56);
    float inner = min(sdBox2(q - vec2(0., -.4), vec2(.24, .5)), length(q - vec2(0., .1)) - .24);
    float d2 = max(outer, -inner);
    vec2 w = vec2(d2, abs(p.z) - .17);
    return min(max(w.x, w.y), 0.) + length(max(w, 0.)) - .01;
  }
  if (uShape == 5) return sdCone(p, .75, .6, .0) - .01;                      // cone
  if (uShape == 6) return sdCyl(p, .8, .07) - .03;                           // disc
  if (uShape == 7) return sdCapsule(p, .5, .3);                              // capsule
  if (uShape == 8) return sdCyl(p, .45, .58) - .03;                          // cylinder
  if (uShape == 9) return sdPyramid((p + vec3(0., .62, 0.)) / 1.45, 1.) * 1.45;  // pyramid
  if (uShape == 10) return max(length(p + vec3(0., .3, 0.)) - .72, -(p.y + .3)) - .01;  // dome
  return min(length(p + vec3(0., .22, 0.)) - .38, sdTorus(p - vec3(0., .55, 0.), vec2(.5, .035)));  // halo
}
float map(vec3 p){
  p.y -= uLift;
  vec3 q = uRot * (p / uScale);
  return shape(q) * min(uScale.x, min(uScale.y, uScale.z));
}
vec3 normalAt(vec3 p){
  vec2 e = vec2(.0012, 0.);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}
float ao(vec3 p, vec3 n){
  float occ = 0., sca = 1.;
  for (int i = 1; i <= 5; i++) { float h = .02 + .07 * float(i); occ += (h - map(p + n * h)) * sca; sca *= .7; }
  return clamp(1. - 2.2 * occ, 0., 1.);
}
float softShadow(vec3 ro, vec3 rd){
  float res = 1., t = .03;
  for (int i = 0; i < 28; i++) {
    float h = map(ro + rd * t);
    res = min(res, 5. * h / t);
    t += clamp(h, .03, .25);
    if (res < .002 || t > 4.) break;
  }
  return clamp(res, 0., 1.);
}
const float FLOOR = -1.0;
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  vec3 ro = vec3(0., .55, 3.6), ta = vec3(0., -.12, 0.);
  vec3 cw = normalize(ta - ro), cu = normalize(cross(cw, vec3(0., 1., 0.))), cv = cross(cu, cw);
  vec3 rd = normalize(uv.x * cu + uv.y * cv + 1.75 * cw);
  vec3 L = normalize(vec3(-.16, 1., .12));
  float t = 0.; bool hit = false;
  for (int i = 0; i < 110; i++) {
    float d = map(ro + rd * t);
    if (d < .0008 * (1. + t)) { hit = true; break; }
    t += d * .92;
    if (t > 9.) break;
  }
  vec3 col = vec3(1.);
  float tf = (FLOOR - ro.y) / rd.y;
  if (hit && (tf < 0. || t < tf)) {
    vec3 p = ro + rd * t, n = normalAt(p), V = -rd, Hh = normalize(L + V);
    float occ = ao(p, n);
    float dif = max(dot(n, L), 0.) * softShadow(p + n * .004, L);
    float spec = pow(max(dot(n, Hh), 0.), 32.);
    float fre = pow(1. - max(dot(n, V), 0.), 3.);
    float sky = .5 + .5 * n.y;
    vec3 base = vec3(.028);
    col = base * (.35 + 1.1 * dif)
        + vec3(.42) * spec * (.4 + .6 * dif)
        + vec3(.12) * sky * occ
        + vec3(.30) * fre * occ * (.55 + .45 * sky);
    col *= .55 + .45 * occ;
  } else if (tf > 0.) {
    vec3 p = ro + rd * tf;
    float r2 = dot(p.xz, p.xz);
    float fade = exp(-r2 * 1.6);                                      // the shadow lives only under the object
    float sh = softShadow(p + vec3(0., .002, 0.), L);
    float contact = smoothstep(0., .6, map(p));
    col = vec3(1.) - vec3(.16 * (1. - sh) + .16 * (1. - contact)) * fade;
  }
  col = pow(col, vec3(1. / 1.05));
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

export type PieceViewer = {
  supported: boolean;
  show: (shape: number) => void;
  start: () => void;
  stop: () => void;
  resize: () => void;
  destroy: () => void;
};

export function createPieceViewer(canvas: HTMLCanvasElement): PieceViewer {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
  const noop: PieceViewer = { supported: false, show: () => {}, start: () => {}, stop: () => {}, resize: () => {}, destroy: () => {} };
  if (!gl) return noop;

  const sh = (type: number, src: string) => {
    const o = gl.createShader(type) as WebGLShader;
    gl.shaderSource(o, src); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader');
    return o;
  };
  let prog: WebGLProgram;
  const shaders: WebGLShader[] = [];
  try {
    prog = gl.createProgram() as WebGLProgram;
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    shaders.push(vs, fs);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  } catch (e) { console.warn(e); return noop; }
  const vao = gl.createVertexArray();
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const U = { res: u('uRes'), rot: u('uRot'), scale: u('uScale'), lift: u('uLift'), shape: u('uShape') };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // physics state
  const st = {
    shape: 0, yaw: 0.6, pitch: -0.18, vyaw: 0, vpitch: 0,
    sx: 1, sy: 1, vsx: 0, vsy: 0, lift: 0, vlift: 0,
    pressed: false, dragging: false, lastInput: -1e9,
    px: 0, py: 0, downX: 0, downY: 0, downT: 0, pid: -1,
  };
  let raf = 0, running = false, last = 0, dirty = true;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const d = Math.min(devicePixelRatio || 1, innerWidth < 700 ? 1.5 : 1.75);
    const w = Math.max(2, Math.round(r.width * d)), h = Math.max(2, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    dirty = true;
  }
  function rotation() {
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), cp = Math.cos(st.pitch), sp = Math.sin(st.pitch);
    // R = Ry(yaw) · Rx(pitch), written row-major; uploaded as-is it is R^T in GLSL (world → object)
    return new Float32Array([
      cy, sy * sp, sy * cp,
      0, cp, -sp,
      -sy, cy * sp, cy * cp,
    ]);
  }
  function draw() {
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.useProgram(prog);
    gl!.uniform2f(U.res, canvas.width, canvas.height);
    gl!.uniformMatrix3fv(U.rot, false, rotation());
    gl!.uniform3f(U.scale, st.sx * (1 + (1 - st.sy) * 0.35), st.sy, st.sx * (1 + (1 - st.sy) * 0.35));
    gl!.uniform1f(U.lift, st.lift);
    gl!.uniform1i(U.shape, st.shape);
    gl!.bindVertexArray(vao); gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }
  function step(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    const f = dt * 60;
    // rotation with inertia, and a slow turn when left alone
    if (!st.dragging) {
      st.yaw += st.vyaw * f; st.pitch += st.vpitch * f;
      st.vyaw *= Math.pow(0.95, f); st.vpitch *= Math.pow(0.9, f);
      if (!reduced && now - st.lastInput > 1600) st.vyaw += (0.006 - st.vyaw) * 0.02 * f;
      st.pitch += (-0.18 - st.pitch) * 0.02 * f;              // settles back to a calm angle
    }
    st.pitch = Math.max(-1.2, Math.min(1.2, st.pitch));
    // squash spring: pressing flattens it; releasing lets it jiggle back
    const ty = st.pressed ? 0.84 : 1, tx = st.pressed ? 1.05 : 1;
    st.vsy += (ty - st.sy) * 0.16 * f; st.vsy *= Math.pow(0.8, f); st.sy += st.vsy * f;
    st.vsx += (tx - st.sx) * 0.16 * f; st.vsx *= Math.pow(0.8, f); st.sx += st.vsx * f;
    // hop: a spring that pulls it back down to rest
    st.vlift += (-st.lift) * 0.08 * f; st.vlift *= Math.pow(0.86, f); st.lift += st.vlift * f;
    const moving = Math.abs(st.vyaw) + Math.abs(st.vpitch) + Math.abs(st.vsy) + Math.abs(st.vsx) + Math.abs(st.vlift) + Math.abs(st.lift) > 1e-4;
    if (moving || st.dragging || dirty || !reduced) { draw(); dirty = false; }
  }

  // input
  const onDown = (e: PointerEvent) => {
    st.pressed = true; st.dragging = false; st.pid = e.pointerId;
    st.px = st.downX = e.clientX; st.py = st.downY = e.clientY; st.downT = performance.now(); st.lastInput = st.downT;
    st.vyaw = 0; st.vpitch = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e: PointerEvent) => {
    if (!st.pressed || e.pointerId !== st.pid) return;
    const dx = e.clientX - st.px, dy = e.clientY - st.py;
    st.px = e.clientX; st.py = e.clientY;
    if (!st.dragging && Math.hypot(e.clientX - st.downX, e.clientY - st.downY) > 5) { st.dragging = true; st.pressed = false; }
    if (st.dragging) {
      const k = 0.009;
      st.yaw += dx * k; st.pitch += dy * k;
      st.vyaw = st.vyaw * 0.5 + dx * k * 0.5; st.vpitch = st.vpitch * 0.5 + dy * k * 0.5;
      st.lastInput = performance.now();
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== st.pid) return;
    const wasTap = !st.dragging && performance.now() - st.downT < 350;
    st.pressed = false; st.dragging = false; st.lastInput = performance.now();
    if (wasTap && !reduced) {               // a tap: spin and hop
      st.vyaw += (Math.random() < 0.5 ? -1 : 1) * 0.16;
      st.vlift += 0.075; st.vsy += 0.05;
    }
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  addEventListener('resize', resize);

  return {
    supported: true,
    show(shape: number) {
      st.shape = shape; st.yaw = 0.6; st.pitch = -0.18; st.vyaw = reduced ? 0 : 0.05;
      st.sy = 0.9; st.vsy = 0.03; st.sx = 1; st.vsx = 0; st.lift = 0; st.vlift = reduced ? 0 : 0.03;
      resize(); draw();
    },
    start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(step); },
    stop() { running = false; cancelAnimationFrame(raf); },
    resize,
    destroy() {
      running = false; cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      removeEventListener('resize', resize);
      gl.deleteVertexArray(vao); gl.deleteProgram(prog); shaders.forEach(s => gl.deleteShader(s));
    },
  };
}
