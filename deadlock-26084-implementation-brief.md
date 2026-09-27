# Implementation Brief — SIH 26084 Demo (Team Deadlock)

> Give this to Claude Code. It is a **build spec**: code, data, commands, tests. Attach `overlap_check.py`, `radars_template.csv`, `events_template.csv`, and the overlap-check `README.md`. This replaces earlier build prompts.

---

## 1. What we are building

A working demo of a **coverage-aware convective nowcasting system**:
- Ingests radar (VIL), satellite IR and lightning for recorded storms.
- Knows, per pixel, how well radar can see (full / partial / none coverage tiers).
- Detects storm initiation from satellite, tracks storms, forecasts 0–3 h with ML (3–6 h via NWP blend if data is reachable).
- Produces four hazard layers (lightning density, hail, downburst proxy, cloudburst) with confidence.
- Streams everything as a **replay** into a map dashboard with countdowns and alerts.

**Demo strategy:** heavy computation runs **offline** once (training, inference, hazards) and writes results to disk. The live demo only **replays precomputed outputs**. This keeps the demo fast and crash-proof on a laptop. Everything is labelled REPLAY.

---

## 2. Rules (short, strict)

1. No hardcoded metrics or lead times. Every number in UI/docs is read from files produced by `eval/`.
2. Badges on screen: `REPLAY`, `US-SEVIR`, `PROXY` (downburst), `ASSUMED` (radar params), `SIMULATED GAP`.
3. If the model loses to a baseline somewhere, the results page shows it.
4. SEVIR split: train < 2019-06-01, test ≥ 2019-06-01. No test data in training or tuning.
5. After each milestone, run its acceptance check and report. Stop if it fails.

---

## 3. Stack

- **Python 3.11:** PyTorch, pysteps, numpy, xarray, h5py, scikit-image, scikit-learn, lightgbm, shap, rasterio, pandas, matplotlib.
- **Backend:** FastAPI + WebSocket, Uvicorn. (Redis/PostGIS optional — MVP serves from disk.)
- **Frontend:** React + Vite + MapLibre GL.
- **Infra:** Docker Compose. Training needs **one GPU** (T4/A10 or better). Demo runs on CPU.

---

## 4. Repo layout

```
deadlock-nowcast/
├── docker-compose.yml
├── Makefile                      # make data / baselines / train / infer / demo
├── config.yaml                   # paths, thresholds, tier config, event lists
├── coverage/
│   ├── overlap_check.py          # provided
│   ├── radars.csv  events.csv
│   └── make_training_masks.py    # tier-map patches → masks for SEVIR
├── data/
│   ├── download_sevir.py         # subset download from AWS
│   ├── sevir_dataset.py          # PyTorch Dataset (frames, channels, masks)
│   └── storm_events_join.py      # NOAA Storm Events labels
├── pipeline/
│   ├── preprocess.py             # regrid, normalise, lightning gridding
│   ├── baselines.py              # persistence, pysteps LK + S-PROG
│   ├── model_unet.py             # tier-aware multi-output U-Net
│   ├── train.py  infer.py
│   ├── blend.py                  # nowcast → NWP (optional)
│   ├── initiation.py             # CI labels, features, LightGBM, SHAP
│   ├── tracking.py               # cells, IDs, merge/split, arrival windows
│   ├── hazards.py                # 4 hazards + tier gating
│   └── calibrate.py              # reliability + isotonic per tier
├── eval/
│   ├── metrics.py                # CSI/POD/FAR/FSS/bias
│   ├── evaluate.py               # writes eval/results/*.json
│   └── plots.py
├── alerts/
│   ├── severity.py  cap.py  sms_templates.py
├── export/
│   └── build_replay.py           # precomputed outputs → replay package
├── services/api/                 # FastAPI: REST + WebSocket replay
├── frontend/                     # React + MapLibre dashboard
├── replay_packages/              # generated per demo event
└── docs/ RESULTS.md LIMITATIONS.md DEMO.md
```

---

## 5. Milestones

Time estimates assume a team of 3–4 with one GPU; adjust. **M1–M9 = minimum working demo.**

### M1 — Coverage tier map (day 1–3)
- Run `overlap_check.py --selftest`, then real run with filled `radars.csv`, SRTM DEM, and events (see its README).
- Save the India tier grid (`tier_grid_base.npz`) — it feeds M4 and the dashboard.
- **Accept:** tier map PNG, summary JSON, sensitivity table; one-paragraph Thesis A/B decision with numbers.

### M2 — SEVIR subset (day 2–4)
- `download_sevir.py`: read `CATALOG.csv` from `s3://sevir` (anonymous access). Select events that have **all of** `vil`, `ir069`, `ir107`, `lght`. Take ~800 train + ~200 test, oversampling events with severe Storm Events types (hail, thunderstorm wind, flash flood). Download only the needed H5 files.
- Note native grids: VIL 384×384 @ 1 km; IR 192×192 @ 2 km; lightning = flash point list (must be gridded). Frames: 49 × 5 min.
- `preprocess.py`: upsample IR to 384×384 (bilinear) for fusion only; grid lightning to flashes per 1 km pixel per 5 min, then smooth (Gaussian σ≈2 px); normalise channels; cache as `.npz` or zarr.
- `storm_events_join.py`: attach hail size / wind speed / event type from the catalog link or NOAA Storm Events CSVs by time + location. Print match rate.
- **Accept:** `python -m data.sevir_dataset --check` prints tensor shapes and plots one event with all channels aligned.

### M3 — Baselines + metrics (day 4–6)
- `baselines.py`: persistence; pysteps Lucas-Kanade motion + semi-Lagrangian extrapolation; S-PROG. Input 13 frames → 12 (1 h) and 36 frames (3 h) ahead.
- `metrics.py`: CSI, POD, FAR at VIL thresholds (confirm standard SEVIR thresholds from the SEVIR repo), FSS at 1/5/15 km, amplitude bias. Per lead time.
- **Accept:** `eval/results/baselines.json`.

### M4 — Coverage masks for training (day 5–6)
- `make_training_masks.py`: cut random 384×384 patches from the India tier grid (weight toward Himalayan areas) → per-pixel tier map.
- Apply to SEVIR samples at load time:
  - tier 0 (none): VIL channel = 0, radar-mask channel = 0
  - tier 1 (partial): VIL × factor(beam height) + noise — **approximation, label it**
  - tier 2 (full): unchanged
- 20% of samples keep random rectangular masks for robustness; 20% keep no mask.
- **Accept:** notebook showing 6 masked samples; tier share statistics saved.

### M5 — Nowcast model (day 6–14)
- `model_unet.py`: U-Net, input channels = 13 frames × (VIL, IR069, IR107, lightning) + tier map + radar mask → **two heads**: 12 future VIL frames and 12 lightning-density frames (1 h). Then extend to 36 frames (3 h) if skill holds.
- Loss: weighted MSE (weights rise with VIL intensity) + small MAE on lightning. Track amplitude bias.
- Train with mixed precision, batch as GPU allows, early stopping on validation CSI. Keep the model small (~5–15 M params) to fit training in hours, not days.
- Ensemble: MC-dropout, 10 samples → probability per pixel.
- `evaluate.py`: model vs best baseline, **per lead time and per tier** (tiers applied to test events with the same masks).
- **Accept:** `eval/results/model.json` + a table; losses shown.

### M6 — Hazards (day 12–16)
- `hazards.py`:
  - **Lightning density:** from the lightning head.
  - **Hail:** LightGBM on patch features (max/mean VIL, IR min temperature, overshooting-top indicator = IR107 much colder than surroundings, lightning rate); labels = Storm Events hail.
  - **Downburst (PROXY):** rule + LightGBM on "high VIL core followed by VIL drop > X% in 10–20 min" features; labels = Storm Events thunderstorm wind (with speed band).
  - **Cloudburst:** VIL → rain rate via a documented relation (state the formula and its uncertainty), accumulate over 1 h and ~25 km² windows → P(≥100 mm/h).
- **Tier gating:** downburst hidden where tier = 0, shown in tier 1 only above a set threshold; others shown with tier-appropriate confidence.
- **Accept:** `eval/results/hazards.json` per hazard and tier.

### M7 — Initiation + tracking (day 14–18)
- `initiation.py`: label = new VIL cell (not advected) within 15/30/60 min. Satellite-only features (IR cooling rate, min IR temperature, WV−IR difference, overshooting tops); radar features only where tier ≥ 1; lightning as confirmation. LightGBM + SHAP top-3 reasons. Also evaluate with satellite degraded to 4 km and 15/30-min cadence.
- `tracking.py`: threshold VIL (kg/m²) → `skimage.measure.label` → match cells frame-to-frame by overlap + predicted motion; merge/split keeps parent/child IDs. Arrival windows for named points from ensemble motion.
- **Accept:** CI POD/FAR/median lead time (both cadences); one lineage tree image.

### M8 — Calibration (day 16–18)
- `calibrate.py`: reliability diagrams per hazard × tier on validation data; isotonic recalibration.
- **Accept:** `eval/results/calibration.json` + plots.

### M9 — Replay package + dashboard (day 14–24, in parallel)
- `export/build_replay.py` for each demo event writes:
  - `meta.json`: event id, georeference (corner lat/lon from SEVIR catalog), start time, frame times, badges.
  - per frame: PNG overlays for VIL, IR, lightning, each hazard, tier map (transparent, colour-mapped); GeoJSON for storm cells, tracks, uncertainty cones; `alerts.json`; `ci.json` with scores + SHAP reasons.
  - `verification.json`: observed truth, hits/misses/false alarms, achieved lead time.
- `services/api`: `GET /events`, `GET /events/{id}/meta`, `WS /replay/{id}?speed=20` streaming frame indices + JSON; static files for PNG/GeoJSON.
- `frontend`:
  - MapLibre map; PNG overlays as `image` sources using event corner coordinates.
  - Layer toggles; **coverage-tier layer**; time slider 0–3 h (0–6 h if blend exists) labelled "0–3 h ML · 3–6 h NWP blend".
  - Right panel: countdown cards ("arrival 25–40 min · 70%" from `alerts.json`), alert feed with Aviation / District / Farmers tabs, CI score + SHAP chips, lineage tree.
  - Badges on every panel; verification panel at end of replay; results page reading `eval/results/*.json`.
- **Accept:** `docker compose up` → open browser → pick event → replay runs end to end on a laptop CPU.

**— minimum working demo ends here —**

### M10 — Alerts output (day 20–24)
- `severity.py`: hazard prob × arrival prob × exposure (population / roads / airports from WorldPop + OSM for the demo region; simple for US events).
- Audience thresholds tuned on validation data; report alert count and FAR per audience vs one fixed threshold.
- `cap.py`: CAP 1.2 XML per alert, including coverage + confidence text.
- `sms_templates.py`: English, Hindi, Telugu templates (flag for native-speaker review).

### M11 — NWP blend for 3–6 h (optional, day 20+)
- For US events: HRRR archive (AWS open data) at matching times; for India: NCUM if available, else GFS.
- `blend.py`: weight(t) from skill vs lead time. If no NWP is reachable, keep the interface and show "3–6 h: designed, not validated" — no numbers.

### M12 — Indian case study (when MOSDAC data arrives)
- Load INSAT-3D/3DR IR (MOSDAC HDF5), regrid, run **satellite-only / available-sources** mode, overlay on the India tier map.
- If no verifiable real-gap event: apply the real tier mask to a radar-covered Indian storm, badge `SIMULATED GAP`.
- Verify against IMERG half-hourly or rain gauges. Report achieved lead time, including misses.

### M13 — Demo package
- Presets: US hail event, US downburst event, Indian case (or "pending data").
- `DEMO.md` click-by-click (below), `RESULTS.md`, `LIMITATIONS.md`, 90-second screen recording.

---

## 6. Demo flow (what the replay must show)

1. T−90 min: map with coverage-tier layer; no storm on radar; baseline panel "no warning".
2. CI score rises from satellite before any radar echo; SHAP reasons shown.
3. Storm cell gets an ID; merge/split lineage kept.
4. Hazard layers appear; slider moves across lead times; downburst disappears where tier = none.
5. Countdown windows for named points; alerts per audience with coverage + confidence; CAP and SMS preview.
6. Replay reveals truth; verification panel with achieved lead time vs baseline.
7. Results page: skill by lead time and tier vs baselines, reliability diagram, limitations.

---

## 7. Fallbacks if time or compute runs short

| Problem | Fallback |
|---|---|
| No GPU / slow training | Train 1 h horizon only, smaller U-Net, fewer events; state it |
| Model doesn't beat pysteps | Show it honestly; lead with coverage map, CI and calibrated confidence |
| Storm Events labels don't join | Hail/downburst as rule-based proxies, labelled |
| No NWP | 0–3 h only; 3–6 h labelled "designed, not validated" |
| No Indian data | Indian panel shows the tier map + "pending data access" |
| Live demo breaks | Screen recording |

---

## 8. Hand back
1. Repo with `make demo` working.
2. `eval/results/*.json`, `RESULTS.md` (every number + source file), `LIMITATIONS.md`, `DEMO.md`.
3. Tier map, overlap decision, sensitivity table.
4. List of anything in problem 26084 not implemented, and why.
