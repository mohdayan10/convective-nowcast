// Synthetic scenario: a pre-monsoon afternoon over the Doon valley.
// Storm geometry is invented; place coordinates are real. Every panel that
// shows scenario output carries the SYNTHETIC badge.

import { fromLngLat } from "./grid";

export type Hazard = "lightning" | "hail" | "downburst" | "cloudburst";
export const HAZARDS: Hazard[] = ["lightning", "hail", "downburst", "cloudburst"];

export type Audience = "aviation" | "district" | "farmers";
export const AUDIENCES: Audience[] = ["aviation", "district", "farmers"];

export interface StormDef {
  id: number;
  parents: number[];
  /** First radar echo (min). */
  tEcho: number;
  tEnd: number;
  /** [t, x, y] */
  path: [number, number, number][];
  /** [t, peak VIL kg/m²] */
  vil: [number, number][];
  /** [t, echo radius km] */
  radius: [number, number][];
  /** Convective initiation: cooling starts at t0 at the storm's first path point. */
  ci?: { t0: number };
  /** Rain-rate multiplier from moist upslope flow. */
  oro?: number;
}

export const STORMS: StormDef[] = [
  {
    id: 14, parents: [], tEcho: 60, tEnd: 140, ci: { t0: 20 },
    path: [[60, 19, 60], [100, 33, 55], [140, 45, 50]],
    vil: [[60, 6], [85, 22], [110, 36], [140, 42]],
    radius: [[60, 4], [110, 8], [140, 9]],
  },
  {
    id: 19, parents: [], tEcho: 80, tEnd: 140, ci: { t0: 45 },
    path: [[80, 41, 70], [110, 44, 60], [140, 47, 51]],
    vil: [[80, 6], [110, 30], [140, 38]],
    radius: [[80, 4], [140, 8]],
  },
  {
    id: 27, parents: [14, 19], tEcho: 140, tEnd: 215,
    path: [[140, 46, 50], [152, 46.5, 44], [168, 49, 38], [190, 56, 32], [215, 61, 27]],
    vil: [[140, 50], [160, 63], [182, 60], [195, 52], [212, 26], [215, 25]],
    radius: [[140, 11], [170, 13], [215, 11]],
  },
  {
    id: 31, parents: [27], tEcho: 215, tEnd: 335, oro: 1.9,
    path: [[215, 63, 28], [250, 73, 31], [285, 81, 34], [315, 85, 35], [335, 88, 36]],
    vil: [[215, 24], [245, 42], [270, 58], [300, 62], [320, 44], [335, 8]],
    radius: [[215, 7], [270, 10], [320, 11], [335, 7]],
  },
  {
    id: 32, parents: [27], tEcho: 215, tEnd: 270,
    path: [[215, 59, 24], [245, 56, 15], [270, 54, 7]],
    vil: [[215, 22], [235, 18], [270, 3]],
    radius: [[215, 6], [270, 4]],
  },
  {
    id: 41, parents: [], tEcho: 270, tEnd: 355, ci: { t0: 230 },
    path: [[270, 99, 74], [320, 106, 70], [355, 111, 67]],
    vil: [[270, 5], [300, 28], [330, 30], [355, 4]],
    radius: [[270, 4], [310, 8], [355, 5]],
  },
];

/** CI candidates that never became storms — the detector's honest false alarms. */
export interface CiFail { id: number; x: number; y: number; t0: number; tPeak: number; peak: number }
export const CI_FAILS: CiFail[] = [
  { id: 36, x: 76, y: 63, t0: 130, tPeak: 175, peak: 0.62 },
];

export const stormById = new Map(STORMS.map((s) => [s.id, s]));
for (const s of STORMS) (s as StormDef & { children?: number[] }).children = [];
for (const s of STORMS)
  for (const p of s.parents) (stormById.get(p) as StormDef & { children: number[] }).children.push(s.id);
export const childrenOf = (id: number) =>
  (stormById.get(id) as StormDef & { children: number[] }).children;

// ---- exposure ---------------------------------------------------------------

export type SiteKind = "airport" | "district" | "town" | "route" | "farms";

export interface Site {
  id: string;
  name: string;
  short: string;
  kind: SiteKind;
  x: number;
  y: number;
  /** Area radius, km (0 for a point). */
  radius: number;
  audiences: Audience[];
  population?: string;
  /** Route / area outline in lng,lat. */
  shape?: [number, number][];
  /** Put the map label on the left to avoid a neighbour. */
  labelLeft?: boolean;
  hi: string;
  te: string;
}

const P = (lng: number, lat: number) => fromLngLat(lng, lat);
const site = (
  s: Omit<Site, "x" | "y"> & { lng: number; lat: number },
): Site => {
  const [x, y] = P(s.lng, s.lat);
  const { lng: _lng, lat: _lat, ...rest } = s;
  return { ...rest, x, y };
};

export const ROUTE_NH7: [number, number][] = [
  [78.2676, 30.0869], [78.3045, 30.1086], [78.3452, 30.1273], [78.3906, 30.1398],
  [78.4312, 30.1509], [78.4700, 30.1590], [78.5003, 30.1632], [78.5380, 30.1561],
  [78.5720, 30.1500], [78.5985, 30.1460],
];

export const SITES: Site[] = [
  site({
    id: "ded", name: "Jolly Grant Airport", short: "DED", kind: "airport",
    lng: 78.1803, lat: 30.1897, radius: 3, audiences: ["aviation", "district"],
    hi: "जॉली ग्रांट हवाई अड्डा", te: "జాలీ గ్రాంట్ విమానాశ్రయం",
  }),
  site({
    id: "ddn", name: "Dehradun District HQ", short: "Dehradun", kind: "district",
    lng: 78.0322, lat: 30.3165, radius: 5, audiences: ["district"], population: "≈ 8 lakh",
    hi: "देहरादून", te: "డెహ్రాడూన్",
  }),
  site({
    id: "tehri", name: "New Tehri District HQ", short: "New Tehri", kind: "district",
    lng: 78.43, lat: 30.38, radius: 3, audiences: ["district"],
    hi: "नई टिहरी", te: "న్యూ టెహ్రీ",
  }),
  site({
    id: "rsk", name: "Rishikesh", short: "Rishikesh", kind: "town",
    lng: 78.2676, lat: 30.0869, radius: 4, audiences: ["district"], population: "≈ 1 lakh",
    hi: "ऋषिकेश", te: "ఋషికేశ్",
  }),
  site({
    id: "hdw", name: "Haridwar", short: "Haridwar", kind: "town",
    lng: 78.1642, lat: 29.9457, radius: 5, audiences: ["district"],
    hi: "हरिद्वार", te: "హరిద్వార్",
  }),
  site({
    id: "nh7", name: "NH-7 Char Dham route (Shivpuri – Byasi)", short: "NH-7 route", kind: "route",
    lng: 78.47, lat: 30.159, radius: 7, audiences: ["district"], shape: ROUTE_NH7,
    hi: "NH-7 चारधाम मार्ग", te: "NH-7 చార్‌ధామ్ మార్గం",
  }),
  site({
    id: "doiwala", name: "Doiwala farm cluster", short: "Doiwala farms", kind: "farms",
    lng: 78.12, lat: 30.19, radius: 5, audiences: ["farmers"], labelLeft: true,
    shape: [[78.08, 30.16], [78.15, 30.155], [78.165, 30.2], [78.13, 30.235], [78.085, 30.215]],
    hi: "डोईवाला के खेत", te: "డోయివాలా పొలాలు",
  }),
  site({
    id: "vikas", name: "Vikasnagar – Sahaspur farms", short: "Vikasnagar farms", kind: "farms",
    lng: 77.83, lat: 30.43, radius: 6, audiences: ["farmers"],
    shape: [[77.76, 30.41], [77.86, 30.385], [77.905, 30.43], [77.87, 30.475], [77.78, 30.47]],
    hi: "विकासनगर–सहसपुर के खेत", te: "వికాస్‌నగర్–సహస్‌పూర్ పొలాలు",
  }),
];

export const siteById = new Map(SITES.map((s) => [s.id, s]));

// ---- synthetic terrain (model physics only; the map shows the real DEM) -----

// Doon valley axis runs NW→SE through Dehradun; the Lesser Himalaya rise to the NE.
const AX = { x: 36.8, y: 51.9, nx: 0.665, ny: 0.747 };

export function elevation(x: number, y: number) {
  const d = (x - AX.x) * AX.nx + (y - AX.y) * AX.ny;
  const plain = 0.28 + 0.32 / (1 + Math.exp(-(d + 17) / 2));
  const shivalik = 0.45 * Math.exp(-((d + 12) ** 2) / 14);
  const himalaya = d > 0 ? 2.3 * (1 - Math.exp(-d / 11)) : 0;
  return plain + shivalik + himalaya;
}

/** Low-level moist inflow from the SE; returns upslope component (0..~1). */
export function upslope(x: number, y: number) {
  const gx = (elevation(x + 1, y) - elevation(x - 1, y)) / 2;
  const gy = (elevation(x, y + 1) - elevation(x, y - 1)) / 2;
  const u = -0.55, v = 0.83;
  return Math.max(0, (u * gx + v * gy) * 9);
}
