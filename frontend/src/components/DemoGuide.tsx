import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Step } from "../demo";

/** Caption card for the guided demo. PageDown/PageUp work with presentation clickers. */
export default function DemoGuide({ steps, i, onStep, onExit }: {
  steps: Step[];
  i: number;
  onStep: (i: number) => void;
  onExit: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (["PageDown", "n", "N", "Enter"].includes(e.key)) { e.preventDefault(); onStep(Math.min(steps.length - 1, i + 1)); }
      else if (["PageUp", "p", "P"].includes(e.key)) { e.preventDefault(); onStep(Math.max(0, i - 1)); }
      else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [i, steps.length, onStep, onExit]);

  const s = steps[i];
  return (
    <div className="demo" role="dialog" aria-label="Guided demo">
      <div className="demo-top">
        <span className="demo-n">{i + 1}<small>/{steps.length}</small></span>
        <div className="demo-dots" aria-hidden>
          {steps.map((_, k) => <button key={k} className={k === i ? "on" : k < i ? "done" : ""} onClick={() => onStep(k)} tabIndex={-1} />)}
        </div>
        <button className="icon-btn" onClick={onExit} aria-label="Exit demo"><X size={15} /></button>
      </div>
      <div className="demo-title">{s.title}</div>
      <p className="demo-say">{s.say}</p>
      <div className="demo-nav">
        <button className="btn" onClick={() => onStep(i - 1)} disabled={i === 0}><ChevronLeft size={15} /> Back</button>
        <span className="muted small">PageDown / N for next</span>
        {i < steps.length - 1
          ? <button className="btn primary" onClick={() => onStep(i + 1)}>Next <ChevronRight size={15} /></button>
          : <button className="btn primary" onClick={onExit}>Finish</button>}
      </div>
    </div>
  );
}
