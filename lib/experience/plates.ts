import { clamp, fbm, hash2, ss } from './math';

/**
 * Placeholder imagery, generated in the browser so the site ships with no image files.
 * To use real photos later, draw them into `cv` (any canvas or image of the same aspect) instead.
 */
export type Plate = {
  w: number;
  h: number;
  ar: string;
  f: (nx: number, ny: number) => number;
  cv?: HTMLCanvasElement;
};

export function createPlates(): Plate[] {
  return [
    { w: 640, h: 400, ar: '16:10', f: (nx, ny) => {            // horizon over open water
      const hz = 0.56;
      if (ny < hz) { const d = hz - ny; return 0.04 + 0.6 * Math.exp(-d * 9) + fbm(nx * 3 + 1, ny * 7, 4) * 0.1 * (1 - d) + Math.exp(-d * 260) * 0.5; }
      const d = ny - hz, r = fbm(nx * 2.5, d * 42 + 3, 4);
      const refl = Math.exp(-Math.abs(nx - 0.62) * 10) * Math.exp(-d * 3.2) * Math.pow(r, 3) * 2.2;
      return 0.03 + r * 0.12 * Math.exp(-d * 2) + refl * 0.7 + Math.exp(-d * 220) * 0.6;
    } },
    { w: 400, h: 600, ar: '2:3', f: (nx, ny) => {              // falling light, long exposure
      let v = 0.03 + fbm(nx * 2, ny * 2, 3) * 0.06 + ny * 0.07;
      const n = 150, cI = Math.floor(nx * n);
      if (hash2(cI, 11) > 0.76) {
        const st = hash2(cI, 3) * 0.9 - 0.15, len = 0.12 + hash2(cI, 5) * 0.7, b = 0.25 + hash2(cI, 9) * 0.75, u = (ny - st) / len;
        if (u > 0 && u < 1) { const fx = 1 - Math.abs((nx * n - cI) - 0.5) * 2; v += b * Math.pow(fx, 3) * Math.pow(Math.sin(u * Math.PI), 0.5) * 0.9; }
      }
      return v;
    } },
    { w: 420, h: 560, ar: '3:4', f: (nx, ny) => {              // monolith in fog
      const fog = 0.05 + 0.34 * Math.pow(1 - Math.abs(ny - 0.8), 7) + fbm(nx * 3, ny * 3, 4) * 0.08;
      if (nx > 0.37 && nx < 0.63 && ny > 0.16 && ny < 0.86) return 0.015 + fbm(nx * 10, ny * 10, 3) * 0.03 + Math.exp(-(nx - 0.37) * 90) * 0.55 + Math.exp(-(ny - 0.16) * 120) * 0.22;
      return fog + (ny > 0.86 ? 0.14 * Math.exp(-(ny - 0.86) * 6) : 0);
    } },
    { w: 600, h: 600, ar: '1:1', f: (nx, ny) => {              // a city grid from above, at night
      const hz = 0.34;
      if (ny < hz) return 0.02 + 0.26 * Math.exp(-(hz - ny) * 14);
      const z = 0.12 / (ny - hz + 0.004), gx = (nx - 0.5) * z * 40, gz = z * 30;
      const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix - 0.5, fz = gz - iz - 0.5;
      const on = hash2(ix, iz) > 0.38 ? 1 : 0;
      const glow = on * Math.exp(-(fx * fx + fz * fz) / (0.004 * z + 0.001));
      return 0.015 + glow * Math.min(1, 1.6 / z) * (0.5 + 0.5 * hash2(iz, ix)) + 0.22 * Math.exp(-(ny - hz) * 16);
    } },
    { w: 380, h: 520, ar: '19:26', f: (nx, ny) => {            // a sun through grain
      const dx = nx - 0.52, dy = (ny - 0.4) * 1.37, d = Math.hypot(dx, dy);
      let v = 0.05 + 0.9 * (1 - ss(0.2, 0.215, d)) + 0.45 * Math.exp(-d * 4.5);
      v += 0.22 * Math.exp(-Math.abs((nx + ny) * 0.7 - 1.05) * 6);
      v += (fbm(nx * 40, ny * 40, 2) - 0.5) * 0.2;
      return v * (0.6 + 0.4 * (1 - ny));
    } },
    { w: 600, h: 380, ar: '30:19', f: (nx, ny) => {            // a corridor of light
      const dx = (nx - 0.5) * 2, dy = (ny - 0.5) * 2;
      const k = Math.max(Math.abs(dx), Math.abs(dy) / 0.63), depth = 1 / (k + 0.001), ring = Math.abs(((depth * 1.4) % 1) - 0.5);
      let v = 0.03 + Math.exp(-k * 6) * 0.95 + (ring > 0.46 ? 0.35 * Math.min(1, k * 2) : 0);
      v += Math.exp(-Math.abs(Math.abs(dx) - Math.abs(dy) / 0.63) * 90) * 0.25 * k;
      if (dy > 0 && Math.abs(dy) / 0.63 > Math.abs(dx)) v += 0.08 * fbm(nx * 20, depth * 3, 3);
      return v;
    } },
  ];
}

type GenOptions = {
  inkRed: boolean;          // WebGL path paints light into the red channel only
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
  let y = 0;
  const step = () => {
    if (!o.alive()) return;
    const t0 = performance.now();
    while (y < h && performance.now() - t0 < 6) {
      for (let x = 0; x < w; x++) {
        let v = P.f(x / w, y / h);
        v += (hash2(x + i * 997, y + 31) - 0.5) * 0.09;
        v = Math.pow(clamp(v), 0.95);
        const k = (y * w + x) * 4;
        if (o.inkRed) { D[k] = v * 255; D[k + 1] = 0; D[k + 2] = 0; }
        else { D[k] = v * 236; D[k + 1] = v * 232; D[k + 2] = v * 223; }
        D[k + 3] = 255;
      }
      y++;
    }
    if (y < h) o.later(step, 0);
    else { cx.putImageData(img, 0, 0); P.cv = cv; done(); }
  };
  step();
}
