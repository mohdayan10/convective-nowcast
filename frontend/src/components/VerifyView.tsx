import { useEffect, useMemo, useState } from "react";
import { FlaskConical, FileJson } from "lucide-react";
import { AUDIENCE_LABEL, Score, allAlerts, ciLeads, score } from "../model/derive";
import { MODE_LABEL, Mode, TERRAIN, setTerrain } from "../model/physics";
import { AUDIENCES, Audience } from "../model/scenario";
import { clockLabel } from "../model/grid";
import { Badge } from "./ui";
import SkillPanel from "./SkillPanel";

type Row = { key: string; name: string; note?: string; s: Score };

const pod = (s: Score) => (s.hits + s.misses ? s.hits / (s.hits + s.misses) : null);
const far = (s: Score) => (s.alerts ? s.falseAlarms / s.alerts : null);
const csi = (s: Score) => (s.hits + s.misses + s.falseAlarms ? s.hits / (s.hits + s.misses + s.falseAlarms) : null);
const f2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));

export default function VerifyView({ terrainOn }: { terrainOn: boolean }) {
  const [aud, setAud] = useState<Audience | "all">("all");

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const was = TERRAIN.on;
    setTerrain(true);
    for (const m of ["all", "noradar", "satonly"] as Mode[])
      out.push({ key: m, name: `ML nowcast · ${MODE_LABEL[m]}`, s: score(allAlerts(m), aud) });
    setTerrain(false);
    out.push({ key: "noterrain", name: "ML nowcast · no terrain features", note: "ablation", s: score(allAlerts("all"), aud) });
    setTerrain(was);
    out.push({ key: "baseline", name: "Extrapolation baseline", note: "motion + intensity persistence", s: score(allAlerts("baseline"), aud) });
    return out;
  }, [aud, terrainOn]);

  const leadMax = Math.max(...rows.map((r) => r.s.medianLead ?? 0), 1);
  const ci = ciLeads("all");

  return (
    <div className="verify">
      <section className="v-card">
        <div className="v-head">
          <FlaskConical size={18} />
          <h2>Replay verification</h2>
          <Badge tone="warn">SYNTHETIC SCENARIO</Badge>
        </div>
        <p className="v-lead">
          Alerts from the full 12:00–18:00 replay scored against what the scenario actually did at each site.
          This shows the verification pipeline working end to end. <b>It is not evidence of model skill.</b> Skill numbers come only from the evaluation code below.
        </p>

        <div className="v-filter">
          <span className="muted">Audience</span>
          {(["all", ...AUDIENCES] as const).map((a) => (
            <button key={a} className={`chip ${aud === a ? "on" : ""}`} onClick={() => setAud(a)}>
              {a === "all" ? "All" : AUDIENCE_LABEL[a]}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table className="v-table">
            <thead>
              <tr>
                <th>Forecast</th>
                <th className="num">Alerts</th>
                <th className="num">Hits</th>
                <th className="num">Misses</th>
                <th className="num">False alarms</th>
                <th className="num">POD</th>
                <th className="num">FAR</th>
                <th className="num">CSI</th>
                <th>Median warning lead</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.key === "baseline" ? "base" : ""}>
                  <td>{r.name}{r.note && <span className="muted"> · {r.note}</span>}</td>
                  <td className="num">{r.s.alerts}</td>
                  <td className="num">{r.s.hits}</td>
                  <td className="num">{r.s.misses}</td>
                  <td className="num">{r.s.falseAlarms}</td>
                  <td className="num">{f2(pod(r.s))}</td>
                  <td className="num">{f2(far(r.s))}</td>
                  <td className="num">{f2(csi(r.s))}</td>
                  <td>
                    <div className="lead-bar">
                      <span style={{ width: `${((r.s.medianLead ?? 0) / leadMax) * 100}%` }} />
                      <b>{r.s.medianLead === null ? "—" : `${r.s.medianLead} min`}</b>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="v-grid">
          <div className="v-mini">
            <h3>Convective initiation</h3>
            {ci.map((c) => (
              <div key={c.id} className="kv">
                <span>Cell {c.id}</span>
                <span>{c.detect === null ? "not detected" : `flagged ${clockLabel(c.detect)} · echo ${clockLabel(c.echo)} · `}<b>{c.lead === null ? "" : `${c.lead} min early`}</b></span>
              </div>
            ))}
            <div className="kv"><span>Candidate 36</span><span>flagged, never formed — <b>CI false alarm</b></span></div>
          </div>
          <div className="v-mini">
            <h3>How scoring works</h3>
            <ul className="plain">
              <li><b>Hit:</b> the hazard is observed at the site while the alert is valid.</li>
              <li><b>Miss:</b> the hazard starts with no alert issued beforehand.</li>
              <li><b>False alarm:</b> the alert expires without the hazard.</li>
              <li><b>Lead:</b> minutes from issue to observed onset (0 if already under way).</li>
            </ul>
          </div>
        </div>
      </section>

      <ModelSkill />
    </div>
  );
}

/** Renders only what the evaluation code wrote to public/results/. */
function ModelSkill() {
  const [state, setState] = useState<"loading" | "empty" | { files: string[] }>("loading");
  useEffect(() => {
    fetch("/results/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { files?: string[] }) => setState(j.files?.length ? { files: j.files } : "empty"))
      .catch(() => setState("empty"));
  }, []);

  return (
    <section className="v-card">
      <div className="v-head">
        <FileJson size={18} />
        <h2>Model skill</h2>
        <Badge tone="info">from eval/results/*.json</Badge>
      </div>
      {state === "loading" && <p className="muted">Loading…</p>}
      {state === "empty" && (
        <div className="empty big">
          <div className="empty-title">No evaluation results yet</div>
          <p>
            This panel shows only numbers written by the evaluation harness. Nothing is typed in by hand.
            Once the harness writes <code>eval/results/index.json</code> it will show:
          </p>
          <ul className="plain cols">
            <li>CSI / POD / FAR by lead time at the SEVIR VIL thresholds</li>
            <li>vs persistence, pysteps optical flow and S-PROG</li>
            <li>FSS at 1 / 5 / 15 km</li>
            <li>Reliability diagrams and amplitude bias</li>
            <li>Skill per input mode (all / no radar / satellite only)</li>
            <li>CI POD, FAR and lead before first echo</li>
            <li>Per-hazard verification against Storm Events reports</li>
            <li>Terrain ablation for cloudburst</li>
          </ul>
        </div>
      )}
      {typeof state === "object" && <SkillPanel files={state.files} />}
    </section>
  );
}
