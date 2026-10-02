// The map is the instrument. Raster overlays and vector cells come straight from
// the replay package; nothing here computes a forecast.

import { useEffect, useRef } from "react";
import maplibregl, { ImageSource, LngLatBoundsLike, Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { Frame, Hazard, Meta, Mode, coverageUrl, rasterUrl, obsUrl } from "../api";
import { offlineStyle, regionFor } from "../map/basemap";
import { LayerKey, gated, useStore, cellsAt, frameAt } from "../store";

const HAZ_COLOUR: Record<Hazard, string> = {
  lightning: "#f2c53d", hail: "#9b6dff", downburst: "#ff6b5a", cloudburst: "#3da5ff",
};
const RASTERS: { key: LayerKey; layer: string; opacity: number }[] = [
  { key: "vil", layer: "vil", opacity: 0.62 },
  { key: "cloudburst", layer: "cloudburst", opacity: 0.6 },
  { key: "lightning", layer: "lightning", opacity: 0.82 },
];

/** Strongest hazard a cell may show at its coverage tier, for the polygon colour. */
function dominant(props: { hazards: Partial<Record<Hazard, number>>; tier: string }) {
  const show = (["downburst", "hail"] as Hazard[])
    .filter((h) => gated(h, props.tier, props.hazards[h]))
    .sort((a, b) => (props.hazards[b] ?? 0) - (props.hazards[a] ?? 0));
  return show[0] ?? null;
}

export default function MapView() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);

  const meta = useStore((s) => s.meta);
  const eventId = useStore((s) => s.eventId);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const leadMin = useStore((s) => s.leadMin);
  const mode = useStore((s) => s.mode);
  const layers = useStore((s) => s.layers);
  const cellStore = useStore((s) => s.cells);
  const selectedCell = useStore((s) => s.selectedCell);

  // ---- create the map once per event (the basemap region can change) --------
  useEffect(() => {
    if (!box.current || !meta) return;
    const [w, s, e, n] = meta.bbox;
    const region = regionFor((w + e) / 2, (s + n) / 2);
    const m = new maplibregl.Map({
      container: box.current,
      style: offlineStyle(region),
      bounds: [[w, s], [e, n]] as LngLatBoundsLike,
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      dragRotate: false,
      maxZoom: 12,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.current = m;
    ready.current = false;

    m.on("load", () => {
      const coords = meta.corners;

      m.addSource("coverage", { type: "image", url: coverageUrl(meta.event), coordinates: coords });
      m.addLayer({
        id: "coverage", type: "raster", source: "coverage",
        paint: { "raster-opacity": 0.45, "raster-resampling": "nearest" },
      });

      // What the radar is seeing at the replay clock, under the forecast: the
      // observation is sharp and cellular where the model's field is smooth, and
      // the difference between them is the thing a forecaster is judging.
      m.addSource("obs", {
        type: "image",
        url: obsUrl(meta.event, frameAt(meta, useStore.getState().tMin) ?? 0),
        coordinates: coords,
      });
      m.addLayer({
        id: "obs", type: "raster", source: "obs",
        paint: { "raster-opacity": 0.78 },
      });

      for (const r of RASTERS) {
        m.addSource(r.layer, {
          type: "image",
          // Cloudburst is a single 1 h accumulation, not a per-lead field.
          url: rasterUrl(meta.event, meta.analysis_frames[0], "all", r.layer,
            r.layer === "cloudburst" ? 60 : 30),
          coordinates: coords,
        });
        m.addLayer({
          id: r.layer, type: "raster", source: r.layer,
          paint: { "raster-opacity": r.opacity },
        });
      }

      const empty = { type: "FeatureCollection" as const, features: [] };
      for (const id of ["cones", "cells", "tracks", "sites", "initiation"]) {
        m.addSource(id, { type: "geojson", data: empty });
      }

      m.addLayer({
        id: "cones", type: "fill", source: "cones",
        paint: { "fill-color": "#4fd1c5", "fill-opacity": 0.1 },
      });
      m.addLayer({
        id: "tracks", type: "line", source: "tracks",
        paint: { "line-color": "#8a9ba8", "line-width": 1.4, "line-dasharray": [2, 1.5] },
      });
      m.addLayer({
        id: "cells-fill", type: "fill", source: "cells",
        paint: { "fill-color": ["get", "colour"], "fill-opacity": ["get", "fillOpacity"] },
      });
      m.addLayer({
        id: "cells-line", type: "line", source: "cells",
        paint: {
          "line-color": ["get", "colour"],
          "line-width": ["case", ["get", "selected"], 2.4, 1.2],
        },
      });
      m.addLayer({
        id: "cells-label", type: "symbol", source: "cells",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Medium"],
          "text-size": 13,
          "text-allow-overlap": false,
        },
        paint: { "text-color": "#e4ecf2", "text-halo-color": "#0e1419", "text-halo-width": 1.4 },
      });
      m.addLayer({
        id: "initiation", type: "circle", source: "initiation",
        paint: {
          "circle-radius": 7, "circle-color": "#4fd1c5", "circle-opacity": 0.25,
          "circle-stroke-color": "#4fd1c5", "circle-stroke-width": 1.4,
        },
      });
      m.addLayer({
        id: "sites", type: "circle", source: "sites",
        paint: {
          "circle-radius": ["case", ["==", ["get", "kind"], "airport"], 5, 4],
          "circle-color": "#0e1419",
          "circle-stroke-color": ["case", ["get", "selected"], "#4fd1c5", "#e4ecf2"],
          "circle-stroke-width": ["case", ["get", "selected"], 2.4, 1.3],
        },
      });
      m.addLayer({
        id: "sites-label", type: "symbol", source: "sites",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 13,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: { "text-color": "#b9c9d6", "text-halo-color": "#0e1419", "text-halo-width": 1.4 },
      });

      m.on("click", "cells-fill", (ev) => {
        const f = ev.features?.[0];
        if (f) useStore.getState().selectCell(f.properties!.id as number);
      });
      m.on("click", "sites", (ev) => {
        const f = ev.features?.[0];
        if (f) useStore.getState().selectSite(f.properties!.id as string);
      });
      // The pointer position feeds the meta strip; the zoom gives it a scale.
      m.on("mousemove", (ev) => useStore.getState().setCursor(
        [ev.lngLat.lng, ev.lngLat.lat],
        (156543.03392 * Math.cos((ev.lngLat.lat * Math.PI) / 180)) / Math.pow(2, m.getZoom())));
      m.on("mouseout", () => useStore.getState().setCursor(null));

      for (const id of ["cells-fill", "sites"]) {
        m.on("mouseenter", id, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; });
      }
      ready.current = true;
      // Paint immediately rather than waiting for the next clock tick.
      sync(m, meta, useStore.getState().frames, useStore.getState().tMin,
        useStore.getState().leadMin, useStore.getState().mode,
        useStore.getState().layers, useStore.getState().selectedCell,
        useStore.getState().selectedSite);
    });

    return () => { m.remove(); map.current = null; ready.current = false; };
  }, [eventId, meta?.event]);

  // ---- keep sources in step with the replay state --------------------------
  useEffect(() => {
    const m = map.current;
    if (!m || !meta || !ready.current) return;
    sync(m, meta, frames, tMin, leadMin, mode, layers, selectedCell,
      useStore.getState().selectedSite);
  }, [meta, frames, cellStore, tMin, leadMin, mode, layers, selectedCell]);

  return <div ref={box} className="maplibregl-map" aria-label="Hazard map" />;
}

function sync(
  m: MlMap, meta: Meta, frames: Record<number, Frame>, tMin: number, leadMin: number,
  mode: Mode, layers: Record<LayerKey, boolean>, selectedCell: number | null,
  selectedSite: string | null,
) {
  const step = meta.step_min;
  const past = meta.analysis_frames.filter((a) => a * step <= tMin + 1e-6);
  const a = past.length ? past[past.length - 1] : meta.analysis_frames[0];
  const frame = frames[a];

  // Rasters: nearest available lead, and cloudburst is a single 1 h accumulation.
  const leads = frame?.leads_min ?? [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  const nearest = leads.reduce((b, l) => (Math.abs(l - leadMin) < Math.abs(b - leadMin) ? l : b), leads[0]);
  for (const r of RASTERS) {
    const on = layers[r.key] && leadMin <= meta.ml_horizon_min;
    m.setLayoutProperty(r.layer, "visibility", on ? "visible" : "none");
    if (!on) continue;
    const url = rasterUrl(meta.event, a, mode, r.layer, r.layer === "cloudburst" ? 60 : nearest);
    const src = m.getSource(r.layer) as ImageSource | undefined;
    if (src && (src as unknown as { url?: string }).url !== url) {
      src.updateImage({ url, coordinates: meta.corners });
      (src as unknown as { url?: string }).url = url;
    }
  }
  m.setLayoutProperty("coverage", "visibility", layers.coverage ? "visible" : "none");

  // The observed raster follows the 5 min replay frame, not the analysis time.
  const of = frameAt(meta, tMin);
  if (of !== null) {
    const ourl = obsUrl(meta.event, of);
    const osrc = m.getSource("obs") as ImageSource | undefined;
    if (osrc && (osrc as unknown as { url?: string }).url !== ourl) {
      osrc.updateImage({ url: ourl, coordinates: meta.corners });
      (osrc as unknown as { url?: string }).url = ourl;
    }
  }
  m.setLayoutProperty("obs", "visibility", layers.obs ? "visible" : "none");

  const empty = { type: "FeatureCollection" as const, features: [] as any[] };
  const setData = (id: string, data: any) => (m.getSource(id) as maplibregl.GeoJSONSource)?.setData(data);

  // Cells come from the 5 min tracked set where the package has one, so the storm
  // moves between the 20 min analysis times; everything else on the map is tied to
  // the analysis frame, which is when the model last ran.
  const objects = cellsAt();
  if (!frame || !objects) {
    for (const id of ["cells", "tracks", "cones", "initiation"]) setData(id, empty);
  } else {
    const cells = objects.features.filter((f) => {
      const d = dominant(f.properties);
      // A cell whose only hazard is hidden by its tier still shows as a tracked
      // cell; the hazard colour is what the tier gates.
      return layers.cells || (d !== null && layers[d]);
    }).map((f) => {
      const d = dominant(f.properties);
      const show = d && layers[d] ? d : null;
      return {
        ...f,
        properties: {
          ...f.properties,
          colour: show ? HAZ_COLOUR[show] : "#8a9ba8",
          fillOpacity: show ? 0.3 : 0.12,
          selected: f.properties.id === selectedCell,
          label: `${f.properties.id}`,
        },
      };
    });
    setData("cells", { type: "FeatureCollection", features: cells });

    setData("tracks", layers.tracks ? {
      type: "FeatureCollection",
      features: objects.features
        .filter((f) => f.properties.track.length > 1)
        .map((f) => ({
          type: "Feature", properties: { id: f.properties.id },
          geometry: { type: "LineString", coordinates: f.properties.track },
        })),
    } : empty);

    setData("cones", layers.cones ? {
      type: "FeatureCollection",
      features: objects.features
        .filter((f) => f.properties.cone)
        .map((f) => ({
          type: "Feature", properties: { id: f.properties.id },
          geometry: { type: "Polygon", coordinates: f.properties.cone! },
        })),
    } : empty);

    setData("initiation", layers.initiation ? {
      type: "FeatureCollection",
      features: frame.initiation.map((c, i) => ({
        type: "Feature", properties: { score: c.score, id: i },
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      })),
    } : empty);
  }

  m.setLayoutProperty("sites", "visibility", layers.sites ? "visible" : "none");
  m.setLayoutProperty("sites-label", "visibility", layers.sites ? "visible" : "none");
  setData("sites", {
    type: "FeatureCollection",
    features: meta.sites.map((s) => ({
      type: "Feature",
      properties: { id: s.id, name: s.name, kind: s.kind, selected: s.id === selectedSite },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  });
}
