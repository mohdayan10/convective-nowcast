# Demo Feature Spec — Coverage-Aware Convective Nowcasting Console (SIH 26084)

> Extracted from the reference build ("ALPHAX"). This documents every screen, panel, and control to implement, plus the shared shell and the honesty conventions. Give this to Claude Code alongside the app build spec. Rename the product to your own (e.g. "DEADLOCK NOWCAST"); do not keep "ALPHAX".
>
> **Hard rule carried through every screen:** no invented numbers. Every value is read from precomputed replay/eval files. Keep the reference's own honesty markers — the `SIM` / `SIMULATED` chips, the "all metrics below are simulated placeholders" banner, and the "research prototype — not an official warning" line. Those are features, not disclaimers to strip.

---

## 1. Shared shell (every screen)

**Left nav rail** (icon + label + 3-letter code, one active item highlighted):
- Overview `OVW`
- Live Nowcast `NOW`
- 3D Storm Explorer `3DX`
- Forecast Timeline `FTM`
- Data Fusion `FUS`
- Explain AI `XAI`
- Storm Replay `REP`
- Validation `VAL`
- System `SYS`
- Bottom of rail: a primary **Judge Demo** button (triggers the scripted walkthrough) and a **Collapse** control.

**Top status bar** (spans the app):
- Product mark + "Atmospheric Intelligence" + problem-statement tag `SIH26084`.
- Global search: "Search locations, layers, actions…" with a ⌘K hint.
- Source status pills, each a coloured dot + state: `RADAR ONLINE`, `SATELLITE ONLINE`, `LIGHTNING SIMULATED`, and an `API LIVE` indicator.

**Bottom meta strip** (thin, always present): cursor lat/long, map scale, current forecast horizon, model name/version, data source label (e.g. "SIM-Monsoon-2026.09"), a `VALIDATION IN PROGRESS` flag, `RESEARCH PROTOTYPE · SIMULATED DATA`, FPS, and IST/UTC clocks.

**Transport bar** (shared by map screens): reset, play/pause, speed selector (0.5× / 1× / 2× / 4×), a big current-horizon readout (e.g. `+3h34`, with `HH:MM IST · T+3.3h` beneath), and a scrubber from `NOW` to `+6h` with `+30m … +5h` ticks. Right-aligned live counters: `CELLS`, `MAX DBZ`, `σ UNCERT` (km), `HORIZON`.

---

## 2. Screen: Live Nowcast (`NOW`) — the main 2D console

The primary screen and the one that must carry the two required outputs (GIS hazard map + countdowns).

**Centre — map:** dark base, storm cells as heat blobs, cell labels like `C-17 · 56dBZ`, dashed forecast tracks fanning out, a forecast cone, city markers (Bengaluru, Mysuru, Chennai, Coimbatore). A `STORM C-17 · SEVERE · TRACKING TOWARD …` ticker along the top edge.

**Top-left — hazard readout cards** (compact, each a metric with a sparkline and trend):
- `EXTREME RAINFALL` — peak +1h %, area km², trend arrow
- `SEVERE WIND` — peak +1h %, area km², trend arrow
(These are the hazard parameters the statement asks for; add lightning + hail equivalents.)

**Left — Map Layers panel** (a `MOCK`/`SIM` chip top-right of the panel), grouped:
- *Observations:* Radar Reflectivity (toggle), Satellite IR (toggle), Lightning Density (toggle)
- *Storm Objects:* Storm Cells, Storm Tracks, Forecast Cone, Uncertainty — each a labelled toggle
Add here (our differentiator, not in the reference): a **Coverage layer** toggle and a **coverage mode** switch (All sources / No radar / Satellite only).

**Right — Storm Inspector** (opens on cell click):
- Cell id (e.g. `CX-2047`), severity tag (`EXTREME`), trend (`STEADY`), a small live timer.
- `CENTROID` lat/long, `MOVEMENT` heading + speed (e.g. `ENE 43.8 km/h`).

**Right — Location Intel** (for the threatened city):
- City name + lat/long, a **threat gauge** (e.g. `94%`) with severity (`SEVERE`), `DOMINANT: THUNDERSTORM`.
- `REFLECTIVITY DBZ` colour scale (15→65+), and a legend: Track, Cone, σ Uncert, Sat IR, Rain P, Hail P.

**Required-output emphasis (add to this screen):** the live **countdown clocks** for named locations must be visible here, not only in the inspector. Each: hazard-coloured, ticking `MM:SS` to arrival, with the window + confidence beneath.

---

## 3. Screen: 3D Storm Explorer (`3DX`)

- **Centre:** a 3D volumetric render of a storm cell (cloud volume + a coloured core/downdraft), rotatable. Controls shown as hints: `DRAG · ROTATE`, `SCROLL · ZOOM`, `HOVER`. A wireframe "future volumes" ghost extends along the track (`+30m / +1h / +2h / +3h`, labelled "uncertainty").
- **Left — Storm Volume panel:** selectable cell chips (`C-17 · 57dBZ`, `C-21 · 48dBZ`, …), plus readouts `CLOUD TOP -68°C`, `MAX DBZ 57`, `LTG/5m 62`, `CONF 87%`. A `SIM` chip.
- **Right — Slice Inspector:** "hover an altitude slice", altitude bands (`0 / 2 / 5 / 8 / 12 km`) with a weak→core colour scale.
- **On the storm:** a floating callout for a city — `EXPECTED ARRIVAL 45 MIN`, `EXTREME RAIN 84%`, `CONFIDENCE 87%`, and a `WHY?` button (jumps to Explain AI).
- A `BACK TO 2D MAP` control.

> Scope note: 3D is high-effort. Build it only after the 2D console, verification and explainability are done. A single pre-baked rotatable volume for one cell is enough for the demo; don't build a general 3D engine.

---

## 4. Screen: Forecast Timeline (`FTM`)

- A compact map strip at top (same cells/tracks), with the transport bar beneath.
- **Hazard Evolution panel** for the selected city, plus a grid of horizon cards: `+1h … +6h`, each showing cell count, a big **peak-rain probability %** (decreasing with lead time: e.g. 88→86→84→81→78→75), and `PEAK RAIN P · σNNkm` (uncertainty growing with lead time). A `SIMULATED` chip.

> This panel is a clean way to show "uncertainty widens with lead time" — a point judges care about. Keep the probabilities monotonic-ish and the σ growing; both come from the data files.

---

## 5. Screen: Data Fusion (`FUS`)

The visual that sells multi-source fusion.

- **Left — three source cards**, each with a `SIM` chip and a mini-viz:
  - `DWR RADAR — structure + motion` (a radar PPI sweep viz)
  - `INSAT SATELLITE — cloud evolution` (cloud blobs, `CTT -63.4°C`)
  - `LIGHTNING — electrical activity` (`+24% / 10min`, a sparkline)
- **Centre — fusion animation:** the three sources flow into a central "AI FUSION" node (`convolutional + spatiotemporal`), then fan out to labelled outputs: Initiation, Trajectory, Lightning, Hail Prob, Ext Rain, Sev Wind, ETA, Uncertainty. A `RUN FUSION` button re-plays the animation.
- **Right — Fusion Outputs panel** (`8 HEADS`): each output with a %: Storm Initiation 62%, Storm Trajectory 87%, Lightning Density 74%, Hail Probability 37%, Extreme Rainfall 84%, Severe Wind 43%, `ETA BENGALURU 45 min`, `σ UNCERTAINTY 12 km@1h`.
- **Bottom-right — ablation readout:** `R → CSI 0.44 · R+S → 0.55 · R+S+L → 0.63`, with `SIMULATED — awaiting validation`.

> The ablation line (radar vs radar+satellite vs radar+sat+lightning) is strong evidence for fusion. Keep it; it ties to Explain AI's ablation lab.

---

## 6. Screen: Explain AI (`XAI`)

Three panels. Header: "Why is this area high risk?" + city + an `ILLUSTRATIVE EXPLANATION · GENERATED FOR DEMO` chip.

- **Risk Breakdown:** a big ring (`84% EXTREME RAIN RISK`) + per-hazard bars (Thunderstorm 91%, Heavy Rain 84%, Hail 37%, Severe Wind 43%). Then **Contributing Signals** with per-signal contribution and source tag: Radar reflectivity +32% (radar), Rapid cloud-top cooling +26% (satellite), Lightning growth +18% (lightning), Storm persistence +14% (model), Environmental context +10% (model). Footer, verbatim intent: *attribution values are illustrative demo output shaped like an integrated-gradient summary — not measured scientific quantities.*
- **Source Ablation — live effect:** three configs with confidence — `RADAR ONLY 63%`, `RADAR + SATELLITE 76%`, `RADAR + SAT + LIGHTNING 87%` — plus `CSI 0.63`, `F1 0.76`, `TRACK ERR 19 km`, `ARRIVAL ERR 6.9 min`, a one-line reading ("lightning electrification trend sharpens intensity + ETA"), and a `SEE THIS CONFIGURATION ON THE LIVE MAP` button.
- **Ablation Lab:** per config (Radar only / +Satellite / +Sat+Lightning): `CSI`, and bars for `CONF` and `HAIL`. A boxed research question: "Does multi-source fusion improve convective nowcasting?" with "all metrics simulated — validation on archival cases in progress".

> This screen is the SHAP/explainability requirement and the fusion-ablation evidence in one. The honesty footer is important with science judges — keep it.

---

## 7. Screen: Storm Replay (`REP`)

The case-study screen — the most persuasive one for judges.

- Event tabs: `EV-029 · Bengaluru Region`, `EV-034 · Mumbai Coast`, `EV-041 · Delhi NCR`, with an `ARCHIVAL · SIMULATED` chip.
- **Centre — split map with a draggable divider:** left side `MODEL FORECAST · ISSUED 18:30`, right side `OBSERVED · ARCHIVE`. A hint: "drag the center divider to compare model forecast vs observed radar." Storm track drawn (cyan = model, amber = observed).
- **Right — Event Intelligence:** `EVENT #029 · CONVECTIVE SYSTEM`, region + date, a paragraph describing the event (pre-monsoon complex crossing the city, model run captured track N min ahead of observation), frame time, intensity, peak dBZ.
- **Right — Model vs Observed:** `TRACK ERROR @+2H 19 km`, `ARRIVAL ERROR 7 min`, `CSI @+1H 0.63`, and a one-line interpretation ("model track lags observed as the cell accelerates").
- **Bottom — timeline scrubber** across the event's clock times (18:00 … 21:00) with per-frame intensity ticks.

> This is where you put a real Indian event once you have data. Until then it is clearly labelled archival/simulated. The side-by-side model-vs-observed is the single most convincing demo beat.

---

## 8. Screen: Validation (`VAL`)

Opens with a full-width banner, verbatim intent: *all metrics below are simulated placeholders — validation on archival cases is in progress. No number here is a measured result.* Plus an `AWAITING VALIDATION` chip. A model toggle: `PERSISTENCE BASELINE` vs `CONVLSTM-V0.3 (FUSION)`.

Panels, each with a `SIMULATED` chip:
- **Reliability · calibration curve:** predicted vs observed, with a "perfect calibration" diagonal; series `R+S+L @+60min`.
- **CSI by forecast horizon:** curves for `R+S+L`, `R+S`, `R`, `Persistence` across `NOW … +6h` (skill decreasing with lead time; fusion above baselines).
- **Track error vs horizon:** km error growing with lead time, per config.
- **Confusion @ +60m:** TP (e.g. 812) / FP (158) tiles.
- **Inference latency:** a gauge (e.g. `1.9s`, `P50 · 13 frames`).

> These are exactly the metrics in your validation plan (CSI, FSS/reliability, track error, latency). Wire them to `eval/results/*.json`; show the banner until real numbers exist.

---

## 9. Screen: System (`SYS`)

Header `SYSTEM · TRUST · IMPACT` + `RESEARCH PROTOTYPE`.

- **System Trust Panel** (`SIMULATED` + a verified-shield icon): source health rows — `DWR RADAR ONLINE · 2.1s`, `INSAT-3D IR ONLINE · 4.8s`, `LN DETECTOR SIMULATED · 1.2s`; then `MODEL ConvLSTM-v0.3`, `LAST RUN 20:38 IST`, `FORECAST HORIZON 0–6h`, `SPATIAL TARGET 1–3 km`, `DATA SIM-Monsoon-2026.09`, `VALIDATION IN PROGRESS`.
- **Processing Pipeline** (`SIMULATED`): stage chips left→right — `DWR RADAR (reflectivity · motion)` → `INSAT IR (cloud-top cooling)` → `LIGHTNING (density · trend)` → `ALIGNMENT (1–3 km grid · 10 min)` → `FUSION (ConvLSTM-v0.3)` → `PROBABILISTIC (output +13 frames)` → `GIS DELIVERY (tracks · ETA · σ)`. Below: stack chips — `BACKEND: FastAPI · PostGIS`, `PROCESSING: GeoPandas · rasterio`, `MODEL: PyTorch · ConvLSTM`.
- **API Surface · FastAPI** (`LIVE · NNN ms`): endpoint rows — `GET /api/status` (system + sources + alerts), `GET /api/storms` (tracked cells @lead), `GET /api/storms/{id}` (cell detail), `GET /api/forecast` (13-frame forecast).
- **System Events · demo feed** (`SIMULATED`): event log — e.g. "Storm C-17 tracking toward Bengaluru — SEVERE 57 dBZ, NE 44 km/h, closest approach ~45 min. Research prototype — not an official warning." and "Radar frame DELAYED — Nagpur DWR — last valid frame 20:36 IST, system holding previous frame." (the delayed-frame event is a good hook for the coverage/data-age story.)

---

## 10. Design language (so it reads as a built instrument, not AI-generated)

Matches the reference and your app build spec:
- **Dark operational console:** near-black slate base (#0E1419-ish), raised panels (#16202B), hairline dividers (#263441). Not pure black.
- **Panels dock flush** with shared edges — not a grid of floating rounded cards with identical soft shadows.
- **Monospace only for live numeric readouts** (clocks, coordinates, dBZ, probabilities, metrics). Sans for everything else.
- **Hazard colours used only for hazards**, consistent across every screen: lightning amber, hail violet, downburst/severe-wind red, cloudburst/rain blue.
- **One restrained interactive accent** (teal/cyan) for controls and active states.
- **Motion:** only the ticking clocks, the storm advancing on play, and the fusion animation on `RUN FUSION`. No fade-up-on-scroll, no hover animation on every element.
- **Honesty chips are part of the design:** `SIM` / `SIMULATED` / `MOCK` / `ARCHIVAL` / `RESEARCH PROTOTYPE` / `AWAITING VALIDATION`. Keep them visible.

Avoid the AI tells: cream + terracotta palette; identical rounded cards; ALL-CAPS eyebrow labels on everything (the reference uses sparse caps for data codes only — fine; don't extend it to headings); `→` on button text; middle-dot meta strings as decoration (the reference uses them for genuine data, which is acceptable).

---

## 11. Data contract (frontend reads only; nothing computed in-browser)

```
replay_packages/<event_id>/
  meta.json          # id, region bbox + corner coords, start time, frame times,
                     # badges (REPLAY / SIM / ARCHIVAL / SIMULATED GAP), named locations, cities
  frames/<t>.json    # per 5-min frame: storm cells (id, dBZ, centroid, movement, severity),
                     # tracks, cones, per-location arrival windows + confidence,
                     # initiation scores, per-cell cloud-top/LTG/conf
  hazards/<t>/*.png  # georeferenced hazard-layer rasters per hazard
  coverage.png       # coverage-tier raster (static per region)
  fusion.json        # 8 fusion-head outputs + ablation (R / R+S / R+S+L CSI)
  xai.json           # risk breakdown + contributing-signal attributions (illustrative)
  alerts.json        # audience, hazard, location, window, confidence, reason, CAP XML, SMS EN/HI/TE
  replay3d/*.glb|json# optional single pre-baked 3D volume for 3DX
  verification.json  # model-vs-observed: track err, arrival err, CSI; revealed at end
eval/results/*.json  # VAL screen: reliability, CSI-by-horizon, track-error, confusion, latency
```

Clocks tick in-browser as `arrival_time − current_replay_time` only; the arrival_time, window and every metric come from the files.

---

## 12. Build order (ship the judge-critical path first)

1. **Shell:** nav rail, top status bar, bottom meta strip, transport bar.
2. **Live Nowcast (2D):** map + hazard layers + storm cells/tracks/cone + inspector + **countdown clocks**. ← required outputs live here
3. **Coverage layer + All/No-radar/Satellite toggle.** ← differentiator
4. **Forecast Timeline:** horizon cards (uncertainty widening).
5. **Storm Replay:** split model-vs-observed + event intel. ← best demo beat
6. **Explain AI:** risk breakdown + contributing signals + ablation.
7. **Data Fusion:** source cards + fusion animation + outputs/ablation.
8. **Validation:** metrics from eval files, with the simulated banner.
9. **System:** trust panel + pipeline + API surface + event feed.
10. **3D Storm Explorer:** one pre-baked volume. (last; highest effort, lowest necessity)
11. **Judge Demo** scripted walkthrough that visits 2→5→6→8 in order.

Items 1–5 are a complete, winning demo that meets the brief and shows the differentiator. 6–11 deepen it.

---

## 13. Hand back
1. `docker compose up` running the console with ≥1 replay event.
2. `DEMO.md`: the exact Judge-Demo click path with timings (open → initiation fires → hazards + countdowns → toggle No-radar → replay model-vs-observed → explain/ablation → validation).
3. A list of any panel still on a `SIMULATED`/placeholder state because its data or eval numbers aren't computed yet.
4. A screenshot of each screen, self-checked against the AI-tells list in section 10.
