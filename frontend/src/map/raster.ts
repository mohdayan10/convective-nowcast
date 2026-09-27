// Grid → RGBA rendering and iso-probability contours for the map.

import { NX, NY, toLngLat } from "../model/grid";
import type { Layer } from "../model/physics";

type Stop = [number, [number, number, number, number]];

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

function ramp(stops: Stop[]) {
  const lut = new Uint8ClampedArray(256 * 4);
  const lo = stops[0][0], hi = stops[stops.length - 1][0];
  for (let i = 0; i < 256; i++) {
    const v = lo + ((hi - lo) * i) / 255;
    let k = 1;
    while (k < stops.length - 1 && v > stops[k][0]) k++;
    const [v0, c0] = stops[k - 1], [v1, c1] = stops[k];
    const f = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
    for (let j = 0; j < 4; j++) lut[i * 4 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return { lut, lo, hi };
}

/** Single-hue probability ramp: transparent → hue → light tint. */
function probRamp(color: string): Stop[] {
  const [r, g, b] = hex(color);
  const tint = (f: number) => [r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f] as const;
  return [
    [0.0, [r, g, b, 0]],
    [0.08, [r, g, b, 0]],
    [0.2, [r * 0.8, g * 0.8, b * 0.8, 90]],
    [0.5, [r, g, b, 175]],
    [0.8, [...tint(0.25), 215] as [number, number, number, number]],
    [1.0, [...tint(0.5), 235] as [number, number, number, number]],
  ];
}

export const HAZARD_COLOR = {
  lightning: "#d9a400",
  hail: "#d548b0",
  downburst: "#e8542e",
  cloudburst: "#2f7fe0",
} as const;

export const RAMPS: Record<Layer, ReturnType<typeof ramp>> = {
  // Brightness temperature (K): warm = clear, cold tops → bright white.
  ir: ramp([
    [190, [255, 255, 255, 235]],
    [210, [226, 236, 246, 215]],
    [235, [168, 182, 200, 170]],
    [260, [110, 122, 140, 90]],
    [280, [70, 80, 96, 0]],
    [300, [70, 80, 96, 0]],
  ]),
  // VIL (kg/m²): single teal hue, dark → pale.
  vil: ramp([
    [0, [18, 60, 66, 0]],
    [2, [18, 72, 78, 0]],
    [5, [22, 92, 96, 120]],
    [15, [34, 148, 136, 185]],
    [30, [110, 214, 186, 220]],
    [45, [200, 246, 230, 240]],
    [65, [255, 255, 255, 250]],
  ]),
  lightning: ramp([
    [0, [217, 164, 0, 0]],
    [0.15, [217, 164, 0, 0]],
    [0.6, [150, 112, 0, 110]],
    [2, [217, 164, 0, 180]],
    [6, [245, 212, 90, 225]],
    [12, [255, 240, 180, 240]],
  ]),
  hail: ramp(probRamp(HAZARD_COLOR.hail)),
  downburst: ramp(probRamp(HAZARD_COLOR.downburst)),
  cloudburst: ramp(probRamp(HAZARD_COLOR.cloudburst)),
};

export function paint(ctx: CanvasRenderingContext2D, grid: Float32Array, layer: Layer) {
  const { lut, lo, hi } = RAMPS[layer];
  const img = ctx.createImageData(NX, NY);
  const d = img.data;
  const k = 255 / (hi - lo);
  for (let i = 0; i < grid.length; i++) {
    const idx = Math.max(0, Math.min(255, Math.round((grid[i] - lo) * k))) * 4;
    d[i * 4] = lut[idx];
    d[i * 4 + 1] = lut[idx + 1];
    d[i * 4 + 2] = lut[idx + 2];
    d[i * 4 + 3] = lut[idx + 3];
  }
  ctx.putImageData(img, 0, 0);
}

/** CSS gradient for a layer's legend. */
export function legendGradient(layer: Layer) {
  const { lut } = RAMPS[layer];
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const j = Math.round((i / 8) * 255) * 4;
    const a = Math.max(lut[j + 3] / 255, 0.08);
    stops.push(`rgba(${lut[j]},${lut[j + 1]},${lut[j + 2]},${a.toFixed(2)}) ${(i / 8) * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** Marching squares: iso-line segments of `grid` at `level`, as lng/lat MultiLineString. */
export function contour(grid: Float32Array, level: number): [number, number][][] {
  const segs: [number, number][][] = [];
  const v = (c: number, r: number) => grid[r * NX + c];
  // Grid cell (c, r) centre sits at x = c + 0.5, y = NY - r - 0.5.
  const P = (c: number, r: number): [number, number] => toLngLat(c + 0.5, NY - r - 0.5);
  const lerpPt = (a: [number, number], b: [number, number], va: number, vb: number): [number, number] => {
    const f = (level - va) / (vb - va);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  for (let r = 0; r < NY - 1; r++)
    for (let c = 0; c < NX - 1; c++) {
      const a = v(c, r), b = v(c + 1, r), cc = v(c + 1, r + 1), d = v(c, r + 1);
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (cc > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const pa = P(c, r), pb = P(c + 1, r), pc = P(c + 1, r + 1), pd = P(c, r + 1);
      const top = () => lerpPt(pa, pb, a, b);
      const right = () => lerpPt(pb, pc, b, cc);
      const bottom = () => lerpPt(pd, pc, d, cc);
      const left = () => lerpPt(pa, pd, a, d);
      switch (idx) {
        case 1: case 14: segs.push([left(), bottom()]); break;
        case 2: case 13: segs.push([bottom(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([top(), right()]); break;
        case 5: segs.push([left(), top()], [bottom(), right()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), top()]); break;
        case 10: segs.push([left(), bottom()], [top(), right()]); break;
      }
    }
  return segs;
}
