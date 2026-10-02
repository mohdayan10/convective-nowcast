# Implementation status

Updated 2026-10-02. Numbers live in `eval/results/*.json`, not here.
Demo click path and the list of screens still showing placeholders: `docs/DEMO.md`.

| Milestone | Status | What exists | Next |
|---|---|---|---|
| Scaffold | ✅ | `config.yaml`, `Makefile`, `pyproject.toml`, `Dockerfile`, `docker-compose.yml` | — |
| **M1** Coverage tier map | ⛔ blocked | — | `overlap_check.py`, `radars.csv`, `events.csv` and its README were never received. Replay packages use a deliberate **simulated** two-radar network (`export.build_replay.demo_network`), badged `SIMULATED GAP` |
| **M2** SEVIR subset | ✅ | 1 018 events cached; `download_sevir.py`, `sevir_dataset.py`, `preprocess.py`, `storm_events_join.py` | — |
| **M3** Baselines + metrics | ✅ | persistence / optical flow / S-PROG → `baselines.json`. Mean CSI at 60 min: 0.155 / 0.205 / 0.230 | — |
| **M4** Training masks | 🟡 simulated | `SevirDataset(mask_fn=…)`, `tier_shares.json` | real tiers need M1 |
| **M5** Nowcast U-Net | ✅ trained / ⏳ scored | `unet_2km.pt`, 7.0 M params, 2 km, 60 min horizon; `train_log.json` | `make model` running → `model.json` |
| **M6** Hazards | ✅ | `hazards.json`: downburst AUC 0.75 / CSI 0.41, hail AUC 0.72 / CSI 0.11 at full tier, 15 min. Hail drops to AUC 0.50 with no radar | cloudburst has no gauge truth on SEVIR |
| **M7** Initiation + tracking | ✅ tracking / ⏳ initiation | `tracking.py` drives the replay cells, lineage and arrival windows | `make ci` running → `ci.json` |
| **M8** Calibration | ✅ measured / ⬜ applied | `calibration.json`: reliability and isotonic refit per hazard × tier on the test split. Brier for P(VIL ≥ 133) at 1 h: 0.050 → 0.027 full tier, 0.126 → 0.039 with no radar; hail 0.111 → 0.078 | the fitted isotonic models are not applied — the replay package still ships raw probabilities, which every screen says |
| **M9** Replay + dashboard | ✅ | `export/build_replay.py` → `replay_packages/<id>/`; `export/build_observed.py` (observed rasters + arrival error) and `export/build_xai.py` (SHAP from the cell models); `services/api/main.py` (REST + WebSocket); nine-screen console in `frontend/src/screens/` | more demo events |
| **M10** Alerts output | ✅ | `alerts.json` thresholds per audience; CAP 1.2 + EN/HI/TE SMS in the UI. District hail alerts 52 → 13 at lower FAR | native-speaker review of HI/TE |
| **M11** NWP blend | ⬜ | UI hatches the lead slider past 60 min and says "not validated" | HRRR access |
| **M12** Indian case | ⬜ | basemap bundle for the Doon valley is still in `public/offline/` | MOSDAC data |
| **M13** Demo package | 🟡 | `docs/DEMO.md` with the click path and the placeholder table, scripted Judge-demo walkthrough in the console, `docker compose up` | `RESULTS.md`, `LIMITATIONS.md`, recording |

## What the app is now

A nine-screen **replay console**: the browser computes nothing but the countdown
arithmetic. Overview, Live nowcast, 3D storm relief, Forecast timeline, Data fusion,
Explain, Storm replay, Validation, System — plus a scripted walkthrough that
drives the console through the judge path. `docs/DEMO.md` lists every screen and
every panel still in a placeholder state.
`export/build_replay.py` runs the model, tracker and hazard scorers offline and
writes a package per event; `services/api` serves it; the console renders it.
Two companion exporters need neither torch nor a GPU and run after it:
`export/build_observed.py` writes the observed radar, satellite and lightning
rasters plus a per-site arrival error (median absolute 5 min, 41 % of arrivals
inside the forecast window on the demo event), and `export/build_xai.py` writes
exact SHAP values from the LightGBM hail and downburst models, which reproduce
the probabilities already in the package.
The previous frontend simulated storms in the browser (`src/model/physics.ts`
and friends) — that is removed, and its files are recoverable from commit
`4f7b9eb` if any of it is wanted back.

Three coverage modes are precomputed per analysis time and are genuine forward
passes, not restyled copies: **all sources**, **no radar** (every pixel tier 0,
which is the modality-dropout path the model was trained on) and **satellite
only** (lightning channel blanked too). On the demo event the forecast peak VIL
goes 27.1 → 28.7 → 6.4 kg/m² across those three.

That removal is now **measured over the whole test split** (`make modes` →
`eval/results/modes.json`, 218 held-out events). Mean CSI at 60 min: 0.166 with
every source, 0.149 with radar denied (90 % of the skill kept) and 0.121 from
satellite alone. Optical flow on the same denied input scores 0.000 — with no
radar there is nothing to extrapolate, so what the model keeps there comes from
satellite and lightning. This was the gap the last revision of this file called
the most valuable thing to add next.

Object track error is measured too, and it is the one metric where the model
loses: `make track-skill` tracks the forecast fields as objects and matches them
to the observed cells by ID, and at 60 min the median centroid error is 36.9 km
for the model against 21.0 km for optical flow and 38.1 km for persistence, over
847 cells in 116 events. Two things in the same file explain it rather than
excuse it: the model holds only 45 % of the cells as objects (optical flow holds
95 %), because a weakened cell drops below the detection threshold, and a matched
forecast cell is about five times the observed area, so the smooth field has
merged neighbours and the merged centroid sits between them. The console says this on
the validation screen in those words. Nothing in the product depends on it — the
cells, arrival windows and alerts are all tracked on observed radar — and
`make tracks` writes the same metric per event for the replay screen.

The VIL layers are drawn on a six-stop reflectivity heat ramp rather than the
single white alpha ramp the first build used, where a severe core and a weak echo
differed only in how grey they were. Forecast and observation share the ramp and
the range, so the comparison on the replay screen stays fair — and the model
saturating lower than the observation is itself the finding. `export/recolour.py`
re-colours the rasters of a built package in place, since the old alpha encoded
the value exactly.

The 3-D screen draws the observed VIL field, not the cells: `export/build_relief.py`
contours it at thirty levels for every 5 min frame (`relief/<f>.json`, `make
relief`), each shell translucent and raised to its own level, so they compose into
a cloud-pale mass with warm cores. Three versions were needed: a slab per tracked
cell says nothing about shape, a dozen opaque contours read as a terraced hill,
and columns of the pooled grid read as a wall of blocks. SEVIR still has no radar volume, so this remains a 2-D product
shown in relief and the screen says so.

## Known gaps

- **Probabilities are measured but not recalibrated.** `make calibrate` now
  writes reliability curves and fits isotonic models per hazard × coverage tier,
  and the Validation screen draws them. The fits are not applied: the replay
  package ships raw model output, so a probability on any screen is still a
  ranking rather than a frequency, and every screen that shows one says so.
  Applying them means re-running `make replay` with `isotonic.pkl` loaded.
- Coverage tiers are simulated; partial-tier scaling is an assumption.
- Downburst is a VIL-collapse proxy, not Doppler velocity.
- Per-lead hazard curves do not exist — the cell models score the analysis time only.
- **Object track error is measured, not fixed.** Matching is by inherited cell ID,
  so a merge is reported as a displacement with a large area ratio beside it
  rather than separated from one. A MODE-style many-to-many object match would
  separate the two; it is not written.
- The lineage of a long-lived mesoscale system accumulates many parents; the UI
  shows the most recent few.

## Commands

```bash
make data-dev        # 80-event subset          make hazards      # M6
make check           # M2 acceptance            make ci           # M7
make baselines       # M3                       make calibrate    # M8 reliability
make model           # M5 vs baselines          make alerts       # M10
make modes           # radar-denied skill       make replay       # M9 package
make track-skill     # track error vs lead      make tracks       # track error, one event
make test
make demo            # docker compose up → localhost:8000
```
