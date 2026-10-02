// Storm relief. SEVIR carries no volumetric radar, so there is no 3-D storm to
// render and none is faked: what is drawn is the tracked cell footprint raised in
// proportion to its column-integrated VIL — a 2-D radar product shown in relief,
// rotatable and pitchable. The caption on screen says exactly that.

import { useEffect, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike, Map as MlMap } from "maplibre-gl";

import { HAZARDS, HAZARD_LABEL, HAZARD_MARK } from "../api";
import { one, pct } from "../fmt";
import { offlineStyle, regionFor } from "../map/basemap";
import { analysisAt, cellsAt, frameAt, gated, useStore } from "../store";

/** Drawing scale only. Stated on screen so nobody reads relief as altitude. */
const METRES_PER_KGM2 = 420;

export default function Explorer3D() {
  const railL = useStore((s) => s.railL);
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const selectedCell = useStore((s) => s.selectedCell);
  const selectCell = useStore((s) => s.selectCell);
  const setScreen = useStore((s) => s.setScreen);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  // The relief follows the 5 min tracked cells, not the 20 min analysis times.
  const objects = cellsAt();
  const cells = objects
    ? [...objects.features].sort((x, y) => y.properties.vil_max_kgm2 - x.properties.vil_max_kgm2)
    : [];
  const sel = cells.find((f) => f.properties.id === selectedCell) ?? cells[0];
  const next = frame ? [...frame.arrivals].sort((x, y) => x.median_min - y.median_min)[0] : undefined;

  return (
    // No right rail on this screen: the relief wants the width.
    <div className={`screen-map no-rail-r${railL ? "" : " no-rail-l"}`}>
      {railL && (
        <aside className="rail-l" aria-label="Storm volume">
          <section className="panel">
            <div className="panel-head">
              <span>Cells at this analysis</span>
              <span className="chip warn" title="Relief is a drawing of a 2-D product, not a measured volume">RELIEF</span>
            </div>
            <div className="panel-body">
              {cells.length === 0 && <p className="hint">No cell above the detection threshold.</p>}
              <div className="chip-row">
                {cells.map((f) => (
                  <button key={f.properties.id} className="chip"
                    aria-pressed={f.properties.id === sel?.properties.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => selectCell(f.properties.id)}>
                    <span className="num">{f.properties.id}</span>
                    {" · "}
                    <span className="num">{one(f.properties.vil_max_kgm2)}</span>
                  </button>
                ))}
              </div>
              {cells.length > 0 && <p className="hint" style={{ marginTop: 6 }}>cell · peak VIL kg/m²</p>}
            </div>
          </section>
  
          {sel && (
            <section className="panel">
              <div className="panel-head"><span>Cell {sel.properties.id}</span></div>
              <div className="panel-body">
                <div className="kv">
                  <span className="k">Peak VIL</span>
                  <span className="num">{one(sel.properties.vil_max_kgm2)} kg/m²</span>
                </div>
                <div className="kv">
                  <span className="k">Relief height</span>
                  <span className="num">
                    {(sel.properties.vil_max_kgm2 * METRES_PER_KGM2 / 1000).toFixed(1)} km drawn
                  </span>
                </div>
                <div className="kv">
                  <span className="k">Footprint</span>
                  <span className="num">{sel.properties.area_km2} km²</span>
                </div>
                <div className="kv">
                  <span className="k">Core ≥ {meta?.core_threshold_kgm2} kg/m²</span>
                  <span className="num">{sel.properties.core_area_km2} km²</span>
                </div>
                <div className="kv">
                  <span className="k">First seen</span>
                  <span className="num">T+{sel.properties.first_min} min</span>
                </div>
                <div className="kv">
                  <span className="k">Radar coverage</span>
                  <span>{sel.properties.tier === "none" ? "no radar" : sel.properties.tier}</span>
                </div>
                {HAZARDS.filter((h) => gated(h, sel.properties.tier, sel.properties.hazards[h]))
                  .map((h) => (
                    <div className="reason" key={h}>
                      <span className={`dot ${h}`} aria-hidden="true">{HAZARD_MARK[h]}</span>
                      <span style={{ flex: 1 }}>{HAZARD_LABEL[h]}</span>
                      <span className="num">{pct(sel.properties.hazards[h]!)}</span>
                    </div>
                  ))}
              </div>
            </section>
          )}
  
          <section className="panel">
            <div className="panel-head"><span>Why there are no altitude slices</span></div>
            <div className="panel-body hint">
              An altitude-slice inspector needs a radar volume — elevation sweeps or a gridded
              3-D reflectivity product. SEVIR provides vertically integrated liquid and two IR
              channels, all single-layer, so no slice exists to show and none is drawn.
              A Doppler volume from a DWR archive would fill this panel.
            </div>
          </section>
        </aside>
      )}

      <main className="map-area">
        <ReliefMap />
        <div className="relief-caption">
          <span>observed VIL in relief, thirty shells</span>
          <span className="ticker-sep">·</span>
          <span className="num">height = VIL × {METRES_PER_KGM2} m per kg/m²</span>
          <span className="ticker-sep">·</span>
          <span>drawing scale, not cloud-top altitude</span>
          <span className="ticker-sep">·</span>
          <span className="hint">drag to rotate, scroll to zoom</span>
        </div>

        {next && (
          <div className="callout">
            <div className="callout-site">{next.name}</div>
            <div className="kv">
              <span className="k">Expected arrival</span>
              <span className="num">{next.median_min} min</span>
            </div>
            <div className="kv">
              <span className="k">Arrival probability</span>
              <span className="num">{pct(next.p)}</span>
            </div>
            {HAZARDS.filter((h) => next.hazards[h] !== undefined).slice(0, 2).map((h) => (
              <div className="kv" key={h}>
                <span className="k">{HAZARD_LABEL[h]}</span>
                <span className="num">{pct(next.hazards[h]!)}</span>
              </div>
            ))}
            <button className="btn" style={{ marginTop: 8 }} onClick={() => setScreen("explain")}>
              Why this rating
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function ReliefMap() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const orbit = useRef(false);
  const [orbiting, setOrbiting] = useState(false);

  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const cellStore = useStore((s) => s.cells);
  const tMin = useStore((s) => s.tMin);
  const selectedCell = useStore((s) => s.selectedCell);

  useEffect(() => {
    if (!box.current || !meta) return;
    const [w, s, e, n] = meta.bbox;
    const m = new maplibregl.Map({
      container: box.current,
      style: offlineStyle(regionFor((w + e) / 2, (s + n) / 2)),
      bounds: [[w, s], [e, n]] as LngLatBoundsLike,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      pitch: 55,
      bearing: -20,
      maxZoom: 12,
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.current = m;
    ready.current = false;

    // Orbit: the camera turns, the storm does not. The data steps every five
    // minutes and nothing between those steps is invented, so this is view motion
    // and nothing else — it is what makes a relief read as a solid. Any touch of
    // the map stops it, because an operator dragging to look at a cell should not
    // have the camera pulling away under them.
    const stop = () => { orbit.current = false; setOrbiting(false); };
    m.on("dragstart", stop);
    m.on("wheel", stop);

    m.on("load", () => {
      const empty = { type: "FeatureCollection" as const, features: [] };
      // The storm body: thirty translucent shells of the VIL field, each raised to
      // its own level, which compose into a soft mass — pale where the cloud is
      // thin, warm through the cores. Not one slab per cell, which says nothing
      // about shape, and not columns of the grid, which read as a wall of blocks.
      m.addSource("relief", { type: "geojson", data: empty });
      m.addLayer({
        id: "relief", type: "fill-extrusion", source: "relief",
        paint: {
          "fill-extrusion-color": ["get", "colour"],
          "fill-extrusion-height": ["get", "height_m"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 1,
          // Off: the gradient darkens each shell's side, which turns the stack back
          // into a flight of contour lines. Flat sides let the shells blend.
          "fill-extrusion-vertical-gradient": false,
        },
      });

      // The tracked cells stay, as a footprint on the ground: that is what carries
      // the id, the hazards and the selection.
      m.addSource("relief-cells", { type: "geojson", data: empty });
      m.addLayer({
        id: "relief-cells", type: "line", source: "relief-cells",
        paint: {
          "line-color": ["case", ["get", "selected"], "#4fd1c5", "#7f93a4"],
          "line-width": ["case", ["get", "selected"], 2.2, 1],
          // Faint: the footprint is for identity and clicking, and it should not
          // draw a bright cage around the storm it belongs to.
          "line-opacity": ["case", ["get", "selected"], 0.9, 0.28],
        },
      });
      m.addSource("relief-track", { type: "geojson", data: empty });
      m.addLayer({
        id: "relief-track", type: "line", source: "relief-track",
        paint: { "line-color": "#8a9ba8", "line-width": 1.6, "line-dasharray": [2, 1.5] },
      });
      m.on("click", "relief-cells", (ev) => {
        const f = ev.features?.[0];
        if (f) useStore.getState().selectCell(f.properties!.id as number);
      });
      m.on("mousemove", (ev) =>
        useStore.getState().setCursor([ev.lngLat.lng, ev.lngLat.lat],
          metresPerPixel(m, ev.lngLat.lat)));
      ready.current = true;
      paint(m);
    });

    return () => { m.remove(); map.current = null; ready.current = false; };
  }, [meta?.event]);

  const reliefStore = useStore((s) => s.relief);
  const ensureRelief = useStore((s) => s.ensureRelief);
  const metaNow = useStore((s) => s.meta);

  useEffect(() => {
    const f = frameAt(metaNow, tMin);
    if (f !== null) { ensureRelief(f); ensureRelief(f + 1); }
  }, [metaNow, tMin, ensureRelief]);

  useEffect(() => {
    if (map.current && ready.current) paint(map.current);
  }, [frames, cellStore, reliefStore, tMin, selectedCell]);

  // One frame of bearing per animation frame while orbiting; 4°/s, slow enough to
  // read the shape and not fast enough to be a carousel.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const m = map.current;
      if (m && orbit.current) m.setBearing(m.getBearing() + 4 * dt);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      <div ref={box} className="maplibregl-map" aria-label="Storm cells in relief" />
      <button
        className="orbit-btn"
        aria-pressed={orbiting}
        onClick={() => { orbit.current = !orbit.current; setOrbiting(orbit.current); }}
        title="Turn the camera slowly around the storm. Dragging the map stops it."
      >
        {orbiting ? "Stop orbit" : "Orbit"}
      </button>
    </>
  );
}

function paint(m: MlMap) {
  const { selectedCell, meta, tMin, relief } = useStore.getState();
  const frame = cellsAt();
  const set = (id: string, data: any) =>
    (m.getSource(id) as maplibregl.GeoJSONSource)?.setData(data);
  const empty = { type: "FeatureCollection", features: [] };

  // The field, where the package has contours for this frame; a package built
  // before they existed falls back to one extrusion per cell.
  const rf = frameAt(meta, tMin);
  const contours = rf === null ? undefined : relief[rf];
  set("relief", contours ? contours.contours : !frame ? empty : {
    type: "FeatureCollection",
    features: frame.features.map((f) => ({
      ...f,
      properties: {
        height_m: f.properties.vil_max_kgm2 * METRES_PER_KGM2,
        colour: f.properties.id === selectedCell ? "#4fd1c5" : "#6f8597",
      },
    })),
  });

  if (!frame) {
    set("relief-cells", empty);
    set("relief-track", empty);
    return;
  }
  set("relief-cells", {
    type: "FeatureCollection",
    features: frame.features.map((f) => ({
      ...f,
      properties: { id: f.properties.id, selected: f.properties.id === selectedCell },
    })),
  });
  set("relief-track", {
    type: "FeatureCollection",
    features: frame.features
      .filter((f) => f.properties.track.length > 1)
      .map((f) => ({
        type: "Feature", properties: { id: f.properties.id },
        geometry: { type: "LineString", coordinates: f.properties.track },
      })),
  });
}

/** Ground resolution at the current zoom, for the meta strip's scale readout. */
export function metresPerPixel(m: MlMap, lat: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, m.getZoom());
}
