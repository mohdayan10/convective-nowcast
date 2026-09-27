import { useEffect, useRef, useState } from "react";
import maplibregl, { CanvasSource, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { OFFLINE_BOUNDS, demTiles, offlineStyle } from "./basemap";
import "maplibre-gl/dist/maplibre-gl.css";

import { BBOX, GRID_CORNERS, NX, NY, fromLngLat, toLngLat } from "../model/grid";
import {
  Grids, Layer, Mode, ciObjects, gridsFor, statesAt, strikes, truthState,
} from "../model/physics";
import { SITES, STORMS, Site, stormById } from "../model/scenario";
import { HAZARD_COLOR, contour, paint } from "./raster";
import type { Hazard } from "../model/scenario";

export type Selection = { kind: "storm"; id: number } | { kind: "site"; id: string } | null;

export interface Overlays { cells: boolean; exposure: boolean; contours: boolean }

interface Props {
  t: number;
  lead: number;
  mode: Mode;
  layers: Set<Layer>;
  overlays: Overlays;
  terrainOn: boolean;
  view3d: boolean;
  selected: Selection;
  onSelect: (s: Selection) => void;
  /** site id → hazard currently alerted for the chosen audience */
  alerting: Map<string, Hazard>;
  onReadout: (r: Readout | null) => void;
}

export interface Readout {
  x: number;
  y: number;
  px: number;
  py: number;
  values: Partial<Record<Layer, number>>;
}

const RASTER_LAYERS: Layer[] = ["ir", "vil", "lightning", "hail", "downburst", "cloudburst"];
const HAZARD_LAYERS = ["hail", "downburst", "cloudburst"] as const;

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const SITE_ICON: Record<Site["kind"], string> = {
  airport: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  district: '<path d="M3 22h18M6 18v-7m4 7v-7m4 7v-7m4 7v-7M12 2l8 5H4z"/>',
  town: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M6 12H4a2 2 0 0 0-2 2v8h20v-8a2 2 0 0 0-2-2h-2M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  farms: '<path d="M2 22 16 8M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94zM7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94zM11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94zM20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4z"/>',
};

export default function MapView(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const canvases = useRef(new Map<Layer, HTMLCanvasElement>());
  const grids = useRef<Grids>({});
  const siteMarkers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLDivElement }>());
  const cellMarkers = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLDivElement }>());
  const propsRef = useRef(p);
  propsRef.current = p;

  // ---- init ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled || !host.current) return;
      const style = offlineStyle();
      const m = new maplibregl.Map({
        container: host.current,
        style,
        bounds: [[BBOX.west, BBOX.south], [BBOX.east, BBOX.north]],
        fitBoundsOptions: { padding: 24 },
        maxBounds: [[OFFLINE_BOUNDS[0] - 0.3, OFFLINE_BOUNDS[1] - 0.25], [OFFLINE_BOUNDS[2] + 0.3, OFFLINE_BOUNDS[3] + 0.25]],
        minZoom: 7.2,
        attributionControl: { compact: true },
        maxPitch: 70,
      });
      map.current = m;
      if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

      m.on("load", () => {
        const baseLayers = m.getStyle().layers;
        const firstSymbol = baseLayers.find((l) => l.type === "symbol")?.id;
        // Recede basemap labels so exposure sites and cells read first.
        for (const l of baseLayers)
          if (l.type === "symbol") m.setPaintProperty(l.id, "text-opacity", 0.55);
        m.addSource("dem-hs", demTiles());
        m.addSource("dem-3d", demTiles());
        m.addLayer({
          id: "hillshade", type: "hillshade", source: "dem-hs",
          paint: {
            "hillshade-exaggeration": 0.55,
            "hillshade-shadow-color": "#02050a",
            "hillshade-highlight-color": "#3a4a5e",
            "hillshade-accent-color": "#0c1520",
          },
        }, firstSymbol);

        m.addSource("domain", {
          type: "geojson",
          data: {
            type: "Feature", properties: {},
            geometry: { type: "Polygon", coordinates: [[...GRID_CORNERS, GRID_CORNERS[0]]] },
          },
        });
        m.addLayer({ id: "domain", type: "line", source: "domain", paint: { "line-color": "#7dd3c0", "line-opacity": 0.35, "line-width": 1, "line-dasharray": [4, 3] } }, firstSymbol);

        for (const l of RASTER_LAYERS) {
          const c = document.createElement("canvas");
          c.width = NX; c.height = NY;
          canvases.current.set(l, c);
          m.addSource(`r-${l}`, { type: "canvas", canvas: c, coordinates: GRID_CORNERS, animate: false });
          m.addLayer({
            id: `r-${l}`, type: "raster", source: `r-${l}`,
            layout: { visibility: "none" },
            paint: {
              "raster-opacity": l === "ir" ? 0.85 : 0.9,
              "raster-resampling": l === "ir" || l === "vil" || l === "lightning" ? "linear" : "nearest",
              "raster-fade-duration": 0,
            },
          }, firstSymbol);
        }

        m.addSource("contours", { type: "geojson", data: EMPTY_FC });
        m.addLayer({
          id: "contours", type: "line", source: "contours",
          paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-opacity": 0.95 },
        });

        m.addSource("exposure", { type: "geojson", data: exposureGeo() });
        m.addLayer({
          id: "farms-fill", type: "fill", source: "exposure", filter: ["==", ["get", "kind"], "farms"],
          paint: { "fill-color": "#9bd17a", "fill-opacity": 0.08 },
        });
        m.addLayer({
          id: "farms-line", type: "line", source: "exposure", filter: ["==", ["get", "kind"], "farms"],
          paint: { "line-color": "#9bd17a", "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [2, 2] },
        });
        m.addLayer({
          id: "route-casing", type: "line", source: "exposure", filter: ["==", ["get", "kind"], "route"],
          paint: { "line-color": "#05080d", "line-width": 5, "line-opacity": 0.7 },
        });
        m.addLayer({
          id: "route", type: "line", source: "exposure", filter: ["==", ["get", "kind"], "route"],
          paint: { "line-color": "#f1e6c8", "line-width": 2, "line-opacity": 0.9, "line-dasharray": [3, 1.5] },
        });

        m.addSource("cones", { type: "geojson", data: EMPTY_FC });
        m.addLayer({ id: "cones", type: "fill", source: "cones", paint: { "fill-color": "#e6edf6", "fill-opacity": 0.07 } });
        m.addLayer({ id: "cones-edge", type: "line", source: "cones", paint: { "line-color": "#e6edf6", "line-opacity": 0.35, "line-width": 1, "line-dasharray": [2, 2] } });
        m.addSource("tracks", { type: "geojson", data: EMPTY_FC });
        m.addLayer({
          id: "track-past", type: "line", source: "tracks", filter: ["==", ["get", "kind"], "past"],
          paint: { "line-color": "#e6edf6", "line-width": 2, "line-opacity": 0.55 },
        });
        m.addLayer({
          id: "track-fc", type: "line", source: "tracks", filter: ["==", ["get", "kind"], "forecast"],
          paint: { "line-color": "#e6edf6", "line-width": 2, "line-opacity": 0.9, "line-dasharray": [1.5, 1.5] },
        });
        m.addLayer({
          id: "track-ticks", type: "circle", source: "tracks", filter: ["==", ["get", "kind"], "tick"],
          paint: { "circle-radius": 2.5, "circle-color": "#0b1119", "circle-stroke-color": "#e6edf6", "circle-stroke-width": 1.2 },
        });

        m.addSource("strikes", { type: "geojson", data: EMPTY_FC });
        m.addLayer({
          id: "strikes", type: "circle", source: "strikes",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 1.8, 11, 3.5],
            "circle-color": HAZARD_COLOR.lightning,
            "circle-stroke-color": "#05080d", "circle-stroke-width": 0.8,
            "circle-opacity": ["get", "a"],
          },
        });

        m.on("mousemove", (e) => {
          const [x, y] = fromLngLat(e.lngLat.lng, e.lngLat.lat);
          if (x < 0 || y < 0 || x >= NX || y >= NY) return propsRef.current.onReadout(null);
          const c = Math.floor(x), r = NY - 1 - Math.floor(y);
          const values: Partial<Record<Layer, number>> = {};
          for (const [k, g] of Object.entries(grids.current) as [Layer, Float32Array][]) values[k] = g[r * NX + c];
          propsRef.current.onReadout({ x, y, px: e.point.x, py: e.point.y, values });
        });
        m.on("mouseout", () => propsRef.current.onReadout(null));
        m.on("click", (e) => {
          if (!(e.originalEvent.target as HTMLElement).closest(".mk")) propsRef.current.onSelect(null);
        });

        createSiteMarkers(m);
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createSiteMarkers(m: MlMap) {
    for (const s of SITES) {
      const el = document.createElement("div");
      el.className = `mk site site-${s.kind}${s.labelLeft ? " left" : ""}`;
      el.innerHTML = `<span class="site-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SITE_ICON[s.kind]}</svg></span><span class="site-label">${s.short}</span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        propsRef.current.onSelect({ kind: "site", id: s.id });
      });
      const m1 = new maplibregl.Marker({ element: el, anchor: s.labelLeft ? "right" : "left", offset: [s.labelLeft ? 11 : -11, 0] })
        .setLngLat(toLngLat(s.x, s.y))
        .addTo(m);
      siteMarkers.current.set(s.id, { m: m1, el });
    }
  }

  // ---- data updates ----------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const { t, lead, mode, layers, overlays } = p;
    const lightningOn = layers.has("lightning") && mode !== "satonly";
    // Observed lightning is drawn as strikes; the density raster is the forecast product.
    const eff = new Set<Layer>([...layers].filter((l) => l !== "lightning" || (lightningOn && lead > 0)));
    const need = new Set<Layer>([...eff, "vil", "hail", "downburst", "cloudburst"]);
    const g = gridsFor(t, lead, mode, need);
    grids.current = g;

    const repaint: CanvasSource[] = [];
    for (const l of RASTER_LAYERS) {
      const vis = eff.has(l);
      m.setLayoutProperty(`r-${l}`, "visibility", vis ? "visible" : "none");
      const grid = g[l];
      if (!vis || !grid) continue;
      const c = canvases.current.get(l)!;
      paint(c.getContext("2d")!, grid, l);
      repaint.push(m.getSource(`r-${l}`) as CanvasSource);
    }
    // Canvas sources re-upload only while playing; run one frame, then stop.
    for (const src of repaint) src.play();
    requestAnimationFrame(() => requestAnimationFrame(() => repaint.forEach((src) => src.pause())));

    // Hazard zones: p = 0.5 contour for every visible hazard layer.
    const feats: GeoJSON.Feature[] = [];
    if (overlays.contours)
      for (const h of HAZARD_LAYERS) {
        if (!eff.has(h) || !g[h]) continue;
        feats.push({
          type: "Feature", properties: { color: HAZARD_COLOR[h] },
          geometry: { type: "MultiLineString", coordinates: contour(g[h]!, 0.5) },
        });
      }
    (m.getSource("contours") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });

    // Lightning strikes: last 5 min, observed only.
    const st = lead === 0 && lightningOn ? strikes(t, mode) : [];
    const prev = lead === 0 && lightningOn ? strikes(t - 5, mode) : [];
    (m.getSource("strikes") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        ...prev.map(([x, y]) => ({ type: "Feature" as const, properties: { a: 0.35 }, geometry: { type: "Point" as const, coordinates: toLngLat(x, y) } })),
        ...st.map(([x, y]) => ({ type: "Feature" as const, properties: { a: 1 }, geometry: { type: "Point" as const, coordinates: toLngLat(x, y) } })),
      ],
    });

    for (const id of ["farms-fill", "farms-line", "route", "route-casing"])
      m.setLayoutProperty(id, "visibility", overlays.exposure ? "visible" : "none");
    for (const { el } of siteMarkers.current.values()) el.style.display = overlays.exposure ? "" : "none";

    updateTracks(m);
    updateCellMarkers(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.t, p.lead, p.mode, p.layers, p.overlays, p.terrainOn, p.selected]);

  function updateTracks(m: MlMap) {
    const { t, mode, overlays, selected } = p;
    const feats: GeoJSON.Feature[] = [];
    const cones: GeoJSON.Feature[] = [];
    if (overlays.cells) {
      for (const s of STORMS) {
        const now = truthState(s, t);
        if (!now || now.phase !== "mature") continue;
        const past: [number, number][] = [];
        for (let k = Math.max(s.tEcho, t - 60); k <= t; k += 5) {
          const q = truthState(s, k);
          if (q) past.push(toLngLat(q.x, q.y));
        }
        // include ancestors' last hour for lineage continuity
        for (const pid of s.parents) {
          const ps = stormById.get(pid)!;
          const seg: [number, number][] = [];
          for (let k = Math.max(ps.tEcho, t - 60); k <= Math.min(ps.tEnd, t); k += 5) {
            const q = truthState(ps, k);
            if (q) seg.push(toLngLat(q.x, q.y));
          }
          if (seg.length > 1) {
            seg.push(toLngLat(now.x, now.y));
            feats.push({ type: "Feature", properties: { kind: "past" }, geometry: { type: "LineString", coordinates: seg } });
          }
        }
        if (past.length > 1) feats.push({ type: "Feature", properties: { kind: "past" }, geometry: { type: "LineString", coordinates: past } });

        const show = !selected || (selected.kind === "storm" && selected.id === s.id) || selected.kind === "site";
        if (!show) continue;
        // Forecast track 0–60 min from this storm's own forecast, with a widening cone.
        const fc: [number, number][] = [];
        const left: [number, number][] = [], right: [number, number][] = [];
        for (let l = 0; l <= 60; l += 10) {
          const f = l === 0 ? now : forecastOf(s.id, t, l, mode);
          if (!f) break;
          fc.push([f.x, f.y]);
          const hw = 1.2 + 0.11 * l;
          left.push(toLngLat(f.x - f.uy * hw, f.y + f.ux * hw));
          right.push(toLngLat(f.x + f.uy * hw, f.y - f.ux * hw));
        }
        if (fc.length > 1) {
          feats.push({ type: "Feature", properties: { kind: "forecast" }, geometry: { type: "LineString", coordinates: fc.map(([x, y]) => toLngLat(x, y)) } });
          fc.slice(1).forEach(([x, y]) => feats.push({ type: "Feature", properties: { kind: "tick" }, geometry: { type: "Point", coordinates: toLngLat(x, y) } }));
          cones.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...left, ...right.reverse(), left[0]]] } });
        }
      }
    }
    (m.getSource("tracks") as GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
    (m.getSource("cones") as GeoJSONSource).setData({ type: "FeatureCollection", features: cones });
  }

  function updateCellMarkers(m: MlMap) {
    const { t, lead, mode, overlays, selected } = p;
    const seen = new Set<string>();
    const put = (key: string, lngLat: [number, number], html: string, cls: string, onClick: () => void) => {
      seen.add(key);
      let e = cellMarkers.current.get(key);
      if (!e) {
        const el = document.createElement("div");
        el.addEventListener("click", (ev) => { ev.stopPropagation(); onClick(); });
        const mk = new maplibregl.Marker({ element: el, anchor: key.startsWith("s") ? "bottom-left" : "center", offset: key.startsWith("s") ? [4, -6] : [0, 0] })
          .setLngLat(lngLat).addTo(m);
        e = { m: mk, el };
        cellMarkers.current.set(key, e);
      }
      e.m.setLngLat(lngLat);
      if (e.el.innerHTML !== html) e.el.innerHTML = html;
      e.el.className = cls;
    };
    if (overlays.cells) {
      const states = lead === 0 ? STORMS.map((s) => truthState(s, t)).filter((s) => s && s.phase === "mature") : statesAt(t, lead, mode).filter((s) => s.I > 12);
      for (const st of states) {
        if (!st) continue;
        const def = stormById.get(st.id)!;
        const sel = selected?.kind === "storm" && selected.id === st.id;
        const lineage = def.parents.length ? `<span class="cell-lin">← ${def.parents.join(", ")}</span>` : "";
        put(`s${st.id}`, toLngLat(st.x, st.y),
          `<span class="cell-id">${lead > 0 ? "~" : ""}${st.id}</span>${lineage}`,
          `mk cell${sel ? " sel" : ""}${lead > 0 ? " fc" : ""}`,
          () => propsRef.current.onSelect({ kind: "storm", id: st.id }));
      }
      for (const ci of ciObjects(t, mode)) {
        const echo = ci.becomes !== undefined && t >= stormById.get(ci.becomes)!.tEcho;
        if (echo) continue;
        const sel = selected?.kind === "storm" && selected.id === ci.id;
        put(`c${ci.id}`, toLngLat(ci.x, ci.y),
          `<span class="ci-ring" style="--s:${ci.score.toFixed(2)}"></span><span class="ci-score">CI ${Math.round(ci.score * 100)}</span>`,
          `mk ci${ci.score >= 0.5 ? " hot" : ""}${sel ? " sel" : ""}`,
          () => propsRef.current.onSelect({ kind: "storm", id: ci.id }));
      }
    }
    for (const [k, e] of cellMarkers.current)
      if (!seen.has(k)) { e.m.remove(); cellMarkers.current.delete(k); }
  }

  // Site highlight: selection + active alert ring.
  useEffect(() => {
    for (const [id, { el }] of siteMarkers.current) {
      const hz = p.alerting.get(id);
      el.classList.toggle("sel", p.selected?.kind === "site" && p.selected.id === id);
      el.classList.toggle("alerting", !!hz);
      el.style.setProperty("--hz", hz ? HAZARD_COLOR[hz] : "transparent");
    }
  }, [p.alerting, p.selected, ready]);

  // 3D terrain
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (p.view3d) {
      m.setTerrain({ source: "dem-3d", exaggeration: 1.5 });
      m.easeTo({ pitch: 62, bearing: -20, duration: 900 });
    } else {
      m.setTerrain(null);
      m.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
  }, [p.view3d, ready]);

  return (
    <div className="map-wrap">
      <div ref={host} className="map" />
    </div>
  );
}

/** One storm's ML forecast state (for tracks); falls back to its successors. */
function forecastOf(id: number, t: number, lead: number, mode: Mode) {
  const all = statesAt(t, lead, mode);
  const own = all.find((s) => s.id === id);
  if (own) return own;
  const kids = all.filter((s) => stormById.get(s.id)!.parents.includes(id));
  return kids.sort((a, b) => b.I - a.I)[0] ?? null;
}

function exposureGeo(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: SITES.filter((s) => s.shape).map((s) => ({
      type: "Feature",
      properties: { kind: s.kind, id: s.id },
      geometry: s.kind === "route"
        ? { type: "LineString", coordinates: s.shape! }
        : { type: "Polygon", coordinates: [[...s.shape!, s.shape![0]]] },
    })),
  };
}
