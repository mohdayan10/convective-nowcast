import { Mountain, Presentation, Radar, Satellite, Zap } from "lucide-react";
import { clockLabel } from "../model/grid";
import { MODE_LABEL, Mode } from "../model/physics";
import { Badge, Segmented } from "./ui";

export type View = "ops" | "verify";

interface Props {
  view: View;
  onView: (v: View) => void;
  t: number;
  mode: Mode;
  onMode: (m: Mode) => void;
  view3d: boolean;
  onView3d: (v: boolean) => void;
  onDemo: () => void;
  demoOn: boolean;
}

export default function TopBar(p: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#121a27" />
          <path d="M18 4 9 18h6l-2 10 10-15h-6z" fill="#7dd3c0" />
        </svg>
        <div>
          <div className="brand-name">Deadlock Nowcast</div>
          <div className="brand-sub">SIH 26084 · Convective hazards 0–6 h</div>
        </div>
      </div>

      <nav className="tabs" aria-label="View">
        <button className={p.view === "ops" ? "on" : ""} onClick={() => p.onView("ops")}>Operations</button>
        <button className={p.view === "verify" ? "on" : ""} onClick={() => p.onView("verify")}>Verification</button>
      </nav>

      <div className="clock" aria-live="off">
        <span className="clock-time">{clockLabel(p.t)}</span>
        <span className="clock-tz">IST</span>
        <Badge tone="info" title="Recorded frames played back in time order — not a live feed">REPLAY</Badge>
        <Badge tone="warn" title="Invented storms over real geography. Drives the UI until SEVIR / Indian data are wired in.">SYNTHETIC SCENARIO</Badge>
      </div>

      <div className="topbar-right">
        <Segmented<Mode>
          label="Input sources"
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: "all", label: <><Radar size={14} /><Satellite size={14} /><Zap size={14} /><span>{MODE_LABEL.all}</span></>, title: "Radar + satellite + lightning" },
            { value: "noradar", label: <><Satellite size={14} /><Zap size={14} /><span>{MODE_LABEL.noradar}</span></>, title: "Radar-denied: satellite + lightning" },
            { value: "satonly", label: <><Satellite size={14} /><span>{MODE_LABEL.satonly}</span></>, title: "Satellite only" },
          ]}
        />
        <button className={`icon-btn ${p.demoOn ? "on" : ""}`} onClick={p.onDemo} title="Guided demo (PageDown / N to advance)">
          <Presentation size={16} /> Demo
        </button>
        <button className={`icon-btn ${p.view3d ? "on" : ""}`} onClick={() => p.onView3d(!p.view3d)} title="3D terrain" aria-pressed={p.view3d}>
          <Mountain size={16} /> 3D
        </button>
      </div>
    </header>
  );
}
