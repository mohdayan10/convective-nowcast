// The opening screen: what this event is, what the console can show, and — the
// part that matters with science judges — what is not computed yet. The second
// list is generated from meta.availability, so it cannot drift from the package.

import { Screen, SCREENS, useStore } from "../store";

const AVAIL_LABEL: Record<string, string> = {
  vil_nowcast: "Radar VIL nowcast, 0–60 min",
  lightning_nowcast: "Lightning density nowcast",
  cloudburst: "Cloudburst probability (VIL→rain relation)",
  hail: "Hail probability per cell",
  downburst: "Downburst probability per cell",
  initiation: "Convective initiation candidates",
  audience_thresholds: "Alert thresholds tuned per audience",
  nwp_blend_3_6h: "3–6 h NWP blend",
  coverage_tiers_real: "Measured radar coverage tiers",
};
const AVAIL_FIX: Record<string, string> = {
  initiation: "python -m pipeline.initiation, then make replay",
  hail: "make hazards, then make replay",
  downburst: "make hazards, then make replay",
  audience_thresholds: "make alerts, then make replay",
  nwp_blend_3_6h: "needs HRRR or equivalent NWP access — designed, not built",
  coverage_tiers_real: "needs the M1 radar-overlap grid; a simulated two-radar network stands in",
};

export default function Overview() {
  const meta = useStore((s) => s.meta);
  const events = useStore((s) => s.events);
  const observed = useStore((s) => s.observed);
  const alerts = useStore((s) => s.alerts);
  const setScreen = useStore((s) => s.setScreen);

  if (!meta) return <div className="page"><p className="hint">Loading the replay package…</p></div>;

  const have = Object.entries(meta.availability).filter(([, v]) => v);
  const missing = Object.entries(meta.availability).filter(([, v]) => !v);
  const start = new Date(meta.start_utc);
  const hours = ((meta.n_frames - 1) * meta.step_min) / 60;

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>{meta.event_type ?? "Convective event"} · {meta.event}</h1>
          <p className="hint">
            {start.toISOString().slice(0, 16).replace("T", " ")} UTC · {hours} h at{" "}
            {meta.step_min} min · {meta.grid.size}×{meta.grid.size} km at{" "}
            {meta.grid.km_per_px} km · {meta.dataset}
          </p>
          <div className="badge-row">
            {meta.badges.map((b) => <span key={b} className="chip">{b}</span>)}
          </div>
        </header>

        {meta.relocated && (
          <div className="banner">
            <strong>This grid is drawn somewhere the storm never was.</strong>{" "}
            {meta.notes.relocated}
            <table className="skill" style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <td style={{ width: "26%" }}>Moved</td>
                  <td style={{ textAlign: "left" }}>{meta.relocated.what_moved}</td>
                </tr>
                <tr>
                  <td>Unchanged</td>
                  <td style={{ textAlign: "left" }}>{meta.relocated.what_did_not}</td>
                </tr>
                <tr>
                  <td>Tile centre</td>
                  <td className="n" style={{ textAlign: "left" }}>
                    {meta.relocated.centre[1].toFixed(4)}°N {meta.relocated.centre[0].toFixed(4)}°E
                    {" · "}{meta.relocated.where}
                  </td>
                </tr>
                <tr>
                  <td>Built from</td>
                  <td className="n" style={{ textAlign: "left" }}>{meta.source_event}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <section className="cols">
          <Figure k="Analysis times" v={String(meta.analysis_frames.length)}
            sub={`every ${meta.step_min * 4} min, frames ${meta.analysis_frames[0]}–${meta.analysis_frames[meta.analysis_frames.length - 1]}`} />
          <Figure k="Named locations" v={String(meta.sites.length)}
            sub="airports and populated places inside the tile" />
          <Figure k="Alerts in this replay" v={String(alerts.length)}
            sub="issued across three audiences at their tuned thresholds" />
          <Figure k="Forecast horizon" v={`${meta.ml_horizon_min} min`}
            sub="trained ML nowcast; nothing shown beyond it" />
        </section>

        <h2>Radar coverage on this tile</h2>
        <div className="cov-bar" role="img"
          aria-label={(["full", "partial", "none"] as const)
            .map((t) => `${t} ${Math.round((meta.coverage.share[t] ?? 0) * 100)}%`).join(", ")}>
          {(["full", "partial", "none"] as const).map((t) => (
            <span key={t} style={{
              width: `${(meta.coverage.share[t] ?? 0) * 100}%`,
              background: `var(--cov-${t})`,
            }} />
          ))}
        </div>
        <div className="cov-key">
          {(["full", "partial", "none"] as const).map((t) => (
            <span key={t}>
              <i style={{ background: `var(--cov-${t})` }} />
              {t === "none" ? "no radar" : t}{" "}
              <span className="num">{Math.round((meta.coverage.share[t] ?? 0) * 100)}%</span>
            </span>
          ))}
        </div>
        <p className="hint">{meta.notes.coverage}</p>

        <h2>What this console shows</h2>
        <ul className="ticks">
          {have.map(([k]) => <li key={k} className="yes">{AVAIL_LABEL[k] ?? k}</li>)}
        </ul>

        <h2>What is not computed</h2>
        {missing.length === 0 ? (
          <p className="hint">Everything the package declares is present.</p>
        ) : (
          <table className="skill">
            <thead><tr><th>Missing</th><th>What would produce it</th></tr></thead>
            <tbody>
              {missing.map(([k]) => (
                <tr key={k}>
                  <td>{AVAIL_LABEL[k] ?? k}</td>
                  <td style={{ textAlign: "left" }}>
                    <code>{AVAIL_FIX[k] ?? "not scheduled"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">
          Each of these appears in the interface as a labelled placeholder naming the command,
          never as a filled-in number.
        </p>

        <h2>Verification available for this event</h2>
        <p className="hint">
          {observed
            ? observed.note
            : "No observed rasters in this package. Run python -m export.build_observed --event "
              + meta.event + " to write them."}
        </p>

        <h2>Screens</h2>
        <div className="screen-grid">
          {SCREENS.filter((s) => s.id !== "overview").map((s) => (
            <button key={s.id} className="screen-card" onClick={() => setScreen(s.id as Screen)}>
              <span className="code num">{s.code}</span>
              <span className="screen-card-name">{s.name}</span>
              <span className="hint">{s.what}</span>
            </button>
          ))}
        </div>

        {events.length > 1 && (
          <>
            <h2>Other replays</h2>
            <EventPicker />
          </>
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

function EventPicker() {
  const events = useStore((s) => s.events);
  const eventId = useStore((s) => s.eventId);
  const openEvent = useStore((s) => s.openEvent);
  return (
    <div className="event-rows">
      {events.map((e) => (
        <button key={e.id} className="alert-row" aria-current={e.id === eventId}
          onClick={() => openEvent(e.id)}>
          <span style={{ flex: 1 }}>
            <span className="who num">{e.id}</span>
            <span className="meta">
              {e.event_type} · {e.start_utc.slice(0, 16).replace("T", " ")} UTC
            </span>
          </span>
          {e.badges.map((b) => <span key={b} className="chip">{b}</span>)}
        </button>
      ))}
    </div>
  );
}
