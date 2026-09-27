// Analytic storm model: truth, the ML-nowcast stand-in, and the extrapolation
// baseline. Every storm is an anisotropic Gaussian with advected texture, so a
// forecast is the same storm with inflated width (blur), damped peak and a
// position error that grows with lead time. It is a UI driver, not a forecast.

import {
  ML_HORIZON, NX, NY, clamp, interp, sig, texture,
} from "./grid";
import {
  CI_FAILS, STORMS, StormDef, elevation, stormById, upslope,
} from "./scenario";

export type Mode = "all" | "noradar" | "satonly";
/** "truth" = what actually happened; "baseline" = persistence of motion + intensity. */
export type Model = Mode | "truth" | "baseline";

export const MODE_LABEL: Record<Mode, string> = {
  all: "All sources",
  noradar: "No radar",
  satonly: "Satellite only",
};

// Skill knobs per mode: blur at analysis (km), blur growth (km/min), position
// error growth (km/min), probability sharpness.
const K: Record<Model, { b0: number; bl: number; pe: number; s: number }> = {
  truth: { b0: 0, bl: 0, pe: 0, s: 0.6 },
  all: { b0: 1.2, bl: 0.045, pe: 0.03, s: 1 },
  noradar: { b0: 3.5, bl: 0.07, pe: 0.05, s: 1.5 },
  satonly: { b0: 5, bl: 0.09, pe: 0.07, s: 2 },
  baseline: { b0: 1.2, bl: 0.045, pe: 0, s: 1 },
};

export interface StormState {
  id: number;
  x: number;
  y: number;
  /** Peak VIL, kg/m². */
  I: number;
  /** Gaussian width, km. */
  sx: number;
  /** Unit motion vector and speed (km/min). */
  ux: number;
  uy: number;
  speed: number;
  r: number;
  /** Probability weight (<1 for storms that have not formed yet). */
  w: number;
  /** Texture amplitude (1 = observed detail, → 0 as forecasts smooth out). */
  tex: number;
  oro: number;
  /** How much of the true life cycle the forecast carries (1 = observed). */
  know: number;
  phase: "ci" | "mature";
}

/**
 * Terrain-aware forecasting (elevation, slope, upslope flow as features). Off =
 * the ablation: the net treats orographic storms like any other.
 */
export const TERRAIN = { on: true, version: 0 };
export function setTerrain(on: boolean) {
  if (TERRAIN.on !== on) { TERRAIN.on = on; TERRAIN.version++; }
}

// ---- truth -----------------------------------------------------------------

function pos(s: StormDef, t: number): [number, number] {
  return [interp(s.path, t, 1), interp(s.path, t, 2)];
}

function motion(s: StormDef, t: number) {
  const a = Math.max(s.path[0][0], t - 5), b = Math.min(s.path[s.path.length - 1][0], a + 10);
  const [x0, y0] = pos(s, b - 10 < s.path[0][0] ? s.path[0][0] : b - 10);
  const [x1, y1] = pos(s, b);
  const dt = Math.max(1, b - (b - 10 < s.path[0][0] ? s.path[0][0] : b - 10));
  const vx = (x1 - x0) / dt, vy = (y1 - y0) / dt;
  const sp = Math.hypot(vx, vy) || 1e-6;
  return { ux: vx / sp, uy: vy / sp, speed: sp };
}

/** CI growth 0..1 during the pre-echo phase. */
export function ciGrowth(s: StormDef, t: number) {
  if (!s.ci || t < s.ci.t0 || t >= s.tEcho) return 0;
  return (t - s.ci.t0) / (s.tEcho - s.ci.t0);
}

export function truthState(s: StormDef, t: number): StormState | null {
  if (t >= s.tEcho && t <= s.tEnd) {
    const [x, y] = pos(s, t);
    const m = motion(s, t);
    const r = interp(s.radius, t);
    return {
      id: s.id, x, y, I: interp(s.vil, t), sx: r * 0.55, r, ...m,
      w: 1, tex: 1, oro: s.oro ?? 1, know: 1, phase: "mature",
    };
  }
  const g = ciGrowth(s, t);
  if (g > 0) {
    const [x, y] = [s.path[0][1], s.path[0][2]];
    const m = motion(s, s.tEcho);
    return {
      id: s.id, x, y, I: 0, sx: 2 + 2 * g, r: 3 + 2 * g, ...m,
      w: 1, tex: 1, oro: 1, know: 1, phase: "ci",
    };
  }
  return null;
}

// ---- convective initiation --------------------------------------------------

export interface CiObject {
  id: number;
  x: number;
  y: number;
  score: number; // 0..1
  /** Storm id if it becomes one. */
  becomes?: number;
  fail?: boolean;
}

const CI_SHARP: Record<Mode, number> = { all: 0.12, noradar: 0.12, satonly: 0.14 };

export function ciScore(s: StormDef, t: number, mode: Mode) {
  const g = ciGrowth(s, t);
  if (g <= 0) return 0;
  const lightning = mode === "satonly" ? 0 : 0.04;
  return sig((g - 0.42 + lightning) / CI_SHARP[mode]);
}

export function ciObjects(t: number, mode: Mode): CiObject[] {
  const out: CiObject[] = [];
  for (const s of STORMS) {
    const sc = ciScore(s, t, mode);
    if (sc > 0.08) out.push({ id: s.id, x: s.path[0][1], y: s.path[0][2], score: sc, becomes: s.id });
  }
  for (const f of CI_FAILS) {
    if (t < f.t0 || t > f.tPeak + 45) continue;
    const g = t <= f.tPeak ? (t - f.t0) / (f.tPeak - f.t0) : 1 - (t - f.tPeak) / 45;
    const sc = f.peak * clamp(g) * (mode === "satonly" ? 1.05 : 1);
    if (sc > 0.08) out.push({ id: f.id, x: f.x, y: f.y, score: sc, fail: true });
  }
  return out;
}

/** First frame at which the CI score crosses 0.5, for "detected N min before echo". */
export function ciDetectTime(s: StormDef, mode: Mode): number | null {
  if (!s.ci) return null;
  for (let t = s.ci.t0; t < s.tEcho; t += 5) if (ciScore(s, t, mode) >= 0.5) return t;
  return null;
}

// ---- forecast state ---------------------------------------------------------

/** Is this storm (or its CI precursor, or an ancestor) visible to the system at t? */
function knownWeight(s: StormDef, t: number, mode: Mode): number {
  if (t >= s.tEcho && t <= s.tEnd) return 1;
  if (t > s.tEnd) return 0;
  const sc = ciScore(s, t, mode);
  let w = sc >= 0.4 ? sc : 0;
  for (const p of s.parents) w = Math.max(w, knownWeight(stormById.get(p)!, t, mode));
  return w;
}

/** The observed state the forecast is anchored to: the storm itself, else its nearest live ancestor. */
function observedAnchor(s: StormDef, t: number): StormState | null {
  const obs = truthState(s, t);
  if (obs && obs.phase === "mature") return obs;
  let best: StormState | null = null;
  for (const p of s.parents) {
    const a = observedAnchor(stormById.get(p)!, t);
    if (a && (!best || a.I > best.I)) best = a;
  }
  return best;
}

/**
 * Storm states valid at t + lead, as the given model sees them from time t.
 * "truth" ignores t and returns what happened at t + lead.
 */
export function statesAt(t: number, lead: number, model: Model): StormState[] {
  const tv = t + lead;
  const out: StormState[] = [];
  const k = K[model];

  if (model === "truth") {
    for (const s of STORMS) {
      const st = truthState(s, tv);
      if (st && st.phase === "mature") out.push(st);
    }
    return out;
  }

  if (model === "baseline") {
    // Extrapolation: storms observed now, moved with current motion, intensity frozen.
    for (const s of STORMS) {
      const st = truthState(s, t);
      if (!st || st.phase !== "mature") continue;
      const b = k.b0 + k.bl * lead;
      const sx = Math.hypot(st.sx, b);
      out.push({
        ...st,
        x: st.x + st.ux * st.speed * lead,
        y: st.y + st.uy * st.speed * lead,
        sx, I: st.I * (st.sx / sx) ** 0.6,
        tex: Math.exp(-lead / 50),
      });
    }
    return out;
  }

  const mlWeight = lead <= ML_HORIZON ? 1 : 1 - (lead - ML_HORIZON) / (360 - ML_HORIZON);
  for (const s of STORMS) {
    const w = knownWeight(s, t, model);
    if (w <= 0) continue;
    const st = truthState(s, tv);
    if (!st || st.phase !== "mature") continue;
    // What the net "knows" about growth/decay and track curvature fades with lead;
    // beyond that it falls back to persistence of what it sees now.
    const oro = TERRAIN.on && (s.oro ?? 1) > 1;
    const know = Math.exp(-lead / (oro ? 160 : 55));
    const seen = observedAnchor(s, t);
    let I = seen ? seen.I + (st.I - seen.I) * know : st.I * know;
    let x = st.x, y = st.y;
    if (seen) {
      const a = Math.exp(-lead / (oro ? 220 : 80));
      x = a * st.x + (1 - a) * (seen.x + seen.ux * seen.speed * lead);
      y = a * st.y + (1 - a) * (seen.y + seen.uy * seen.speed * lead);
    } else {
      // Not yet formed: only the CI signal anchors it.
      I *= 0.85;
    }
    const b = k.b0 + k.bl * lead;
    const sx = Math.hypot(st.sx, b);
    // Systematic lag + right-of-track bias, like most extrapolation-trained nets.
    // Terrain features pin orographic storms to the slope: less drift, less smoothing.
    const e = k.pe * lead * (oro ? 0.3 : 1);
    const damp = oro ? (st.sx / sx) ** 0.3 : (st.sx / sx) ** 0.6 / (1 + 0.0025 * lead * k.s);
    I = Math.max(0, I) * damp * mlWeight;
    if (I < 0.5) continue;
    out.push({
      ...st,
      x: x - st.ux * e * 0.8 + st.uy * e * 0.5,
      y: y - st.uy * e * 0.8 - st.ux * e * 0.5,
      sx,
      I,
      w,
      know,
      oro: TERRAIN.on ? st.oro : 1,
      tex: Math.exp(-lead / 45) * (model === "all" ? 1 : 0.6),
    });
  }
  return out;
}

// ---- fields ----------------------------------------------------------------

function stormVil(st: StormState, x: number, y: number) {
  const dx = x - st.x, dy = y - st.y;
  const along = dx * st.ux + dy * st.uy;
  const cross = -dx * st.uy + dy * st.ux;
  const sa = st.sx * 1.3, sc = st.sx * 0.85;
  const q = (along * along) / (2 * sa * sa) + (cross * cross) / (2 * sc * sc);
  if (q > 9) return 0;
  let v = st.I * Math.exp(-q);
  if (st.tex > 0.02) v *= 1 + st.tex * (texture(along + 50, cross + 50, st.id) - 0.5) * 1.1;
  return v * st.w;
}

/** NWP stand-in for 3–6 h: diffuse afternoon convection over high terrain. */
function nwpVil(x: number, y: number, tv: number) {
  const diurnal = Math.exp(-(((tv - 250) / 70) ** 2));
  const e = elevation(x, y);
  return 16 * diurnal * clamp((e - 1.1) / 1.2) * (0.8 + 0.4 * Math.sin(x / 9 + y / 13));
}

function nwpWeight(lead: number) {
  return lead <= ML_HORIZON ? 0 : (lead - ML_HORIZON) / (360 - ML_HORIZON);
}

export function vilAt(states: StormState[], x: number, y: number, tv = 0, lead = 0) {
  let v = 0;
  for (const st of states) v += stormVil(st, x, y);
  const w = nwpWeight(lead);
  if (w > 0) v += w * nwpVil(x, y, tv);
  return v;
}

/** Documented-relation stand-in: rain rate (mm/h) from VIL with orographic boost. */
export function rainRate(vil: number, x: number, y: number, oro: number) {
  return 2.05 * vil * (1 + (oro - 1) * clamp(upslope(x, y) * 1.4));
}

function rainAt(states: StormState[], x: number, y: number, tv: number, lead: number) {
  let r = 0;
  for (const st of states) r += rainRate(stormVil(st, x, y), x, y, st.oro);
  const w = nwpWeight(lead);
  if (w > 0) r += rainRate(w * nwpVil(x, y, tv), x, y, 1.3);
  return r;
}

export function brightnessTemp(t: number, x: number, y: number) {
  let tb = 297 - 7 * elevation(x, y) - 0.015 * y;
  for (const s of STORMS) {
    const st = truthState(s, t);
    if (!st) continue;
    if (st.phase === "ci") {
      const g = ciGrowth(s, t);
      const d2 = (x - st.x) ** 2 + (y - st.y) ** 2;
      tb -= 58 * g * Math.exp(-d2 / (2 * (2.5 + 3 * g) ** 2));
      continue;
    }
    const f = clamp(st.I / 55);
    const core = 30 + 55 * f;
    const d2 = (x - st.x) ** 2 + (y - st.y) ** 2;
    tb -= core * Math.exp(-d2 / (2 * (st.sx * 1.1) ** 2)) * (0.9 + 0.2 * texture(x - st.x + 20, y - st.y + 20, st.id + 3));
    // Anvil spreads downwind (upper flow toward ENE).
    const as = st.sx * 2.6;
    const ax = st.x + 0.9 * as * 0.94, ay = st.y + 0.9 * as * 0.34;
    const da = (x - ax) ** 2 + (y - ay) ** 2;
    tb -= 0.55 * core * Math.exp(-da / (2 * as * as));
  }
  for (const f of CI_FAILS) {
    if (t < f.t0 || t > f.tPeak + 45) continue;
    const g = t <= f.tPeak ? (t - f.t0) / (f.tPeak - f.t0) : 1 - (t - f.tPeak) / 45;
    const d2 = (x - f.x) ** 2 + (y - f.y) ** 2;
    tb -= 40 * clamp(g) * Math.exp(-d2 / (2 * 3.5 ** 2));
  }
  return Math.max(188, tb);
}

/** Flash rate (flashes/min) with a lightning jump while the updraft intensifies. */
export function flashRate(s: StormDef, t: number) {
  const st = truthState(s, t);
  if (!st) return 0;
  if (st.phase === "ci") {
    const g = ciGrowth(s, t);
    return g > 0.72 ? 0.6 * (g - 0.72) / 0.28 : 0;
  }
  const dI = (interp(s.vil, t + 5) - interp(s.vil, t - 5)) / 10;
  return 0.12 * Math.max(0, st.I - 14) ** 1.15 * (1 + 2.2 * Math.max(0, dI));
}

/** Lightning density, flashes km⁻² h⁻¹. */
function lightningAt(states: StormState[], x: number, y: number, tv: number) {
  let d = 0;
  for (const st of states) {
    const s = stormById.get(st.id)!;
    // Scale the life-cycle flash rate to the forecast intensity.
    const fr = flashRate(s, tv) * st.w * Math.min(1, st.I / Math.max(interp(s.vil, tv), 1));
    if (fr <= 0) continue;
    const sl = st.sx * 0.9;
    const d2 = (x - st.x) ** 2 + (y - st.y) ** 2;
    d += (fr * 60 * Math.exp(-d2 / (2 * sl * sl))) / (2 * Math.PI * sl * sl);
  }
  return d;
}

/** Downburst proxy: rapid collapse of a formerly intense core. */
function downburstAt(states: StormState[], x: number, y: number, tv: number, s: number) {
  let p = 0;
  for (const st of states) {
    const def = stormById.get(st.id)!;
    const now = interp(def.vil, tv), next = interp(def.vil, tv + 15);
    const recentMax = Math.max(interp(def.vil, tv - 20), now);
    const collapse = (now - next) / Math.max(now, 1);
    const pc = sig((collapse - 0.2) / (0.07 * s)) * sig((recentMax - 44) / (4 * s)) * st.know;
    if (pc < 0.01) continue;
    const sd = st.sx * 1.1;
    const d2 = (x - st.x) ** 2 + (y - st.y) ** 2;
    p = Math.max(p, pc * st.w * Math.exp(-d2 / (2 * sd * sd)));
  }
  return p;
}

// ---- hazard evaluation ------------------------------------------------------

export interface HazardSample {
  vil: number;
  lightningDensity: number;
  lightning: number;
  hail: number;
  downburst: number;
  cloudburst: number;
  accum: number;
}

/** Everything at one point, valid at t + lead as `model` sees it from t. */
export function sample(t: number, lead: number, model: Model, x: number, y: number): HazardSample {
  const s = K[model].s * (1 + lead / 120);
  const st = statesAt(t, lead, model);
  const tv = t + lead;
  const vil = vilAt(st, x, y, tv, lead);
  const ld = model === "satonly" ? lightningAt(st, x, y, tv) * 0.6 : lightningAt(st, x, y, tv);
  let accum = 0;
  for (let k = 0; k < 6; k++) {
    const l = lead + 5 + k * 10;
    accum += (rainAt(statesAt(t, l, model), x, y, t + l, l) * 10) / 60;
  }
  return {
    vil,
    lightningDensity: ld,
    lightning: 1 - Math.exp(-ld / 1.5),
    hail: sig((vil - 44) / (3.5 * s)),
    downburst: model === "baseline" ? 0 : downburstAt(st, x, y, tv, s),
    cloudburst: sig((accum - 100) / (10 * s)),
    accum,
  };
}

// ---- grids for rendering ----------------------------------------------------

export type Layer = "ir" | "vil" | "lightning" | "hail" | "downburst" | "cloudburst";

export interface Grids {
  vil?: Float32Array;
  ir?: Float32Array;
  lightning?: Float32Array;
  hail?: Float32Array;
  downburst?: Float32Array;
  cloudburst?: Float32Array;
}

const cache = new Map<string, Grids>();

/** Grids (row 0 = north) for the requested layers, cached by (t, lead, mode). */
export function gridsFor(t: number, lead: number, mode: Mode, layers: Set<Layer>): Grids {
  const key = `${t}|${lead}|${mode}|${TERRAIN.on}|${[...layers].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const g: Grids = {};
  const N = NX * NY;
  const tv = t + lead;
  const s = K[mode].s * (1 + lead / 120);
  const st = statesAt(t, lead, mode);
  const want = (l: Layer) => layers.has(l);

  if (want("vil") || want("hail")) {
    const vil = new Float32Array(N);
    for (let r = 0; r < NY; r++)
      for (let c = 0; c < NX; c++) vil[r * NX + c] = vilAt(st, c + 0.5, NY - r - 0.5, tv, lead);
    if (want("vil")) g.vil = vil;
    if (want("hail")) {
      const h = new Float32Array(N);
      for (let i = 0; i < N; i++) h[i] = sig((vil[i] - 44) / (3.5 * s));
      g.hail = h;
    }
  }
  if (want("ir")) {
    // Satellite is only observed; forecasts show the latest image.
    const ir = new Float32Array(N);
    for (let r = 0; r < NY; r++)
      for (let c = 0; c < NX; c++) ir[r * NX + c] = brightnessTemp(t, c + 0.5, NY - r - 0.5);
    g.ir = ir;
  }
  if (want("lightning")) {
    const l = new Float32Array(N);
    const f = mode === "satonly" ? 0.6 : 1;
    for (let r = 0; r < NY; r++)
      for (let c = 0; c < NX; c++) l[r * NX + c] = f * lightningAt(st, c + 0.5, NY - r - 0.5, tv);
    g.lightning = l;
  }
  if (want("downburst")) {
    const d = new Float32Array(N);
    for (let r = 0; r < NY; r++)
      for (let c = 0; c < NX; c++) d[r * NX + c] = downburstAt(st, c + 0.5, NY - r - 0.5, tv, s);
    g.downburst = d;
  }
  if (want("cloudburst")) {
    const acc = new Float32Array(N);
    for (let k = 0; k < 6; k++) {
      const l = lead + 5 + k * 10;
      const sk = statesAt(t, l, mode);
      for (let r = 0; r < NY; r++)
        for (let c = 0; c < NX; c++) {
          const x = c + 0.5, y = NY - r - 0.5;
          acc[r * NX + c] += (rainAt(sk, x, y, t + l, l) * 10) / 60;
        }
    }
    for (let i = 0; i < N; i++) acc[i] = sig((acc[i] - 100) / (10 * s));
    g.cloudburst = acc;
  }

  if (cache.size > 400) cache.clear();
  cache.set(key, g);
  return g;
}

/** Observed lightning strikes in the 5 minutes before t (deterministic). */
export function strikes(t: number, mode: Mode): [number, number][] {
  if (mode === "satonly") return [];
  const out: [number, number][] = [];
  for (const s of STORMS) {
    const st = truthState(s, t);
    if (!st) continue;
    const n = Math.round(flashRate(s, t) * 5);
    let a = (s.id * 7919 + t * 104729) >>> 0;
    const r = () => ((a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const u = Math.max(r(), 1e-6), v = r();
      const rad = Math.sqrt(-2 * Math.log(u)) * st.sx * 0.8;
      out.push([st.x + rad * Math.cos(2 * Math.PI * v), st.y + rad * Math.sin(2 * Math.PI * v)]);
    }
  }
  return out;
}
