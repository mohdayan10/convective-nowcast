// The transport bar, shared by every map screen. Two axes, because an operational
// console needs both: where the replay has got to, and how far ahead the forecast
// on the map is looking. The counters on the right are read from the current
// analysis frame, for the coverage mode currently selected.

import { useCallback, useRef } from "react";
import { MODE_LABEL } from "../api";
import { clock, lead as leadLabel, one } from "../fmt";
import { analysisAt, useStore } from "../store";

const LEAD_MAX = 360;          // the 0–6 h the problem statement asks for
const LEAD_TICKS = [30, 60, 120, 180, 240, 300];
// Replay acceleration, not playback rate: at 1× a four-hour event takes four
// hours, which is no use in a demo, so the slowest offered is 5×.
const SPEEDS = [5, 10, 20, 60];

export default function Transport() {
  const meta = useStore((s) => s.meta);
  const tMin = useStore((s) => s.tMin);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const leadMin = useStore((s) => s.leadMin);
  const mode = useStore((s) => s.mode);
  const frames = useStore((s) => s.frames);
  const setClock = useStore((s) => s.setClock);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const setLead = useStore((s) => s.setLead);

  const end = meta ? (meta.n_frames - 1) * meta.step_min : 240;
  const horizon = meta?.ml_horizon_min ?? 60;
  const start = meta ? meta.analysis_frames[0] * meta.step_min : 0;

  const a = analysisAt(meta, tMin);
  const frame = a === null ? null : frames[a];
  const stats = frame?.modes?.[mode];
  const cells = frame?.cells.features.length ?? null;
  const core = frame
    ? frame.cells.features.reduce((n, f) => n + f.properties.core_area_km2, 0)
    : null;
  const valid = meta && a !== null
    ? new Date(new Date(meta.start_utc).getTime() + (a * meta.step_min + leadMin) * 60000)
    : null;

  return (
    <footer className="transport">
      <div className="transport-ctl">
        <button className="play" onClick={() => { setPlaying(false); setClock(start); }}
          aria-label="Reset the replay to the first analysis time" title="Reset">↺</button>
        <button className="play" onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause replay" : "Play replay"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="seg" role="group" aria-label="Replay acceleration">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
      </div>

      <div className="horizon-readout">
        <span className="big num">{leadMin === 0 ? "NOW" : `+${leadLabel(leadMin)}`}</span>
        <span className="hint num">
          {valid ? `${valid.toISOString().slice(11, 16)} UTC valid` : "—"}
          {" · "}T+{clock(tMin)}
        </span>
      </div>

      <div className="transport-tracks">
        <div className="scrub-col">
          <div className="scrub-labels">
            <span>Replay</span>
            <span className="num">{Math.round(tMin)} / {end} min</span>
          </div>
          <Track value={tMin} max={end} onChange={(v) => setClock(v)} label="Replay time"
            ticks={meta ? meta.analysis_frames.map((f) => f * meta.step_min) : []} />
        </div>
        <div className="scrub-col">
          <div className="scrub-labels">
            <span>Forecast lead &mdash; 0&ndash;{horizon} min trained, hatched beyond</span>
            <span className="num">{leadMin === 0 ? "now" : leadLabel(leadMin)}</span>
          </div>
          <Track value={leadMin} max={LEAD_MAX} unvalidatedFrom={horizon} ticks={LEAD_TICKS}
            onChange={setLead} label="Forecast lead time" />
        </div>
      </div>

      <dl className="counters" aria-label="Current analysis">
        <Counter k="cells" v={cells === null ? "—" : String(cells)} />
        <Counter k={`peak VIL · ${MODE_LABEL[mode].toLowerCase()}`}
          v={stats ? `${one(stats.vil_max_kgm2)}` : "—"} unit="kg/m²" />
        <Counter k="core area" v={core === null ? "—" : String(core)} unit="km²" />
        <Counter k="horizon" v={leadMin === 0 ? "now" : leadLabel(leadMin)} />
      </dl>
    </footer>
  );
}

function Counter({ k, v, unit }: { k: string; v: string; unit?: string }) {
  return (
    <div className="counter">
      <dt>{k}</dt>
      <dd className="num">{v}{unit && <span className="unit"> {unit}</span>}</dd>
    </div>
  );
}

function Track({
  value, max, onChange, label, unvalidatedFrom, ticks = [],
}: {
  value: number; max: number; onChange: (v: number) => void; label: string;
  unvalidatedFrom?: number; ticks?: number[];
}) {
  const el = useRef<HTMLDivElement>(null);

  const pick = useCallback((clientX: number) => {
    const r = el.current?.getBoundingClientRect();
    if (!r) return;
    onChange(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max);
  }, [max, onChange]);

  const drag = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(e.clientX);
  };

  const pc = (v: number) => `${(v / max) * 100}%`;

  return (
    <div
      ref={el}
      className="track"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onPointerDown={drag}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && pick(e.clientX)}
      onKeyDown={(e) => {
        const d = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
        if (d) { e.preventDefault(); onChange(Math.max(0, Math.min(max, value + d))); }
      }}
    >
      <div className="rail" />
      {unvalidatedFrom !== undefined && (
        <div
          className="unvalidated"
          style={{ left: pc(unvalidatedFrom), width: pc(max - unvalidatedFrom) }}
          title="No validated forecast here: the ML nowcast ends and no NWP blend is wired in"
        />
      )}
      <div className="done" style={{ width: pc(Math.min(value, unvalidatedFrom ?? max)) }} />
      {ticks.map((t) => <div key={t} className="tick" style={{ left: pc(t) }} />)}
      <div className="knob" style={{ left: pc(value) }} />
    </div>
  );
}
