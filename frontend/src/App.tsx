import { useCallback, useEffect, useMemo, useState } from "react";
import { Layers as LayersIcon } from "lucide-react";
import MapView, { Overlays, Readout, Selection } from "./map/MapView";
import TopBar, { View } from "./components/TopBar";
import LayerPanel from "./components/LayerPanel";
import Timeline from "./components/Timeline";
import SidePanel, { Tab } from "./components/SidePanel";
import CapModal from "./components/CapModal";
import VerifyView from "./components/VerifyView";
import DemoGuide from "./components/DemoGuide";
import { DemoState, Step, buildSteps } from "./demo";
import { Badge } from "./components/ui";
import { FRAME, LEAD_MAX, LEAD_STEP, ML_HORIZON, T_END, clockLabel, leadLabel } from "./model/grid";
import { Layer, MODE_LABEL, Mode, setTerrain } from "./model/physics";
import { Alert, allAlerts, countdowns, outcome } from "./model/derive";
import { Audience, Hazard } from "./model/scenario";

const START_T = 125; // 14:05 — storms 14 and 19 about to merge

/** Shareable state in the URL hash, e.g. #t=140&lead=30&mode=noradar&terrain=0&view=ops&aud=aviation */
function readHash() {
  const h = new URLSearchParams(window.location.hash.slice(1));
  const num = (k: string, d: number, max: number, step: number) => {
    const v = Number(h.get(k));
    return h.has(k) && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v / step) * step)) : d;
  };
  const pick = <T extends string>(k: string, ok: readonly T[], d: T) => (ok.includes(h.get(k) as T) ? (h.get(k) as T) : d);
  return {
    t: num("t", START_T, T_END, FRAME),
    lead: num("lead", 0, LEAD_MAX, LEAD_STEP),
    mode: pick<Mode>("mode", ["all", "noradar", "satonly"], "all"),
    terrain: h.get("terrain") !== "0",
    view: pick<View>("view", ["ops", "verify"], "ops"),
    aud: pick<Audience>("aud", ["aviation", "district", "farmers"], "district"),
  };
}
const INIT = readHash();
setTerrain(INIT.terrain);

export default function App() {
  const [view, setView] = useState<View>(INIT.view);
  const [t, setT] = useState(INIT.t);
  const [lead, setLead] = useState(INIT.lead);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<Mode>(INIT.mode);
  const [terrainOn, setTerrainOn] = useState(INIT.terrain);
  const [layers, setLayers] = useState<Set<Layer>>(new Set<Layer>(["ir", "vil", "lightning", "hail", "cloudburst"]));
  const [overlays, setOverlays] = useState<Overlays>({ cells: true, exposure: true, contours: true });
  const [view3d, setView3d] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>("alerts");
  const [audience, setAudience] = useState<Audience>(INIT.aud);
  const [modal, setModal] = useState<{ a: Alert; v: "cap" | "sms" } | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);

  // The terrain flag lives in the model module; flip it before anything derives from it.
  const [terrainVersion, setTerrainVersion] = useState(0);
  const onTerrain = useCallback((v: boolean) => {
    setTerrain(v);
    setTerrainOn(v);
    setTerrainVersion((n) => n + 1);
  }, []);

  const set = useMemo(() => allAlerts(mode), [mode, terrainVersion]);
  const baseline = useMemo(() => allAlerts("baseline").alerts, [terrainVersion]);

  useEffect(() => {
    const h = new URLSearchParams({ t: String(t), lead: String(lead), mode, terrain: terrainOn ? "1" : "0", view, aud: audience });
    history.replaceState(null, "", `#${h}`);
  }, [t, lead, mode, terrainOn, view, audience]);

  // ---- guided demo ----
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [stepI, setStepI] = useState(0);
  const applyDemo = useCallback((st: DemoState) => {
    setPlaying(false);
    setModal(null);
    onTerrain(st.terrain);
    setView(st.view); setT(st.t); setLead(st.lead); setMode(st.mode);
    setLayers(new Set(st.layers)); setTab(st.tab); setAudience(st.audience); setSelected(st.selected);
  }, [onTerrain]);
  const goStep = useCallback((i: number) => {
    if (!steps || i < 0 || i >= steps.length) return;
    setStepI(i);
    applyDemo(steps[i].state);
  }, [steps, applyDemo]);
  const startDemo = useCallback(() => {
    const s = buildSteps();
    setSteps(s);
    setStepI(0);
    applyDemo(s[0].state);
  }, [applyDemo]);
  const cds = useMemo(() => countdowns(t, mode), [t, mode, terrainVersion]);

  const alerting = useMemo(() => {
    const m = new Map<string, Hazard>();
    for (const a of set.alerts)
      if (a.audience === audience && a.t <= t && outcome(a, t) === "pending" && !m.has(a.site.id)) m.set(a.site.id, a.hazard);
    return m;
  }, [set, audience, t]);

  // Playback: one 5-minute frame per second at 1×.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((v) => {
        if (v + FRAME > T_END) { setPlaying(false); return v; }
        return v + FRAME;
      });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed]);

  // Keyboard: space play/pause, ←/→ frame, [ ] lead.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (modal || (e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowRight") setT((v) => Math.min(T_END, v + FRAME));
      else if (e.key === "ArrowLeft") setT((v) => Math.max(0, v - FRAME));
      else if (e.key === "]") setLead((l) => Math.min(LEAD_MAX, l + LEAD_STEP));
      else if (e.key === "[") setLead((l) => Math.max(0, l - LEAD_STEP));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [modal]);

  const onSelect = useCallback((s: Selection) => {
    setSelected(s);
    if (s?.kind === "storm") setTab("storm");
    if (s?.kind === "site") setTab("arrivals");
  }, []);

  return (
    <div className={`app view-${view}`}>
      <TopBar view={view} onView={setView} t={t} mode={mode} onMode={setMode} view3d={view3d} onView3d={setView3d}
        onDemo={startDemo} demoOn={!!steps} />

      {view === "ops" ? (
        <>
          <LayerPanel
            mode={mode} lead={lead} layers={layers} onLayers={setLayers}
            overlays={overlays} onOverlays={setOverlays} terrainOn={terrainOn} onTerrain={onTerrain}
            open={layersOpen} onClose={() => setLayersOpen(false)}
          />
          {layersOpen && <div className="scrim" onClick={() => setLayersOpen(false)} />}
          <main className="stage">
            <MapView
              t={t} lead={lead} mode={mode} layers={layers} overlays={overlays}
              terrainOn={terrainOn} view3d={view3d} selected={selected} onSelect={onSelect}
              alerting={alerting} onReadout={setReadout}
            />
            <div className="map-hud">
              <div className={`hud-chip ${lead === 0 ? "obs" : lead > ML_HORIZON ? "nwp" : "fc"}`}>
                <span className="hud-k">{lead === 0 ? "Observed" : "Forecast"}</span>
                <span className="hud-v">{clockLabel(t + lead)} IST</span>
                {lead > 0 && <span className="hud-s">{leadLabel(lead)} from {clockLabel(t)}</span>}
              </div>
              {mode !== "all" && (
                <div className="hud-chip mode">
                  <span className="hud-k">{MODE_LABEL[mode]}</span>
                  <span className="hud-s">{mode === "noradar" ? "Radar-denied: VIL estimated from IR + lightning" : "Satellite only: no radar, no lightning feed"}</span>
                </div>
              )}
              {!terrainOn && (
                <div className="hud-chip mode"><span className="hud-k">Ablation</span><span className="hud-s">Terrain features off</span></div>
              )}
            </div>
            {readout && <ReadoutTip r={readout} lead={lead} />}
            <button className="layers-fab" onClick={() => setLayersOpen(true)} aria-label="Layers">
              <LayersIcon size={16} /> Layers
            </button>
          </main>
          <Timeline
            t={t} onT={setT} lead={lead} onLead={setLead} playing={playing} onPlaying={setPlaying}
            speed={speed} onSpeed={setSpeed} mode={mode} alerts={set.alerts}
          />
          <SidePanel
            tab={tab} onTab={setTab} t={t} mode={mode} audience={audience} onAudience={setAudience}
            set={set} baseline={baseline} countdowns={cds} selected={selected} onSelect={onSelect}
            onOpenAlert={(a, v) => setModal({ a, v })}
          />
        </>
      ) : (
        <main className="verify-stage"><VerifyView terrainOn={terrainOn} /></main>
      )}

      {steps && <DemoGuide steps={steps} i={stepI} onStep={goStep} onExit={() => setSteps(null)} />}

      {modal && (
        <CapModal alert={modal.a} view={modal.v} onView={(v) => setModal({ ...modal, v })} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function ReadoutTip({ r, lead }: { r: Readout; lead: number }) {
  const v = r.values;
  const rows: [string, string][] = [];
  if (v.vil !== undefined) rows.push(["VIL", `${v.vil.toFixed(1)} kg/m²`]);
  if (v.ir !== undefined) rows.push(["Cloud top", `${(v.ir - 273.15).toFixed(0)} °C`]);
  if (v.lightning !== undefined) rows.push(["Lightning", `${v.lightning.toFixed(1)} fl km⁻² h⁻¹`]);
  if (v.hail !== undefined) rows.push(["P(hail)", `${Math.round(v.hail * 100)}%`]);
  if (v.downburst !== undefined) rows.push(["P(downburst)", `${Math.round(v.downburst * 100)}%`]);
  if (v.cloudburst !== undefined) rows.push(["P(cloudburst)", `${Math.round(v.cloudburst * 100)}%`]);
  return (
    <div className="readout" style={{ left: r.px + 16, top: r.py + 16 }}>
      <div className="readout-h">{r.x.toFixed(0)} km E · {r.y.toFixed(0)} km N {lead > 0 && <Badge tone="info">{leadLabel(lead)}</Badge>}</div>
      {rows.map(([k, val]) => (
        <div key={k} className="readout-r"><span>{k}</span><b>{val}</b></div>
      ))}
    </div>
  );
}
