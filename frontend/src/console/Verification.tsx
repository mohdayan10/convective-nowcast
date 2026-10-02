// Revealed when the replay reaches the end of the event: what actually happened.

import { HAZARD_LABEL } from "../api";
import { useStore } from "../store";

export default function Verification() {
  const v = useStore((s) => s.verification);
  const meta = useStore((s) => s.meta);
  const tMin = useStore((s) => s.tMin);

  // Reveal once the replay is inside its final frame — a dragged scrubber will
  // never land exactly on the last minute.
  const end = meta ? (meta.n_frames - 1) * meta.step_min : Infinity;
  if (!v || tMin < end - (meta?.step_min ?? 5)) return null;

  const s = v.summary;
  return (
    <section className="panel">
      <div className="panel-head">
        <span>Verification</span>
        <span className="hint">replay complete</span>
      </div>
      <div className="panel-body">
        {s.n === 0 ? (
          <p className="hint">
            No alerts were issued in this replay, so there is nothing to verify. Train the
            hazard models and tune the audience thresholds to populate this panel.
          </p>
        ) : (
          <>
            <div className="kv"><span className="k">Alerts</span><span className="num">{s.n}</span></div>
            <div className="kv"><span className="k">Hits</span><span className="num">{s.hits}</span></div>
            <div className="kv"><span className="k">False alarms</span><span className="num">{s.false_alarms}</span></div>
            <div className="kv">
              <span className="k">Median lead achieved</span>
              <span className="num">{s.median_lead_min === null ? "—" : `${s.median_lead_min} min`}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {v.alerts.map((r) => (
                <div className="reason" key={r.alert}>
                  <span className={`verdict ${r.outcome}`}>{r.outcome.replace("_", " ")}</span>
                  <span style={{ flex: 1 }}>{HAZARD_LABEL[r.hazard]} &mdash; {r.site_name}</span>
                  <span className="num hint">
                    {r.lead_min_achieved === null ? "—" : `${r.lead_min_achieved} min`}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="hint" style={{ marginTop: 8 }}>{v.note}</p>
      </div>
    </section>
  );
}
