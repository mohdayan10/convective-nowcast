// The bar across the top: what this is, where the replay clock stands, which
// sources are in play, and the honesty badges the package declares.

import { useEffect, useRef, useState } from "react";
import { MODE_LABEL, pingApi } from "../api";
import { clock } from "../fmt";
import { MAP_SCREENS, SCREENS, useStore } from "../store";

export default function StatusBar() {
  const meta = useStore((s) => s.meta);
  const tMin = useStore((s) => s.tMin);
  const mode = useStore((s) => s.mode);
  const nav = useStore((s) => s.nav);
  const setNav = useStore((s) => s.setNav);
  const railL = useStore((s) => s.railL);
  const setRailL = useStore((s) => s.setRailL);
  const screen = useStore((s) => s.screen);
  const observed = useStore((s) => s.observed);
  const [api, setApi] = useState<"up" | "down">("up");

  useEffect(() => {
    let live = true;
    const tick = () => pingApi()
      .then(() => live && setApi("up"))
      .catch(() => live && setApi("down"));
    tick();
    const id = setInterval(tick, 10_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const wall = meta
    ? new Date(new Date(meta.start_utc).getTime() + tMin * 60000).toISOString().slice(11, 19)
    : "--:--:--";

  return (
    <header className="status">
      {/* The one control that shows and hides the screen rail. It lives here because
          the status bar is the only strip no panel can cover, so it is in the same
          place whether the rail is there or not. */}
      <button className="nav-show" aria-pressed={nav !== "hidden"}
        onClick={() => setNav(nav === "hidden" ? "open" : "hidden")}
        title={nav === "hidden" ? "Show the screen rail ( [ )" : "Hide the screen rail ( [ )"}
        aria-label={nav === "hidden" ? "Show screen rail" : "Hide screen rail"}>
        <span aria-hidden="true">☰</span>
      </button>
      {MAP_SCREENS.includes(screen) && (
        // Only on the screens that have a left panel; elsewhere it would be a
        // control for something that is not on the page.
        <button className="nav-show" aria-pressed={railL}
          onClick={() => setRailL(!railL)}
          title={railL ? "Hide the layer panel ( ] )" : "Show the layer panel ( ] )"}
          aria-label={railL ? "Hide layer panel" : "Show layer panel"}>
          <span aria-hidden="true">▤</span>
        </button>
      )}
      <span className="brand">
        Deadlock Nowcast
        <span className="brand-sub">SIH26084 · atmospheric intelligence</span>
      </span>

      <span className="badge live" title="Recorded event played back from precomputed files">
        <span className="pip" aria-hidden="true" />
        Replay
      </span>
      <span className="status-clock" aria-label="Replay clock">
        {wall}<span className="unit"> UTC</span>
      </span>
      <span className="hint num">T+{clock(tMin)}</span>

      <Search />

      <span className="spacer" />

      <div className="pills" aria-label="Source status">
        <Pill name="Radar" state="replay" />
        <Pill name="Satellite" state="replay" />
        <Pill name="Lightning" state="replay" />
        <Pill name="Coverage" state={meta?.availability.coverage_tiers_real ? "replay" : "simulated"} />
        <Pill name="Observation" state={observed ? "replay" : "absent"} />
        <Pill name="API" state={api === "up" ? "replay" : "absent"} />
      </div>

      {meta?.badges.filter((b) => b !== "REPLAY").map((b) => (
        <span key={b} className="badge" title={badgeHint(b, meta.notes)}>{label(b)}</span>
      ))}

      {mode !== "all" && (
        <span className="badge live" title="Set in the left rail, under Sources the model may see">
          {MODE_LABEL[mode]}
        </span>
      )}
    </header>
  );
}

/** A source and its state. The state is spelled out only when it is not the
 *  nominal one — "simulated" and "absent" are the words that carry information,
 *  and six pills each saying "replay" pushed the bar past its width. */
function Pill({ name, state }: { name: string; state: "replay" | "simulated" | "absent" }) {
  const word = state === "replay" ? "replay" : state === "simulated" ? "simulated" : "absent";
  return (
    <span className="pill" title={`${name}: ${word}`}>
      <i className={`src-dot ${state}`} aria-hidden="true" />
      {name}
      {state !== "replay" && <span className="hint"> {word}</span>}
    </span>
  );
}

/** Jumps to a screen by name or three-letter code. ⌘K / Ctrl-K focuses it. */
function Search() {
  const el = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const setScreen = useStore((s) => s.setScreen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        el.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = q.trim()
    ? SCREENS.filter((s) =>
        (s.name + s.code + s.what).toLowerCase().includes(q.trim().toLowerCase()))
    : [];

  return (
    <div className="search">
      <input
        ref={el}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) { setScreen(hits[0].id); setQ(""); el.current?.blur(); }
          if (e.key === "Escape") { setQ(""); el.current?.blur(); }
        }}
        placeholder="Go to a screen…"
        aria-label="Go to a screen"
      />
      <span className="kbd" aria-hidden="true">⌘K</span>
      {hits.length > 0 && (
        <ul className="search-hits">
          {hits.map((s) => (
            <li key={s.id}>
              <button onClick={() => { setScreen(s.id); setQ(""); }}>
                <span className="code num">{s.code}</span> {s.name}
                <span className="hint"> — {s.what}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function label(b: string) {
  if (b === "US-SEVIR") return "US–SEVIR";
  if (b === "RELOCATED") return "Relocated grid";
  if (b === "SIMULATED GAP") return "Simulated gap";
  if (b === "PROXY") return "Proxy";
  return b;
}

function badgeHint(b: string, notes: Record<string, string>) {
  if (b === "US-SEVIR") return "Trained and verified on the US SEVIR dataset";
  if (b === "RELOCATED") return notes.relocated ?? "";
  if (b === "SIMULATED GAP") return notes.coverage ?? "";
  if (b === "PROXY") return notes.downburst ?? "";
  return "";
}
