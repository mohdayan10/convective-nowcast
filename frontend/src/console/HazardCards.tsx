// The hazard readout, top-left of the live map: one card per hazard parameter the
// problem statement names. Every figure is read from the analysis frames already
// loaded — the value at this analysis time, the trend against the previous one,
// and a spark over the analysis times the replay has passed. Nothing is modelled
// in the browser.

import { Frame, Hazard, Mode } from "../api";
import { analysisAt, gated, useStore } from "../store";

interface Card {
  hazard: Hazard | "vil";
  title: string;
  /** Value at each analysis frame the console has, oldest first. */
  series: (number | null)[];
  fmt: (v: number) => string;
  unit: string;
  /** What the number is and what it is not — shown on hover, not on the map. */
  sub: string;
  /** One word on the face of the card when the number carries a caveat. */
  caveat?: string;
}

export default function HazardCards() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const mode = useStore((s) => s.mode);
  const leadMin = useStore((s) => s.leadMin);

  const a = analysisAt(meta, tMin);
  if (!meta || a === null) return null;
  const past = meta.analysis_frames.filter((f) => f <= a).map((f) => frames[f]).filter(Boolean);
  if (!past.length) return null;

  const cards = buildCards(past, mode, meta.availability);

  // One line per hazard, read left to right: what it is, how much, which way it is
  // going. What the number is and is not lives in the tooltip rather than in four
  // paragraphs stacked over the map.
  const foot = `Peak value at the current analysis time, ${leadMin > meta.ml_horizon_min
    ? "which has no forecast at this lead"
    : `forecast over 0–${meta.ml_horizon_min} min`}. `
    + "The arrow compares it with the previous analysis time.";

  return (
    <div className="haz-cards" aria-label="Hazard readout" title={foot}>
      {cards.map((c) => {
        const vals = c.series.filter((v): v is number => v !== null);
        const last = vals.length ? vals[vals.length - 1] : null;
        const prev = vals.length > 1 ? vals[vals.length - 2] : null;
        return (
          <div className="haz-card" key={c.hazard}
            title={`${c.title} — ${c.sub}. ${foot}`}
            style={{ ["--key" as string]: `var(--${c.hazard === "vil" ? "accent" : c.hazard})` }}>
            <div className="haz-card-title">{c.title}</div>
            <div className="haz-card-value num">
              {last === null ? "—" : c.fmt(last)}
              <span className="unit"> {c.unit}</span>
            </div>
            <div className="haz-card-foot">
              <Trend now={last} prev={prev} />
              {c.caveat && <span className="haz-flag" title={c.sub}>{c.caveat}</span>}
            </div>
            <Spark series={c.series} />
          </div>
        );
      })}
    </div>
  );
}

function buildCards(past: Frame[], mode: Mode, avail: Record<string, boolean>): Card[] {
  const stat = (pick: (f: Frame) => number | null) => past.map(pick);

  /** Strongest cell probability the coverage tier allows on screen. */
  const cellMax = (h: Hazard) => (f: Frame) => {
    const vs = f.cells.features
      .filter((c) => gated(h, c.properties.tier, c.properties.hazards[h]))
      .map((c) => c.properties.hazards[h]!);
    return vs.length ? Math.max(...vs) : null;
  };

  const cards: Card[] = [
    {
      hazard: "cloudburst",
      title: "Extreme rainfall",
      series: stat((f) => f.modes[mode]?.accum_max_mm ?? null),
      fmt: (v) => v.toFixed(1),
      unit: "mm / 1 h",
      sub: `peak forecast accumulation · P(≥100 mm) ${
        fmtP(past[past.length - 1].modes[mode]?.p_ge_100mm_max)}`,
    },
    {
      hazard: "downburst",
      title: "Severe wind",
      series: stat(cellMax("downburst")),
      fmt: (v) => `${Math.round(v * 100)}`,
      unit: "% peak cell",
      sub: avail.downburst
        ? "proxy — VIL-core collapse, not Doppler velocity"
        : "model not trained — no probability",
      caveat: avail.downburst ? "proxy" : "not trained",
    },
    {
      hazard: "lightning",
      title: "Lightning density",
      series: stat((f) => f.modes[mode]?.lightning_max ?? null),
      fmt: (v) => v.toFixed(4),
      unit: "fl/km²/5 min",
      sub: "peak of the forecast lightning field",
    },
    {
      hazard: "hail",
      title: "Hail",
      series: stat(cellMax("hail")),
      fmt: (v) => `${Math.round(v * 100)}`,
      unit: "% peak cell",
      sub: avail.hail
        ? "cell model, raw probability"
        : "model not trained — no probability",
      caveat: avail.hail ? undefined : "not trained",
    },
  ];
  return cards;
}

const fmtP = (p: number | undefined) =>
  p === undefined ? "—" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`;

function Trend({ now, prev }: { now: number | null; prev: number | null }) {
  if (now === null || prev === null) {
    return <span className="hint" title="no previous analysis time to compare with" />;
  }
  const d = now - prev;
  const rel = prev === 0 ? (d === 0 ? 0 : 1) : d / prev;
  if (Math.abs(rel) < 0.02) return <span className="trend flat" title="steady">steady</span>;
  return (
    <span className={`trend ${d > 0 ? "up" : "down"}`}
      title={`${d > 0 ? "up" : "down"} ${Math.abs(rel * 100).toFixed(0)}% since the previous analysis`}>
      {d > 0 ? "▲" : "▼"} <span className="num">{Math.abs(rel * 100).toFixed(0)}%</span>
    </span>
  );
}

function Spark({ series }: { series: (number | null)[] }) {
  const vals = series.filter((v): v is number => v !== null);
  // Before the second analysis time there is no trend to draw. The card keeps its
  // height so the strip does not jump when the first one arrives.
  if (vals.length < 2) return <div className="spark-empty" aria-hidden="true" />;
  const W = 150, H = 22;
  const hi = Math.max(...vals), lo = Math.min(...vals, 0);
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - 2 - ((v - lo) / Math.max(hi - lo, 1e-9)) * (H - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
      aria-label={`${vals.length} analysis times, latest ${vals[vals.length - 1]}`}>
      <polyline points={pts.join(" ")} fill="none" stroke="var(--key)" strokeWidth="1.4"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
