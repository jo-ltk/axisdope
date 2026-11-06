/**
 * Sample pieces for future releases, shown on the opening grid. Each one is an abstract studio
 * object (sphere, ring, monolith…) drawn in a 100×100 box using ink density (see engine `L`):
 * 0 = white paper, 1 = black ink.
 *
 * Edit the list freely: change `code` and `name`, reorder, or remove items. To use a real photo
 * later, replace `draw` with a function that draws a grayscale cut-out into the box.
 */
export type Ink = (v: number) => string;
export type Product = {
  code: string;
  name: string;
  draw: (g: CanvasRenderingContext2D, ink: Ink) => void;
  cv?: HTMLCanvasElement;
};

type G = CanvasRenderingContext2D;

/** soft contact shadow on the floor */
function floor(g: G, ink: Ink, cx: number, cy: number, rx: number, k = 0.32) {
  g.save(); g.translate(cx, cy); g.scale(1, 0.12);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, ink(k)); gr.addColorStop(1, ink(0));
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
  g.restore();
}
/** a matte black sphere lit from the upper left */
function sphere(g: G, ink: Ink, cx: number, cy: number, r: number) {
  const gr = g.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.05, cx, cy, r);
  gr.addColorStop(0, ink(0.5)); gr.addColorStop(0.35, ink(0.82)); gr.addColorStop(1, ink(0.97));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
}
/** vertical gradient fill for flat faces */
function face(g: G, ink: Ink, y0: number, y1: number, a: number, b: number) {
  const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, ink(a)); gr.addColorStop(1, ink(b));
  g.fillStyle = gr;
}
function hgrad(g: G, ink: Ink, x0: number, x1: number, a: number, b: number, c = b) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, ink(a)); gr.addColorStop(0.3, ink(b)); gr.addColorStop(1, ink(c));
  g.fillStyle = gr;
}

export function createProducts(): Product[] {
  return [
    { code: '001', name: 'SPHERE', draw: (g, ink) => {
      floor(g, ink, 50, 80, 26); sphere(g, ink, 50, 50, 27);
    } },
    { code: '002', name: 'RING', draw: (g, ink) => {
      floor(g, ink, 50, 82, 28, 0.26);
      const gr = g.createLinearGradient(25, 20, 75, 80); gr.addColorStop(0, ink(0.6)); gr.addColorStop(0.4, ink(0.9)); gr.addColorStop(1, ink(0.97));
      g.strokeStyle = gr; g.lineWidth = 13; g.beginPath(); g.arc(50, 48, 23, 0, Math.PI * 2); g.stroke();
    } },
    { code: '003', name: 'MONOLITH', draw: (g, ink) => {
      floor(g, ink, 50, 88, 18);
      hgrad(g, ink, 40, 60, 0.62, 0.9, 0.97); g.fillRect(40, 10, 20, 78);
    } },
    { code: '004', name: 'CUBE', draw: (g, ink) => {
      floor(g, ink, 50, 84, 30, 0.26);
      g.fillStyle = ink(0.62); g.beginPath(); g.moveTo(50, 22); g.lineTo(76, 34); g.lineTo(50, 46); g.lineTo(24, 34); g.closePath(); g.fill();
      face(g, ink, 34, 84, 0.82, 0.92); g.beginPath(); g.moveTo(24, 34); g.lineTo(50, 46); g.lineTo(50, 82); g.lineTo(24, 70); g.closePath(); g.fill();
      face(g, ink, 34, 84, 0.93, 0.98); g.beginPath(); g.moveTo(76, 34); g.lineTo(50, 46); g.lineTo(50, 82); g.lineTo(76, 70); g.closePath(); g.fill();
    } },
    { code: '005', name: 'ARCH', draw: (g, ink) => {
      floor(g, ink, 50, 88, 26, 0.26);
      hgrad(g, ink, 26, 74, 0.68, 0.9, 0.96);
      g.beginPath(); g.moveTo(26, 88); g.lineTo(26, 40); g.arc(50, 40, 24, Math.PI, 0); g.lineTo(74, 88);
      g.lineTo(62, 88); g.lineTo(62, 46); g.arc(50, 46, 12, 0, Math.PI, true); g.lineTo(38, 88); g.closePath(); g.fill();
    } },
    { code: '006', name: 'CONE', draw: (g, ink) => {
      floor(g, ink, 50, 84, 28, 0.28);
      hgrad(g, ink, 24, 76, 0.6, 0.86, 0.97);
      g.beginPath(); g.moveTo(50, 14); g.lineTo(76, 80); g.quadraticCurveTo(50, 88, 24, 80); g.closePath(); g.fill();
    } },
    { code: '007', name: 'DISC', draw: (g, ink) => {
      floor(g, ink, 50, 76, 34, 0.22);
      g.fillStyle = ink(0.95); g.beginPath(); g.ellipse(50, 56, 34, 10, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(16, 50, 68, 6);
      face(g, ink, 36, 56, 0.55, 0.82); g.beginPath(); g.ellipse(50, 50, 34, 10, 0, 0, Math.PI * 2); g.fill();
    } },
    { code: '008', name: 'CAPSULE', draw: (g, ink) => {
      floor(g, ink, 50, 84, 22, 0.28);
      hgrad(g, ink, 37, 63, 0.58, 0.88, 0.97);
      g.beginPath(); g.moveTo(37, 28); g.arc(50, 28, 13, Math.PI, 0); g.lineTo(63, 70); g.arc(50, 70, 13, 0, Math.PI); g.closePath(); g.fill();
    } },
    { code: '009', name: 'CYLINDER', draw: (g, ink) => {
      floor(g, ink, 50, 86, 26, 0.28);
      hgrad(g, ink, 30, 70, 0.62, 0.9, 0.97);
      g.beginPath(); g.moveTo(30, 26); g.lineTo(30, 78); g.ellipse(50, 78, 20, 6, 0, Math.PI, 0, true); g.lineTo(70, 26); g.closePath(); g.fill();
      g.fillStyle = ink(0.7); g.beginPath(); g.ellipse(50, 26, 20, 6, 0, 0, Math.PI * 2); g.fill();
    } },
    { code: '010', name: 'PYRAMID', draw: (g, ink) => {
      floor(g, ink, 50, 84, 32, 0.26);
      face(g, ink, 16, 82, 0.72, 0.86); g.beginPath(); g.moveTo(50, 16); g.lineTo(20, 76); g.lineTo(54, 82); g.closePath(); g.fill();
      face(g, ink, 16, 82, 0.92, 0.98); g.beginPath(); g.moveTo(50, 16); g.lineTo(54, 82); g.lineTo(80, 72); g.closePath(); g.fill();
    } },
    { code: '011', name: 'DOME', draw: (g, ink) => {
      floor(g, ink, 50, 74, 34, 0.3);
      const gr = g.createRadialGradient(38, 46, 2, 50, 72, 34);
      gr.addColorStop(0, ink(0.5)); gr.addColorStop(0.4, ink(0.85)); gr.addColorStop(1, ink(0.97));
      g.fillStyle = gr; g.beginPath(); g.arc(50, 72, 30, Math.PI, 0); g.ellipse(50, 72, 30, 4, 0, 0, Math.PI); g.closePath(); g.fill();
    } },
    { code: '012', name: 'HALO', draw: (g, ink) => {
      floor(g, ink, 50, 86, 22, 0.26);
      sphere(g, ink, 50, 62, 15);
      g.strokeStyle = ink(0.9); g.lineWidth = 1.6; g.beginPath(); g.ellipse(50, 30, 22, 6, 0, 0, Math.PI * 2); g.stroke();
    } },
  ];
}
