import { Eye, EyeOff, X } from "lucide-react";
import type { Layer, Mode } from "../model/physics";
import type { Overlays } from "../map/MapView";
import { legendGradient } from "../map/raster";
import { Badge, HazardIcon, Toggle } from "./ui";

interface Props {
  mode: Mode;
  lead: number;
  layers: Set<Layer>;
  onLayers: (l: Set<Layer>) => void;
  overlays: Overlays;
  onOverlays: (o: Overlays) => void;
  terrainOn: boolean;
  onTerrain: (v: boolean) => void;
  /** Drawer state on narrow screens. */
  open: boolean;
  onClose: () => void;
}

const OBS: { id: Layer; name: string; unit: string; ticks: string[] }[] = [
  { id: "ir", name: "Satellite IR", unit: "cloud-top K", ticks: ["190", "240", "300"] },
  { id: "vil", name: "Radar VIL", unit: "kg/m²", ticks: ["0", "30", "65"] },
  { id: "lightning", name: "Lightning", unit: "strikes · density", ticks: ["0", "6", "12 fl km⁻² h⁻¹"] },
];

const HAZ: { id: Layer & ("hail" | "downburst" | "cloudburst"); name: string; unit: string; proxy?: boolean }[] = [
  { id: "hail", name: "Hail", unit: "P(VIL-based hail)" },
  { id: "downburst", name: "Downburst", unit: "P(core collapse)", proxy: true },
  { id: "cloudburst", name: "Cloudburst", unit: "P(≥100 mm / 1 h)" },
];

export default function LayerPanel(p: Props) {
  const toggle = (l: Layer) => {
    const n = new Set(p.layers);
    n.has(l) ? n.delete(l) : n.add(l);
    p.onLayers(n);
  };
  const unavailable = (l: Layer) =>
    (l === "lightning" && p.mode === "satonly") ? "No lightning feed in this mode" : null;
  const note = (l: Layer) => {
    if (l === "vil" && p.mode !== "all") return "Estimated from IR + lightning";
    if (l === "ir" && p.lead > 0) return "Latest image (not forecast)";
    if (l === "lightning") return p.lead > 0 ? "Forecast flash density" : "Strikes, last 10 min · density shown for forecasts";
    return null;
  };

  return (
    <aside className={`rail ${p.open ? "open" : ""}`} aria-label="Layers">
      <div className="rail-head">
        <span>Layers & model</span>
        <button className="icon-btn" onClick={p.onClose} aria-label="Close layers"><X size={16} /></button>
      </div>
      <section>
        <h3>Observations</h3>
        {OBS.map((o) => {
          const na = unavailable(o.id);
          const on = p.layers.has(o.id) && !na;
          return (
            <div key={o.id} className={`layer ${on ? "on" : ""} ${na ? "na" : ""}`}>
              <button className="layer-head" onClick={() => !na && toggle(o.id)} disabled={!!na} aria-pressed={on}>
                {on ? <Eye size={15} /> : <EyeOff size={15} />}
                <span className="layer-name">{o.name}</span>
                <span className="layer-unit">{o.unit}</span>
              </button>
              {on && (
                <div className="legend">
                  <div className="legend-bar" style={{ background: legendGradient(o.id) }} />
                  <div className="legend-ticks">{o.ticks.map((t) => <span key={t}>{t}</span>)}</div>
                </div>
              )}
              {(na || note(o.id)) && <div className="layer-note">{na ?? note(o.id)}</div>}
            </div>
          );
        })}
      </section>

      <section>
        <h3>Hazards <span className="h3-sub">shaded = probability · line = 50%</span></h3>
        {HAZ.map((h) => {
          const on = p.layers.has(h.id);
          return (
            <div key={h.id} className={`layer ${on ? "on" : ""}`}>
              <button className="layer-head" onClick={() => toggle(h.id)} aria-pressed={on}>
                <HazardIcon h={h.id} size={15} />
                <span className="layer-name">{h.name}</span>
                {h.proxy && <Badge tone="proxy" title="Proxy from VIL collapse; Doppler radial-velocity divergence at the finale">PROXY</Badge>}
                <span className="layer-unit">{h.unit}</span>
              </button>
              {on && (
                <div className="legend">
                  <div className="legend-bar" style={{ background: legendGradient(h.id) }} />
                  <div className="legend-ticks"><span>10%</span><span>50%</span><span>100%</span></div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section>
        <h3>Overlays</h3>
        <Toggle on={p.overlays.cells} onChange={(v) => p.onOverlays({ ...p.overlays, cells: v })} label="Storm cells, tracks & CI" />
        <Toggle on={p.overlays.exposure} onChange={(v) => p.onOverlays({ ...p.overlays, exposure: v })} label="Exposure (sites, route, farms)" />
        <Toggle on={p.overlays.contours} onChange={(v) => p.onOverlays({ ...p.overlays, contours: v })} label="50% hazard outlines" />
      </section>

      <section>
        <h3>Model</h3>
        <Toggle
          on={p.terrainOn}
          onChange={p.onTerrain}
          label={<>Terrain features <span className="muted">(elevation, upslope flow)</span></>}
          hint="Switch off to see the ablation: the cloudburst on NH-7 is missed without terrain features."
        />
      </section>
    </aside>
  );
}
