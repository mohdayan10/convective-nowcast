import { useMemo, useRef } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { FRAME, LEAD_MAX, LEAD_STEP, ML_HORIZON, T_END, clockLabel, leadLabel } from "../model/grid";
import { Mode, ciDetectTime } from "../model/physics";
import { STORMS } from "../model/scenario";
import type { Alert } from "../model/derive";
import { HAZARD_COLOR } from "../map/raster";
import { Segmented } from "./ui";

interface Props {
  t: number;
  onT: (t: number) => void;
  lead: number;
  onLead: (l: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  mode: Mode;
  alerts: Alert[];
}

interface Ev { t: number; label: string; kind: "ci" | "echo" | "merge" | "split" }

function useDrag(onValue: (f: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    onValue(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    at(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons & 1) at(e.clientX);
  };
  return { ref, onPointerDown, onPointerMove };
}

export default function Timeline(p: Props) {
  const events = useMemo<Ev[]>(() => {
    const ev: Ev[] = [];
    for (const s of STORMS) {
      const d = ciDetectTime(s, p.mode);
      if (d !== null) ev.push({ t: d, label: `CI detected → cell ${s.id}`, kind: "ci" });
      if (s.ci) ev.push({ t: s.tEcho, label: `First radar echo, cell ${s.id}`, kind: "echo" });
      if (s.parents.length > 1) ev.push({ t: s.tEcho, label: `Merge ${s.parents.join(" + ")} → ${s.id}`, kind: "merge" });
    }
    const splits = new Map<number, number[]>();
    for (const s of STORMS) if (s.parents.length === 1) splits.set(s.parents[0], [...(splits.get(s.parents[0]) ?? []), s.id]);
    for (const [pid, kids] of splits) {
      const k = STORMS.find((s) => s.id === kids[0])!;
      ev.push({ t: k.tEcho, label: `Split ${pid} → ${kids.join(", ")}`, kind: "split" });
    }
    return ev.sort((a, b) => a.t - b.t);
  }, [p.mode]);

  const replay = useDrag((f) => p.onT(Math.round((f * T_END) / FRAME) * FRAME));
  const leadDrag = useDrag((f) => p.onLead(Math.round((f * LEAD_MAX) / LEAD_STEP) * LEAD_STEP));
  const pos = (t: number) => `${(t / T_END) * 100}%`;
  const lpos = (l: number) => `${(l / LEAD_MAX) * 100}%`;
  const hours = [0, 60, 120, 180, 240, 300, 360];

  const validLabel =
    p.lead === 0 ? "Observed" : p.lead <= ML_HORIZON ? "ML nowcast" : `NWP blend ${Math.round(((p.lead - ML_HORIZON) / (LEAD_MAX - ML_HORIZON)) * 100)}%`;

  return (
    <div className="timeline">
      <div className="tl-controls">
        <button className="icon-btn" onClick={() => p.onT(Math.max(0, p.t - FRAME))} title="Back 5 min (←)" aria-label="Back 5 minutes"><SkipBack size={16} /></button>
        <button className="play" onClick={() => p.onPlaying(!p.playing)} title="Play / pause (space)" aria-label={p.playing ? "Pause" : "Play"}>
          {p.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="icon-btn" onClick={() => p.onT(Math.min(T_END, p.t + FRAME))} title="Forward 5 min (→)" aria-label="Forward 5 minutes"><SkipForward size={16} /></button>
        <Segmented<string>
          size="sm" label="Playback speed" value={String(p.speed)} onChange={(v) => p.onSpeed(Number(v))}
          options={[{ value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }]}
        />
      </div>

      <div className="tl-rows">
        <div className="tl-row">
          <div className="tl-label">Replay <span className="tl-val">{clockLabel(p.t)}</span></div>
          <div className="track replay" {...replay} role="slider" aria-label="Replay time" aria-valuemin={0} aria-valuemax={T_END} aria-valuenow={p.t} aria-valuetext={`${clockLabel(p.t)} IST`} tabIndex={0}>
            <div className="track-fill" style={{ width: pos(p.t) }} />
            {hours.map((h) => (
              <span key={h} className="tick" style={{ left: pos(h) }}><span>{clockLabel(h)}</span></span>
            ))}
            {events.filter((e) => e.t <= p.t).map((e, i) => (
              <span key={i} className={`ev ev-${e.kind}`} style={{ left: pos(e.t) }} title={`${clockLabel(e.t)} · ${e.label}`} />
            ))}
            {p.alerts.filter((a) => a.t <= p.t).map((a) => (
              <span key={a.id} className="ev-alert" style={{ left: pos(a.t), background: HAZARD_COLOR[a.hazard] }} title={`${clockLabel(a.t)} · ${a.hazard} alert · ${a.site.short}`} />
            ))}
            <span className="thumb" style={{ left: pos(p.t) }} />
          </div>
        </div>

        <div className="tl-row">
          <div className="tl-label">Lead <span className="tl-val">{leadLabel(p.lead)}</span></div>
          <div className="track lead" {...leadDrag} role="slider" aria-label="Forecast lead time" aria-valuemin={0} aria-valuemax={LEAD_MAX} aria-valuenow={p.lead} aria-valuetext={leadLabel(p.lead)} tabIndex={0}>
            <div className="seg-ml" style={{ width: lpos(ML_HORIZON) }}><span>ML nowcast 0–3 h</span></div>
            <div className="seg-nwp" style={{ left: lpos(ML_HORIZON), width: lpos(LEAD_MAX - ML_HORIZON) }}>
              <span>ML → NCUM blend 3–6 h · designed, not validated</span>
            </div>
            {[0, 60, 120, 180, 240, 300, 360].map((h) => (
              <span key={h} className="tick" style={{ left: lpos(h) }}><span>{h / 60}h</span></span>
            ))}
            <span className="thumb" style={{ left: lpos(p.lead) }} />
          </div>
        </div>
      </div>

      <div className="tl-valid">
        <div className="tl-valid-k">Valid</div>
        <div className="tl-valid-v">{clockLabel(p.t + p.lead)}</div>
        <div className={`tl-valid-s ${p.lead > ML_HORIZON ? "nwp" : ""}`}>{validLabel}</div>
      </div>
    </div>
  );
}
