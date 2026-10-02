// The threatened-location readout. Opens on the site chosen from the countdowns
// or clicked on the map; every figure is that site's row in the current analysis
// frame, plus what the observation files later said about it.

import { HAZARDS, HAZARD_LABEL, HAZARD_MARK } from "../api";
import { pct } from "../fmt";
import { analysisAt, gated, useStore } from "../store";

export default function LocationIntel() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const siteId = useStore((s) => s.selectedSite);
  const observed = useStore((s) => s.observed);
  const selectCell = useStore((s) => s.selectCell);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  if (!meta || !siteId) return null;

  const site = meta.sites.find((s) => s.id === siteId);
  if (!site) return null;
  const arr = frame?.arrivals.find((v) => v.site === siteId) ?? null;
  const tier = arr
    ? frame?.cells.features.find((f) => f.properties.id === arr.cell)?.properties.tier ?? "full"
    : "full";
  const obs = observed?.sites.find((s) => s.site === siteId) ?? null;
  const shown = arr ? HAZARDS.filter((h) => gated(h, tier, arr.hazards[h])) : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <span>{site.name}</span>
        <span className="hint">{site.kind}</span>
      </div>
      <div className="panel-body">
        <div className="kv">
          <span className="k">Position</span>
          <span className="num">{site.lat.toFixed(3)}°N {site.lon.toFixed(3)}°E</span>
        </div>

        {!arr ? (
          <p className="hint" style={{ marginTop: 8 }}>
            No tracked cell is forecast to reach this location at the current analysis time,
            so it carries no arrival probability.
          </p>
        ) : (
          <>
            <Gauge p={arr.p} />
            <div className="kv">
              <span className="k">Arrival window</span>
              <span className="num">{arr.start_min}–{arr.end_min} min</span>
            </div>
            <div className="kv">
              <span className="k">From cell</span>
              <button className="chip" style={{ cursor: "pointer" }}
                onClick={() => selectCell(arr.cell)}>{arr.cell}</button>
            </div>
            <div className="kv">
              <span className="k">Radar coverage</span>
              <span>{tier === "none" ? "no radar" : tier}</span>
            </div>
            <div style={{ marginTop: 6 }}>
              {shown.length === 0 && (
                <p className="hint">
                  No hazard probability this location&rsquo;s coverage tier allows on screen.
                </p>
              )}
              {shown.map((h) => (
                <div className="reason" key={h}>
                  <span className={`dot ${h}`} aria-hidden="true">{HAZARD_MARK[h]}</span>
                  <span style={{ flex: 1 }}>{HAZARD_LABEL[h]}</span>
                  <span className="num">{pct(arr.hazards[h]!)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {obs && (
          <p className="hint" style={{ marginTop: 10 }}>
            {obs.observed_first_min === null
              ? `Observation: the storm never reached ${observed!.threshold_kgm2} kg/m² within ±${observed!.box_km} km of here during the event.`
              : `Observation: first exceeded ${observed!.threshold_kgm2} kg/m² at T+${obs.observed_first_min} min, peak ${obs.observed_peak_kgm2} kg/m².`}
          </p>
        )}
      </div>

      <div className="panel-body">
        <div className="scale-head hint">
          <span>VIL</span>
          <span className="num">
            {meta.hazard_ranges.vil.min}–{meta.hazard_ranges.vil.max}+ {meta.hazard_ranges.vil.units}
          </span>
        </div>
        <div className="scale-bar" aria-hidden="true" />
      </div>
    </section>
  );
}

/** The arrival probability, drawn as an arc. The number is the number in the file. */
function Gauge({ p }: { p: number }) {
  const R = 26, C = Math.PI * R;
  return (
    <div className="gauge">
      <svg viewBox="0 0 64 40" width="72" height="45" role="img"
        aria-label={`arrival probability ${pct(p)}`}>
        <path d={`M 6 34 A ${R} ${R} 0 0 1 58 34`} fill="none" stroke="#22303c" strokeWidth="6" />
        <path d={`M 6 34 A ${R} ${R} 0 0 1 58 34`} fill="none" stroke="var(--accent)"
          strokeWidth="6" strokeDasharray={`${C * p} ${C}`} strokeLinecap="butt" />
      </svg>
      <div>
        <div className="num gauge-value">{pct(p)}</div>
        <div className="hint">arrival probability, ensemble of perturbed motions</div>
      </div>
    </div>
  );
}
