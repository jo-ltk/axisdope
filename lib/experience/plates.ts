import { clamp, hash2, ss } from './math';

/**
 * Placeholder imagery, generated in the browser so the site ships with no image files.
 * Each plate is an isolated studio object on white paper. The functions return INK DENSITY:
 * 0 is paper, 1 is full black.
 *
 * To use real photos later, draw a grayscale cut-out into `cv` instead (ink = 1 - luminance,
 * written into the red channel when WebGL is on; see generatePlate).
 */
export type Plate = {
  w: number;
  h: number;
  f: (nx: number, ny: number, px: number) => number;
  cv?: HTMLCanvasElement;
};

// signed distance to a box centred at (cx, cy) with half-size (hx, hy); negative inside
const sdBox = (x: number, y: number, cx: number, cy: number, hx: number, hy: number) => {
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
};
const fill = (d: number, px: number) => 1 - ss(-px, px, d);           // anti-aliased inside test
const shadow = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, k: number) => {
  const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  return k * Math.exp(-e * 1.6);
};

export function createPlates(): Plate[] {
  return [
    { w: 420, h: 560, f: (x, y, px) => {                       // monolith
      const ground = shadow(x, y, 0.5, 0.855, 0.2, 0.022, 0.32);
      const d = sdBox(x, y, 0.5, 0.48, 0.115, 0.365);
      const m = fill(d, px);
      const sheen = 0.32 * Math.exp(-(x - 0.385) * 38) + 0.08 * (1 - y);
      return Math.max(ground, m * (0.94 - sheen));
    } },
    { w: 520, h: 520, f: (x, y, px) => {                       // orb
      const ground = shadow(x, y, 0.5, 0.79, 0.22, 0.03, 0.3);
      const dx = x - 0.5, dy = y - 0.45, r = 0.27, d = Math.hypot(dx, dy) - r;
      const m = fill(d, px);
      const nz = Math.sqrt(Math.max(0, 1 - (dx * dx + dy * dy) / (r * r)));
      const lam = Math.max(0, (-dx / r) * 0.55 + (-dy / r) * 0.6 + nz * 0.58);
      const rim = Math.pow(1 - nz, 3) * 0.12;
      return Math.max(ground, m * clamp(0.95 - Math.pow(lam, 6) * 0.55 - rim));
    } },
    { w: 600, h: 420, f: (x, y, px) => {                       // stacked plinths
      let v = shadow(x, y, 0.52, 0.86, 0.3, 0.03, 0.28);
      const boxes = [[0.58, 0.42, 0.22, 0.13, 0.78], [0.54, 0.53, 0.22, 0.13, 0.86], [0.5, 0.64, 0.22, 0.13, 0.94]];
      for (const [cx, cy, hx, hy, ink] of boxes) {
        const d = sdBox(x, y, cx, cy, hx, hy);
        if (d < px) {
          const edge = ss(-0.012, -0.003, d) * 0.4;            // a hairline of light between slabs
          v = Math.max(v * (1 - fill(d, px)), fill(d, px) * (ink - edge - 0.06 * (y - cy + hy) / (2 * hy)));
        }
      }
      return v;
    } },
    { w: 440, h: 600, f: (x, y, px) => {                       // arch
      const ground = shadow(x, y, 0.5, 0.875, 0.26, 0.022, 0.3);
      const ax = (x - 0.5) * 0.733;                             // aspect-correct horizontal distance
      const outer = Math.min(sdBox(x, y, 0.5, 0.61, 0.2, 0.25), Math.hypot(ax, y - 0.36) - 0.147);
      const inner = Math.min(sdBox(x, y, 0.5, 0.69, 0.09, 0.17), Math.hypot(ax * 1.0, y - 0.52) - 0.066);
      const body = fill(outer, px) * (1 - fill(inner, px));
      const depth = fill(inner, px) * (0.1 + 0.18 * ss(0.86, 0.5, y));
      return Math.max(ground, body * (0.93 - 0.18 * Math.exp(-(x - 0.3) * 30)), depth);
    } },
    { w: 640, h: 380, f: (x, y, px) => {                       // an object in motion, long exposure
      const k = 640 / 380, X = x * k, cx = 0.74 * k, hl = 0.1 * k, r = 0.15;   // work in height units
      const capsule = Math.hypot(Math.max(Math.abs(X - cx) - hl, 0), y - 0.5) - r;
      const sheen = 0.2 * ss(0.5, 0.36, y);
      const body = fill(capsule, px * k) * (0.94 - sheen);
      let trail = 0;
      if (X < cx) {
        const band = ss(r, r * 0.7, Math.abs(y - 0.5));
        const row = Math.floor(y * 380 / 3);
        const len = 0.45 + hash2(row, 7) * 0.65;
        trail = band * Math.pow(Math.max(0, 1 - (cx - X) / len), 1.6) * (0.3 + 0.35 * hash2(row, 3));
      }
      return Math.max(shadow(x, y, 0.62, 0.84, 0.32, 0.03, 0.16), body, trail);
    } },
    { w: 520, h: 520, f: (x, y, px) => {                       // ring
      const ground = shadow(x, y, 0.5, 0.82, 0.24, 0.028, 0.28);
      const dx = x - 0.5, dy = y - 0.46, rr = Math.hypot(dx, dy);
      const d = Math.abs(rr - 0.22) - 0.07;
      const m = fill(d, px);
      const ang = Math.atan2(dy, dx);
      const sheen = 0.42 * Math.pow(Math.max(0, Math.cos(ang + 2.2)), 6) * ss(0.07, 0, Math.abs(rr - 0.2));
      return Math.max(ground, m * (0.93 - sheen));
    } },
  ];
}

type GenOptions = {
  inkRed: boolean;          // WebGL path stores ink density in the red channel
  scale: number;            // phones use .72
  alive: () => boolean;
  later: (fn: () => void, ms: number) => void;
};

/** Computes a plate in ~6ms slices so no long task ever blocks scrolling. */
export function generatePlate(P: Plate, i: number, o: GenOptions, done: () => void) {
  const w = Math.round(P.w * o.scale), h = Math.round(P.h * o.scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  if (!cx) return;
  const img = cx.createImageData(w, h), D = img.data;
  const px = 1.2 / w;
  let y = 0;
  const step = () => {
    if (!o.alive()) return;
    const t0 = performance.now();
    while (y < h && performance.now() - t0 < 6) {
      for (let x = 0; x < w; x++) {
        let v = P.f(x / w, y / h, px);
        v += (hash2(x + i * 997, y + 31) - 0.5) * 0.05 * v;      // photographic grain, only in the ink
        v = clamp(v);
        const k = (y * w + x) * 4;
        if (o.inkRed) { D[k] = v * 255; D[k + 1] = 0; D[k + 2] = 0; }
        else { const l = 255 - v * 245; D[k] = l; D[k + 1] = l; D[k + 2] = l; }
        D[k + 3] = 255;
      }
      y++;
    }
    if (y < h) o.later(step, 0);
    else { cx.putImageData(img, 0, 0); P.cv = cv; done(); }
  };
  step();
}
