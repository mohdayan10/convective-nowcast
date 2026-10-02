// Validation. Every number here is read from eval/results/*.json; where a file
// does not exist the section says what has to run to produce it and shows no
// bars. The banner is deliberately specific about which parts are measured and
// which parts rest on a simulated input — a blanket "all simulated" would be as
// untrue as a blanket claim of validation.

import { useEffect, useState } from "react";
import { useStore } from "../store";
import Chart, {
  Curve, LINE, METHOD_COLOUR, METHOD_LABEL, TIER_COLOUR, fx,
} from "../console/Chart";

const THRESH_LABEL: Record<string, string> = {
  "16": "light (VIL 16)", "74": "moderate (VIL 74)", "133": "heavy (VIL 133)",
  "160": "severe (VIL 160)", "181": "intense (VIL 181)", "219": "extreme (VIL 219)",
};

export default function Validation() {
  const r = useStore((s) => s.results);
  const err = useStore((s) => s.resultsError);
  const loadResults = useStore((s) => s.loadResults);
  const observed = useStore((s) => s.observed);
  const [against, setAgainst] = useState<string>("persistence");
  const [thresh, setThresh] = useState<string>("74");

  useEffect(() => { loadResults(); }, [loadResults]);

  if (err) return <div className="page"><div className="page-inner"><p className="empty">{err}</p></div></div>;
  if (!r) return <div className="page"><div className="page-inner"><p className="hint">Loading evaluation files…</p></div></div>;

  // model.json re-scores the baselines alongside the model on the full test
  // split, so prefer it; baselines.json alone covers fewer events.
  const model = r.model;
  const base = model ?? r.baselines;
  const order = ["model", "sprog", "optical_flow", "persistence"];
  const curves: Curve[] = base
    ? Object.keys(base.methods)
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))
        .map((k, i) => ({
          name: METHOD_LABEL[k] ?? k,
          colour: METHOD_COLOUR[k] ?? LINE[i % LINE.length],
          x: base.methods[k].lead_min as number[],
          y: base.methods[k].mean_csi as number[],
        }))
    : [];
  const m = model?.methods?.model;
  const cmp = model?.methods?.[against];
  const tiers = m?.by_tier;
  const leads: number[] = m?.lead_min ?? [];
  const i60 = leads.indexOf(60);
  const thresholds: number[] = model?.thresholds ?? [];

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>Validation</h1>
        </header>

        <div className="banner">
          <strong>What is measured and what is not.</strong>{" "}
          The skill figures below are measured: the trained model and three
          extrapolation baselines scored over{" "}
          <span className="num">{model?.data?.n_events ?? "—"}</span> held-out SEVIR events,
          split {model?.data?.split ?? "—"}. What is still not measured, and carries no number
          here: {[
            !r.calibration && "probability calibration",
            !r.track && "object track error",
            !r.modes && "inference latency for the trained model",
            "skill on any Indian case",
          ].filter(Boolean).join(", ")}. The probabilities the rest of the console shows are raw
          model output: the reliability curves below measure them, they are not applied to them.
          One input is simulated:{" "}
          {model?.coverage?.tier_source ?? "coverage tiers"}, which every per-tier figure
          inherits. The dataset is American; no Indian case is wired in.
          <div className="badge-row">
            <span className="chip warn">Coverage tiers simulated</span>
            <span className="chip warn">
              {r.calibration ? "Probabilities raw, not recalibrated" : "Probabilities uncalibrated"}
            </span>
            <span className="chip">US SEVIR</span>
          </div>
        </div>

        <h2>Nowcast skill by lead time</h2>
        {base ? (
          <>
            <Chart curves={curves} xLabel="lead time (min)" yLabel="mean CSI" />
            <p className="hint">
              Mean CSI over VIL thresholds {base.thresholds.join(", ")} (SEVIR pixel units),
              {" "}{base.data.n_events} test events, split {base.data.split}.
            </p>
            <table className="skill">
              <thead>
                <tr><th>Method</th>{leadCols(curves).map((L) => <th key={L}>{L} min</th>)}</tr>
              </thead>
              <tbody>
                {curves.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    {leadCols(curves).map((L) => {
                      const i = c.x.indexOf(L);
                      return <td className="n" key={L}>{fx(i < 0 ? null : c.y[i], 3)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {model && <p className="hint">{whereItLoses(curves)}</p>}
          </>
        ) : <p className="empty">Run <code>make baselines</code> to populate this.</p>}

        <h2>Detection at one threshold</h2>
        {m?.by_threshold ? (
          <>
            <div className="row-controls">
              <div className="seg" role="group" aria-label="VIL threshold">
                {thresholds.map((t) => (
                  <button key={t} aria-pressed={String(t) === thresh}
                    onClick={() => setThresh(String(t))}>{t}</button>
                ))}
              </div>
              <span className="hint">{THRESH_LABEL[thresh] ?? `VIL ${thresh}`}</span>
              <span className="spacer" />
              <div className="seg" role="group" aria-label="Compare against">
                {["persistence", "optical_flow", "sprog"].map((k) => (
                  <button key={k} aria-pressed={against === k} onClick={() => setAgainst(k)}>
                    {METHOD_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
            <Chart
              xLabel="lead time (min)" yLabel="score"
              curves={[
                { name: "Model POD", colour: "#4fd1c5", x: leads, y: m.by_threshold[thresh].pod },
                { name: "Model FAR", colour: "#ff6b5a", x: leads, y: m.by_threshold[thresh].far },
                ...(cmp?.by_threshold?.[thresh] ? [
                  { name: `${METHOD_LABEL[against]} POD`, colour: "#7aa7c7", x: cmp.lead_min, y: cmp.by_threshold[thresh].pod },
                  { name: `${METHOD_LABEL[against]} FAR`, colour: "#8a9ba8", x: cmp.lead_min, y: cmp.by_threshold[thresh].far },
                ] : []),
              ]}
            />
            <table className="skill">
              <thead>
                <tr><th>At 60 min, VIL ≥ {thresh}</th><th>CSI</th><th>POD</th><th>FAR</th><th>Frequency bias</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{METHOD_LABEL.model}</td>
                  <td className="n">{fx(m.by_threshold[thresh].csi[i60], 3)}</td>
                  <td className="n">{fx(m.by_threshold[thresh].pod[i60], 3)}</td>
                  <td className="n">{fx(m.by_threshold[thresh].far[i60], 3)}</td>
                  <td className="n">{fx(m.by_threshold[thresh].bias[i60], 2)}</td>
                </tr>
                {cmp?.by_threshold?.[thresh] && (
                  <tr>
                    <td>{METHOD_LABEL[against]}</td>
                    <td className="n">{fx(cmp.by_threshold[thresh].csi[i60], 3)}</td>
                    <td className="n">{fx(cmp.by_threshold[thresh].pod[i60], 3)}</td>
                    <td className="n">{fx(cmp.by_threshold[thresh].far[i60], 3)}</td>
                    <td className="n">{fx(cmp.by_threshold[thresh].bias[i60], 2)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="hint">
              Hit rate and false-alarm ratio at a fixed VIL threshold, which is the honest
              version of a confusion matrix here: the counts behind these rates are per pixel
              over {model.data.n_events} events, not per storm, so quoting them as storm counts
              would overstate what was verified. A frequency bias above 1 means the model
              forecasts the threshold over more area than was observed.
            </p>
          </>
        ) : (
          <p className="empty">Run <code>make model</code> to score POD and FAR per threshold.</p>
        )}

        <h2>Scale sensitivity — fractions skill score</h2>
        {m?.fss ? (
          <>
            <Chart
              xLabel="lead time (min)" yLabel="FSS"
              curves={Object.keys(m.fss[Object.keys(m.fss)[0]]).map((scale, i) => ({
                name: `${scale} neighbourhood`,
                colour: LINE[i % LINE.length],
                x: leads,
                y: m.fss[Object.keys(m.fss).includes(thresh) ? thresh : Object.keys(m.fss)[0]][scale],
              }))}
            />
            <p className="hint">
              FSS at VIL ≥ {Object.keys(m.fss).includes(thresh) ? thresh : Object.keys(m.fss)[0]},
              over neighbourhoods of {Object.keys(m.fss[Object.keys(m.fss)[0]]).join(", ")}.
              Skill rises with the neighbourhood, which is what a displaced-but-correct forecast
              looks like. How far displaced is the track error further down, and how well the
              probabilities themselves hold up is the reliability section.
            </p>
          </>
        ) : <p className="empty">No FSS in model.json.</p>}

        <h2>Reliability · calibration</h2>
        {r.calibration ? <Calibration c={r.calibration} /> : (
          <p className="empty">
            Not computed. The hazard probabilities shown throughout the console are raw model
            outputs — <code>pipeline/calibrate.py</code> exists but has never been run, so no
            calibration curve and no reliability diagram is shown. Until it does, a probability
            on any screen should be read as a ranking, not as a frequency.
          </p>
        )}

        <h2>Skill with the radar taken away</h2>
        {r.modes ? <Denied m={r.modes} /> : (
          <p className="empty">
            Not computed. Run <code>make modes</code> to re-score the model over the test split
            with the radar input removed.
          </p>
        )}

        <h2>Skill where radar cannot see</h2>
        {tiers ? (
          <>
            <Chart
              xLabel="lead time (min)" yLabel="mean CSI"
              curves={(["full", "partial", "none"] as const).map((t, i) => ({
                name: t === "none" ? "No radar" : t === "partial" ? "Partial radar" : "Full radar",
                colour: TIER_COLOUR[i],
                x: leads,
                y: tiers[t].mean_csi as number[],
              }))}
            />
            <table className="skill">
              <thead>
                <tr><th>Coverage</th>{[15, 30, 60].map((L) => <th key={L}>{L} min</th>)}</tr>
              </thead>
              <tbody>
                {(["full", "partial", "none"] as const).map((t) => (
                  <tr key={t}>
                    <td>{t === "none" ? "No radar" : t === "partial" ? "Partial" : "Full"}</td>
                    {[15, 30, 60].map((L) => {
                      const i = leads.indexOf(L);
                      return <td className="n" key={L}>{fx(i < 0 ? null : tiers[t].mean_csi[i], 3)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Mean CSI for the same model over pixels at each coverage tier.
              {" "}{model.coverage.tier_source}; {model.coverage.partial_tier_vil_scaling}.
              This is a breakdown of one forecast by where radar could see, which is a different
              question from forecasting without radar at all — that one is measured in the
              section above.
            </p>
          </>
        ) : (
          <p className="empty">
            Not computed. Run <code>make model</code> to score the model per coverage tier.
          </p>
        )}

        <h2>Arrival error</h2>
        {observed ? (
          <>
            <table className="skill">
              <thead>
                <tr><th>On the loaded replay</th><th>Value</th></tr>
              </thead>
              <tbody>
                <tr><td>Forecasts scored</td>
                  <td className="n">{observed.summary.n_forecasts}</td></tr>
                <tr><td>Median error (positive = late)</td>
                  <td className="n">{fx(observed.summary.median_error_min, 1)} min</td></tr>
                <tr><td>Median absolute error</td>
                  <td className="n">{fx(observed.summary.median_abs_error_min, 1)} min</td></tr>
                <tr><td>Observed arrival inside the forecast window</td>
                  <td className="n">
                    {observed.summary.in_window_share === null ? "—"
                      : `${Math.round(observed.summary.in_window_share * 100)}%`}
                  </td></tr>
              </tbody>
            </table>
            <p className="hint">
              One event, {observed.summary.n_forecasts} site-forecasts — enough to demonstrate the
              measurement, nowhere near enough to characterise the system. {observed.note}
            </p>
          </>
        ) : (
          <p className="empty">
            No observed file for the loaded event. Run{" "}
            <code>python -m export.build_observed</code>.
          </p>
        )}

        <h2>Object track error</h2>
        {r.track ? <TrackError t={r.track} /> : (
          <p className="empty">
            Not computed. Run <code>make track-skill</code> to segment the forecast fields into cells
            and match them to the observed cells. The arrival error above is the error metric
            that exists without it.
          </p>
        )}

        <h2>Inference latency</h2>
        {r.baselines?.methods ? (
          <>
            <table className="skill">
              <thead><tr><th>Method</th><th>Seconds per event</th></tr></thead>
              <tbody>
                {Object.entries(r.baselines.methods as Record<string, any>)
                  .filter(([, v]) => v.seconds_per_event !== undefined)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{METHOD_LABEL[k] ?? k}</td>
                      <td className="n">{fx(v.seconds_per_event, 3)}</td>
                    </tr>
                  ))}
                <tr>
                  <td>{METHOD_LABEL.model}</td>
                  <td className="n">
                    {fx(r.modes?.latency?.seconds_per_event?.all, 2)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="hint">
              Measured for the extrapolation baselines on {r.baselines.data.n_events} events,
              single-threaded, during <code>make baselines</code>.
              {r.modes?.latency
                ? <> The model&rsquo;s figure is {r.modes.latency.what} It is the cost of
                  producing a forecast, not of showing one: the replay console reads precomputed
                  files and does no inference at all.</>
                : <> The trained model&rsquo;s inference time was not recorded, so no number is
                  shown for it.</>}
            </p>
          </>
        ) : <p className="empty">No timings recorded.</p>}

        <h2>Coverage tiers used in training</h2>
        {r.tier_shares ? (
          <>
            <table className="skill">
              <thead><tr><th>Tier</th><th>Share of pixels</th></tr></thead>
              <tbody>
                {Object.entries(r.tier_shares.pixel_share as Record<string, number>).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k === "none" ? "No radar" : k === "partial" ? "Partial" : "Full"}</td>
                    <td className="n">{(v * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">{r.tier_shares.tier_source}</p>
          </>
        ) : <p className="empty">No tier statistics yet.</p>}

        <h2>Hail and downburst</h2>
        {r.hazards ? <HazardTable h={r.hazards} /> : (
          <p className="empty">
            Not computed. Run <code>python -m pipeline.hazards</code> to train the cell models
            and write <code>eval/results/hazards.json</code>.
          </p>
        )}

        <h2>Convective initiation</h2>
        {r.ci ? (
          <>
            <CiTable ci={r.ci} />
            <p className="hint">
              Skill at finding a storm before radar sees one, from satellite alone, under three
              satellite configurations — the third is the INSAT-like 4 km / 30 min case, which is
              what an Indian deployment would actually have. {r.ci.candidate_rule}; label:{" "}
              {r.ci.label_rule}. {r.ci.tier_source}.
            </p>
          </>
        ) : (
          <p className="empty">
            Not computed. Run <code>python -m pipeline.initiation</code> to write{" "}
            <code>eval/results/ci.json</code>.
          </p>
        )}

        <h2>Alert thresholds by audience</h2>
        {r.alerts ? <AlertTable a={r.alerts} /> : (
          <p className="empty">
            Not computed. Run <code>python -m alerts.severity</code> once the hazard models exist.
          </p>
        )}

        <h2>Training</h2>
        {r.train_log ? (
          <>
            <p className="hint">
              {r.train_log.params_M} M parameters at {r.train_log.resolution_km} km,{" "}
              {r.train_log.horizon_min} min horizon, {r.train_log.n_train_events} train /{" "}
              {r.train_log.n_val_events} validation events, best epoch{" "}
              {r.train_log.best_epoch} of {r.train_log.epochs.length}.
            </p>
            <Chart xLabel="epoch" yLabel="validation CSI" curves={[{
              name: "Validation CSI", colour: LINE[1],
              x: r.train_log.epochs.map((e: any) => e.epoch),
              y: r.train_log.epochs.map((e: any) => e.val_mean_csi_2km),
            }]} />
          </>
        ) : <p className="empty">No training log.</p>}

        <h2>Limitations</h2>
        <ul className="hint" style={{ lineHeight: 1.7 }}>
          <li>The model forecasts 60 minutes at 2 km and is upsampled to the 1 km grid; 3–6 h has no validated forecast.</li>
          <li>Radar coverage tiers are simulated — the real tier map needs the M1 overlap analysis.</li>
          <li>Downburst is a proxy from VIL-core collapse, not Doppler velocity.</li>
          <li>Cloudburst probability uses a documented VIL→rain relation with ×/÷ 2 spread at 90%.</li>
          <li>
            {"Hazard probabilities are raw model output on every other screen; the isotonic "}
            {"recalibration measured here is not applied to the replay package."}
          </li>
          <li>Trained and verified on US SEVIR data; no Indian data is wired in yet.</li>
        </ul>
      </div>
    </div>
  );
}


/** Radar-denied skill: the same model re-scored with an input removed. */
function Denied({ m }: { m: any }) {
  const order: ("all" | "noradar" | "satonly")[] = ["all", "noradar", "satonly"];
  const name = { all: "All sources", noradar: "No radar", satonly: "Satellite only" };
  const leads: number[] = m.methods.all.lead_min;
  const i60 = leads.indexOf(60);
  const i30 = leads.indexOf(30);
  const keep = (k: string) =>
    m.methods.all.mean_csi[i60] ? m.methods[k].mean_csi[i60] / m.methods.all.mean_csi[i60] : null;
  return (
    <>
      <Chart
        xLabel="lead time (min)" yLabel="mean CSI"
        curves={[
          ...order.map((k, i) => ({
            name: `Model — ${name[k].toLowerCase()}`,
            colour: TIER_COLOUR[i],
            x: leads, y: m.methods[k].mean_csi as number[],
          })),
          {
            name: "Optical flow — no radar",
            colour: "#8a9ba8",
            x: leads, y: m.baseline.noradar.mean_csi as number[],
          },
        ]}
      />
      <table className="skill">
        <thead>
          <tr>
            <th>Sources the model may see</th><th>Mean CSI @ 30 min</th><th>@ 60 min</th>
            <th>Share of all-sources skill kept</th><th>Optical flow @ 60 min</th>
          </tr>
        </thead>
        <tbody>
          {order.map((k) => (
            <tr key={k}>
              <td>{name[k]}</td>
              <td className="n">{fx(m.methods[k].mean_csi[i30], 3)}</td>
              <td className="n">{fx(m.methods[k].mean_csi[i60], 3)}</td>
              <td className="n">{keep(k) === null ? "—" : `${Math.round(keep(k)! * 100)}%`}</td>
              <td className="n">{fx(m.baseline[k].mean_csi[i60], 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        {m.question} Over {m.data.n_events} held-out events, split {m.data.split}.
      </p>
      <p className="hint">{m.baseline_note}</p>
    </>
  );
}

/** Centroid distance per lead, with the share of cells each method still has. */
function TrackError({ t }: { t: any }) {
  const order = ["model", "optical_flow", "persistence"];
  const leads: number[] = t.lead_min;
  const i30 = leads.indexOf(30), i60 = leads.indexOf(60);
  return (
    <>
      <Chart
        xLabel="lead time (min)" yLabel="median centroid error (km)"
        curves={order
          .filter((k) => t.methods[k])
          .map((k) => ({
            name: METHOD_LABEL[k] ?? k,
            colour: METHOD_COLOUR[k] ?? "#8a9ba8",
            x: leads,
            y: t.methods[k].median_error_km as number[],
          }))}
      />
      <table className="skill">
        <thead>
          <tr>
            <th>Method</th><th>Median error @ 30 min</th><th>@ 60 min</th>
            <th>90th percentile @ 60 min</th><th>Cells matched @ 60 min</th>
            <th>Forecast/observed area @ 60 min</th>
          </tr>
        </thead>
        <tbody>
          {order.filter((k) => t.methods[k]).map((k) => {
            const v = t.methods[k];
            return (
              <tr key={k}>
                <td>{METHOD_LABEL[k] ?? k}</td>
                <td className="n">{fx(v.median_error_km[i30], 1)} km</td>
                <td className="n">{fx(v.median_error_km[i60], 1)} km</td>
                <td className="n">{fx(v.p90_error_km[i60], 1)} km</td>
                <td className="n">
                  {v.matched_share[i60] === null ? "\u2014"
                    : `${Math.round(v.matched_share[i60] * 100)}%`}
                </td>
                <td className="n">{fx(v.median_area_ratio?.[i60], 2)}×</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        {t.question} {t.data.n_analysis_cells} cells over {t.data.n_events} held-out events.
        {" "}{t.method}
      </p>
      <p className="hint">{t.note}</p>
      <p className="hint">{reading(t)}</p>
    </>
  );
}

/** The finding, stated from the numbers rather than asserted — including when it
 *  goes against the model, which on this metric it does. */
function reading(t: any): string {
  const i = t.lead_min.indexOf(60) < 0 ? t.lead_min.length - 1 : t.lead_min.indexOf(60);
  const lead = t.lead_min[i];
  const got = (k: string) => t.methods[k]?.median_error_km?.[i] ?? null;
  const share = (k: string) => t.methods[k]?.matched_share?.[i] ?? null;
  const m = got("model"), fl = got("optical_flow"), ms = share("model"), fs = share("optical_flow");
  if (m === null || fl === null) return "";
  const km = (v: number) => `${v.toFixed(1)} km`;
  const pc = (v: number | null) => (v === null ? "\u2014" : `${Math.round(v * 100)}%`);
  if (m <= fl) {
    return `At +${lead} min the model places the storm ${km(m)} from where it went, against `
      + `${km(fl)} for optical flow, and keeps ${pc(ms)} of the cells to optical flow's `
      + `${pc(fs)}. It wins on position as well as on pixel skill.`;
  }
  const r = t.methods.model?.median_area_ratio?.[i];
  return `Read against the CSI curves above, this one goes the other way: at +${lead} min the `
    + `model places a storm ${km(m)} from where it went while optical flow places it ${km(fl)}, `
    + `and the model still has only ${pc(ms)} of the cells against optical flow's ${pc(fs)}. `
    + `Its fields are smooth, and the area column says what that does to an object: a matched `
    + `forecast cell is ${r ? `${r.toFixed(1)}×` : "well over"} the size of the observed one, so `
    + `it has swallowed its neighbours, and the merged blob's centroid sits between the storms `
    + `it merged — part of the error above is that merge rather than a displacement. The rest is `
    + `a weakened cell dropping below the detection threshold and vanishing as an object even `
    + `where its pixels still score. Extrapolation moves a sharp echo along a motion field and `
    + `keeps it sharp, so for the position of one cell it remains the better tool, and this page `
    + `says so. Nothing in the console depends on the model's object tracks: the cells, the `
    + `arrival windows and the alerts are all tracked on observed radar.`;
}

/** Reliability per hazard and coverage tier, raw against isotonic-recalibrated. */
function Calibration({ c }: { c: any }) {
  const items = Object.entries(c.items as Record<string, any>);
  if (!items.length) return <p className="empty">calibration.json has no scored items.</p>;
  return (
    <>
      <div className="cal-grid">
        {items.map(([k, v]) => (
          <figure className="cal-card" key={k}>
            <figcaption>
              <span>{v.hazard.replace(/_/g, " ")}</span>
              <span className="hint">{v.tier === "none" ? "no radar" : v.tier} radar</span>
            </figcaption>
            <Reliability raw={v.raw} cal={v.calibrated} />
            <div className="cal-stats">
              <span className="hint">Brier</span>
              <span className="num">{fx(v.raw.brier, 4)} → {fx(v.calibrated.brier, 4)}</span>
              <span className="hint">base rate</span>
              <span className="num">{fx(v.raw.base_rate, 3)}</span>
              <span className="hint">n</span>
              <span className="num">{v.raw.n}</span>
            </div>
          </figure>
        ))}
      </div>
      <p className="hint">
        {c.method}. A point above the diagonal is a probability that under-forecasts how often
        the event happened; below it, one that over-forecasts. Bins holding fewer than ten cases
        are dropped rather than plotted as noise.
      </p>
      <p className="hint">
        These curves measure the probabilities. They are not applied to them: the replay package
        ships raw model output, so a probability elsewhere in the console is still a ranking
        rather than a frequency. Applying the fitted isotonic models would mean re-running{" "}
        <code>make replay</code> with them loaded.
      </p>
    </>
  );
}

function Reliability({ raw, cal }: { raw: any; cal: any }) {
  const W = 220, H = 180, P = 30;
  const pts = (d: any) => (d.bins as any[])
    .filter((b) => b.n >= 10 && b.p_mean !== null && b.obs_freq !== null)
    .map((b) => `${P + b.p_mean * (W - P - 8)},${H - P - b.obs_freq * (H - P - 8)}`);
  const rawPts = pts(raw), calPts = pts(cal);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`reliability, Brier ${raw.brier.toFixed(4)} raw and ${cal.brier.toFixed(4)} calibrated`}>
      <line x1={P} y1={H - P} x2={W - 8} y2={8} stroke="#35475f" strokeDasharray="3 3" />
      <line x1={P} y1={8} x2={P} y2={H - P} stroke="#1d2a35" />
      <line x1={P} y1={H - P} x2={W - 8} y2={H - P} stroke="#1d2a35" />
      {[0, 0.5, 1].map((t) => (
        <text key={t} x={P - 5} y={H - P - t * (H - P - 8) + 4} textAnchor="end"
          fill="#8a9ba8" fontSize="10">{t}</text>
      ))}
      {rawPts.length > 1 && (
        <polyline points={rawPts.join(" ")} fill="none" stroke="#8a9ba8" strokeWidth="1.5" />
      )}
      {calPts.length > 1 && (
        <polyline points={calPts.join(" ")} fill="none" stroke="#4fd1c5" strokeWidth="1.8" />
      )}
      <text x={W - 8} y={H - 8} textAnchor="end" fill="#8a9ba8" fontSize="10">forecast p</text>
    </svg>
  );
}

/** Up to five evenly spread lead times that every curve actually has. */
function leadCols(curves: Curve[]): number[] {
  if (!curves.length) return [];
  const common = curves[0].x.filter((L) => curves.every((c) => c.x.includes(L)));
  if (common.length <= 5) return common;
  const step = (common.length - 1) / 4;
  return [0, 1, 2, 3, 4].map((i) => common[Math.round(i * step)]);
}

/** The brief's honesty rule: if the model loses to a baseline, say so here. */
function whereItLoses(curves: Curve[]): string {
  const m = curves.find((c) => c.name === METHOD_LABEL.model);
  const others = curves.filter((c) => c !== m);
  if (!m || !others.length) return "";
  const lost = m.x.filter((L, i) => others.some((o) => {
    const j = o.x.indexOf(L);
    return j >= 0 && o.y[j] > m.y[i];
  }));
  if (!lost.length) return "The model beats every extrapolation baseline at every lead time scored.";
  const won = m.x.filter((L) => !lost.includes(L));
  const span = (a: number[]) => (a.length === 1 ? `${a[0]} min` : `${a[0]}–${a[a.length - 1]} min`);
  return won.length
    ? `The model loses to at least one extrapolation baseline at ${span(lost)} and wins from ${span(won)} onward. Extrapolation is hard to beat at very short lead times, where the storm has barely moved.`
    : `The model does not beat the extrapolation baselines at any lead time scored (${span(lost)}).`;
}

function HazardTable({ h }: { h: any }) {
  const rows = Object.entries(h.hazards as Record<string, any>)
    .filter(([, v]) => v.by_tier_and_lead)
    .flatMap(([k, v]) => Object.values(v.by_tier_and_lead as Record<string, any>)
      .map((d: any) => ({ hazard: k, ...d })));
  if (!rows.length) return <p className="empty">No per-tier scores in hazards.json.</p>;
  return (
    <>
      <table className="skill">
        <thead>
          <tr><th>Hazard</th><th>Coverage</th><th>Lead</th><th>AUC</th><th>CSI</th><th>POD</th><th>FAR</th></tr>
        </thead>
        <tbody>
          {rows.map((d, i) => (
            <tr key={i}>
              <td>{d.hazard}</td><td>{d.tier}</td><td className="n">{d.lead_min}</td>
              <td className="n">{fx(d.auc)}</td><td className="n">{fx(d.csi)}</td>
              <td className="n">{fx(d.pod)}</td><td className="n">{fx(d.far)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{h.tier_source}. {h.label_source}</p>
    </>
  );
}

function CiTable({ ci }: { ci: any }) {
  const rows = Object.entries(ci.conditions as Record<string, any>).flatMap(([name, c]: [string, any]) =>
    Object.entries(c.horizons as Record<string, any>).map(([h, d]: [string, any]) => ({ name, h, ...d })));
  return (
    <table className="skill">
      <thead>
        <tr><th>Satellite</th><th>Horizon</th><th>POD</th><th>FAR</th><th>CSI</th><th>Median lead before echo</th></tr>
      </thead>
      <tbody>
        {rows.map((d, i) => (
          <tr key={i}>
            <td>{d.name.replace(/_/g, " ")}</td><td className="n">{d.h} min</td>
            <td className="n">{fx(d.pod)}</td><td className="n">{fx(d.far)}</td>
            <td className="n">{fx(d.csi)}</td>
            <td className="n">{d.median_lead_before_echo_min ?? "—"} min</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AlertTable({ a }: { a: any }) {
  const rows = Object.entries(a.by_hazard as Record<string, any>).flatMap(([hz, r]: [string, any]) =>
    Object.entries(r).map(([aud, d]: [string, any]) => ({ hz, aud, ...d })));
  return (
    <>
      <table className="skill">
        <thead>
          <tr><th>Hazard</th><th>Audience</th><th>Threshold</th><th>Alerts</th><th>POD</th><th>FAR</th></tr>
        </thead>
        <tbody>
          {rows.map((d, i) => (
            <tr key={i}>
              <td>{d.hz}</td><td>{d.aud}</td><td className="n">{fx(d.threshold)}</td>
              <td className="n">{d.alerts}</td><td className="n">{fx(d.pod)}</td>
              <td className="n">{fx(d.far)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{a.severity}</p>
    </>
  );
}
