// Why this cell is rated this way. The attributions are exact SHAP values from
// the gradient-boosted hail and downburst models, computed by export.build_xai
// from the same models that produced the probabilities on the map — so the bars
// add up to the model's logit and the screen can be checked against it.

import { useEffect } from "react";

import { Hazard, HAZARD_LABEL, HAZARD_MARK } from "../api";
import { pct } from "../fmt";
import { analysisAt, gated, useStore } from "../store";
import { fx } from "../console/Chart";

/** What each model feature is, in words. Order follows the model's feature list. */
const FEATURE_WHAT: Record<string, string> = {
  vil_max: "peak VIL in the cell",
  vil_p95: "95th percentile VIL in the cell",
  area_133: "area above 3.5 kg/m² around the cell",
  area_181: "area above 12 kg/m² around the cell",
  trend10: "VIL change over 10 min",
  trend20: "VIL change over 20 min",
  collapse20: "fall from the cell's recent peak",
  ir_min: "coldest cloud top over the cell",
  ot_index: "overshooting-top index",
  wv_ir_max: "water-vapour minus clean-IR difference",
  lght_rate: "flash count around the cell",
  lght_jump: "flash growth over 10 min",
};
const FEATURE_SOURCE: Record<string, string> = {
  vil_max: "radar", vil_p95: "radar", area_133: "radar", area_181: "radar",
  trend10: "radar", trend20: "radar", collapse20: "radar",
  ir_min: "satellite", ot_index: "satellite", wv_ir_max: "satellite",
  lght_rate: "lightning", lght_jump: "lightning",
};

export default function Explain() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const xai = useStore((s) => s.xai);
  const selectedCell = useStore((s) => s.selectedCell);
  const selectCell = useStore((s) => s.selectCell);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const setScreen = useStore((s) => s.setScreen);
  const results = useStore((s) => s.results);
  const loadResults = useStore((s) => s.loadResults);

  useEffect(() => { loadResults(); }, [loadResults]);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  const cells = frame
    ? [...frame.cells.features].sort((x, y) =>
        (y.properties.hazards.downburst ?? 0) - (x.properties.hazards.downburst ?? 0))
    : [];
  const cell = cells.find((f) => f.properties.id === selectedCell) ?? cells[0];
  const xaiFrame = a === null ? undefined : xai?.frames[String(a)];
  const xc = cell ? xaiFrame?.cells[String(cell.properties.id)] : undefined;

  if (!meta) return <div className="page"><p className="hint">Loading…</p></div>;

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>Why is this cell rated this way?</h1>
          <p className="hint">
            Analysis {a === null ? "—" : `T+${a * meta.step_min} min`}
            {cell && <> · cell <span className="num">{cell.properties.id}</span></>}
            {" · "}
            {xai ? "exact SHAP values from the cell models" : "no attribution file in this package"}
          </p>
          <div className="chip-row">
            {cells.map((f) => (
              <button key={f.properties.id} className="chip" style={{ cursor: "pointer" }}
                aria-pressed={f.properties.id === cell?.properties.id}
                onClick={() => selectCell(f.properties.id)}>
                <span className="num">{f.properties.id}</span>
              </button>
            ))}
          </div>
        </header>

        {!cell ? (
          <p className="empty">No tracked cell at this analysis time.</p>
        ) : (
          <>
            <h2>Risk breakdown</h2>
            <div className="xai-top">
              <Ring cell={cell.properties} />
              <div className="xai-bars">
                {(["downburst", "hail", "lightning", "cloudburst"] as Hazard[]).map((h) => {
                  const p = cell.properties.hazards[h];
                  const shown = gated(h, cell.properties.tier, p);
                  return (
                    <div className="xai-bar" key={h}>
                      <span className={`dot ${h}`} aria-hidden="true">{HAZARD_MARK[h]}</span>
                      <span className="xai-bar-name">{HAZARD_LABEL[h]}</span>
                      <span className="xai-bar-track">
                        {p !== undefined && shown && (
                          <i style={{ width: `${p * 100}%`, background: `var(--${h})` }} />
                        )}
                      </span>
                      <span className="num xai-bar-value">
                        {p === undefined ? "no model"
                          : shown ? pct(p)
                          : `hidden at ${cell.properties.tier}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="hint">
              Lightning and cloudburst are gridded fields, not per-cell models, so they carry no
              cell probability here; they are map layers. Hail and downburst probabilities are raw
              model output: their reliability is measured on the validation screen, but the
              recalibration fitted there is not applied to the numbers shown here.
            </p>

            <h2>Contributing signals</h2>
            {!xc ? (
              <p className="empty">
                No attribution for this cell. Run{" "}
                <code>python -m export.build_xai --event {meta.event}</code> to compute SHAP
                values from the trained cell models.
              </p>
            ) : (
              <>
                {Object.entries(xc.hazards).map(([hz, h]) => (
                  <Attribution key={hz} hazard={hz} h={h} values={xc.values} />
                ))}
                <p className="hint">{xai!.note}</p>
                <ul className="hint" style={{ lineHeight: 1.7 }}>
                  {xai!.caveats.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </>
            )}

            <h2>Convective initiation</h2>
            {!frame ? null : frame.initiation.length === 0 ? (
              <p className="empty">
                {meta.availability.initiation
                  ? "No candidate above the model's validation-tuned threshold at this analysis time. The model is trained; it is not firing here."
                  : "Initiation model not trained. Run make ci, then make replay."}
              </p>
            ) : (
              <>
                <div className="ci-grid">
                  {frame.initiation.slice(0, 6).map((c, i) => (
                    <div className="ci-card" key={i}>
                      <div className="ci-head">
                        <span className="num ci-score">{c.score}</span>
                        <span className="hint num">
                          {c.lat.toFixed(2)}°N {c.lon.toFixed(2)}°E
                        </span>
                      </div>
                      {c.reasons.map((r) => (
                        <div className="reason" key={r.feature}>
                          <span className="bar">
                            <i style={{
                              width: `${Math.min(100, (Math.abs(r.effect)
                                / Math.max(...c.reasons.map((q) => Math.abs(q.effect)), 1e-6)) * 100)}%`,
                            }} />
                          </span>
                          <span style={{ flex: 1 }}>{r.feature}</span>
                          <span className="num hint">{r.effect >= 0 ? "+" : "−"}{Math.abs(r.effect).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="hint">
                  Candidates are patches with no radar echo yet where the model expects one
                  within 30 minutes; the score is its ranking and the bars are its own top
                  contributions, in log-odds. The initiation model sees satellite, not radar — it
                  is the part of the system that can see a storm before there is anything for
                  radar to find. Its measured skill is on the validation screen.
                </p>
              </>
            )}

            <h2>Source ablation — this event, this analysis time</h2>
            {frame ? (
              <>
                <div className="ablation">
                  {(["all", "noradar", "satonly"] as const).map((md) => {
                    const s = frame.modes[md];
                    const ref = frame.modes.all?.vil_max_kgm2 ?? 1;
                    return (
                      <button key={md} className="ablation-card" aria-current={mode === md}
                        onClick={() => setMode(md)}>
                        <span className="ablation-name">
                          {md === "all" ? "Radar + satellite + lightning"
                            : md === "noradar" ? "Satellite + lightning" : "Satellite only"}
                        </span>
                        <span className="num ablation-value">
                          {s ? s.vil_max_kgm2.toFixed(1) : "—"}
                          <span className="unit"> kg/m² peak VIL</span>
                        </span>
                        <span className="ablation-track">
                          <i style={{ width: `${s ? Math.min(100, (s.vil_max_kgm2 / ref) * 100) : 0}%` }} />
                        </span>
                        <span className="hint">
                          lightning peak <span className="num">{s ? s.lightning_max.toFixed(4) : "—"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="hint">
                  Three separate forward passes with the input removed, precomputed by the
                  exporter. One event is not a skill measurement: the same removal measured over
                  the held-out test split is on the{" "}
                  <button className="link" onClick={() => setScreen("validation")}>
                    validation screen
                  </button>
                  {results?.modes ? (
                    <>, where the model keeps{" "}
                    <span className="num">{keptShare(results.modes)}</span> of its all-sources
                    skill at 60 minutes with radar denied, and optical flow keeps none.</>
                  ) : <>, once <code>make modes</code> has been run.</>}
                </p>
              </>
            ) : <p className="empty">Waiting for the first analysis frame.</p>}

            <h2>What the models learned overall</h2>
            {xai ? (
              <>
                <table className="skill">
                  <thead>
                    <tr>
                      <th>Feature</th><th>Source</th>
                      {Object.keys(xai.gain).map((hz) => <th key={hz}>{hz} gain</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {xai.features.map((f) => (
                      <tr key={f}>
                        <td title={FEATURE_WHAT[f]}>{FEATURE_WHAT[f] ?? f}</td>
                        <td>{FEATURE_SOURCE[f] ?? "—"}</td>
                        {Object.keys(xai.gain).map((hz) => (
                          <td className="n" key={hz}>{fx(xai.gain[hz][f], 3)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint">
                  Share of total split gain per feature, over the whole training set — the
                  model-level view. The bars above are this one cell at this one time.
                </p>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The dominant hazard, drawn as a ring. No number here that is not in the file. */
function Ring({ cell }: { cell: { hazards: Partial<Record<Hazard, number>>; tier: string } }) {
  const shown = (["downburst", "hail"] as Hazard[])
    .filter((h) => gated(h, cell.tier, cell.hazards[h]))
    .sort((x, y) => (cell.hazards[y] ?? 0) - (cell.hazards[x] ?? 0));
  const top = shown[0];
  const p = top ? cell.hazards[top]! : null;
  const R = 46, C = 2 * Math.PI * R;
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" width="150" height="150" role="img"
        aria-label={top ? `${HAZARD_LABEL[top]} ${pct(p!)}` : "no cell hazard probability"}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="#22303c" strokeWidth="9" />
        {p !== null && (
          <circle cx="60" cy="60" r={R} fill="none" stroke={`var(--${top})`} strokeWidth="9"
            strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 60 60)" />
        )}
      </svg>
      <div className="ring-label">
        <div className="num ring-value">{p === null ? "—" : pct(p)}</div>
        <div className="hint">{top ? HAZARD_LABEL[top] : "no cell model output"}</div>
      </div>
    </div>
  );
}

function Attribution({ hazard, h, values }: {
  hazard: string;
  h: { p: number; base_log_odds: number; contrib: Record<string, number> };
  values: Record<string, number>;
}) {
  const rows = Object.entries(h.contrib).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const widest = Math.max(...rows.map(([, v]) => Math.abs(v)), 1e-6);
  const sum = rows.reduce((t, [, v]) => t + v, 0) + h.base_log_odds;
  return (
    <section className="panel flat">
      <div className="panel-head">
        <span>{HAZARD_LABEL[hazard as Hazard] ?? hazard}</span>
        <span className="hint num">
          {pct(h.p)} · logit {sum.toFixed(2)} = base {h.base_log_odds.toFixed(2)} + contributions
        </span>
      </div>
      <div className="panel-body">
        {rows.map(([f, v]) => (
          <div className="attr" key={f}>
            <span className="attr-name" title={f}>{FEATURE_WHAT[f] ?? f}</span>
            <span className="chip">{FEATURE_SOURCE[f] ?? "—"}</span>
            <span className="num attr-value">{fmtVal(f, values[f])}</span>
            <span className="attr-track">
              <i className={v >= 0 ? "pos" : "neg"}
                style={{
                  width: `${(Math.abs(v) / widest) * 50}%`,
                  left: v >= 0 ? "50%" : `${50 - (Math.abs(v) / widest) * 50}%`,
                }} />
              <span className="attr-zero" aria-hidden="true" />
            </span>
            <span className="num attr-contrib">{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Share of all-sources skill the model keeps at 60 min with radar denied. */
function keptShare(modes: any): string {
  const leads: number[] = modes.methods.all.lead_min;
  const i = leads.indexOf(60);
  const ref = modes.methods.all.mean_csi[i];
  const got = modes.methods.noradar.mean_csi[i];
  return ref ? `${Math.round((got / ref) * 100)}%` : "—";
}

function fmtVal(f: string, v: number | undefined) {
  if (v === undefined) return "—";
  if (f.startsWith("area") || f === "lght_rate") return Math.round(v).toString();
  return v.toFixed(2);
}
