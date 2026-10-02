// Reads precomputed replay packages. The app computes no forecasts: every value
// on screen comes from these files (app build spec §5).

export type Hazard = "lightning" | "hail" | "downburst" | "cloudburst";
export type Mode = "all" | "noradar" | "satonly";
export type Audience = "aviation" | "district" | "farmers";
export type Tier = "full" | "partial" | "none";

export const HAZARDS: Hazard[] = ["lightning", "hail", "downburst", "cloudburst"];
export const HAZARD_LABEL: Record<Hazard, string> = {
  lightning: "Lightning density",
  hail: "Hail",
  downburst: "Downburst",
  cloudburst: "Cloudburst",
};
/** Letter carried on every hazard mark so colour is never the only cue. */
export const HAZARD_MARK: Record<Hazard, string> = {
  lightning: "L", hail: "H", downburst: "D", cloudburst: "C",
};
export const MODE_LABEL: Record<Mode, string> = {
  all: "All sources",
  noradar: "No radar",
  satonly: "Satellite only",
};
export const AUDIENCE_LABEL: Record<Audience, string> = {
  aviation: "Aviation", district: "District", farmers: "Farmers",
};

export interface Site {
  id: string; name: string; kind: "airport" | "city";
  lon: number; lat: number; weight: number;
}

export interface Meta {
  event: string;
  /** The SEVIR event this package was built from; differs from `event` when the
   *  grid has been georeferenced somewhere else. */
  source_event?: string;
  created_utc?: string;
  event_type: string | null;
  dataset: string;
  start_utc: string;
  step_min: number;
  n_frames: number;
  analysis_frames: number[];
  /** Frames for which cells/<f>.json exists — every 5 min frame, where the package has them. */
  cell_frames?: number[];
  /** Frames for which relief/<f>.json exists. */
  relief_frames?: number[];
  modes: Mode[];
  radars_km: number[][];
  grid: { size: number; km_per_px: number };
  /** Top-left, top-right, bottom-right, bottom-left — what a MapLibre image source takes. */
  corners: [[number, number], [number, number], [number, number], [number, number]];
  bbox: [number, number, number, number];
  badges: string[];
  coverage: { source: string; share: Partial<Record<Tier, number>> };
  sites: Site[];
  ml_horizon_min: number;
  availability: Record<string, boolean>;
  hazard_ranges: Record<string, { min: number; max: number; units: string }>;
  core_threshold_kgm2: number;
  notes: Record<string, string>;
  /** Present when the grid is drawn somewhere other than where the storm happened. */
  relocated?: {
    where: string;
    centre: [number, number];
    what_moved: string;
    what_did_not: string;
  } | null;
}

export interface Arrival {
  site: string; name: string; kind: string; lon: number; lat: number;
  p: number; start_min: number; end_min: number; median_min: number;
  cell: number; hazards: Partial<Record<Hazard, number>>;
}

export interface CiCandidate {
  score: number; lon: number; lat: number;
  reasons: { feature: string; effect: number }[];
}

export interface CellProps {
  id: number; parents: number[]; children: number[];
  first_min: number; vil_max_kgm2: number; area_km2: number; core_area_km2: number;
  tier: Tier; hazards: Partial<Record<Hazard, number>>;
  track: [number, number][];
  /** [minute from event start, peak VIL kg/m²] up to the analysis time. */
  vil_series: [number, number][];
  cone: number[][][] | null;
}

export interface Frame {
  analysis_frame: number;
  time_utc: string;
  leads_min: number[];
  cells: { type: "FeatureCollection"; features: { type: "Feature"; geometry: any; properties: CellProps }[] };
  arrivals: Arrival[];
  initiation: CiCandidate[];
  modes: Record<Mode, { vil_max_kgm2: number; lightning_max: number; accum_max_mm: number; p_ge_100mm_max: number }>;
}

export interface Alert {
  id: string; sent_utc: string; analysis_frame: number;
  audience: Audience; hazard: Hazard;
  site: string; site_name: string; lon: number; lat: number;
  p: number; p_arrival: number; start_min: number; end_min: number;
  severity: number; tier: Tier; threshold: number; cell: number;
  cap_xml: string; sms: Record<string, string>;
}

export interface VerifyRow {
  alert: string; audience: Audience; hazard: Hazard; site_name: string;
  outcome: "hit" | "miss" | "false_alarm";
  observed_first_min: number | null;
  lead_min_achieved: number | null;
}

export interface Verification {
  threshold_kgm2: number;
  note: string;
  alerts: VerifyRow[];
  summary: { n: number; hits: number; false_alarms: number; median_lead_min: number | null };
}

/** cells/<frame>.json — the tracked cells at one 5 min frame. The model runs every
 *  20 min; the tracker runs on observed radar every 5 min, so the storm objects
 *  advance between analysis times. */
export interface CellFrame {
  frame: number;
  time_utc: string;
  cells: Frame["cells"];
}

/** relief/<frame>.json — closed contours of the observed VIL field, one polygon per
 *  level, each carrying the height and colour that level is drawn at. */
export interface ReliefFrame {
  frame: number;
  time_utc: string;
  levels_kgm2: number[];
  metres_per_kgm2: number;
  source: string;
  contours: {
    type: "FeatureCollection";
    features: {
      type: "Feature";
      geometry: { type: "Polygon"; coordinates: number[][][] };
      properties: { level_kgm2: number; height_m: number; colour: string };
    }[];
  };
}

/** tracks.json — where the forecast put the storm, written by export.build_tracks. */
export interface TrackLead {
  lead_min: number;
  median_error_km: number | null;
  max_error_km: number | null;
  /** Matched forecast cell area over observed: well above 1 is a merge, not a displacement. */
  median_area_ratio: number | null;
  n_matched: number;
  n_observed_alive: number;
  per_cell: { id: number; error_km: number; area_ratio: number }[];
}

export interface Tracks {
  event: string; mode: string; km_per_px: number; method: string; note: string;
  lead_min: number[];
  median_error_km: (number | null)[];
  median_area_ratio: (number | null)[];
  p90_error_km: (number | null)[];
  /** Share of still-living observed cells the forecast also has, per lead. */
  matched_share: (number | null)[];
  n_scored: number[];
  frames: {
    analysis_frame: number; time_utc: string;
    n_analysis_cells: number; cells: number[]; leads: TrackLead[];
  }[];
  summary: {
    n_analysis_frames: number; n_cell_forecasts: number;
    median_error_km_all_leads: number | null;
    median_area_ratio_all_leads: number | null;
  };
}

/** observed.json — what actually happened, written by export.build_observed. */
export interface ObsFrame {
  frame: number; time_utc: string;
  peak_kgm2: number; area_km2: number; core_area_km2: number;
  /** Coldest 10.7 µm cloud top in the tile, °C, and how much it cooled in 10 min. */
  ctt_min_c: number; ctt_area_lt_minus50_km2: number; ctt_cooling_c_per_10min: number;
  /** Observed GLM flash density — a different scale from the forecast layer. */
  flash_density_max: number; flash_area_km2: number;
  flash_change_per_10min: number | null;
}

export interface ObsForecast {
  analysis_frame: number; predicted_arrival_min: number; window_min: [number, number];
  p: number; observed_arrival_min: number | null;
  error_min: number | null; in_window: boolean | null;
}

export interface ObsSite {
  site: string; name: string; kind: string;
  observed_first_min: number | null; observed_peak_kgm2: number;
  forecasts: ObsForecast[];
  median_error_min: number | null; median_abs_error_min: number | null;
}

export interface Observed {
  event: string; threshold_kgm2: number; core_threshold_kgm2: number; box_km: number;
  note: string;
  ir_range_c: [number, number];
  lght_range: [number, number];
  lght_note: string;
  frames: ObsFrame[];
  sites: ObsSite[];
  summary: {
    n_forecasts: number; median_error_min: number | null;
    median_abs_error_min: number | null; in_window_share: number | null;
  };
}

/** xai.json — exact SHAP values from the gradient-boosted cell models. */
export interface XaiHazard {
  p: number;
  base_log_odds: number;
  contrib: Record<string, number>;
}

export interface XaiCell {
  values: Record<string, number>;
  hazards: Record<string, XaiHazard>;
}

export interface Xai {
  event: string;
  features: string[];
  radar_features: string[];
  units: string;
  note: string;
  caveats: string[];
  gain: Record<string, Record<string, number>>;
  frames: Record<string, { cells: Record<string, XaiCell> }>;
}

export interface EventRow {
  id: string; event_type: string | null; start_utc: string; badges: string[];
}

const API = import.meta.env.VITE_API ?? "";

async function json<T>(url: string): Promise<T> {
  const r = await fetch(`${API}${url}`);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

export const getEvents = () => json<{ events: EventRow[] }>("/api/events");
export const getMeta = (id: string) => json<Meta>(`/api/events/${id}/meta`);
export const getFrame = (id: string, a: number) => json<Frame>(`/api/events/${id}/frames/${a}`);
export const getAlerts = (id: string) => json<{ alerts: Alert[] }>(`/api/events/${id}/alerts`);
export const getVerification = (id: string) => json<Verification>(`/api/events/${id}/verification`);
export const getXai = (id: string) => json<Xai>(`/api/events/${id}/xai`);
export const getObserved = (id: string) => json<Observed>(`/api/events/${id}/observed`);
export const getTracks = (id: string) => json<Tracks>(`/api/events/${id}/tracks`);
export const getCells = (id: string, f: number) =>
  json<CellFrame>(`/api/events/${id}/cells/${f}`);
export const getRelief = (id: string, f: number) =>
  json<ReliefFrame>(`/api/events/${id}/relief/${f}`);
export const getResults = () => json<Record<string, any>>("/api/results");

/** The API surface the System screen lists, and the one call it times. */
export const ENDPOINTS: { method: string; path: string; what: string }[] = [
  { method: "GET", path: "/api/events", what: "the replay index" },
  { method: "GET", path: "/api/events/{id}/meta", what: "grid, sites, coverage, availability" },
  { method: "GET", path: "/api/events/{id}/frames/{a}", what: "cells, tracks, cones, arrivals" },
  { method: "GET", path: "/api/events/{id}/alerts", what: "CAP 1.2 + SMS per audience" },
  { method: "GET", path: "/api/events/{id}/verification", what: "alert outcomes" },
  { method: "GET", path: "/api/events/{id}/observed", what: "observed intensity, arrival error" },
  { method: "GET", path: "/api/events/{id}/cells/{f}", what: "tracked cells at one 5 min frame" },
  { method: "GET", path: "/api/events/{id}/relief/{f}", what: "VIL contours for the 3-D relief" },
  { method: "GET", path: "/api/events/{id}/tracks", what: "object track error per lead" },
  { method: "GET", path: "/api/events/{id}/xai", what: "SHAP attributions per cell" },
  { method: "GET", path: "/api/results", what: "every eval/results/*.json" },
  { method: "WS", path: "/ws/replay/{id}", what: "the replay clock" },
  { method: "GET", path: "/files/{id}/...", what: "hazard, coverage and observed rasters" },
];

/** Round-trip time of one real request, for the System screen. No synthetic number. */
export async function pingApi(): Promise<number> {
  const t0 = performance.now();
  const r = await fetch(`${API}/api/events`, { cache: "no-store" });
  await r.arrayBuffer();
  return performance.now() - t0;
}

/** Raster overlay written by export.build_replay for one analysis time and mode. */
export function rasterUrl(id: string, a: number, mode: Mode, layer: string, lead: number) {
  return `${API}/files/${id}/hazards/${a}/${mode}/${layer}_${lead}.png`;
}

export const coverageUrl = (id: string) => `${API}/files/${id}/coverage.png`;

/** Observed source rasters at one frame — what the model was fed, as it was fed it. */
export type ObsLayer = "vil" | "ir107" | "lght";
export const obsUrl = (id: string, frame: number, layer: ObsLayer = "vil") =>
  `${API}/files/${id}/obs/${layer === "vil" ? "" : `${layer}_`}${frame}.png`;

/** The replay clock. The server owns playback; the client interpolates between ticks. */
export function openClock(
  id: string,
  speed: number,
  onTick: (m: { t_min: number; playing: boolean; speed: number; end: boolean }) => void,
): WebSocket | null {
  try {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const host = API ? API.replace(/^https?:\/\//, "") : location.host;
    const ws = new WebSocket(`${proto}://${host}/ws/replay/${id}?speed=${speed}`);
    ws.onmessage = (e) => {
      try { onTick(JSON.parse(e.data)); } catch { /* ignore a malformed tick */ }
    };
    return ws;
  } catch {
    return null;
  }
}
