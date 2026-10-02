// Data fusion: the three inputs the network actually receives, the heads it
// actually has, and what happens to the forecast when an input is taken away.
// The source panels are the real arrays from the package — the same rasters the
// model was fed — so the diagram is a picture of the run, not an illustration.

import { useEffect, useState } from "react";
import { MODE_LABEL, Mode, obsUrl } from "../api";
import { one } from "../fmt";
import { analysisAt, useStore } from "../store";
import { fx } from "../console/Chart";

const SOURCES = [
  {
    id: "radar" as const, layer: "vil" as const,
    title: "Radar", what: "structure and motion",
    detail: "SEVIR vertically integrated liquid, 1 km, 5 min. Stands in for a DWR mosaic.",
  },
  {
    id: "satellite" as const, layer: "ir107" as const,
    title: "Satellite IR", what: "cloud-top evolution",
    detail: "GOES 10.7 µm brightness temperature, 2 km, upsampled to the 1 km grid.",
  },
  {
    id: "lightning" as const, layer: "lght" as const,
    title: "Lightning", what: "electrical activity",
    detail: "GLM flashes gridded to 1 km and smoothed, per 5 min.",
  },
];

/** The heads this model has. Each one is declared in meta.availability. */
const HEADS: { key: string; name: string; unit: string }[] = [
  { key: "vil_nowcast", name: "VIL nowcast", unit: "kg/m², 12 lead frames" },
  { key: "lightning_nowcast", name: "Lightning density", unit: "flashes/km²/5 min" },
  { key: "cloudburst", name: "Cloudburst", unit: "P(≥100 mm / 1 h)" },
  { key: "hail", name: "Hail", unit: "P per cell" },
  { key: "downburst", name: "Downburst", unit: "P per cell, proxy" },
  { key: "initiation", name: "Initiation", unit: "candidate score" },
];

export default function Fusion() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const observed = useStore((s) => s.observed);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const results = useStore((s) => s.results);
  const loadResults = useStore((s) => s.loadResults);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => { loadResults(); }, [loadResults]);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  const obsFrame = observed?.frames.find((f) => f.frame === (a ?? -1)) ?? null;
  const m = results?.model?.methods?.model;
  const i60 = m?.lead_min?.indexOf(60) ?? -1;

  if (!meta) return <div className="page"><p className="hint">Loading…</p></div>;

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>Data fusion</h1>
          <p className="hint">
            Analysis {a === null ? "—" : `T+${a * meta.step_min} min`} · one forward pass per
            coverage mode, precomputed · {MODE_LABEL[mode]} on the map
          </p>
        </header>

        <div className="fusion" key={runKey}>
          <div className="fusion-sources">
            {SOURCES.map((s, i) => {
              const dropped =
                (mode !== "all" && s.id === "radar") || (mode === "satonly" && s.id === "lightning");
              return (
                <div className={`fusion-card${dropped ? " dropped" : ""}`} key={s.id}
                  style={{ ["--i" as string]: i }}>
                  <div className="fusion-card-head">
                    <span>{s.title}</span>
                    <span className="hint">{s.what}</span>
                  </div>
                  {a !== null && observed ? (
                    <img className="fusion-thumb" src={obsUrl(meta.event, a, s.layer)}
                      alt={`${s.title} at the current analysis time`} />
                  ) : (
                    <div className="fusion-thumb hatched" aria-hidden="true" />
                  )}
                  <div className="fusion-card-stats">
                    {s.id === "radar" && (
                      <>
                        <Stat k="peak VIL" v={obsFrame ? `${obsFrame.peak_kgm2}` : "—"} u="kg/m²" />
                        <Stat k="core area" v={obsFrame ? `${obsFrame.core_area_km2}` : "—"} u="km²" />
                      </>
                    )}
                    {s.id === "satellite" && (
                      <>
                        <Stat k="coldest top" v={obsFrame ? `${obsFrame.ctt_min_c}` : "—"} u="°C" />
                        <Stat k="cooling / 10 min"
                          v={obsFrame ? `${obsFrame.ctt_cooling_c_per_10min > 0 ? "+" : ""}${obsFrame.ctt_cooling_c_per_10min}` : "—"}
                          u="°C" />
                      </>
                    )}
                    {s.id === "lightning" && (
                      <>
                        <Stat k="peak density" v={obsFrame ? `${obsFrame.flash_density_max}` : "—"}
                          u="fl/km²/5 min" />
                        <Stat k="area change / 10 min"
                          v={obsFrame?.flash_change_per_10min == null ? "—"
                            : `${obsFrame.flash_change_per_10min > 0 ? "+" : ""}${Math.round(obsFrame.flash_change_per_10min * 100)}`}
                          u="%" />
                      </>
                    )}
                  </div>
                  <div className="hint fusion-card-foot">{s.detail}</div>
                  {dropped && <div className="dropped-flag">removed in {MODE_LABEL[mode].toLowerCase()}</div>}
                </div>
              );
            })}
          </div>

          <div className="fusion-mid" aria-hidden="true">
            <svg viewBox="0 0 120 240" preserveAspectRatio="none" className="fusion-wires">
              {[40, 120, 200].map((y, i) => (
                <path key={y} d={`M 0 ${y} C 60 ${y}, 60 120, 120 120`} fill="none"
                  stroke="var(--accent)" strokeWidth="1.2" className="wire"
                  style={{ ["--i" as string]: i }} />
              ))}
            </svg>
          </div>

          <div className="fusion-core">
            <div className="fusion-node">
              <span className="fusion-node-title">Tier-aware U-Net</span>
              <span className="hint num">
                {results?.train_log
                  ? `${results.train_log.params_M.toFixed(2)} M params · ${results.train_log.resolution_km} km · ${results.train_log.horizon_min} min`
                  : "parameters unknown until make model runs"}
              </span>
              <span className="hint">
                encoder–decoder over 13 input frames of all four channels, with the coverage tier
                as an input plane and modality dropout in training
              </span>
            </div>
            <button className="btn" onClick={() => setRunKey((k) => k + 1)}>Replay the animation</button>
          </div>

          <div className="fusion-outputs">
            <div className="panel-head"><span>Heads</span></div>
            {HEADS.map((h) => (
              <div className="head-row" key={h.key}>
                <span className={`head-dot ${meta.availability[h.key] ? "on" : "off"}`} aria-hidden="true" />
                <span style={{ flex: 1 }}>{h.name}</span>
                <span className="hint">{meta.availability[h.key] ? h.unit : "not trained"}</span>
              </div>
            ))}
            <div className="head-row">
              <span className="head-dot on" aria-hidden="true" />
              <span style={{ flex: 1 }}>Arrival window per location</span>
              <span className="hint">
                {frame ? `${frame.arrivals.length} locations now` : "—"}
              </span>
            </div>
            <p className="hint" style={{ padding: "6px 12px 12px" }}>
              Hail and downburst are gradient-boosted cell models over the fused fields, not
              heads of the network. Arrival windows come from an ensemble of perturbed storm
              motions, 10 members.
            </p>
          </div>
        </div>

        <h2>Take a source away</h2>
        <p className="hint">
          Each mode is a separate forward pass with the input removed, precomputed by the
          exporter — not the all-sources run restyled. These are this event at this analysis
          time.
        </p>
        {frame ? (
          <table className="skill">
            <thead>
              <tr>
                <th>Sources</th><th>Peak VIL kg/m²</th><th>Peak lightning</th>
                <th>Peak 1 h accumulation mm</th><th>P(≥100 mm)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(["all", "noradar", "satonly"] as Mode[]).map((md) => {
                const s = frame.modes[md];
                return (
                  <tr key={md} aria-current={mode === md}>
                    <td>{MODE_LABEL[md]}</td>
                    <td className="n">{s ? one(s.vil_max_kgm2) : "—"}</td>
                    <td className="n">{s ? s.lightning_max.toFixed(4) : "—"}</td>
                    <td className="n">{s ? one(s.accum_max_mm) : "—"}</td>
                    <td className="n">{s ? s.p_ge_100mm_max.toFixed(4) : "—"}</td>
                    <td>
                      <button className="btn" onClick={() => setMode(md)}>
                        {mode === md ? "on the map" : "show on the map"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="empty">Waiting for the first analysis frame.</p>}

        <h2>Does coverage change measured skill?</h2>
        {m?.by_tier ? (
          <>
            <table className="skill">
              <thead>
                <tr><th>Coverage tier</th><th>Mean CSI @ 60 min</th><th>Amplitude bias</th></tr>
              </thead>
              <tbody>
                {(["full", "partial", "none"] as const).map((t) => (
                  <tr key={t}>
                    <td>{t === "none" ? "No radar" : t === "partial" ? "Partial radar" : "Full radar"}</td>
                    <td className="n">{fx(i60 < 0 ? null : m.by_tier[t].mean_csi[i60], 3)}</td>
                    <td className="n">{fx(i60 < 0 ? null : m.by_tier[t].amplitude_bias?.[i60], 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              Measured over the {results!.model.data.n_events}-event test split, by pixel coverage
              tier. This is not the same question as the mode switch above: that removes an input
              from one event, this scores the same forecasts over pixels radar can and cannot see.
              The question the mode switch asks is answered below.
            </p>
          </>
        ) : (
          <p className="empty">
            Per-tier skill is not computed. Run <code>make model</code>.
          </p>
        )}

        <h2>The same removal, measured over the test split</h2>
        {results?.modes ? (
          <>
            <table className="skill">
              <thead>
                <tr>
                  <th>Sources the model may see</th><th>Mean CSI @ 60 min</th>
                  <th>Share of all-sources skill kept</th><th>Optical flow @ 60 min</th>
                </tr>
              </thead>
              <tbody>
                {(["all", "noradar", "satonly"] as Mode[]).map((md) => {
                  const leads: number[] = results.modes.methods.all.lead_min;
                  const i = leads.indexOf(60);
                  const v = results.modes.methods[md].mean_csi[i];
                  const ref = results.modes.methods.all.mean_csi[i];
                  return (
                    <tr key={md} aria-current={mode === md}>
                      <td>{MODE_LABEL[md]}</td>
                      <td className="n">{fx(v, 3)}</td>
                      <td className="n">{ref ? `${Math.round((v / ref) * 100)}%` : "—"}</td>
                      <td className="n">{fx(results.modes.baseline[md].mean_csi[i], 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint">
              {results.modes.data.n_events} held-out events, the same forward passes the console
              shows for one event. {results.modes.baseline_note}
            </p>
          </>
        ) : (
          <p className="empty">
            Not computed. Run <code>make modes</code> to score each coverage mode over the test
            split.
          </p>
        )}

        {results?.hazards && (
          <>
            <h2>Cell models, by coverage</h2>
            <table className="skill">
              <thead>
                <tr><th>Hazard</th><th>Coverage</th><th>Lead</th><th>AUC</th><th>CSI</th></tr>
              </thead>
              <tbody>
                {Object.entries(results.hazards.hazards as Record<string, any>)
                  .filter(([, v]) => v.by_tier_and_lead)
                  .flatMap(([k, v]) => Object.values(v.by_tier_and_lead as Record<string, any>)
                    .map((d: any) => ({ hazard: k, ...d })))
                  .map((d: any, i: number) => (
                    <tr key={i}>
                      <td>{d.hazard}</td><td>{d.tier}</td>
                      <td className="n">{d.lead_min} min</td>
                      <td className="n">{fx(d.auc)}</td><td className="n">{fx(d.csi)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="hint">{results.hazards.tier_source}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v, u }: { k: string; v: string; u: string }) {
  return (
    <div className="fusion-stat">
      <span className="hint">{k}</span>
      <span className="num">{v}<span className="unit"> {u}</span></span>
    </div>
  );
}
