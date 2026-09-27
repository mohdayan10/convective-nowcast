// 1 km analysis grid over the Dehradun – Rishikesh – Tehri domain.
// x = km east of the west edge, y = km north of the south edge.

export const NX = 120;
export const NY = 110;

const DLON = 1 / (111.32 * Math.cos((30.3 * Math.PI) / 180)); // deg per km
const DLAT = 1 / 111.2;

export const BBOX = {
  west: 77.65,
  south: 29.85,
  east: 77.65 + NX * DLON,
  north: 29.85 + NY * DLAT,
};

/** Image-source corners, clockwise from top-left. */
export const GRID_CORNERS: [[number, number], [number, number], [number, number], [number, number]] = [
  [BBOX.west, BBOX.north],
  [BBOX.east, BBOX.north],
  [BBOX.east, BBOX.south],
  [BBOX.west, BBOX.south],
];

export const toLngLat = (x: number, y: number): [number, number] => [
  BBOX.west + x * DLON,
  BBOX.south + y * DLAT,
];

export const fromLngLat = (lng: number, lat: number): [number, number] => [
  (lng - BBOX.west) / DLON,
  (lat - BBOX.south) / DLAT,
];

// ---- replay clock -----------------------------------------------------------
// t = minutes after 12:00 IST on the synthetic day.
export const T_START_IST = 12 * 60;
export const T_END = 360;
export const FRAME = 5;
export const LEAD_MAX = 360;
export const LEAD_STEP = 10;
export const ML_HORIZON = 180; // beyond this the forecast blends toward NWP

export const clockLabel = (t: number) => {
  const m = T_START_IST + Math.round(t);
  const hh = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

export const leadLabel = (l: number) => {
  if (l === 0) return "T+0";
  const h = Math.floor(l / 60);
  const m = l % 60;
  return h ? `T+${h}h${m ? String(m).padStart(2, "0") : ""}` : `T+${m}m`;
};

// ---- small numeric helpers -------------------------------------------------
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const sig = (z: number) => 1 / (1 + Math.exp(-z));
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Piecewise-linear keyframes [[t, v], ...]; clamps outside the range. */
export function interp(kf: readonly (readonly number[])[], t: number, col = 1): number {
  if (t <= kf[0][0]) return kf[0][col];
  for (let i = 1; i < kf.length; i++) {
    if (t <= kf[i][0]) {
      const [t0, t1] = [kf[i - 1][0], kf[i][0]];
      return lerp(kf[i - 1][col], kf[i][col], (t - t0) / (t1 - t0));
    }
  }
  return kf[kf.length - 1][col];
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(r: () => number) {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// Value noise for storm texture (storm-relative, so it moves with the cell).
function hash(ix: number, iy: number, s: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s);
  const c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function texture(u: number, v: number, seed: number) {
  return 0.62 * vnoise(u / 4.5, v / 4.5, seed) + 0.38 * vnoise(u / 2, v / 2, seed + 7);
}
