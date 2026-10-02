import { HAZARDS, HAZARD_LABEL, MODE_LABEL, Mode } from "../api";
import { pct } from "../fmt";
import { LayerKey, useStore } from "../store";

const SWATCH: Partial<Record<LayerKey, string>> = {
  lightning: "var(--lightning)", hail: "var(--hail)",
  downburst: "var(--downburst)", cloudburst: "var(--cloudburst)",
};

export default function LayerRail() {
  const layers = useStore((s) => s.layers);
  const toggle = useStore((s) => s.toggleLayer);
  const meta = useStore((s) => s.meta);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const avail = meta?.availability ?? {};

  const row = (k: LayerKey, label: string, note?: string, empty = false) => (
    <button
      key={k}
      className={`layer-row${empty ? " empty-layer" : ""}`}
      aria-pressed={layers[k]}
      onClick={() => toggle(k)}
      style={{ ["--swatch" as string]: SWATCH[k] ?? "var(--accent)" }}
      title={note}
    >
      <span className="box" aria-hidden="true" />
      <span className="label">{label}</span>
      {empty && <span className="hint">no model</span>}
    </button>
  );

  return (
    <aside className="rail-l" aria-label="Layers">
      {/* One list, not two: hazards first because they are what the map is for,
          then the things drawn on top of them. A layer with no model behind it is
          dimmed in place rather than given a line of explanation underneath. */}
      <section className="panel">
        <div className="panel-head"><span>Map layers</span></div>
        {HAZARDS.map((h) =>
          row(h, HAZARD_LABEL[h],
            avail[h] === false ? "Model not trained yet — layer empty" : undefined,
            avail[h] === false))}
        <div className="layer-split" />
        {row("obs", "Observed radar, now",
          "What the radar sees at the replay clock — the observation, not a forecast")}
        {row("vil", "Forecast VIL at the lead",
          "The model's field at the lead on the transport bar")}
        {row("cells", "Storm cells")}
        {row("tracks", "Tracks")}
        {row("cones", "Uncertainty cones")}
        {row("initiation", "Initiation candidates",
          avail.initiation ? undefined : "Initiation model not trained yet", !avail.initiation)}
        {row("sites", "Named locations")}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Radar coverage</span>
          {meta && !avail.coverage_tiers_real && (
            <span className="chip warn" title={meta.notes.coverage}>SIM</span>
          )}
        </div>
        <div className="panel-body">
          {row("coverage", "Show coverage tiers")}
          <div className="mode-switch">
            <div className="hint" style={{ marginBottom: 4 }}>Sources the model may see</div>
            <div className="seg stack" role="group" aria-label="Coverage mode">
              {(["all", "noradar", "satonly"] as Mode[]).map((m) => (
                <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}
                  title={m === "all" ? "Radar, satellite and lightning"
                    : m === "noradar" ? "Radar removed: the model forecasts from satellite and lightning"
                    : "Satellite only: radar and lightning both removed"}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          {meta && (
            <div style={{ marginTop: 6 }}>
              {(["full", "partial", "none"] as const).map((t) => (
                <div className="tier-key" key={t}>
                  <i style={{ background: `var(--cov-${t})` }} aria-hidden="true" />
                  <span style={{ flex: 1 }}>{t === "none" ? "No radar" : t === "partial" ? "Partial" : "Full"}</span>
                  <span className="num hint">{pct(meta.coverage.share[t] ?? 0)}</span>
                </div>
              ))}
              <p className="hint tiny" style={{ marginTop: 6 }} title={meta.notes.coverage}>
                Tiers are simulated.
              </p>
            </div>
          )}
        </div>
      </section>

    </aside>
  );
}
