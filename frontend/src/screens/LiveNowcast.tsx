// The main 2D console, and the screen that carries both required outputs: the GIS
// hazard map and the arrival countdowns. Everything drawn here comes from the
// replay package; the only arithmetic in the browser is the countdown subtraction.

import { MODE_LABEL } from "../api";
import { lead as leadLabel, one } from "../fmt";
import { analysisAt, useStore } from "../store";

import AlertFeed from "../console/AlertFeed";
import Countdowns from "../console/Countdowns";
import HazardCards from "../console/HazardCards";
import LayerRail from "../console/LayerRail";
import LocationIntel from "../console/LocationIntel";
import MapView from "../console/MapView";
import Verification from "../console/Verification";

export default function LiveNowcast() {
  const railL = useStore((s) => s.railL);
  const meta = useStore((s) => s.meta);
  const mode = useStore((s) => s.mode);
  const leadMin = useStore((s) => s.leadMin);

  const beyond = meta ? leadMin > meta.ml_horizon_min : false;

  return (
    <div className={`screen-map${railL ? "" : " no-rail-l"}`}>
      {railL && <LayerRail />}

      <main className="map-area">
        <MapView />
        <Ticker />
        <HazardCards />

        <div className="overlay-tr">
          {mode !== "all" && (
            <div className="legend" role="status">
              <strong style={{ fontWeight: 500 }}>{MODE_LABEL[mode]}</strong>
              <div className="hint" style={{ maxWidth: 230, marginTop: 2 }}>
                {mode === "noradar"
                  ? "Radar input removed. The forecast on screen is a real forward pass from satellite and lightning only."
                  : "Radar and lightning both removed. Satellite alone."}
              </div>
            </div>
          )}
          {beyond && (
            <div className="legend" role="status">
              <strong style={{ fontWeight: 500 }}>No forecast at {leadLabel(leadMin)}</strong>
              <div className="hint" style={{ maxWidth: 230, marginTop: 2 }}>
                {meta?.notes.horizon}
              </div>
            </div>
          )}
          {meta && !beyond && (
            // A key for the three raster ramps: swatch and name on the map, the
            // units on hover, in one line rather than three.
            <div className="legend legend-row">
              {(["vil", "lightning", "cloudburst"] as const).map((k) => (
                <span className="row" key={k}
                  title={`${k === "vil" ? "Radar VIL" : k === "lightning" ? "Lightning density"
                    : "Cloudburst accumulation"} — ${meta.hazard_ranges[k]?.units}`}>
                  <i style={{
                    width: 26, height: 7, borderRadius: 1,
                    background: k === "vil"
                      // The same stops as export.build_replay.VIL_RAMP.
                      ? "linear-gradient(90deg, #1b3f5c, #1f8296, #2fa67c, #d6c244, #e07833, #c4333c)"
                      : `linear-gradient(90deg, transparent, var(--${k}))`,
                  }} />
                  <span className="hint">
                    {k === "vil" ? "VIL" : k === "lightning" ? "Lightning" : "Cloudburst"}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </main>

      <aside className="rail-r" aria-label="Countdowns, locations and alerts">
        {/* Once the replay ends, the reveal is the thing to read first. */}
        <Verification />
        <Countdowns />
        <LocationIntel />
        <AlertFeed />
      </aside>
    </div>
  );
}

/** The one-line situation report along the top of the map, built from the frame. */
function Ticker() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  if (!meta || !frame) return null;

  const strongest = [...frame.cells.features]
    .sort((x, y) => y.properties.vil_max_kgm2 - x.properties.vil_max_kgm2)[0];
  if (!strongest) {
    return (
      <div className="ticker" role="status">
        No cell above the detection threshold at this analysis time.
      </div>
    );
  }
  const p = strongest.properties;
  const next = [...frame.arrivals].sort((x, y) => x.median_min - y.median_min)[0];

  return (
    <div className="ticker" role="status">
      <span className="num">Cell {p.id}</span>
      <span className="ticker-sep">·</span>
      <span className="num">{one(p.vil_max_kgm2)} kg/m² peak VIL</span>
      <span className="ticker-sep">·</span>
      <span className="num">{p.core_area_km2} km² core ≥ {meta.core_threshold_kgm2}</span>
      {next && (
        <>
          <span className="ticker-sep">·</span>
          <span>
            next arrival {next.name} in <span className="num">{next.median_min} min</span>
          </span>
        </>
      )}
      <span className="ticker-sep">·</span>
      <span className="hint">Research prototype — not an official warning</span>
    </div>
  );
}
