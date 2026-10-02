import { CellProps, HAZARDS, HAZARD_LABEL, HAZARD_MARK } from "../api";
import { one, pct } from "../fmt";
import { analysisAt, gated, useStore } from "../store";

export default function StormDetail() {
  const meta = useStore((s) => s.meta);
  const frames = useStore((s) => s.frames);
  const tMin = useStore((s) => s.tMin);
  const id = useStore((s) => s.selectedCell);
  const selectCell = useStore((s) => s.selectCell);
  const setMode = useStore((s) => s.setMode);
  const mode = useStore((s) => s.mode);

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  const f = frame?.cells.features.find((x) => x.properties.id === id);
  if (id === null || !frame) return null;

  if (!f) {
    return (
      <div className="sheet">
        <Head title={`Storm ${id}`} onClose={() => selectCell(null)} />
        <div className="panel-body hint">This cell is not present at the current analysis time.</div>
      </div>
    );
  }

  const p = f.properties;
  const live = HAZARDS.filter((h) => p.hazards[h] !== undefined);

  return (
    <div className="sheet">
      <Head title={`Storm ${p.id}`} onClose={() => selectCell(null)} />

      <div className="panel-body">
        <div className="kv"><span className="k">First seen</span><span className="num">{p.first_min} min</span></div>
        <div className="kv"><span className="k">Peak VIL</span><span className="num">{one(p.vil_max_kgm2)} kg/m²</span></div>
        <div className="kv"><span className="k">Cell area</span><span className="num">{p.area_km2} km²</span></div>
        <div className="kv">
          <span className="k">Core ≥ {meta?.core_threshold_kgm2} kg/m²</span>
          <span className="num">{p.core_area_km2} km²</span>
        </div>
        <div className="kv"><span className="k">Radar coverage</span><span>{tierWord(p.tier)}</span></div>
      </div>

      <section className="panel">
        <div className="panel-head"><span>Intensity so far</span><span className="hint">kg/m²</span></div>
        <div className="panel-body">
          <Spark series={p.vil_series} />
          <p className="hint">
            Observed peak VIL in this cell up to the analysis time. Per-lead hazard curves
            are not computed — the hazard models score the cell at the analysis time only.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><span>Hazards</span></div>
        <div className="panel-body">
          {live.length === 0 && (
            <p className="hint">
              Hail and downburst models are not trained yet, so this cell carries no hazard
              probability. Lightning and cloudburst are map layers.
            </p>
          )}
          {live.map((h) => {
            const shown = gated(h, p.tier, p.hazards[h]);
            return (
              <div className="reason" key={h}>
                <span className={`dot ${h}`} aria-hidden="true">{HAZARD_MARK[h]}</span>
                <span style={{ flex: 1 }}>{HAZARD_LABEL[h]}</span>
                {shown
                  ? <span className="num">{pct(p.hazards[h]!)}</span>
                  : <span className="hint">hidden at {tierWord(p.tier)}</span>}
              </div>
            );
          })}
          {p.hazards.downburst !== undefined && (
            <p className="hint" style={{ marginTop: 6 }}>{meta?.notes.downburst}</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><span>Lineage</span></div>
        <div className="panel-body">
          <Lineage p={p} onPick={selectCell} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><span>Initiation</span></div>
        <div className="panel-body">
          {frame.initiation.length === 0 ? (
            <p className="hint">
              {meta?.availability.initiation
                ? "No initiation candidate above threshold at this time."
                : "Initiation model not trained yet."}
            </p>
          ) : (
            <Ci c={frame.initiation[0]} />
          )}
        </div>
      </section>

      <div className="panel-body">
        <button
          className="btn primary"
          onClick={() => setMode(mode === "noradar" ? "all" : "noradar")}
        >
          {mode === "noradar" ? "Restore radar" : "Show without radar"}
        </button>
      </div>
    </div>
  );
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="sheet-head">
      <span className="t">{title}</span>
      <button className="x" onClick={onClose} aria-label="Close panel">×</button>
    </div>
  );
}

function tierWord(t: string) {
  return t === "none" ? "no radar" : t === "partial" ? "partial" : "full";
}

function Spark({ series }: { series: [number, number][] | undefined }) {
  if (!series || series.length < 2) return <p className="hint">Too short to plot.</p>;
  const W = 300, H = 44;
  const xs = series.map((d) => d[0]), ys = series.map((d) => d[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...ys, 1);
  const pt = (d: [number, number]) =>
    `${((d[0] - x0) / Math.max(x1 - x0, 1)) * W},${H - (d[1] / y1) * (H - 4) - 2}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
      aria-label={`Peak VIL rose to ${y1.toFixed(1)} kg per square metre`}>
      <polyline points={series.map(pt).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
    </svg>
  );
}

function Lineage({ p, onPick }: { p: CellProps; onPick: (id: number) => void }) {
  // The tracker keeps the dominant ID through merges, so a long-lived mesoscale
  // system accumulates many parents. The most recent few are what matter now.
  const parents = p.parents.slice(-6);
  const hidden = p.parents.length - parents.length;
  if (!p.parents.length && !p.children.length) {
    return <p className="hint">No merge or split so far — this cell has kept one identity.</p>;
  }
  return (
    <>
      {parents.length > 0 && (
        <div className="reason">
          <span className="k" style={{ color: "var(--dim)", width: 62 }}>merged in</span>
          <span style={{ flex: 1 }}>
            {parents.map((q) => (
              <button key={q} className="chip" style={{ marginRight: 4, cursor: "pointer" }}
                onClick={() => onPick(q)}>{q}</button>
            ))}
            {hidden > 0 && <span className="hint">+{hidden} earlier</span>}
          </span>
        </div>
      )}
      {p.children.length > 0 && (
        <div className="reason">
          <span className="k" style={{ color: "var(--dim)", width: 62 }}>split off</span>
          <span style={{ flex: 1 }}>
            {p.children.slice(-6).map((q) => (
              <button key={q} className="chip" style={{ marginRight: 4, cursor: "pointer" }}
                onClick={() => onPick(q)}>{q}</button>
            ))}
          </span>
        </div>
      )}
      <p className="hint" style={{ marginTop: 6 }}>
        The dominant cell keeps its ID through a merge or split, so an alert raised for a
        storm stays attached to it.
      </p>
    </>
  );
}

function Ci({ c }: { c: { score: number; reasons: { feature: string; effect: number }[] } }) {
  const top = Math.max(...c.reasons.map((r) => Math.abs(r.effect)), 1e-6);
  return (
    <>
      <div className="kv">
        <span className="k">Initiation score</span>
        <span className="num" style={{ fontSize: 17 }}>{c.score}</span>
      </div>
      {c.reasons.map((r) => (
        <div className="reason" key={r.feature}>
          <span className="bar"><i style={{ width: `${(Math.abs(r.effect) / top) * 100}%` }} /></span>
          <span style={{ flex: 1 }}>{r.feature}</span>
        </div>
      ))}
      <p className="hint" style={{ marginTop: 6 }}>Top contributions from the model, largest first.</p>
    </>
  );
}
