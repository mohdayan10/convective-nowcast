import { useEffect, useRef } from "react";
import { openClock } from "./api";
import { MAP_SCREENS, analysisAt, useStore, frameAt } from "./store";

import AlertDetail from "./console/AlertDetail";
import JudgeDemo from "./console/JudgeDemo";
import MetaStrip from "./console/MetaStrip";
import Nav from "./console/Nav";
import StatusBar from "./console/StatusBar";
import StormDetail from "./console/StormDetail";
import Transport from "./console/Transport";

import Explain from "./screens/Explain";
import Explorer3D from "./screens/Explorer3D";
import Fusion from "./screens/Fusion";
import LiveNowcast from "./screens/LiveNowcast";
import Overview from "./screens/Overview";
import Replay from "./screens/Replay";
import System from "./screens/System";
import Timeline from "./screens/Timeline";
import Validation from "./screens/Validation";

const TICK_MS = 125;

export default function App() {
  const load = useStore((s) => s.load);

  useEffect(() => { load(); }, [load]);

  return <Console />;
}

function Console() {
  const meta = useStore((s) => s.meta);
  const eventId = useStore((s) => s.eventId);
  const tMin = useStore((s) => s.tMin);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const screen = useStore((s) => s.screen);
  const error = useStore((s) => s.error);
  const selectedCell = useStore((s) => s.selectedCell);
  const selectedAlert = useStore((s) => s.selectedAlert);
  const ensureFrame = useStore((s) => s.ensureFrame);
  const ensureCells = useStore((s) => s.ensureCells);
  const setNav = useStore((s) => s.setNav);

  const ws = useRef<WebSocket | null>(null);
  const serverT = useRef(-1);
  const lastTick = useRef(0);

  // ---- the replay clock ----------------------------------------------------
  // The server owns playback (spec §6). If no tick arrives the console falls back
  // to a local clock, so a dropped socket cannot stall a live demo.
  useEffect(() => {
    if (!eventId) return;
    const sock = openClock(eventId, speed, (m) => {
      lastTick.current = Date.now();
      serverT.current = m.t_min;
      useStore.getState().setClock(m.t_min, m.playing);
    });
    ws.current = sock;
    return () => { sock?.close(); ws.current = null; serverT.current = -1; };
  }, [eventId]);

  useEffect(() => {
    const s = ws.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ playing, speed }));
  }, [playing, speed]);

  // A clock position that the server did not send is a user seek.
  useEffect(() => {
    const s = ws.current;
    if (s && s.readyState === WebSocket.OPEN && Math.abs(tMin - serverT.current) > 0.5) {
      serverT.current = tMin;
      s.send(JSON.stringify({ seek_min: tMin }));
    }
  }, [tMin]);

  useEffect(() => {
    if (!playing || !meta) return;
    const id = setInterval(() => {
      if (Date.now() - lastTick.current < 1000) return;   // the server is driving
      const end = (meta.n_frames - 1) * meta.step_min;
      const st = useStore.getState();
      const next = Math.min(st.tMin + (TICK_MS / 1000) * st.speed / 60, end);
      st.setClock(next, next < end);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, meta]);

  // "[" and "]" hide and show the two rails, for a demo on a small screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.key === "[") {
        e.preventDefault();
        setNav(useStore.getState().nav === "hidden" ? "open" : "hidden");
      } else if (e.key === "]") {
        e.preventDefault();
        const st = useStore.getState();
        st.setRailL(!st.railL);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setNav]);

  // ---- keep the 5 min cells around the clock loaded -------------------------
  // The model runs every 20 min, the tracker every 5; these are what let the storm
  // advance between analysis times instead of jumping.
  useEffect(() => {
    if (!meta) return;
    const f = frameAt(meta, tMin);
    if (f === null) return;
    ensureCells(f);
    ensureCells(f + 1);
  }, [meta, tMin, ensureCells]);

  // ---- keep the current and next analysis frame loaded ---------------------
  useEffect(() => {
    if (!meta) return;
    const a = analysisAt(meta, tMin);
    if (a === null) return;
    ensureFrame(a);
    const next = meta.analysis_frames.find((x) => x > a);
    if (next !== undefined) ensureFrame(next);
  }, [meta, tMin, ensureFrame]);

  // On the screens that read a whole frame at once, keep every analysis time the
  // replay has passed, so the sparks and the trends have something to plot.
  useEffect(() => {
    if (!meta) return;
    const a = analysisAt(meta, tMin);
    if (a === null) return;
    for (const f of meta.analysis_frames) if (f <= a) ensureFrame(f);
  }, [meta, tMin, ensureFrame]);

  if (error && !meta) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>No replay data</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  const onMap = MAP_SCREENS.includes(screen);

  return (
    <div className={`shell${onMap ? "" : " no-transport"}`}>
      <StatusBar />
      <Nav />

      <div className="screen">
        {screen === "overview" && <Overview />}
        {screen === "nowcast" && <LiveNowcast />}
        {screen === "explorer" && <Explorer3D />}
        {screen === "timeline" && <Timeline />}
        {screen === "fusion" && <Fusion />}
        {screen === "explain" && <Explain />}
        {screen === "replay" && <Replay />}
        {screen === "validation" && <Validation />}
        {screen === "system" && <System />}
      </div>

      {screen === "nowcast" && selectedCell !== null && <StormDetail />}
      {screen === "nowcast" && selectedAlert !== null && <AlertDetail />}

      {onMap && <Transport />}
      <MetaStrip />
      <JudgeDemo />
    </div>
  );
}
