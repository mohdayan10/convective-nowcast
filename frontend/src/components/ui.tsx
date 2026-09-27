import type { ReactNode } from "react";
import { CloudHail, CloudRainWind, Wind, Zap, Plane, Landmark, Building2, Route, Wheat } from "lucide-react";
import type { Hazard, SiteKind } from "../model/scenario";
import { HAZARD_COLOR } from "../map/raster";

export function HazardIcon({ h, size = 16 }: { h: Hazard; size?: number }) {
  const props = { size, strokeWidth: 2, color: HAZARD_COLOR[h], "aria-hidden": true };
  switch (h) {
    case "lightning": return <Zap {...props} />;
    case "hail": return <CloudHail {...props} />;
    case "downburst": return <Wind {...props} />;
    case "cloudburst": return <CloudRainWind {...props} />;
  }
}

export function SiteIcon({ k, size = 15 }: { k: SiteKind; size?: number }) {
  const props = { size, strokeWidth: 2, "aria-hidden": true };
  switch (k) {
    case "airport": return <Plane {...props} />;
    case "district": return <Landmark {...props} />;
    case "town": return <Building2 {...props} />;
    case "route": return <Route {...props} />;
    case "farms": return <Wheat {...props} />;
  }
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "warn" | "proxy" | "ok" | "bad" | "info"; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function Segmented<T extends string>({
  value, options, onChange, size = "md", label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label: string;
}) {
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} title={hint}>
      <span className="toggle-track"><span className="toggle-knob" /></span>
      <span className="toggle-label">{label}</span>
    </button>
  );
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
