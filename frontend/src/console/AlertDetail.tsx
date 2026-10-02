import { useState } from "react";
import { AUDIENCE_LABEL, HAZARD_LABEL, HAZARD_MARK } from "../api";
import { pct } from "../fmt";
import { useStore } from "../store";

const LANGS: [string, string][] = [["en", "English"], ["hi", "हिन्दी"], ["te", "తెలుగు"]];

export default function AlertDetail() {
  const id = useStore((s) => s.selectedAlert);
  const alerts = useStore((s) => s.alerts);
  const selectAlert = useStore((s) => s.selectAlert);
  const sent = useStore((s) => s.sent);
  const markSent = useStore((s) => s.markSent);
  const [showXml, setShowXml] = useState(false);

  const al = alerts.find((x) => x.id === id);
  if (!al) return null;

  return (
    <div className="sheet">
      <div className="sheet-head">
        <span className={`dot ${al.hazard}`} aria-hidden="true">{HAZARD_MARK[al.hazard]}</span>
        <span className="t">{HAZARD_LABEL[al.hazard]} &mdash; {al.site_name}</span>
        <button className="x" onClick={() => selectAlert(null)} aria-label="Close panel">×</button>
      </div>

      <div className="panel-body">
        <div className="kv"><span className="k">Audience</span><span>{AUDIENCE_LABEL[al.audience]}</span></div>
        <div className="kv">
          <span className="k">Arrival window</span>
          {al.end_min <= 0
            ? <span>already overhead</span>
            : <span className="num">{al.start_min}–{al.end_min} min</span>}
        </div>
        <div className="kv"><span className="k">Hazard probability</span><span className="num">{pct(al.p)}</span></div>
        <div className="kv"><span className="k">Arrival probability</span><span className="num">{pct(al.p_arrival)}</span></div>
        <div className="kv"><span className="k">Issued at threshold</span><span className="num">{al.threshold.toFixed(2)}</span></div>
        <div className="kv"><span className="k">Radar coverage</span><span>{al.tier === "none" ? "no radar" : al.tier}</span></div>
      </div>

      <section className="panel">
        <div className="panel-head"><span>Why this fired</span></div>
        <div className="panel-body">
          <p style={{ margin: 0 }}>
            {HAZARD_LABEL[al.hazard]} probability reached {pct(al.p)} for storm {al.cell},
            which {al.end_min <= 0
              ? `is already over ${al.site_name}`
              : `is forecast to reach ${al.site_name} in ${al.start_min}–${al.end_min} minutes`}
            {" "}({pct(al.p_arrival)} of ensemble tracks). The {AUDIENCE_LABEL[al.audience]} threshold
            for this hazard is {al.threshold.toFixed(2)}.
          </p>
          {al.tier !== "full" && (
            <p className="hint" style={{ marginTop: 6 }}>
              {al.tier === "none"
                ? "No radar covers this location: the forecast comes from satellite and lightning."
                : "Radar coverage is partial here, so storm cores may be underestimated."}
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>CAP 1.2</span>
          <button className="chip" style={{ cursor: "pointer" }} onClick={() => setShowXml(!showXml)}>
            {showXml ? "hide" : "show"}
          </button>
        </div>
        {showXml && <div className="panel-body"><pre className="xml">{al.cap_xml}</pre></div>}
      </section>

      <section className="panel">
        <div className="panel-head"><span>SMS</span></div>
        <div className="panel-body">
          {LANGS.map(([k, name]) => (
            <div className="sms" key={k}>
              <div className="lang">{name}</div>
              {al.sms[k]}
            </div>
          ))}
          <p className="hint" style={{ marginTop: 6 }}>{al.sms.review}</p>
        </div>
      </section>

      <div className="panel-body">
        <button
          className="btn primary"
          disabled={!!sent[al.id]}
          onClick={() => markSent(al.id)}
        >
          {sent[al.id] ? "Dispatched in replay" : "Send alert"}
        </button>
        <p className="hint" style={{ marginTop: 6 }}>
          Nothing leaves this machine. The CAP status is Exercise.
        </p>
      </div>
    </div>
  );
}
