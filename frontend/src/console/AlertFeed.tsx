// Alerts are read from alerts.json and appear as the replay clock passes the time
// each one was issued, so the audiences visibly fire at different moments.

import { AUDIENCE_LABEL, Audience, HAZARD_LABEL, HAZARD_MARK } from "../api";
import { pct } from "../fmt";
import { useStore } from "../store";

export default function AlertFeed() {
  const alerts = useStore((s) => s.alerts);
  const meta = useStore((s) => s.meta);
  const tMin = useStore((s) => s.tMin);
  const audience = useStore((s) => s.audience);
  const setAudience = useStore((s) => s.setAudience);
  const selectAlert = useStore((s) => s.selectAlert);
  const sent = useStore((s) => s.sent);

  const step = meta?.step_min ?? 5;
  const live = alerts.filter((al) => al.analysis_frame * step <= tMin + 1e-6);
  const counts = (a: Audience) => live.filter((x) => x.audience === a).length;
  const rows = live.filter((al) => al.audience === audience).reverse();

  return (
    <section className="panel">
      <div className="tabs" role="tablist" aria-label="Alert audience">
        {(["aviation", "district", "farmers"] as Audience[]).map((a) => (
          <button
            key={a} role="tab" aria-selected={audience === a}
            onClick={() => setAudience(a)}
          >
            {AUDIENCE_LABEL[a]}{counts(a) ? ` ${counts(a)}` : ""}
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <div className="panel-body hint">
          {meta?.availability.audience_thresholds === false
            ? "Audience thresholds are not tuned yet, so no alerts are issued. Run alerts.severity after the hazard models finish."
            : "No alerts for this audience yet at this point in the replay."}
        </div>
      )}

      {rows.map((al) => (
        <button key={al.id} className="alert-row" onClick={() => selectAlert(al.id)}>
          <span className={`dot ${al.hazard}`} aria-hidden="true">{HAZARD_MARK[al.hazard]}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="who">{HAZARD_LABEL[al.hazard]} &mdash; {al.site_name}</span>
            <span className="meta">
              {al.end_min <= 0
                ? "already overhead"
                : <>in <span className="num">{al.start_min}–{al.end_min} min</span></>}
              {" · "}<span className="num">{pct(al.p)}</span>
              {al.tier !== "full" && ` · ${al.tier === "none" ? "no radar" : "partial radar"}`}
            </span>
          </span>
          {sent[al.id] && <span className="chip">sent</span>}
        </button>
      ))}
    </section>
  );
}
