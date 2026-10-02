"""Per-event object track error for an already-built replay package.

`build_observed` scores when the storm arrived at a site. This scores where the
forecast put the storm: at every analysis frame in the package the forecast is
re-run, its cells are tracked, and each cell is compared with the same cell in
the observation at the same valid time. That is the one metric the Storm Replay
screen was missing, and the only one it showed as not computed.

Needs the trained U-Net and a GPU, like `build_replay`, but only one event:

    python -m export.build_tracks --event S852920

Writes, into the existing package:
    tracks.json   per analysis frame and per lead: median centroid error in km,
                  the cells matched, and the cells the observation still has

The forecast is re-run rather than read back from the package's PNGs, which are
8-bit renders — tracking them would measure the rendering as well as the model.
Nothing else in the package changes, so the numbers on the other screens are the
ones that shipped.
"""
from __future__ import annotations

import argparse
import json
import zlib
from datetime import timedelta

import numpy as np
import pandas as pd

from pipeline.settings import ROOT, path
from pipeline.tracking import MIN_AREA_KM2, THRESH_KGM2, match_error

MODE = "all"            # the forecast the replay shows by default


def build(pkg: str, out_root=None, n_members: int = 10) -> dict:
    from coverage.tiers import apply_tiers, sample_tiers
    from data.sevir_dataset import load_event
    from export.build_replay import demo_network
    from pipeline.baselines import _motion
    from pipeline.infer import predict
    from pipeline.preprocess import vil_frames
    from pipeline.train import N_IN, N_OUT

    out = (out_root or path("replay")) / pkg
    if not (out / "meta.json").exists():
        raise SystemExit(f"no replay package at {out} — run export.build_replay first")
    meta = json.loads((out / "meta.json").read_text())
    from pipeline.meta import from_package
    eid = from_package(meta)       # a relocated package is named after its tile
    step = meta["step_min"]
    start_utc = pd.to_datetime(meta["start_utc"]).to_pydatetime()
    # The same coverage sample the package was built with, so the forecast being
    # scored is the forecast the console draws.
    ts = demo_network() if meta["coverage"]["source"] == "simulated-demo" \
        else sample_tiers(np.random.default_rng(zlib.crc32(eid.encode()) + 1))
    vil = vil_frames(load_event(eid)["vil"])

    per_lead_err: list[list[float]] = [[] for _ in range(N_OUT)]
    per_lead_ratio: list[list[float]] = [[] for _ in range(N_OUT)]
    per_lead_kept = np.zeros(N_OUT)
    per_lead_alive = np.zeros(N_OUT)
    frames = []
    for a in meta["analysis_frames"]:
        if a + N_OUT >= vil.shape[0] or a - N_IN + 1 < 0:
            continue
        x = vil[a - N_IN + 1:a + 1]
        y = vil[a + 1:a + 1 + N_OUT]
        xm, _ = apply_tiers(x, ts, np.random.default_rng(0))
        fcst = predict(eid, a - N_IN + 1, ts, np.random.default_rng(a), n_members)["vil"]
        r = match_error(xm, y, fcst, _motion(xm))
        rows = []
        for i, row in enumerate(r["errors"]):
            e = [v for _, v, _ in row]
            ra = [q for _, _, q in row]
            per_lead_err[i] += e
            per_lead_ratio[i] += ra
            per_lead_kept[i] += len(row)
            per_lead_alive[i] += r["alive"][i]
            rows.append({
                "lead_min": (i + 1) * step,
                "median_error_km": None if not e else round(float(np.median(e)), 2),
                "max_error_km": None if not e else round(float(np.max(e)), 2),
                "median_area_ratio": None if not ra else round(float(np.median(ra)), 2),
                "n_matched": len(row),
                "n_observed_alive": r["alive"][i],
                "per_cell": [{"id": cid, "error_km": round(v, 2), "area_ratio": round(q, 2)}
                             for cid, v, q in row],
            })
        frames.append({
            "analysis_frame": a,
            "time_utc": (start_utc + timedelta(minutes=a * step)).isoformat(),
            "n_analysis_cells": len(r["analysis_cells"]),
            "cells": r["analysis_cells"],
            "leads": rows,
        })
        at60 = next((q for q in rows if q["lead_min"] == 60), rows[-1] if rows else None)
        print(f"  frame {a}: {len(r['analysis_cells'])} cells, "
              f"median error at +{at60['lead_min']}min "
              f"{at60['median_error_km']} km ({at60['n_matched']}"
              f"/{at60['n_observed_alive']} matched)", flush=True)

    med = lambda e: None if not e else round(float(np.median(e)), 2)
    doc = {
        "event": pkg,
        "mode": MODE,
        "km_per_px": meta["grid"]["km_per_px"],
        "method": (f"Cells are connected components of VIL >= {THRESH_KGM2} kg/m2 smoothed, at "
                   f"least {MIN_AREA_KM2} km2 (pipeline.tracking, TITAN-style advected overlap). "
                   "Forecast and observation are tracked as one sequence each, both starting "
                   "from the same observed input frames, so a cell ID at the analysis frame is "
                   "the same storm in both. Error is the centroid distance at the same valid "
                   "time; a cell the forecast has dropped is counted as unmatched, not scored, "
                   "so losing a storm cannot improve the error. The area ratio is the matched "
                   "forecast cell's area over the observed cell's: well above 1 means the "
                   "forecast has merged neighbouring storms into one object, whose centroid "
                   "sits between them, so part of the error is a merge and not a displacement."),
        "lead_min": [(i + 1) * step for i in range(N_OUT)],
        "median_error_km": [med(e) for e in per_lead_err],
        "median_area_ratio": [med(r) for r in per_lead_ratio],
        "p90_error_km": [None if not e else round(float(np.percentile(e, 90)), 2)
                         for e in per_lead_err],
        "matched_share": [None if per_lead_alive[i] == 0
                          else round(float(per_lead_kept[i] / per_lead_alive[i]), 3)
                          for i in range(N_OUT)],
        "n_scored": [len(e) for e in per_lead_err],
        "frames": frames,
        "summary": {
            "n_analysis_frames": len(frames),
            "n_cell_forecasts": int(per_lead_kept.sum()),
            "median_error_km_all_leads": med([v for e in per_lead_err for v in e]),
            "median_area_ratio_all_leads": med([v for r in per_lead_ratio for v in r]),
        },
        "note": ("One event, scored against SEVIR VIL. The split-wide version of this metric, "
                 "with the extrapolation baselines for comparison, is on the validation screen "
                 "(eval/results/track.json)."),
    }
    (out / "tracks.json").write_text(json.dumps(doc, indent=1))
    print(f"wrote {(out / 'tracks.json').relative_to(ROOT)}")
    return doc


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--all", action="store_true", help="every event in the replay index")
    a = ap.parse_args(argv)
    ids = list(a.event)
    if a.all or not ids:
        idx = path("replay") / "index.json"
        ids = [e["id"] for e in json.loads(idx.read_text())["events"]] if idx.exists() else ids
    if not ids:
        raise SystemExit("no event given and no replay index to read")
    for eid in ids:
        build(eid)


if __name__ == "__main__":
    main()
