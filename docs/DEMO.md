# Demo — click path and current state

Replay of **S852920**, a Thunderstorm Wind event over Kansas / Missouri,
17 August 2019, 06:37 UTC. 49 frames at 5 min (4 h). Everything on screen is read
from `replay_packages/<id>/`; the browser computes nothing but the countdown
arithmetic.

Two packages are built from that one event, and the console opens on the first:

| Package | What it is |
|---|---|
| `S852920-IN-KA` | the same event with its 384 km grid georeferenced onto **Karnataka**, tile centred on Bengaluru. Badged `RELOCATED`. The named locations and airports are the real ones for that tile — Bengaluru, Kempegowda (BLR), Mysuru, Mandya, Tumakuru, Salem, Vellore, Davangere — because they come from the same global exposure tables. Nothing else moves: the forecast, the cells, the arrival windows, every metric and the timestamps are computed on the grid, and the grid is unchanged. Overview opens with a banner saying exactly that. |
| `S852920` | the event where it happened, over Kansas and Missouri |

Build the relocated one with `make replay-india`. It needs the Karnataka basemap
bundle in `frontend/public/offline/basemap-in.pmtiles`, and MapLibre 5 — 2026
Protomaps builds encode Kannada and Tamil labels in PGF, which MapLibre 4 cannot
decode, and a failed tile stops the style loading so no overlay is ever drawn.

Storm objects are written at every 5 min frame (`cells/<frame>.json`, `make
cells`), not only at the 20 min analysis times, so the cells and the 3-D relief
advance with the replay clock instead of stepping every twenty minutes. The
hazard rasters are still per analysis time, which is when the model ran.

## Run it

```bash
docker compose up --build        # → http://localhost:8000
```

Or on the host, without Docker:

```bash
make frontend                    # build the console
make api                         # serve it on :8000
```

Rebuilding the replay package (needs the GPU, the SEVIR cache and torch):

```bash
make replay                      # build_replay, then build_observed and build_xai
```

The two companion steps need neither torch nor a GPU — only the cached SEVIR
event and the trained cell models — so they can be re-run on their own:

```bash
make observed                    # obs/*.png + observed.json  (what actually happened)
make xai                         # xai.json                   (SHAP from the cell models)
```

`make tracks` writes `tracks.json` — where the forecast put each storm against
where it went — and does need the GPU, because it re-runs the forecast rather
than tracking the package's 8-bit PNGs.

The evaluation files behind the Validation screen are built separately and do not
touch the package:

```bash
make model                       # skill against the three baselines
make modes                       # the same model with radar and lightning denied
make track-skill                 # object track error per lead, model vs baselines
make calibrate                   # reliability per hazard and coverage tier
```

## The screens

| Code | Screen | What it carries |
|---|---|---|
| `OVW` | Overview | The event, the coverage split, and the generated list of what is **not** computed |
| `NOW` | Live nowcast | **Required outputs**: GIS hazard map and ticking arrival countdowns. Two VIL rasters, named apart in the rail: the observed radar at the replay clock, and the model's forecast at the lead on the transport bar. Both are drawn on one reflectivity heat ramp, so the model's smooth field and the observation's sharp cores can be read against each other |
| `3DX` | 3D storm relief | The observed VIL field in relief — thirty translucent shells composing into a cloud-pale mass with warm cores — with the tracked cells as faint footprints on the ground. Rotatable, with an orbit control, and labelled as a drawing of a 2-D product rather than a measured volume |
| `FTM` | Forecast timeline | Per-lead forecast thumbnails with measured CSI, bias and no-radar CSI |
| `FUS` | Data fusion | The three input rasters the network was actually fed, its heads, and the ablation |
| `XAI` | Explain | Exact SHAP values from the hail and downburst models |
| `REP` | Storm replay | Split map: model forecast against observed radar at the same valid time |
| `VAL` | Validation | Measured skill from `eval/results/*.json`, with what is not measured named |
| `SYS` | System | Sources, pipeline, API surface and this session's event log |

**Judge demo** at the bottom of the screen rail drives a fixed ten-step
walkthrough of the path below. Back and Next step through it; the panel clears
the transport bar so the counters stay readable.

## Click path (7–8 min)

| # | Do this | What to say |
|---|---|---|
| 1 | Open `localhost:8000`, pick **IMD–NCMRWF forecaster**, land on `OVW` | "A replay console. One recorded event, played back from precomputed files. The list of what is not computed is generated from the package, not written by hand." |
| 2 | `NOW` — press **play** (20×) | "The replay clock advances and the countdown clocks tick down to arrival at each named location. The window and the confidence come from an ensemble of perturbed storm motions in the package; the browser only subtracts." |
| 3 | Point at the **hazard cards**, top left | "Extreme rainfall, severe wind, lightning, hail — the parameters the problem statement asks for, each with its trend against the previous analysis time." |
| 4 | Point at the **coverage layer** in the left rail | "39% of this tile has full radar, 29% partial, 31% none. The tiers are simulated and every panel that uses them says so." |
| 5 | Switch to **No radar**, then **Satellite only** | "Separate forward passes with the input removed, not the same forecast restyled. Peak VIL in the transport bar goes 26.7 → 28.6 → 6.5 kg/m² at this analysis time. Over the whole test split the model keeps 0.149 of its 0.166 mean CSI at 60 minutes with the radar denied — 90% — and optical flow on the same denied input scores zero. That number is on the validation screen." |
| 6 | `REP` — drag the **divider** | "Same valid time: model forecast left, observed radar right, same grid and same colour ramp. The model has the shape and the position; it is smoother and weaker than the observation, which the next screen quantifies." |
| 7 | `REP` — read **Model against observed** | "Median absolute arrival error 5 minutes, 41% of arrivals inside the forecast window, 29 site-forecasts. Beside it, where the forecast put the storm: the matched cell's centroid is tens of kilometres off at an hour, and the area column says why — the forecast cell is several times the area of the observed one, so it has merged its neighbours and the merged centroid sits between them. We report the metric that makes the model look worst, with what it is actually measuring." |
| 8 | `XAI` — pick the strongest cell | "Exact SHAP values from the gradient-boosted downburst model. The bars sum with the base value to the model's logit, so this can be checked against the probability on the map. Lightning rate and cloud-top temperature carry this cell." |
| 9 | `FUS` | "The three rasters are the arrays the network was fed. Eight heads, two of them not trained and marked so." |
| 10 | `VAL` | "Measured over 218 held-out events: mean CSI against three extrapolation baselines, the skill left when the radar is taken away, object track error per lead, and reliability per hazard and coverage tier. The page states where the model loses to a baseline — it does, below 20 minutes — and keeps its own list of what is still not measured." |
| 11 | `SYS` | "The pipeline, the API, and this session's log. Nothing live, nothing sent." |

## What is still a placeholder, and why

These are labelled in the interface, not hidden. Each names the command that
fills it.

| Screen | Placeholder | Fills when |
|---|---|---|
| `OVW` → what is not computed | three rows, generated from `meta.availability` | the commands in that table run, then `make replay` |
| `NOW` left rail → Initiation candidates | "Initiation model not trained yet" | `make ci`, then `make replay` |
| `NOW` map → initiation markers | nothing drawn | `make ci`, then `make replay` |
| `3DX` → altitude slices | "no slice exists to show and none is drawn" | needs a radar volume; SEVIR has none |
| `FTM` → +1.5 h … +6 h cards | hatched, "no forecast" | needs a 3-h model or an NWP blend |
| `FTM` → per-lead hazard curves | "not computed" | the cell models would have to score each lead frame |
| `FUS` → Initiation head | "not trained" | `make ci` |
| `XAI` → attributions | absent if `xai.json` is missing | `make xai` |
| `REP` → split map | "no observed rasters" if `observed.json` is missing | `make observed` |
| `VAL` → recalibrated probabilities | reliability is drawn; the fits are not applied | the replay package would have to be rebuilt with `isotonic.pkl` loaded |
| Everywhere | "Coverage tiers simulated" | needs the M1 radar-overlap grid |
| Forecast lead beyond 60 min | hatched on the transport bar | as above |

Nothing on any screen shows a number for the rows in this table.

## Numbers a judge is likely to ask about

All of these are read from files, and all are reproducible from the repo:

- **Nowcast skill** — mean CSI at 60 min: model 0.166, S-PROG 0.125, optical flow
  0.115, persistence 0.094, over 218 held-out events (`eval/results/model.json`).
  The model loses to S-PROG and optical flow at 5–15 min; the page says so.
- **Coverage breakdown** — mean CSI at 60 min by tier: full 0.174, partial 0.185,
  no radar 0.155 — the same model and the same forecasts, scored over the pixels
  at each tier. The tiers are simulated, and the ordering is not clean: partial
  scores above full here, which is why the console calls this a breakdown of one
  forecast and not a measurement of forecasting without radar.
- **Radar denied** — that measurement, separately: the model re-run with the input
  taken away over the same 218 events. Mean CSI at 60 min 0.166 all sources,
  0.149 no radar, 0.121 satellite only; optical flow on the same denied input
  0.000, because with no radar there is nothing to extrapolate
  (`eval/results/modes.json`). Forward pass 0.56 s per event, 10 MC-dropout
  members over a 384 km tile on a GTX 1050 Ti.
- **Track error** — the number that goes against the model, and it is on the
  validation screen: median centroid error at 60 min 36.9 km for the model
  against 21.0 km for optical flow and 38.1 km for persistence, over 847 cells in
  116 events (`eval/results/track.json`). The model keeps only 45% of the cells as
  objects where optical flow keeps 95%, and a matched forecast cell is about five
  times the observed area, so part of that error is the smooth field merging
  neighbouring storms rather than misplacing one. The model wins on pixel skill
  and loses on object position; nothing in the console uses its object tracks —
  the cells, arrival windows and alerts are tracked on observed radar.
- **Reliability** — Brier for P(VIL ≥ 133) at 1 h, raw → after an isotonic fit on
  the validation period: 0.050 → 0.027 over full-radar pixels, 0.126 → 0.039
  where there is no radar; hail 0.111 → 0.078 (`eval/results/calibration.json`).
  The fits are measured, not applied — the console ships raw probabilities and
  says so.
- **Arrival** — median absolute error 5 min over 29 site-forecasts on this event;
  41% of observed arrivals fell inside the forecast window
  (`replay_packages/S852920/observed.json`).
- **Alerts** — 15 issued in this replay, 14 hits, 1 false alarm, median lead
  12.5 min (`verification.json`). District hail thresholds cut alerts 52 → 13.
- **Attributions** — reproduce the probability exactly: cell 52's downburst
  logit is base −1.06 plus the contributions listed, giving 0.909, which is the
  0.909 in `frames/28.json`.

## Screenshots

One per screen, captured from the running console at 1680×950, in
`docs/screens/`: `overview`, `nowcast`, `explorer`, `timeline`, `fusion`,
`explain`, `replay`, `validation`, `system`.
