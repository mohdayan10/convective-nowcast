# App Build Spec — Coverage-Aware Convective Nowcasting Dashboard (SIH 26084, Team Deadlock)S

> Give this whole file to Claude Code. It builds the demo app the judges will see. The two outputs the problem statement literally names — an interactive GIS dashboard with 1–3 km hazard zones, and live countdown clocks for storm arrival — must be the two most obvious things on screen. Everything else supports them.

---

## 0. Build the demo, design it to look real

This is a **replay demo**, not a live system: it plays back recorded storms from precomputed files so it runs fast and never crashes mid-presentation. But it must look and behave like the real operational tool. A small honest `REPLAY` badge stays visible; nothing else about the UI should feel like a prototype.

**Non-negotiable:** no invented numbers. Every forecast value, skill score and countdown comes from the precomputed replay files produced by the model/eval pipeline. If a number isn't computed yet, the UI shows a labelled placeholder state, never a fake figure.

---

## 1. The two required outputs (make these unmissable)

1. **GIS dashboard with 1 km hazard zones** — a real slippy map, hazard polygons at 1 km, colour-coded by hazard type.
2. **Live countdown clocks** — for each threatened named location, a *ticking* clock to storm arrival, shown as a window with confidence, e.g. `Hail → Airport  arrives in 00:32:10  (25–40 min, 70%)`. The seconds tick during replay. This is the single element the judges will look for by name; give it visual weight.

A judge ticks "did they show the GIS dashboard and the countdowns?" before anything else. If those two aren't instantly visible, nothing clever matters.

---

## 2. The differentiator (what separates us)

A **coverage toggle**: `All sources | No radar | Satellite only`. Flipping to "No radar" re-runs the same storm from precomputed files and visibly keeps forecasting (with lower, honestly-shown confidence) in the valleys where a normal nowcast would go blank. Pair it with a **coverage layer** that shades the map full / partial / no radar coverage. This is the one thing no other team will have — give it a dedicated, obvious control, and make the "still works without radar" moment a one-click demo beat.

---

## 3. Make it NOT look AI-generated

This matters: judges have seen a hundred generic dashboards. Follow this design direction exactly, and avoid the tells listed.

### Design concept
This is an **operational meteorology console for emergency forecasters**, not a consumer weather app and not a SaaS landing page. Reference the feel of real systems forecasters respect: IMD/NWP workstations, aviation weather displays, mission-control. Dense, calm, information-first, trustworthy under pressure. The map is the instrument; the UI is the housing around it.

### Palette (dark operational console)
- `--bg: #0E1419` (near-black slate, not pure black, not the cliché #111)
- `--panel: #16202B` (raised panel)
- `--line: #263441` (hairline borders between panels)
- `--text: #E4ECF2` / `--text-dim: #8A9BA8`
- Hazard colours, used *only* for hazards, consistently everywhere:
  - lightning `#F2C53D` · hail `#9B6DFF` · downburst `#FF6B5A` · cloudburst `#3DA5FF`
- Coverage tiers: full `#2E7D5B` · partial `#B5852E` · none `#5A4A4A` (muted, so hazards stay dominant)
- One restrained accent for interactive elements: `#4FD1C5` (teal). Not terracotta, not acid green.

### Typography
- **IBM Plex Sans** for UI and labels, **IBM Plex Mono** for numbers (clocks, coordinates, probabilities, metrics). A monospace for *live data readouts* is authentic to instrument panels — this is the one place mono is a real choice, not a tell, so use it only for numeric readouts, never for body copy or headings.
- Type scale: clear hierarchy, not many sizes. Numbers in clocks are the largest type on the screen.

### Layout
Not a grid of identical rounded cards. A **console shell**: a thin top status bar, a map filling the centre, docked tool rails left and right that feel built-in (flush edges, hairline dividers, not floating cards with drop shadows). Panels share edges; they don't float.

```
┌────────────────────────────────────────────────────────────────┐
│ [●REPLAY 14:32 IST]   DEADLOCK NOWCAST      [All|No radar|Sat]  │ status bar
├──────┬──────────────────────────────────────────────┬──────────┤
│ L    │                                              │  ALERTS  │
│ A    │                 MAP                           │  (tabs:  │
│ Y    │        1km hazard zones + coverage           │  Avtn /  │
│ E    │        storm cells + tracks + cones          │  Distr / │
│ R    │                                              │  Farmer) │
│ S    │                                              │          │
│      │                                              │ COUNTDOWN│
│      │                                              │ CLOCKS   │
├──────┴──────────────────────────────────────────────┴──────────┤
│ ◀ 0h ───────●──────────────── 6h ▶   "0–3h ML · 3–6h blend"    │ time scrubber
└────────────────────────────────────────────────────────────────┘
```

### Avoid these AI tells (hard rules)
- No warm cream background with serif display and terracotta accent.
- No grid of identical rounded cards with the same soft grey shadow under each.
- No tracked-out ALL-CAPS eyebrow labels above every heading.
- No meta strings joined with middle dots; no `WORD — fragment` spaced-em-dash labels.
- No `→` appended to button text; buttons say the action ("Send alert", "Show without radar").
- No fade-and-slide-up on every panel. One orchestrated motion only: the countdown ticking, and the storm advancing when replay plays. Motion answers actions (open panel, toggle coverage); it doesn't decorate.
- One border-radius discipline: panels square or near-square (2px); only interactive chips get a small radius. Don't round everything.

### Where to spend boldness
One memorable thing: the **live countdown clocks** rendered large in Plex Mono, each colour-keyed to its hazard, ticking during replay. Everything else stays quiet so that lands.

---

## 4. Screens

### 4.1 Login (thin)
Role picker: Aviation officer / District admin / IMD-NCMRWF forecaster / Viewer. Role changes default map region and which alert tab opens first. Don't over-build; the judges won't dwell here. No marketing copy.

### 4.2 Main console (the screen that wins)
- **Map (centre):** MapLibre GL, dark base, terrain hillshade for the Himalayan region. Layers: 1 km hazard polygons (per hazard, toggleable), coverage-tier shading, storm cells with ID labels, tracks, widening uncertainty cones. Click a storm → detail panel.
- **Left rail — Layers:** toggles for each hazard, coverage layer, radar/satellite/lightning inputs. Compact, flush, hairline-separated.
- **Right rail — Alerts & Countdowns:**
  - Alert feed, tabbed Aviation / District / Farmer, newest first. Each row: hazard dot, location, arrival window, confidence.
  - **Countdown clocks** block: the named locations under threat, each a large ticking Plex Mono clock colour-keyed to hazard, with the window and confidence beneath.
- **Top status bar:** REPLAY badge + replay clock; product name; coverage mode toggle (All / No radar / Satellite only).
- **Bottom scrubber:** 0–6 h slider, play/pause/speed, label "0–3 h ML · 3–6 h blend". Dragging it moves all hazard layers and clocks in sync.

### 4.3 Storm detail (slides in over the right rail on click)
- Storm ID + merge/split lineage (small node tree).
- Four hazard probabilities, each a small sparkline across 0–6 h.
- Initiation score 0–100 with top-3 SHAP reasons in plain words.
- Coverage tier + calibrated confidence for this storm.
- "Show without radar" button → triggers the coverage toggle focused on this storm.

### 4.4 Alert detail / composer
Click an alert → plain-language reason (from top-3 signals), the CAP 1.2 XML (collapsed, expandable), and SMS preview in English / Hindi / Telugu. A "Send alert" button that, in demo, shows the dispatched message and marks the alert sent. Never actually sends.

### 4.5 Verification (revealed at end of a replay)
When a storm's replay completes, reveal observed truth: per alert, hit / miss / false alarm, and the **lead time achieved vs the baseline**. One clear, quiet panel. This is a strong closing beat.

### 4.6 Results page
Reads only from `eval/results/*.json`: CSI / FSS by lead time and coverage tier vs persistence and pysteps; reliability diagram per tier; the radar-denied skill-drop chart (the headline). If results aren't in yet, show an honest empty state ("Metrics populate from the evaluation run"), not fake bars.

---

## 5. Data contract (what the frontend reads)

The model/eval pipeline writes a replay package per event; the app only reads it. Do not compute forecasts in the browser.

```
replay_packages/<event_id>/
  meta.json          # event id, region bbox + corner coords, start time, frame times,
                     # badges (REPLAY, US-SEVIR / INDIA, SIMULATED GAP), named locations
  frames/<t>.json    # per 5-min frame: storm cells (GeoJSON), tracks, cones,
                     # per-location arrival windows + confidence, initiation scores
  hazards/<t>/*.png  # hazard-layer raster overlays per hazard, georeferenced to bbox
  coverage.png       # coverage-tier raster (static per region)
  alerts.json        # alerts with audience, hazard, location, window, confidence,
                     # reason (top-3 signals), CAP XML, SMS EN/HI/TE
  verification.json  # revealed at end: hit/miss/false-alarm, lead time vs baseline
eval/results/*.json  # skill metrics for the results page
```

Countdown clocks are computed in the browser **only** as `arrival_time − current_replay_time` for display ticking; the arrival_time and window come from the frame data, not invented.

---

## 6. Stack
- **Frontend:** React + Vite + TypeScript, MapLibre GL JS, deck.gl for dense grid layers, lightweight state (Zustand). No component kit that imposes a generic card look — style from the token system above.
- **Backend (thin, serves the replay):** FastAPI + WebSocket streaming frame indices during playback; static serving of the package files. Redis/PostGIS optional — files on disk are fine for the demo.
- **No browser storage** beyond in-memory state.
- One-command run: `docker compose up` → open the console.

---

## 7. Build order (ship the winning path first)
1. Console shell + map + one event's hazard polygons rendering from a package.
2. Time scrubber wired to frames; hazard layers move with it.
3. **Countdown clocks** ticking from frame data (required output #2).
4. Alert feed + audience tabs from `alerts.json`.
5. Coverage layer + **All / No radar / Satellite** toggle (the differentiator).
6. Storm detail panel (lineage, hazard sparklines, initiation + SHAP).
7. Verification reveal + results page from eval files.
8. Login, alert composer/CAP/SMS, polish.

Items 1–5 are the demo that meets the brief and shows the differentiator. 6–8 deepen it.

---

## 8. Quality floor (build it in, don't announce it)
Responsive to a laptop screen (judges may view on a projector — test at 1280×720); visible keyboard focus; `prefers-reduced-motion` respected (clocks still update, decorative motion stops); colours distinguishable for colour-blind viewers (hazard dots carry a letter/shape too, not colour alone); legible at projector distance (no text under 14px in the main view).

## 9. What to hand back
1. `docker compose up` running the console with at least one replay event.
2. A short `DEMO.md`: the exact click path for the 6–7 min demo (open → initiation fires → hazards + countdowns → toggle No radar → alerts → verification → results).
3. A note listing any screen still showing a placeholder state because the data/results aren't computed yet.
