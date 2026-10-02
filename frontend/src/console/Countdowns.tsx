// Required output #2: a ticking clock to storm arrival per threatened location.
// The arrival time and window come from the replay package; only the difference
// against the replay clock is computed here, which is what makes it tick.

import { Arrival, HAZARDS, HAZARD_MARK, Hazard } from "../api";
import { clock, pct } from "../fmt";
import { analysisAt, gated, useStore } from "../store";

export default function Countdowns() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const selectedSite = useStore((s) => s.selectedSite);
  const selectSite = useStore((s) => s.selectSite);
  const selectCell = useStore((s) => s.selectCell);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  const issued = a === null || !meta ? 0 : a * meta.step_min;

  if (!frame) {
    return (
      <section className="panel">
        <div className="panel-head"><span>Arrival countdowns</span></div>
        <div className="panel-body hint">Waiting for the first analysis.</div>
      </section>
    );
  }

  const cellTier = new Map(frame.cells.features.map((f) => [f.properties.id, f.properties.tier]));
  const rows = frame.arrivals
    .map((v) => ({ v, eta: issued + v.median_min }))
    .sort((x, y) => x.eta - y.eta);

  return (
    <section className="panel">
      <div className="panel-head">
        <span>Arrival countdowns</span>
        <span className="hint">{rows.length} under threat</span>
      </div>

      {rows.length === 0 && (
        <div className="panel-body hint">
          No location is on a tracked storm&rsquo;s path at this analysis time.
        </div>
      )}

      <div className="clocks">
        {rows.map(({ v, eta }, i) => {
          const tier = cellTier.get(v.cell) ?? "full";
          const haz = topHazard(v, tier);
          const remain = eta - tMin;
          const key = haz ? `var(--${haz})` : "var(--dim)";
          return (
            <button
              key={v.site}
              className={`clock${i > 0 ? " compact" : ""}`}
              style={{ ["--key" as string]: key }}
              aria-current={selectedSite === v.site}
              onClick={() => { selectSite(v.site); selectCell(v.cell); }}
            >
              <span className="clock-top">
                {haz
                  ? <span className={`dot ${haz}`} aria-hidden="true">{HAZARD_MARK[haz]}</span>
                  : <span className="dot" style={{ background: "var(--dim)" }} aria-hidden="true">?</span>}
                <span className="clock-site">{v.name}</span>
                {tier !== "full" && (
                  <span className="chip" title="Radar coverage at this location">
                    {tier === "none" ? "no radar" : "partial"}
                  </span>
                )}
              </span>

              <span className={`clock-time${remain <= 0 ? " past" : ""}`}>
                {remain <= 0 ? "overhead" : clock(remain)}
              </span>

              <span className="clock-sub">
                {v.end_min <= 0
                  ? <>storm already over this location</>
                  : <>window <span className="num">{v.start_min}–{v.end_min} min</span></>}
                {" · confidence "}<span className="num">{pct(v.p)}</span>
                {haz && <>{" · "}<span className="num">{pct(v.hazards[haz]!)}</span> {haz}</>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The most likely hazard the site's coverage tier allows on screen. */
function topHazard(v: Arrival, tier: string): Hazard | null {
  const show = HAZARDS
    .filter((h) => gated(h, tier, v.hazards[h]))
    .sort((x, y) => (v.hazards[y] ?? 0) - (v.hazards[x] ?? 0));
  return show[0] ?? null;
}
