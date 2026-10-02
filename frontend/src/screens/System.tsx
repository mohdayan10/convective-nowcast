// System, trust and the API surface. The source rows describe what this replay
// actually contains, the latency is a timed request to the running server, and
// the event feed is the console's own log — not a scripted ticker.

import { useEffect, useState } from "react";
import { ENDPOINTS, pingApi } from "../api";
import { useStore } from "../store";

const STAGES = [
  { name: "Radar VIL", what: "1 km, 5 min · structure and motion" },
  { name: "Satellite IR", what: "6.9 and 10.7 µm · cloud-top cooling" },
  { name: "Lightning", what: "GLM flashes · density and trend" },
  { name: "Alignment", what: "one 384 km grid at 1 km, 5 min" },
  { name: "Tier-aware U-Net", what: "13 frames in, 12 lead frames out" },
  { name: "Cell models", what: "hail and downburst per tracked cell" },
  { name: "Tracking", what: "identity through merge and split, arrival ensemble" },
  { name: "Package", what: "rasters, frames, alerts, verification" },
];

const STACK = [
  "Serving: FastAPI · uvicorn",
  "Model: PyTorch · tier-aware U-Net",
  "Cell models: LightGBM",
  "Fields: NumPy · SciPy · scikit-image",
  "Baselines: pysteps",
  "Map: MapLibre GL · Protomaps, offline",
];

export default function System() {
  const meta = useStore((s) => s.meta);
  const log = useStore((s) => s.log);
  const alerts = useStore((s) => s.alerts);
  const observed = useStore((s) => s.observed);
  const xai = useStore((s) => s.xai);
  const results = useStore((s) => s.results);
  const loadResults = useStore((s) => s.loadResults);
  const [ms, setMs] = useState<number | null>(null);
  const [pingErr, setPingErr] = useState<string | null>(null);

  useEffect(() => { loadResults(); }, [loadResults]);
  useEffect(() => {
    let live = true;
    const tick = () =>
      pingApi()
        .then((v) => { if (live) { setMs(v); setPingErr(null); } })
        .catch((e) => { if (live) setPingErr(String(e)); });
    tick();
    const id = setInterval(tick, 5000);
    return () => { live = false; clearInterval(id); };
  }, []);

  if (!meta) return <div className="page"><p className="hint">Loading…</p></div>;

  const sources = [
    { name: "Radar VIL", state: "replay", detail: `${meta.dataset} · ${meta.grid.km_per_px} km · ${meta.step_min} min` },
    { name: "Satellite IR", state: "replay", detail: "GOES 6.9 / 10.7 µm, 2 km, upsampled" },
    { name: "Lightning", state: "replay", detail: "GLM flashes gridded to 1 km" },
    { name: "Radar coverage tiers", state: meta.availability.coverage_tiers_real ? "measured" : "simulated",
      detail: meta.coverage.source },
    { name: "NWP (3–6 h blend)", state: "absent", detail: "designed, not built — no HRRR access" },
  ];

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <h1>System, trust and delivery</h1>
          <p className="hint">
            Nothing here is live: the console plays a recorded event back from precomputed files
            and the server computes nothing. Research prototype — not an official warning.
          </p>
        </header>

        <div className="cols">
          <section className="panel flat">
            <div className="panel-head"><span>Sources in this replay</span></div>
            <div className="panel-body">
              {sources.map((s) => (
                <div className="src-row" key={s.name}>
                  <span className={`src-dot ${s.state}`} aria-hidden="true" />
                  <span className="src-name">
                    {s.name}
                    <span className="hint">{s.detail}</span>
                  </span>
                  <span className="hint">{s.state}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel flat">
            <div className="panel-head"><span>Model and package</span></div>
            <div className="panel-body">
              <div className="kv"><span className="k">Model</span>
                <span className="num">{results?.model?.model?.architecture ?? "—"}</span></div>
              <div className="kv"><span className="k">Parameters</span>
                <span className="num">{results?.train_log?.params_M?.toFixed(2) ?? "—"} M</span></div>
              <div className="kv"><span className="k">Trained at</span>
                <span className="num">{results?.train_log?.resolution_km ?? "—"} km</span></div>
              <div className="kv"><span className="k">Forecast horizon</span>
                <span className="num">0–{meta.ml_horizon_min} min</span></div>
              <div className="kv"><span className="k">Delivery grid</span>
                <span className="num">{meta.grid.km_per_px} km · {meta.grid.size}²</span></div>
              <div className="kv"><span className="k">Package built</span>
                <span className="num">{meta.created_utc?.slice(0, 16).replace("T", " ") ?? "—"} UTC</span></div>
              <div className="kv"><span className="k">Alerts in package</span>
                <span className="num">{alerts.length}</span></div>
              <div className="kv"><span className="k">Observed rasters</span>
                <span>{observed ? `${observed.frames.length} frames` : "absent"}</span></div>
              <div className="kv"><span className="k">Attributions</span>
                <span>{xai ? `${Object.keys(xai.frames).length} analysis times` : "absent"}</span></div>
            </div>
          </section>
        </div>

        <h2>Processing pipeline</h2>
        <ol className="pipeline">
          {STAGES.map((s, i) => (
            <li key={s.name}>
              <span className="pipe-n num">{i + 1}</span>
              <span className="pipe-name">{s.name}</span>
              <span className="hint">{s.what}</span>
            </li>
          ))}
        </ol>
        <div className="badge-row">
          {STACK.map((s) => <span key={s} className="chip">{s}</span>)}
        </div>
        <p className="hint">
          Every stage above runs offline in <code>export/build_replay.py</code> and its
          companions. The browser does the countdown subtraction and nothing else.
        </p>

        <h2>API surface</h2>
        <div className="api-head">
          <span className="chip">{pingErr ? "unreachable" : "responding"}</span>
          <span className="num">
            {ms === null ? "—" : `${ms.toFixed(0)} ms`}
          </span>
          <span className="hint">
            {pingErr ?? "round trip of a real GET /api/events from this browser, re-timed every 5 s"}
          </span>
        </div>
        <table className="skill">
          <thead><tr><th>Route</th><th>Method</th><th>Returns</th></tr></thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.path}>
                <td className="n">{e.path}</td>
                <td>{e.method}</td>
                <td style={{ textAlign: "left" }}>{e.what}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Console event log</h2>
        {log.length === 0 ? (
          <p className="hint">Nothing logged yet this session.</p>
        ) : (
          <div className="log">
            {log.map((r) => (
              <div className="log-row" key={`${r.t}-${r.text}`}>
                <span className="num log-time">
                  {new Date(r.t).toISOString().slice(11, 19)}
                </span>
                <span className="chip">{r.kind}</span>
                <span style={{ flex: 1 }}>{r.text}</span>
              </div>
            ))}
          </div>
        )}
        <p className="hint">
          This is what this browser session did, in order. It is not a feed of system events from
          a running forecast system — there is no running forecast system behind this console.
        </p>
      </div>
    </div>
  );
}
