import { create } from "zustand";
import {
  Alert, Audience, CellFrame, EventRow, Frame, Hazard, Meta, Mode, Observed, ReliefFrame,
  Tracks, Verification, Xai,
  getAlerts, getCells, getEvents, getFrame, getMeta, getObserved, getRelief, getResults,
  getTracks, getVerification, getXai,
} from "./api";


/** One screen per entry; the code is what the nav rail shows and the URL hash carries. */
export type Screen =
  | "overview" | "nowcast" | "explorer" | "timeline" | "fusion"
  | "explain" | "replay" | "validation" | "system";

export const SCREENS: { id: Screen; code: string; name: string; what: string }[] = [
  { id: "overview", code: "OVW", name: "Overview", what: "What this event is and what is computed" },
  { id: "nowcast", code: "NOW", name: "Live nowcast", what: "Hazard map and arrival countdowns" },
  { id: "explorer", code: "3DX", name: "3D storm relief", what: "Cells in relief by column VIL" },
  { id: "timeline", code: "FTM", name: "Forecast timeline", what: "Skill and spread by lead time" },
  { id: "fusion", code: "FUS", name: "Data fusion", what: "Sources in, heads out, source ablation" },
  { id: "explain", code: "XAI", name: "Explain", what: "Why this cell is rated this way" },
  { id: "replay", code: "REP", name: "Storm replay", what: "Forecast against observed radar" },
  { id: "validation", code: "VAL", name: "Validation", what: "Measured skill from eval/results" },
  { id: "system", code: "SYS", name: "System", what: "Sources, pipeline, API, event log" },
];

/** Screens that carry the map and therefore the transport bar. */
export const MAP_SCREENS: Screen[] = ["nowcast", "explorer", "timeline", "replay"];

export type NavState = "open" | "codes" | "hidden";

// The rail's width is a per-viewer preference, so it is remembered in this
// browser and nowhere else. Private windows and blocked site data throw on
// access, and a demo must not die for a sidebar, so both sides are guarded.
const NAV_KEY = "deadlock.nav";
const RAIL_KEY = "deadlock.railL";

function readNav(): NavState {
  try {
    const v = localStorage.getItem(NAV_KEY);
    return v === "codes" || v === "hidden" || v === "open" ? v : "open";
  } catch {
    return "open";
  }
}

function writeNav(n: NavState) {
  try {
    localStorage.setItem(NAV_KEY, n);
  } catch {
    /* no persistence available; the session still works */
  }
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* as above */
  }
}

export interface LogRow { t: number; kind: string; text: string }
export type LayerKey =
  | "obs" | "vil" | "lightning" | "cloudburst" | "hail" | "downburst"
  | "coverage" | "cells" | "tracks" | "cones" | "sites" | "initiation";


interface State {
  screen: Screen;
  /** Screen rail: full width, three-letter codes only, or gone. */
  nav: NavState;
  /** The left panel on the map screens — layers and coverage, or cells in 3-D. */
  railL: boolean;

  events: EventRow[];
  eventId: string | null;
  meta: Meta | null;
  frames: Record<number, Frame>;
  /** Cells at every 5 min frame, keyed by frame. The model runs every 20 min; the
   *  tracker runs every 5, so the storm advances between analysis times. */
  cells: Record<number, CellFrame>;
  /** VIL contours per frame, for the 3-D relief. */
  relief: Record<number, ReliefFrame>;
  alerts: Alert[];
  verification: Verification | null;
  observed: Observed | null;
  tracks: Tracks | null;
  xai: Xai | null;
  results: Record<string, any> | null;
  resultsError: string | null;
  error: string | null;
  log: LogRow[];
  /** Map cursor position, for the meta strip. Set by whichever map has the pointer. */
  cursor: [number, number] | null;
  /** Metres per pixel at the map centre, for the scale readout. */
  mapScale: number | null;
  /** Judge-demo step, or null when the walkthrough is not running. */
  demoStep: number | null;

  /** Replay clock, minutes from the event start. */
  tMin: number;
  playing: boolean;
  speed: number;
  /** Forecast lead shown on the map, minutes. */
  leadMin: number;
  mode: Mode;
  layers: Record<LayerKey, boolean>;

  audience: Audience;
  selectedCell: number | null;
  selectedAlert: string | null;
  selectedSite: string | null;
  sent: Record<string, boolean>;

  setScreen: (s: Screen) => void;
  setNav: (n: NavState) => void;
  setRailL: (v: boolean) => void;
  /** The collapse control: full → codes → full. Hiding is its own control. */
  toggleNav: () => void;
  loadResults: () => void;
  logEvent: (kind: string, text: string) => void;
  setDemoStep: (i: number | null) => void;
  setCursor: (c: [number, number] | null, scale?: number | null) => void;
  load: () => Promise<void>;
  openEvent: (id: string) => Promise<void>;
  ensureFrame: (a: number) => void;
  ensureCells: (f: number) => void;
  ensureRelief: (f: number) => void;
  setClock: (t: number, playing?: boolean) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setLead: (m: number) => void;
  setMode: (m: Mode) => void;
  toggleLayer: (k: LayerKey) => void;
  setAudience: (a: Audience) => void;
  selectCell: (id: number | null) => void;
  selectAlert: (id: string | null) => void;
  selectSite: (id: string | null) => void;
  markSent: (id: string) => void;
}

export const useStore = create<State>((set, get) => ({
  screen: "nowcast",
  nav: readNav(),
  railL: readFlag(RAIL_KEY, true),
  events: [],
  eventId: null,
  meta: null,
  frames: {},
  cells: {},
  relief: {},
  alerts: [],
  verification: null,
  observed: null,
  tracks: null,
  xai: null,
  results: null,
  resultsError: null,
  error: null,
  log: [],
  cursor: null,
  mapScale: null,
  demoStep: null,

  tMin: 0,
  playing: false,
  speed: 20,
  leadMin: 30,
  mode: "all",
  layers: {
    obs: true, vil: true, lightning: true, cloudburst: false, hail: true, downburst: true,
    coverage: true, cells: true, tracks: true, cones: true, sites: true, initiation: true,
  },

  audience: "district",
  selectedCell: null,
  selectedAlert: null,
  selectedSite: null,
  sent: {},

  setScreen: (s) => set({ screen: s }),
  setNav: (n) => { writeNav(n); set({ nav: n }); },
  setRailL: (v) => { writeFlag(RAIL_KEY, v); set({ railL: v }); },
  toggleNav: () => get().setNav(get().nav === "open" ? "codes" : "open"),

  loadResults: () => {
    if (get().results || get().resultsError) return;
    getResults()
      .then((results) => set({ results }))
      .catch((e) => set({ resultsError: `Evaluation files unreachable (${(e as Error).message})` }));
  },

  /** The System screen's feed. Real console events only — nothing scripted. */
  logEvent: (kind, text) =>
    set({ log: [{ t: Date.now(), kind, text }, ...get().log].slice(0, 60) }),

  setDemoStep: (i) => set({ demoStep: i }),

  setCursor: (c, scale) =>
    set(scale === undefined ? { cursor: c } : { cursor: c, mapScale: scale }),

  load: async () => {
    try {
      const { events } = await getEvents();
      set({ events });
      if (events.length && !get().eventId) await get().openEvent(events[0].id);
      else if (!events.length) set({ error: "No replay packages. Run: python -m export.build_replay --auto 1" });
    } catch (e) {
      set({ error: `Replay API unreachable (${(e as Error).message})` });
    }
  },

  openEvent: async (id) => {
    const [meta, alerts, verification, observed, tracks, xai] = await Promise.all([
      getMeta(id),
      getAlerts(id).then((d) => d.alerts).catch(() => [] as Alert[]),
      getVerification(id).catch(() => null),
      getObserved(id).catch(() => null),
      getTracks(id).catch(() => null),
      getXai(id).catch(() => null),
    ]);
    set({
      eventId: id, meta, alerts, verification, observed, tracks, xai, frames: {}, cells: {}, relief: {},
      tMin: meta.analysis_frames[0] * meta.step_min,
      leadMin: Math.min(30, meta.ml_horizon_min),
      selectedCell: null, selectedAlert: null, selectedSite: null, playing: false,
    });
    get().ensureFrame(meta.analysis_frames[0]);
    get().logEvent("replay",
      `Loaded ${id} — ${meta.event_type ?? "event"}, ${meta.n_frames} frames at ${meta.step_min} min. ` +
      (observed ? "Observed rasters present." : "No observed rasters: run export.build_observed."));
  },

  ensureFrame: (a) => {
    const { eventId, frames } = get();
    if (!eventId || frames[a]) return;
    // Mark the slot before awaiting so a fast-advancing clock cannot queue it twice.
    set({ frames: { ...get().frames, [a]: undefined as unknown as Frame } });
    getFrame(eventId, a)
      .then((f) => set({ frames: { ...get().frames, [a]: f } }))
      .catch(() => set({ frames: { ...get().frames, [a]: undefined as unknown as Frame } }));
  },

  ensureCells: (f) => {
    const { eventId, cells, meta } = get();
    if (!eventId || !meta?.cell_frames?.includes(f) || f in cells) return;
    set({ cells: { ...get().cells, [f]: undefined as unknown as CellFrame } });
    getCells(eventId, f)
      .then((c) => set({ cells: { ...get().cells, [f]: c } }))
      .catch(() => set({ cells: { ...get().cells, [f]: undefined as unknown as CellFrame } }));
  },

  ensureRelief: (f) => {
    const { eventId, relief, meta } = get();
    if (!eventId || !meta?.relief_frames?.includes(f) || f in relief) return;
    set({ relief: { ...get().relief, [f]: undefined as unknown as ReliefFrame } });
    getRelief(eventId, f)
      .then((r) => set({ relief: { ...get().relief, [f]: r } }))
      .catch(() => set({ relief: { ...get().relief, [f]: undefined as unknown as ReliefFrame } }));
  },

  setClock: (t, playing) => set(playing === undefined ? { tMin: t } : { tMin: t, playing }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (s) => set({ speed: s }),
  setLead: (m) => set({ leadMin: m }),
  setMode: (m) => {
    if (get().mode !== m) {
      get().logEvent("mode", m === "all" ? "Coverage mode: all sources."
        : m === "noradar" ? "Coverage mode: radar input removed — forward pass from satellite and lightning."
        : "Coverage mode: satellite only — radar and lightning removed.");
    }
    set({ mode: m });
  },
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setAudience: (a) => set({ audience: a }),
  selectCell: (id) => set({ selectedCell: id, selectedAlert: null }),
  selectAlert: (id) => set({ selectedAlert: id }),
  selectSite: (id) => set({ selectedSite: id }),
  markSent: (id) => set({ sent: { ...get().sent, [id]: true } }),
}));

/** The latest analysis time at or before the replay clock. */
export function analysisAt(meta: Meta | null, tMin: number): number | null {
  if (!meta) return null;
  const past = meta.analysis_frames.filter((a) => a * meta.step_min <= tMin + 1e-6);
  return past.length ? past[past.length - 1] : meta.analysis_frames[0];
}

/** The 5 min frame the replay clock stands on. */
export function frameAt(meta: Meta | null, tMin: number): number | null {
  if (!meta) return null;
  return Math.max(0, Math.min(meta.n_frames - 1, Math.floor(tMin / meta.step_min + 1e-6)));
}

/** The cells to draw now: the 5 min tracked set where the package has one, and the
 *  analysis frame's otherwise, so an older package still draws. */
export function cellsAt(): Frame["cells"] | null {
  const { meta, tMin, cells, frames } = useStore.getState();
  const f = frameAt(meta, tMin);
  if (f !== null && cells[f]) return cells[f].cells;
  const a = analysisAt(meta, tMin);
  return a !== null && frames[a] ? frames[a].cells : null;
}

export function currentFrame(): Frame | null {
  const { meta, tMin, frames } = useStore.getState();
  const a = analysisAt(meta, tMin);
  return a === null ? null : frames[a] ?? null;
}

/** Hazards the coverage tier allows on screen (pipeline.hazards.gate, display side). */
export function gated(hazard: Hazard, tier: string, p: number | undefined): boolean {
  if (p === undefined) return false;
  if (hazard !== "downburst") return true;
  if (tier === "none") return false;
  return tier === "partial" ? p >= 0.5 : true;
}
