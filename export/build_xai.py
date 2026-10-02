"""Per-cell hazard attributions for an already-built replay package.

The hail and downburst models are gradient-boosted trees, and LightGBM computes
exact SHAP values for a tree ensemble itself (`pred_contrib=True`). So the
explanation screen does not need an illustration of an attribution: this writes
the real one, for the real cells in the package, from the models that produced
the probabilities already in `frames/<a>.json`.

Needs the cached SEVIR event and `store/models/hazards.pkl` — no torch, no GPU:

    python -m export.build_xai --event S852920

Writes `xai.json` into the package:
    features          the model's feature list, in model order
    gain              global split gain per feature, per hazard
    frames.<a>.cells  per cell: probability, base log-odds, feature value and
                      SHAP contribution in log-odds, per hazard
"""
from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd

from export.build_replay import load_cell_models
from pipeline.settings import ROOT, path
from pipeline.tracking import track


def contributions(model, row: pd.DataFrame, features: list[str]) -> tuple[float, dict[str, float]]:
    """SHAP values in log-odds for one row: (base, {feature: contribution}).

    LightGBM returns n_features + 1 columns, the last being the expected value
    the contributions are added to.
    """
    raw = model.booster_.predict(row, pred_contrib=True)[0]
    return float(raw[-1]), {f: float(v) for f, v in zip(features, raw[:-1])}


def build(pkg: str, out_root=None) -> dict:
    from data.sevir_dataset import load_event
    from pipeline.hazards import FEATURES, RADAR_FEATURES, cell_features
    from pipeline.preprocess import event_channels

    out = (out_root or path("replay")) / pkg
    if not (out / "meta.json").exists():
        raise SystemExit(f"no replay package at {out} — run export.build_replay first")
    meta = json.loads((out / "meta.json").read_text())

    models = load_cell_models()
    if not models:
        raise SystemExit("store/models/hazards.pkl not found — run make hazards first")

    from pipeline.meta import from_package
    eid = from_package(json.loads((out / "meta.json").read_text()))
    ch = event_channels(load_event(eid), eid)
    cells, ids = track(ch["vil"])

    frames: dict[str, dict] = {}
    for a in meta["analysis_frames"]:
        per_cell: dict[str, dict] = {}
        for cid, c in cells.items():
            if not (c.first <= a <= c.last):
                continue
            mask = ids[a] == cid
            if not mask.any():
                continue
            hist = {tr["t"]: tr["vil_max_kgm2"] for tr in c.track}
            feats = cell_features(ch, mask, a, hist)
            row = pd.DataFrame([feats])[FEATURES]
            entry: dict[str, dict] = {
                "values": {f: round(float(feats[f]), 4) for f in FEATURES},
                "hazards": {},
            }
            for hz, (model, _thr) in models.items():
                base, contrib = contributions(model, row, FEATURES)
                entry["hazards"][hz] = {
                    "p": round(float(model.predict_proba(row)[:, 1][0]), 4),
                    "base_log_odds": round(base, 4),
                    "contrib": {f: round(v, 4) for f, v in contrib.items()},
                }
            per_cell[str(cid)] = entry
        frames[str(a)] = {"cells": per_cell}
        print(f"  frame {a}: {len(per_cell)} cells", flush=True)

    gain = {}
    for hz, (model, _thr) in models.items():
        imp = model.booster_.feature_importance(importance_type="gain")
        total = float(imp.sum()) or 1.0
        gain[hz] = {f: round(float(v) / total, 4)
                    for f, v in sorted(zip(FEATURES, imp), key=lambda kv: -kv[1])}

    doc = {
        "event": pkg,
        "features": FEATURES,
        "radar_features": RADAR_FEATURES,
        "units": "log-odds; contributions sum with base_log_odds to the model's logit",
        "note": ("Exact SHAP values from the gradient-boosted hail and downburst models "
                 "(LightGBM pred_contrib), for the cells in this package. These are the "
                 "models' own attributions, not an illustration of one. They explain what "
                 "the model used, which is not the same as what caused the storm."),
        "caveats": [
            "Probabilities are uncalibrated: pipeline.calibrate has never been run.",
            "Downburst is a VIL-collapse proxy, not Doppler velocity.",
            "Coverage tier enters the forecast upstream, not as a feature here, so no "
            "contribution is attributed to it.",
        ],
        "gain": gain,
        "frames": frames,
    }
    (out / "xai.json").write_text(json.dumps(doc, indent=1))
    print(f"wrote {(out / 'xai.json').relative_to(ROOT)}")
    return doc


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--all", action="store_true", help="every event in the replay index")
    a = ap.parse_args(argv)
    ids = list(a.event)
    if a.all:
        idx = path("replay") / "index.json"
        if idx.exists():
            ids += [e["id"] for e in json.loads(idx.read_text())["events"]]
    for eid in dict.fromkeys(ids):
        print(f"xai: {eid}", flush=True)
        build(eid)


if __name__ == "__main__":
    main()
