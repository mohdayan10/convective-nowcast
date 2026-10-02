// Screen rail. One active screen, a three-letter code per row so an operator can
// call a screen by name, and the judge-demo trigger pinned to the bottom.

import { SCREENS, Screen, useStore } from "../store";

export default function Nav() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const nav = useStore((s) => s.nav);
  const toggleNav = useStore((s) => s.toggleNav);
  const navOpen = nav === "open";
  const demoStep = useStore((s) => s.demoStep);
  const setDemoStep = useStore((s) => s.setDemoStep);
  const availability = useStore((s) => s.meta?.availability);

  // Hidden is rendered by the shell as a restore tab, not here.
  if (nav === "hidden") return null;

  return (
    <nav className={`nav${navOpen ? "" : " shut"}`} aria-label="Screens">
      <div className="nav-rows">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            className="nav-row"
            aria-current={screen === s.id}
            onClick={() => setScreen(s.id)}
            title={navOpen ? s.what : `${s.name} — ${s.what}`}
          >
            <span className="code num">{s.code}</span>
            {navOpen && <span className="nav-name">{s.name}</span>}
          </button>
        ))}
      </div>

      <div className="nav-foot">
        <button
          className={`btn${demoStep === null ? " primary" : ""}`}
          onClick={() => setDemoStep(demoStep === null ? 0 : null)}
          title="A fixed walkthrough: nowcast, radar-denied mode, replay against observation, explanation, measured skill"
        >
          {navOpen
            ? (demoStep === null ? "Judge demo" : "Stop demo")
            : (demoStep === null ? "▶" : "■")}
        </button>
        {navOpen && availability && !availability.coverage_tiers_real && (
          <p className="hint nav-note">Coverage tiers simulated</p>
        )}
        <button className="nav-collapse" onClick={toggleNav}
          title="Narrow the rail to its codes — ☰ above hides it altogether"
          aria-label={navOpen ? "Collapse screen rail to codes" : "Expand screen rail"}>
          {navOpen ? "‹ Collapse" : "›"}
        </button>
      </div>
    </nav>
  );
}

export const screenName = (id: Screen) => SCREENS.find((s) => s.id === id)?.name ?? id;
