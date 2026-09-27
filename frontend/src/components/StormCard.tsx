import { ChevronRight, Radar } from "lucide-react";
import { clockLabel, interp } from "../model/grid";
import {
  Mode, brightnessTemp, ciDetectTime, ciObjects, ciScore, flashRate, sample, truthState,
} from "../model/physics";
import { CI_FAILS, HAZARDS, STORMS, childrenOf, stormById } from "../model/scenario";
import { HAZARD_LABEL } from "../model/derive";
import { HAZARD_COLOR } from "../map/raster";
import type { Selection } from "../map/MapView";
import { Badge, HazardIcon, pct } from "./ui";

interface Props { t: number; mode: Mode; selected: Selection; onSelect: (s: Selection) => void }

const compass = (ux: number, uy: number) => {
  const deg = (Math.atan2(ux, uy) * 180) / Math.PI;
  const d = (deg + 360) % 360;
  return { deg: Math.round(d), name: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8] };
};

export default function StormCard({ t, mode, selected, onSelect }: Props) {
  const id = selected?.kind === "storm" ? selected.id : null;
  const def = id !== null ? stormById.get(id) : undefined;
  const fail = id !== null ? CI_FAILS.find((f) => f.id === id) : undefined;

  if (def) {
    const st = truthState(def, t);
    if (st?.phase === "mature") return <Mature id={def.id} t={t} mode={mode} onSelect={onSelect} />;
    if (st?.phase === "ci") return <CiView id={def.id} t={t} mode={mode} />;
  }
  if (fail) return <CiView id={fail.id} t={t} mode={mode} />;
  return <StormList t={t} mode={mode} onSelect={onSelect} gone={id !== null} />;
}

function StormList({ t, mode, onSelect, gone }: { t: number; mode: Mode; onSelect: Props["onSelect"]; gone: boolean }) {
  const cells = STORMS.map((s) => ({ s, st: truthState(s, t) })).filter((x) => x.st?.phase === "mature");
  const cis = ciObjects(t, mode).filter((c) => c.becomes === undefined || t < stormById.get(c.becomes)!.tEcho);
  return (
    <>
      {gone && <div className="note">That cell has dissipated or become another cell.</div>}
      <h4 className="sub">Active cells</h4>
      {cells.length === 0 && <div className="muted pad">No radar echoes above threshold.</div>}
      {cells.map(({ s, st }) => (
        <button key={s.id} className="row-btn" onClick={() => onSelect({ kind: "storm", id: s.id })}>
          <span className="cell-chip">{s.id}</span>
          <span>VIL {st!.I.toFixed(0)} kg/m² · {compass(st!.ux, st!.uy).name} {(st!.speed * 60).toFixed(0)} km/h</span>
          <ChevronRight size={15} />
        </button>
      ))}
      <h4 className="sub">Initiation candidates</h4>
      {cis.length === 0 && <div className="muted pad">None — the CI detector flags growing cumulus before radar sees them.</div>}
      {cis.map((c) => (
        <button key={c.id} className="row-btn" onClick={() => onSelect({ kind: "storm", id: c.id })}>
          <span className="ci-chip">CI</span>
          <span>Candidate {c.id} · score {Math.round(c.score * 100)}</span>
          <ChevronRight size={15} />
        </button>
      ))}
    </>
  );
}

function Lineage({ id, t, onSelect }: { id: number; t: number; onSelect: Props["onSelect"] }) {
  const def = stormById.get(id)!;
  const kids = childrenOf(id).filter((k) => t >= stormById.get(k)!.tEcho);
  const col = (ids: number[], cur = false) => (
    <div className="lin-col">
      {ids.map((k) => (
        <button key={k} className={`lin-node ${cur ? "cur" : ""}`} onClick={() => onSelect({ kind: "storm", id: k })}>{k}</button>
      ))}
    </div>
  );
  if (!def.parents.length && !kids.length) return <div className="muted">Single cell — no merges or splits yet.</div>;
  return (
    <div className="lineage">
      {def.parents.length > 0 && <>{col(def.parents)}<div className="lin-arrow">{def.parents.length > 1 ? "merge" : "split"} →</div></>}
      {col([id], true)}
      {kids.length > 0 && <><div className="lin-arrow">split →</div>{col(kids)}</>}
    </div>
  );
}

function Mature({ id, t, mode, onSelect }: { id: number; t: number; mode: Mode; onSelect: Props["onSelect"] }) {
  const def = stormById.get(id)!;
  const st = truthState(def, t)!;
  const dir = compass(st.ux, st.uy);
  const tb = brightnessTemp(t, st.x, st.y);
  const fr = flashRate(def, t);
  const fr0 = flashRate(def, t - 10);
  const trend = interp(def.vil, t) - interp(def.vil, t - 10);
  const phase = trend > 3 ? "Intensifying" : trend < -6 ? "Collapsing" : "Mature";
  // Origin: the CI detection of this cell or its earliest ancestor.
  const roots: number[] = [];
  const walk = (k: number) => { const d = stormById.get(k)!; d.parents.length ? d.parents.forEach(walk) : roots.push(k); };
  walk(id);
  const haz = HAZARDS.map((h) => {
    let m = 0;
    for (let l = 0; l <= 30; l += 10) m = Math.max(m, sample(t, l, mode, st.x, st.y)[h]);
    return { h, p: m };
  });

  return (
    <div className="storm">
      <div className="storm-head">
        <span className="cell-chip big">{id}</span>
        <div>
          <div className="storm-title">Cell {id}</div>
          <div className="muted">{phase} · first echo {clockLabel(def.tEcho)}</div>
        </div>
        {phase === "Collapsing" && <Badge tone="proxy" title="Rapid VIL collapse is the downburst proxy">DOWNBURST PROXY</Badge>}
      </div>

      <div className="stats">
        <Stat k="Peak VIL" v={`${st.I.toFixed(0)}`} u="kg/m²" d={`${trend >= 0 ? "+" : ""}${trend.toFixed(0)} / 10 min`} />
        <Stat k="Motion" v={`${(st.speed * 60).toFixed(0)}`} u="km/h" d={`toward ${dir.name} (${dir.deg}°)`} />
        <Stat k="Cloud top" v={`${(tb - 273.15).toFixed(0)}`} u="°C" d={`${tb.toFixed(0)} K IR`} />
        <Stat k="Flash rate" v={mode === "satonly" ? "—" : fr.toFixed(0)} u={mode === "satonly" ? "" : "/min"} d={mode === "satonly" ? "no lightning feed" : fr0 > 0.5 ? `×${(fr / fr0).toFixed(1)} vs 10 min ago` : "onset"} />
      </div>

      <h4 className="sub">Hazards, next 30 min</h4>
      <div className="hz-bars">
        {haz.map(({ h, p }) => (
          <div key={h} className="hz-bar">
            <HazardIcon h={h} size={14} />
            <span className="hz-name">{HAZARD_LABEL[h]}</span>
            <span className="hz-track"><span style={{ width: `${p * 100}%`, background: HAZARD_COLOR[h] }} /></span>
            <span className="hz-v">{pct(p)}</span>
          </div>
        ))}
      </div>

      <h4 className="sub">Lineage</h4>
      <Lineage id={id} t={t} onSelect={onSelect} />
      <p className="muted small">IDs persist through merges and splits (TITAN-style tracking, extended) so alerts stay attached to the same storm.</p>

      <h4 className="sub">Origin</h4>
      {roots.map((r) => {
        const rd = stormById.get(r)!;
        const d = ciDetectTime(rd, mode);
        return (
          <div key={r} className="origin">
            <Radar size={14} />
            {d !== null ? (
              <span>Cell {r}: CI flagged <b>{clockLabel(d)}</b>, first radar echo {clockLabel(rd.tEcho)} — <b>{rd.tEcho - d} min</b> before radar.</span>
            ) : (
              <span>Cell {r}: first seen on radar {clockLabel(rd.tEcho)}.</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ k, v, u, d }: { k: string; v: string; u: string; d: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}<small>{u}</small></div>
      <div className="d">{d}</div>
    </div>
  );
}

function CiView({ id, t, mode }: { id: number; t: number; mode: Mode }) {
  const def = stormById.get(id);
  const fail = CI_FAILS.find((f) => f.id === id);
  const x = def ? def.path[0][1] : fail!.x, y = def ? def.path[0][2] : fail!.y;
  const score = (k: number) => {
    if (def) return ciScore(def, k, mode);
    const f = fail!;
    if (k < f.t0 || k > f.tPeak + 45) return 0;
    const g = k <= f.tPeak ? (k - f.t0) / (f.tPeak - f.t0) : 1 - (k - f.tPeak) / 45;
    return f.peak * Math.max(0, g);
  };
  const s = score(t);
  const tb = brightnessTemp(t, x, y), tb15 = brightnessTemp(t - 15, x, y);
  const cooling = tb15 - tb;
  const flash = def ? flashRate(def, t) : 0;
  const t0 = def ? def.ci!.t0 : fail!.t0;
  const hist: [number, number][] = [];
  for (let k = t0; k <= t; k += 5) hist.push([k, score(k)]);

  const reasons = [
    { l: "Cloud-top cooling", v: `−${cooling.toFixed(1)} K / 15 min`, w: Math.min(1, cooling / 16) },
    { l: "Coldest top", v: `${(tb - 273.15).toFixed(0)} °C`, w: Math.min(1, Math.max(0, (270 - tb) / 45)) },
    { l: "Lightning onset", v: mode === "satonly" ? "no feed" : flash > 0 ? `${flash.toFixed(1)} /min` : "none yet", w: mode === "satonly" ? 0 : Math.min(1, flash / 0.6) },
    { l: "Terrain trigger", v: "upslope, Mussoorie range", w: 0.3 },
  ].sort((a, b) => b.w - a.w);

  const W = 300, H = 64;
  const path = hist.map(([k, v], i) => `${i ? "L" : "M"}${((k - t0) / Math.max(5, t - t0)) * W},${H - v * H}`).join(" ");

  return (
    <div className="storm">
      <div className="storm-head">
        <span className="ci-chip big">CI</span>
        <div>
          <div className="storm-title">Initiation candidate {id}</div>
          <div className="muted">Not yet on radar · watching since {clockLabel(t0)}</div>
        </div>
      </div>

      <div className="gauge">
        <div className="gauge-v">{Math.round(s * 100)}<small>/100</small></div>
        <div className="gauge-k">CI score · alert at 50</div>
        <div className="gauge-bar"><span style={{ width: `${s * 100}%` }} /><i style={{ left: "50%" }} /></div>
      </div>

      <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="CI score history">
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="spark-ref" />
        <path d={path} className="spark-line" />
      </svg>
      <div className="spark-axis"><span>{clockLabel(t0)}</span><span>{clockLabel(t)}</span></div>

      <h4 className="sub">Why (feature contributions)</h4>
      <ul className="why">
        {reasons.map((r) => (
          <li key={r.l}>
            <span className="why-bar"><span style={{ width: `${Math.max(6, r.w * 100)}%` }} /></span>
            <span className="why-l">{r.l}</span>
            <span className="why-v">{r.v}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Synthetic contributions. With a trained classifier these come from SHAP values of the same features.</p>
    </div>
  );
}
