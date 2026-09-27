# Implementation status — against the implementation brief

Updated 2026-09-27. Numbers live in `eval/results/*.json`, not here.

| Milestone | Status | What exists | Blocked on / next |
|---|---|---|---|
| Scaffold (§4) | ✅ | `config.yaml`, `Makefile`, `pyproject.toml` (uv, Python 3.11, torch 2.14 + CUDA 12.6), package dirs, `frontend/` | Docker Compose once the API exists |
| **M1** Coverage tier map | ⛔ blocked | — | `overlap_check.py`, `radars_template.csv`, `events_template.csv`, its README (not received) |
| **M2** SEVIR subset | ✅ dev subset / ⏳ full | `data/download_sevir.py` (byte-range reads, resumable), `data/sevir_dataset.py`, `pipeline/preprocess.py`, `data/storm_events_join.py`; alignment plot `docs/m2_alignment.png` | Full 1 000-event download ≈ 4 h at the ~1 MB/s link |
| **M3** Baselines + metrics | ✅ on dev test split | `pipeline/baselines.py` (persistence, LK + semi-Lagrangian, S-PROG), `eval/metrics.py` (CSI/POD/FAR/bias, FSS, amplitude bias; unit-tested), `eval/evaluate.py` → `eval/results/baselines.json` | Re-run on the full 200-event test split |
| **M4** Training masks | ⛔ blocked | `SevirDataset(mask_fn=…)` hook ready | M1 tier grid |
| **M5** Nowcast U-Net | ⬜ | torch + GPU verified (GTX 1050 Ti, 4 GB) | Brief assumes T4/A10: use the 1 h / smaller-model fallback locally or a cloud GPU |
| **M6** Hazards | ⬜ | Storm Events labels joined (hail size, wind speed) | M5 outputs |
| **M7** Initiation + tracking | ⬜ | — | — |
| **M8** Calibration | ⬜ | — | M6 |
| **M9** Replay + dashboard | 🟡 frontend done on synthetic data | `frontend/`: map, layers, timeline, alerts, countdowns, CI card, lineage, verification, guided demo, offline basemap; **Model skill panel reads `eval/results/*.json`** | `export/build_replay.py`, `services/api`, coverage-tier layer, event picker, `US-SEVIR` / `ASSUMED` / `SIMULATED GAP` badges |
| **M10** Alerts output | 🟡 | CAP 1.2 + EN/HI/TE SMS in the frontend (synthetic) | `alerts/severity.py`, thresholds tuned on validation data |
| **M11** NWP blend | ⬜ | UI labels 3–6 h "designed, not validated" | HRRR access check |
| **M12** Indian case | ⬜ | — | MOSDAC data |
| **M13** Demo package | 🟡 | Guided demo mode in the UI | `DEMO.md`, `RESULTS.md`, `LIMITATIONS.md`, recording |

## Findings so far

- **Bandwidth is the constraint.** SEVIR over this link: ~0.28 MB/s per connection, ~1 MB/s with 8 in parallel. VIL/IR are contiguous uncompressed arrays, so each event is fetched as byte ranges (~14 MB/event) instead of whole 4–16 GB files.
- **Formats verified on real data:** IR stored as °C × 100; lightning `[t_sec, lat, lon, x, y]` with x, y on the 48×48 grid (×8 → 1 km); IR is 10–42 °C colder over VIL cores in the stored orientation and worse under any flip or transpose.
- **Storm Events join:** exact on NOAA `event_id` — 29/29 dev storm events matched.
- **S-PROG** cannot run on near-empty fields; those events fall back to optical flow and are listed in `baselines.json → notes`.

## Commands

```bash
make data-dev        # 80-event subset
make check           # M2 acceptance
make baselines       # M3 → eval/results/baselines.json
.venv/bin/python -m eval.publish   # copy results into the dashboard
make test
```
