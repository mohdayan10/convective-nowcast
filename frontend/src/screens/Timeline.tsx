// Forecast timeline: how the forecast and its measured skill change with lead
// time. The thumbnails are the forecast rasters the package shipped for the
// current analysis time and coverage mode; the skill figures under them are from
// eval/results/model.json, measured over the test split — not over this one
// event, which the caption says plainly.

import { useEffect } from "react";
import { MODE_LABEL, rasterUrl } from "../api";
import { lead as leadLabel } from "../fmt";
import { analysisAt, useStore } from "../store";
import Chart, { METHOD_COLOUR, METHOD_LABEL, TIER_COLOUR, fx } from "../console/Chart";

/** The 3–6 h cards the problem statement asks about, and which we cannot fill. */
const BEYOND = [90, 120, 180, 240, 300, 360];

export default function Timeline() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const mode = useStore((s) => s.mode);
  const leadMin = useStore((s) => s.leadMin);
  const setLead = useStore((s) => s.setLead);
  const results = useStore((s) => s.results);
  const loadResults = useStore((s) => s.loadResults);
  const selectedSite = useStore((s) => s.selectedSite);

  useEffect(() => { loadResults(); }, [loadResults]);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  const m = results?.model?.methods?.model;
  const leads: number[] = frame?.leads_min ?? [];
  const csiAt = (L: number) => {
    const i = m?.lead_min?.indexOf(L) ?? -1;
    return i < 0 ? null : (m.mean_csi[i] as number);
  };
  const biasAt = (L: number) => {
    const i = m?.lead_min?.indexOf(L) ?? -1;
    return i < 0 ? null : (m.amplitude_bias[i] as number);
  };
  const tierAt = (tier: "full" | "partial" | "none", L: number) => {
    const t = m?.by_tier?.[tier];
    const i = m?.lead_min?.indexOf(L) ?? -1;
    return !t || i < 0 ? null : (t.mean_csi[i] as number);
  };

  const site = selectedSite
    ? frame?.arrivals.find((v) => v.site === selectedSite)
    : frame?.arrivals.slice().sort((x, y) => x.median_min - y.median_min)[0];

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>Forecast timeline</h1>
          <p className="hint">
            Analysis {a === null ? "—" : `T+${a * (meta?.step_min ?? 5)} min`} ·{" "}
            {MODE_LABEL[mode]} · {meta ? `${meta.ml_horizon_min} min trained horizon` : ""}
          </p>
        </header>

        {site && (
          <section className="panel flat">
            <div className="panel-head">
              <span>Hazard evolution — {site.name}</span>
              <span className="hint">from this analysis time</span>
            </div>
            <div className="panel-body">
              <div className="cols">
                <Figure k="Arrival window" v={`${site.start_min}–${site.end_min} min`}
                  sub="spread of the perturbed-motion ensemble" />
                <Figure k="Median arrival" v={`${site.median_min} min`} sub="ensemble median" />
                <Figure k="Arrival probability" v={`${Math.round(site.p * 100)}%`}
                  sub="share of members reaching the site" />
                <Figure k="From cell" v={String(site.cell)} sub="tracked cell identity" />
              </div>
              <p className="hint">
                Per-lead hazard probabilities are not computed: the hail and downburst cell
                models score a cell at its analysis time only, so there is no curve to draw
                and none is drawn.
              </p>
            </div>
          </section>
        )}

        <h2>Forecast by lead time</h2>
        {!frame ? (
          <p className="empty">Waiting for the first analysis frame.</p>
        ) : (
          <div className="horizon-grid">
            {leads.map((L) => (
              <button key={L} className="horizon-card" aria-current={Math.round(leadMin) === L}
                onClick={() => setLead(L)}>
                <div className="horizon-card-head">
                  <span className="num big-sm">+{leadLabel(L)}</span>
                  <span className="hint num">{fx(csiAt(L), 3)} CSI</span>
                </div>
                <img className="horizon-thumb" alt={`Forecast VIL at ${L} minutes`}
                  src={rasterUrl(meta!.event, a!, mode, "vil", L)} />
                <div className="horizon-card-foot">
                  <span className="hint">bias</span>
                  <span className="num">{fx(biasAt(L), 2)}</span>
                  <span className="hint">no-radar CSI</span>
                  <span className="num">{fx(tierAt("none", L), 3)}</span>
                </div>
              </button>
            ))}
            {BEYOND.map((L) => (
              <div key={L} className="horizon-card none">
                <div className="horizon-card-head">
                  <span className="num big-sm">+{leadLabel(L)}</span>
                </div>
                <div className="horizon-thumb hatched" aria-hidden="true" />
                <div className="horizon-card-foot hint">no forecast</div>
              </div>
            ))}
          </div>
        )}
        <p className="hint">
          Thumbnails are the forecast VIL rasters in this package for the current analysis time
          and coverage mode, on the same colour ramp as the map. CSI and amplitude bias are
          measured over the {results?.model?.data?.n_events ?? "—"}-event test split, not over
          this event; they describe the model, not this forecast.
          {" "}{meta?.notes.horizon}
        </p>

        <h2>Skill falls as lead time grows</h2>
        {m ? (
          <>
            <Chart
              xLabel="lead time (min)" yLabel="mean CSI"
              curves={Object.keys(results.model.methods).map((k) => ({
                name: METHOD_LABEL[k] ?? k,
                colour: METHOD_COLOUR[k] ?? "#8a9ba8",
                x: results.model.methods[k].lead_min as number[],
                y: results.model.methods[k].mean_csi as number[],
              }))}
            />
            <p className="hint">
              Mean CSI over VIL thresholds {results.model.thresholds.join(", ")} (SEVIR pixel
              units), {results.model.data.n_events} test events, split{" "}
              {results.model.data.split}.
            </p>
          </>
        ) : (
          <p className="empty">
            Run <code>make model</code> to write <code>eval/results/model.json</code>; until
            then no skill curve is shown.
          </p>
        )}

        <h2>And falls further where radar cannot see</h2>
        {m?.by_tier ? (
          <>
            <Chart
              xLabel="lead time (min)" yLabel="mean CSI"
              curves={(["full", "partial", "none"] as const).map((t, i) => ({
                name: t === "none" ? "No radar" : t === "partial" ? "Partial radar" : "Full radar",
                colour: TIER_COLOUR[i],
                x: m.lead_min as number[],
                y: m.by_tier[t].mean_csi as number[],
              }))}
            />
            <p className="hint">
              Same model, same forecasts, scored over the pixels at each coverage tier.{" "}
              {results!.model.coverage.tier_source};{" "}
              {results!.model.coverage.partial_tier_vil_scaling}.
            </p>
          </>
        ) : (
          <p className="empty">Per-tier skill is not computed. Run <code>make model</code>.</p>
        )}
      </div>
    </div>
  );
}

function Figure({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="figure">
      <div className="hint">{k}</div>
      <div className="figure-value num">{v}</div>
      <div className="hint">{sub}</div>
    </div>
  );
}
