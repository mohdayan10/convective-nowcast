// The thin strip along the bottom: where the pointer is, what the map scale is,
// which model produced what is on screen, and the two clocks. Everything here is
// read from the package or measured in the browser — nothing is decorative.

import { useEffect, useRef, useState } from "react";
import { lead as leadLabel } from "../fmt";
import { useStore } from "../store";

export default function MetaStrip() {
  const meta = useStore((s) => s.meta);
  const leadMin = useStore((s) => s.leadMin);
  const cursor = useStore((s) => s.cursor);
  const mapScale = useStore((s) => s.mapScale);
  const results = useStore((s) => s.results);
  const loadResults = useStore((s) => s.loadResults);
  const fps = useFps();
  const now = useWallClock();

  useEffect(() => { loadResults(); }, [loadResults]);

  const arch = results?.model?.model?.architecture;
  const params = results?.train_log?.params_M;
  const km = results?.train_log?.resolution_km;
  const model = arch
    ? `${arch}${params ? ` · ${params.toFixed(1)} M` : ""}${km ? ` · ${km} km` : ""}`
    : "model not scored";

  return (
    <footer className="meta-strip">
      <span className="num">
        {cursor ? `${cursor[1].toFixed(3)}°N  ${cursor[0].toFixed(3)}°E` : "—  —"}
      </span>
      <Sep />
      <span className="num">{mapScale ? `${fmtScale(mapScale)}/px` : "— /px"}</span>
      <Sep />
      <span>
        horizon <span className="num">{leadLabel(leadMin)}</span>
        {meta && leadMin > meta.ml_horizon_min && <span className="hint"> (no forecast)</span>}
      </span>
      <Sep />
      <span>{model}</span>
      <Sep />
      <span className="num">{meta ? `${meta.dataset}·${meta.event}` : "no event"}</span>

      <span className="spacer" />

      {meta?.availability.coverage_tiers_real === false && (
        <><span className="flag">Coverage tiers simulated</span><Sep /></>
      )}
      <span className="flag">Research prototype — not an official warning</span>
      <Sep />
      <span className="num" title="Browser frame rate">{fps} fps</span>
      <Sep />
      <span className="num">{now.ist} IST</span>
      <Sep />
      <span className="num">{now.utc} UTC</span>
    </footer>
  );
}

const Sep = () => <span className="meta-sep" aria-hidden="true">·</span>;

function fmtScale(mPerPx: number) {
  return mPerPx >= 1000 ? `${(mPerPx / 1000).toFixed(1)} km` : `${Math.round(mPerPx)} m`;
}

/** Measured, not claimed: frames counted over the last second. */
function useFps() {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      frames.current += 1;
      if (t - last >= 1000) {
        setFps(Math.round((frames.current * 1000) / (t - last)));
        frames.current = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

/** Wall clocks, not the replay clock — the replay clock lives in the status bar. */
function useWallClock() {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const d = new Date(t);
  return {
    utc: d.toISOString().slice(11, 19),
    ist: new Date(t + 5.5 * 3600_000).toISOString().slice(11, 19),
  };
}
