"""Tracked cells at every 5 min frame for an already-built replay package.

`build_replay` runs the model at the analysis times, 20 minutes apart, and until
now the storm objects were written only at those times — so the cells, their
tracks and the relief on the 3-D screen stepped once every 20 replay-minutes and
stood still in between. The tracker itself runs on observed radar at the full
5 min cadence, so the frames exist; they were simply not exported.

This writes them for a package that already exists, without re-running the model:

    python -m export.build_cells --event S852920-IN-KA

Writes, into the existing package:
    cells/<frame>.json   the same cell features as frames/<a>.json, per 5 min frame
and adds `cell_frames` to meta.json. Needs no GPU — the tracker and the two cell
models are CPU work — so it is cheap to re-run.
"""
from __future__ import annotations

import argparse
import json
from datetime import timedelta

import numpy as np
import pandas as pd

from export.build_replay import (GRID, STEP_MIN, cell_features, cell_hazard_probs,
                                 demo_network, load_cell_models)
from pipeline.settings import ROOT, cfg, path


def build(pkg: str, out_root=None) -> int:
    from coverage.tiers import from_m1_grid
    from data.sevir_dataset import load_event
    from pipeline.meta import from_package
    from pipeline.preprocess import event_channels
    from pipeline.tracking import track

    out = (out_root or path("replay")) / pkg
    if not (out / "meta.json").exists():
        raise SystemExit(f"no replay package at {out} — run export.build_replay first")
    meta = json.loads((out / "meta.json").read_text())
    eid = from_package(meta)          # a relocated package is named after its tile
    start = pd.to_datetime(meta["start_utc"]).to_pydatetime()

    ch = event_channels(load_event(eid), eid)
    vil_obs = ch["vil"]
    # The same coverage sample the package was built with, so a cell's tier here is
    # the tier it carries everywhere else.
    ts = from_m1_grid(np.random.default_rng(cfg()["sevir"]["seed"]), GRID) or demo_network(GRID)
    cells, ids = track(vil_obs)
    models = load_cell_models()

    (out / "cells").mkdir(exist_ok=True)
    n = int(vil_obs.shape[0])
    for f in range(n):
        fe = cell_features(eid, cells, ids, f, vil_obs, ts,
                           cell_hazard_probs(models, ch, ids, cells, f))
        (out / "cells" / f"{f}.json").write_text(json.dumps(
            {"frame": f, "time_utc": (start + timedelta(minutes=f * STEP_MIN)).isoformat(),
             "cells": {"type": "FeatureCollection", "features": fe}}))
    meta["cell_frames"] = list(range(n))
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {(out / 'cells').relative_to(ROOT)}/0..{n - 1}.json")
    return n


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
    for pkg in ids:
        print(f"cells: {pkg}", flush=True)
        build(pkg)


if __name__ == "__main__":
    main()
