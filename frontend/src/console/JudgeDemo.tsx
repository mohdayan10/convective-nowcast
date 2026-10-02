// The scripted walkthrough. Each step puts the console into a known state and
// says what to look at; the numbers it points to are whatever the package holds,
// so the script cannot drift from the data. Nothing here sets a value that is
// then displayed as if it were a forecast.

import { useEffect } from "react";
import { Screen, useStore } from "../store";

interface Step {
  screen: Screen;
  title: string;
  say: string;
  apply?: () => void;
}

function steps(): Step[] {
  const s = () => useStore.getState();
  const mid = () => {
    const m = s().meta;
    if (!m) return 0;
    const f = m.analysis_frames[Math.floor(m.analysis_frames.length / 2)];
    return f * m.step_min;
  };
  return [
    {
      screen: "overview",
      title: "What this is",
      say: "A replay console for coverage-aware convective nowcasting. One recorded event, "
        + "played back from precomputed files. The badges and the list of what is not computed "
        + "stay on screen throughout.",
      apply: () => { s().setPlaying(false); s().setMode("all"); },
    },
    {
      screen: "nowcast",
      title: "The required outputs",
      say: "A GIS hazard map and a ticking countdown per named location. The arrival window and "
        + "confidence come from an ensemble of perturbed storm motions in the package; the browser "
        + "only subtracts the clock.",
      apply: () => {
        s().setClock(mid());
        s().setLead(30);
        s().setPlaying(true);
      },
    },
    {
      screen: "nowcast",
      title: "Where radar cannot see",
      say: "The coverage layer shows the share of this tile with full, partial and no radar. "
        + "The tiers here are simulated, and every panel that depends on them says so.",
      apply: () => {
        s().setPlaying(false);
        if (!s().layers.coverage) s().toggleLayer("coverage");
      },
    },
    {
      screen: "nowcast",
      title: "Take the radar away",
      say: "Same storm, radar input removed. This is a separate forward pass through the model's "
        + "modality-dropout path, not the previous forecast restyled — it keeps forecasting from "
        + "satellite and lightning.",
      apply: () => s().setMode("noradar"),
    },
    {
      screen: "nowcast",
      title: "And the lightning too",
      say: "Satellite alone, and the forecast collapses. The peak VIL figure in the transport bar "
        + "is the number to read. We report that rather than hide it.",
      apply: () => s().setMode("satonly"),
    },
    {
      screen: "replay",
      title: "Forecast against observation",
      say: "The same valid time, forecast on the left and observed radar on the right, same grid "
        + "and same colour ramp. Drag the divider. The arrival error beside it is measured on this "
        + "event; track error is not computed and is not shown.",
      apply: () => { s().setMode("all"); s().setClock(mid()); s().setLead(30); },
    },
    {
      screen: "explain",
      title: "Why this cell",
      say: "Exact SHAP values from the gradient-boosted hail and downburst models — the same "
        + "models that produced the probabilities on the map. The bars sum with the base value to "
        + "the model's logit, so this screen can be checked against it.",
    },
    {
      screen: "fusion",
      title: "The three sources",
      say: "The rasters here are the arrays the network was fed. Below them, what happens to the "
        + "forecast when a source is removed, and the measured per-tier skill — which is a "
        + "different question, and labelled as one.",
    },
    {
      screen: "validation",
      title: "Measured skill",
      say: "Mean CSI against three extrapolation baselines over the held-out test split, the "
        + "skill left when the radar is taken away, how far the forecast puts the storm, and "
        + "reliability per hazard and coverage tier. The page says where the model loses to a "
        + "baseline, and keeps its own list of what is still not measured.",
    },
    {
      screen: "system",
      title: "What is underneath",
      say: "The pipeline, the API the console reads, and this session's own event log. Nothing is "
        + "live and nothing is sent.",
    },
  ];
}

export default function JudgeDemo() {
  const step = useStore((s) => s.demoStep);
  const setDemoStep = useStore((s) => s.setDemoStep);
  const setScreen = useStore((s) => s.setScreen);
  const script = steps();

  useEffect(() => {
    if (step === null) return;
    const st = script[step];
    if (!st) { setDemoStep(null); return; }
    setScreen(st.screen);
    st.apply?.();
    useStore.getState().logEvent("demo", `Step ${step + 1}: ${st.title}`);
  }, [step]);

  if (step === null) return null;
  const st = script[step];
  if (!st) return null;

  return (
    <div className="demo" role="region" aria-label="Judge demo">
      <div className="demo-step num">{step + 1} / {script.length}</div>
      <div className="demo-body">
        <div className="demo-title">{st.title}</div>
        <p className="demo-say">{st.say}</p>
      </div>
      <div className="demo-ctl">
        <button className="btn" disabled={step === 0} onClick={() => setDemoStep(step - 1)}>Back</button>
        <button className="btn primary"
          onClick={() => setDemoStep(step + 1 < script.length ? step + 1 : null)}>
          {step + 1 < script.length ? "Next" : "Finish"}
        </button>
        <button className="x" aria-label="Stop the walkthrough" onClick={() => setDemoStep(null)}>×</button>
      </div>
    </div>
  );
}
