import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "./ui";

// Shape of eval/results/baselines.json (written by eval/evaluate.py).
interface MethodScores {
  lead_min: number[];
  mean_csi: number[];
  by_threshold: Record<string, { csi: number[]; pod: number[]; far: number[]; bias: number[] }>;
  fss: Record<string, Record<string, number[]>>;
  amplitude_bias: number[];
  seconds_per_event: number;
}
interface ResultFile {
  kind: string;
  created_utc: string;
  git: string;
  data: { dataset: string; selection: string; split: string; n_events: number };
  thresholds: number[];
  fss_scales_km: number[];
  methods: Record<string, MethodScores>;
  notes?: { sprog_fallback_to_optical_flow?: { events: string[] } };
}

// Colour follows the method, never its rank. Persistence is the neutral reference.
const SERIES: Record<string, { label: string; color: string }> = {
  model: { label: "ML nowcast", color: "#7dd3c0" },
  sprog: { label: "S-PROG", color: "#d95926" },
  optical_flow: { label: "Optical flow (LK)", color: "#3987e5" },
  persistence: { label: "Persistence", color: "#8a96a8" },
};

type Metric = { key: string; label: string; get: (m: MethodScores) => number[] };

export default function SkillPanel({ files }: { files: string[] }) {
  const [data, setData] = useState<ResultFile[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(files.map((f) => fetch(`/results/${f}`).then((r) => r.json() as Promise<ResultFile>)))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, [files]);

  const merged = useMemo(() => {
    const methods: Record<string, MethodScores> = {};
    for (const d of data) Object.assign(methods, d.methods);
    return { methods, meta: data.find((d) => d.kind === "baselines") ?? data[0] };
  }, [data]);

  if (err) return <p className="muted">Could not read results: {err}</p>;
  if (!merged.meta) return <p className="muted">Loading results…</p>;
  const meta = merged.meta;

  const metrics: Metric[] = [
    { key: "mean", label: "Mean CSI", get: (m) => m.mean_csi },
    ...meta.thresholds.map((t) => ({ key: `csi${t}`, label: `CSI ≥ ${t}`, get: (m: MethodScores) => m.by_threshold[String(t)].csi })),
    ...Object.keys(Object.values(merged.methods)[0].fss).flatMap((t) =>
      meta.fss_scales_km.map((s) => ({ key: `fss${t}_${s}`, label: `FSS ≥ ${t} @ ${s} km`, get: (m: MethodScores) => m.fss[t][`${s}km`] }))),
  ];

  const hasModel = "model" in merged.methods;
  const fallback = meta.notes?.sprog_fallback_to_optical_flow?.events.length ?? 0;

  return (
    <div className="skill">
      <div className="skill-meta">
        <Badge tone="info">US-SEVIR</Badge>
        <span>
          {meta.data.n_events} test events · {meta.data.selection.replace(".csv", "")} · {meta.data.split} · written {meta.created_utc.slice(0, 16).replace("T", " ")} UTC · git {meta.git}
        </span>
      </div>
      {!hasModel && (
        <div className="note">The ML nowcast is not trained yet (milestone M5). These are the baselines it has to beat.</div>
      )}
      <Chart metrics={metrics} methods={merged.methods} />
      {fallback > 0 && (
        <p className="muted small">S-PROG fell back to optical flow on {fallback} near-empty event(s); see <code>notes</code> in baselines.json.</p>
      )}
    </div>
  );
}

function Chart({ metrics, methods }: { metrics: Metric[]; methods: Record<string, MethodScores> }) {
  const [mk, setMk] = useState("mean");
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const metric = metrics.find((m) => m.key === mk) ?? metrics[0];
  const order = Object.keys(SERIES).filter((k) => k in methods);
  const leads = methods[order[0]].lead_min;
  const series = order.map((k) => ({ k, ...SERIES[k], v: metric.get(methods[k]) }));
  const ymax = Math.min(1, Math.max(0.1, Math.ceil(Math.max(...series.flatMap((s) => s.v.filter(Number.isFinite))) * 10 + 0.5) / 10));

  const W = 1040, H = 360, L = 44, R = 132, T = 14, B = 34;
  const x = (lead: number) => L + ((lead - leads[0]) / (leads[leads.length - 1] - leads[0])) * (W - L - R);
  const y = (v: number) => T + (1 - v / ymax) * (H - T - B);
  const path = (v: number[]) =>
    v.map((val, i) => (Number.isFinite(val) ? `${i && Number.isFinite(v[i - 1]) ? "L" : "M"}${x(leads[i]).toFixed(1)},${y(val).toFixed(1)}` : "")).join(" ");
  const yt = Array.from({ length: 6 }, (_, i) => (ymax * i) / 5);
  const xt = leads.filter((l) => l % 30 === 0 || l === leads[0]);

  // Direct labels at line ends, nudged apart so they never collide.
  const ends = series.map((s) => ({ k: s.k, label: s.label, color: s.color, y: y(s.v[s.v.length - 1] ?? 0) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    leads.forEach((l, i) => { if (Math.abs(x(l) - px) < Math.abs(x(leads[best]) - px)) best = i; });
    setHover(px >= L - 10 && px <= W - R + 10 ? best : null);
  };

  return (
    <div className="chart">
      <div className="chart-bar">
        <label className="muted small" htmlFor="metric">Metric</label>
        <select id="metric" value={mk} onChange={(e) => setMk(e.target.value)}>
          {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <div className="legend-row" aria-label="Legend">
          {series.map((s) => <span key={s.k}><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      </div>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
        aria-label={`${metric.label} by lead time`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="tick-l">{v.toFixed(2)}</text>
          </g>
        ))}
        {xt.map((l) => <text key={l} x={x(l)} y={H - B + 18} textAnchor="middle" className="tick-l">{l} min</text>)}
        <text x={L} y={H - 4} className="axis-l">lead time</text>
        {series.map((s) => <path key={s.k} d={path(s.v)} className="line" style={{ stroke: s.color }} />)}
        {ends.map((e) => <text key={e.k} x={W - R + 8} y={e.y + 4} className="end-l" fill="currentColor">{e.label}</text>)}
        {hover !== null && (
          <g>
            <line x1={x(leads[hover])} x2={x(leads[hover])} y1={T} y2={H - B} className="cross" />
            {series.map((s) => Number.isFinite(s.v[hover]) && (
              <circle key={s.k} cx={x(leads[hover])} cy={y(s.v[hover])} r={4} fill={s.color} className="dot" />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(leads[hover]) / W) * 100}%` }}>
          <b>T+{leads[hover]} min</b>
          {series.map((s) => (
            <div key={s.k}><i style={{ background: s.color }} />{s.label}<span>{Number.isFinite(s.v[hover]) ? s.v[hover].toFixed(3) : "—"}</span></div>
          ))}
        </div>
      )}
      <details className="table-view">
        <summary>Table view</summary>
        <div className="table-wrap">
          <table className="v-table">
            <thead><tr><th>Lead</th>{series.map((s) => <th key={s.k} className="num">{s.label}</th>)}</tr></thead>
            <tbody>
              {leads.map((l, i) => (l % 15 === 0 || i === 0) && (
                <tr key={l}><td>T+{l} min</td>{series.map((s) => <td key={s.k} className="num">{Number.isFinite(s.v[i]) ? s.v[i].toFixed(3) : "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
