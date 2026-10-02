// Shared line chart for the evaluation screens. Small, axis-labelled, no gridline
// decoration beyond the four it needs; a metric that is undefined is left out of
// the line rather than drawn as zero.

export type Curve = { name: string; colour: string; x: number[]; y: number[] };

/** An undefined metric (null from the API) prints as an em dash, never as 0. */
export const fx = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "\u2014" : v.toFixed(d);

export const METHOD_LABEL: Record<string, string> = {
  persistence: "Persistence", optical_flow: "Optical flow (Lucas\u2013Kanade)", sprog: "S-PROG",
  model: "Tier-aware U-Net",
};
// Deliberately not the hazard colours: those mean one thing everywhere and a
// skill curve is not a hazard. The model takes the accent; the baselines are a
// muted blue family so the comparison reads at a glance.
export const METHOD_COLOUR: Record<string, string> = {
  model: "#4fd1c5", sprog: "#7aa7c7", optical_flow: "#55748e", persistence: "#8a9ba8",
};
export const LINE = ["#4fd1c5", "#7aa7c7", "#55748e", "#8a9ba8"];
export const TIER_COLOUR = ["#2e7d5b", "#b5852e", "#8a9ba8"];

export default function Chart({ curves, xLabel = "lead time (min)", yLabel, height = 250 }: {
  curves: Curve[];
  xLabel?: string;
  yLabel?: string;
  height?: number;
}) {
  const W = 760, H = height, P = 50;
  const all = curves.flatMap((c) => c.y).filter((v) => Number.isFinite(v));
  if (!curves.length || !all.length) return <p className="empty">Nothing to plot.</p>;
  const xMin = Math.min(...curves.flatMap((c) => c.x));
  const xMax = Math.max(...curves.flatMap((c) => c.x));
  const yMax = Math.max(...all) * 1.15;
  const px = (v: number) => P + ((v - xMin) / Math.max(xMax - xMin, 1e-9)) * (W - P - 10);
  const py = (v: number) => H - P - (v / yMax) * (H - P - 14);

  return (
    <figure style={{ margin: "6px 0 2px" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={curves.map((c) => `${c.name} peaks at ${Math.max(...c.y).toFixed(3)}`).join("; ")}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={P} x2={W - 10} y1={py(yMax * f)} y2={py(yMax * f)} stroke="#1d2a35" />
            <text x={P - 6} y={py(yMax * f) + 4} textAnchor="end" fill="#8a9ba8" fontSize="11">
              {(yMax * f).toFixed(2)}
            </text>
          </g>
        ))}
        <text x={(W + P) / 2} y={H - 6} textAnchor="middle" fill="#8a9ba8" fontSize="11">{xLabel}</text>
        {yLabel && (
          <text x={12} y={(H - P) / 2} fill="#8a9ba8" fontSize="11" textAnchor="middle"
            transform={`rotate(-90 12 ${(H - P) / 2})`}>{yLabel}</text>
        )}
        {curves.map((c) => (
          <polyline key={c.name} fill="none" stroke={c.colour} strokeWidth="1.8"
            points={c.x.map((x, i) => (Number.isFinite(c.y[i]) ? `${px(x)},${py(c.y[i])}` : ""))
              .filter(Boolean).join(" ")} />
        ))}
      </svg>
      <figcaption style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
        {curves.map((c) => (
          <span key={c.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 14, height: 3, background: c.colour, display: "inline-block" }} />
            {c.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
