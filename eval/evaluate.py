"""Score forecast methods on the test split and write eval/results/*.json.

    python -m eval.evaluate baselines            # → eval/results/baselines.json
    python -m eval.evaluate baselines --limit 5  # quick run

Every number shown in the dashboard or docs must come from these files.
"""
from __future__ import annotations

import argparse
import json
import platform
import subprocess
import time
import zlib
from datetime import datetime, timezone

import numpy as np

from data.sevir_dataset import available, load_event
from eval.metrics import Accumulator
from pipeline import baselines
from pipeline.preprocess import vil_frames
from pipeline.settings import ROOT, cfg, path


def _git() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "uncommitted"


def eval_baselines(selection: str, limit: int | None, n_leads: int) -> dict:
    c, f = cfg()["verification"], cfg()["frames"]
    test = available("test", selection)
    ids = list(test.id)[:limit] if limit else list(test.id)
    if not ids:
        raise SystemExit("no test events on disk — run data.download_sevir first")
    methods = ("persistence", "optical_flow", "sprog")
    acc = {m: Accumulator(c["vil_thresholds"], c["fss_thresholds"], c["fss_scales_km"], n_leads) for m in methods}
    timing = {m: 0.0 for m in methods}
    fallbacks: list[str] = []
    t0 = time.time()
    for k, eid in enumerate(ids):
        vil = vil_frames(load_event(eid)["vil"])
        x, y = vil[: f["n_in"]], vil[f["n_in"]: f["n_in"] + n_leads]
        v = baselines._motion(x)
        for m in methods:
            s = time.time()
            if m == "persistence":
                p = baselines.persistence(x, n_leads)
            elif m == "optical_flow":
                p = baselines.optical_flow(x, n_leads, v)
            else:
                try:
                    p = baselines.sprog(x, n_leads, v)
                except baselines.SprogFallback:
                    p = baselines.optical_flow(x, n_leads, v)
                    fallbacks.append(eid)
            timing[m] += time.time() - s
            acc[m].add(p, y)
        print(f"  {k + 1}/{len(ids)} {eid}  ({time.time() - t0:.0f}s)", flush=True)
    return {
        "kind": "baselines",
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git": _git(),
        "host": platform.node(),
        "data": {
            "dataset": "SEVIR",
            "selection": selection,
            "split": "test (time_utc >= %s)" % cfg()["sevir"]["split_date"],
            "n_events": len(ids),
            "event_ids": ids,
            "input_frames": f["n_in"],
            "units": "VIL pixel value 0-255 (thresholds in the same units)",
        },
        "thresholds": c["vil_thresholds"],
        "fss_scales_km": c["fss_scales_km"],
        "methods": {m: {**acc[m].summary(f["step_min"]), "seconds_per_event": timing[m] / len(ids)} for m in methods},
        "notes": {
            "sprog_fallback_to_optical_flow": {
                "events": fallbacks,
                "reason": "S-PROG needs rain in >=0.1% of pixels; near-empty inputs use optical flow instead",
            },
        },
    }


TIER_NAMES = {0: "none", 1: "partial", 2: "full"}


def eval_model(limit: int | None, n_members: int = 10) -> dict:
    """ML nowcast vs baselines, 1 h, same coverage masks for all methods; overall and per tier."""
    from coverage.tiers import TIER_GRID, apply_tiers, sample_tiers
    from pipeline.infer import load_model, predict
    from pipeline.train import N_IN, N_OUT, splits

    c, f = cfg()["verification"], cfg()["frames"]
    ids = splits()["test"][:limit] if limit else splits()["test"]
    if not ids:
        raise SystemExit("no cached test events — run pipeline.cache")
    start = 49 - N_IN - N_OUT - 12  # same fixed window as validation: input frames 12-24
    methods = ("model", "persistence", "optical_flow", "sprog")
    mk = lambda: Accumulator(c["vil_thresholds"], c["fss_thresholds"], c["fss_scales_km"], N_OUT)
    acc = {m: mk() for m in methods}
    tier_acc = {m: {k: mk() for k in TIER_NAMES} for m in methods}
    tier_px = np.zeros(3)
    fallbacks = []
    t0 = time.time()
    for k, eid in enumerate(ids):
        seed = zlib.crc32(eid.encode())  # stable across runs, unlike hash()
        rng = np.random.default_rng(seed)
        ts = sample_tiers(np.random.default_rng(seed + 1))
        vil = vil_frames(load_event(eid)["vil"])
        x, y = vil[start:start + N_IN], vil[start + N_IN:start + N_IN + N_OUT]
        # Baselines see radar only where the coverage tier allows (same masks as the model).
        xm, _ = apply_tiers(x, ts, np.random.default_rng(0))
        pred = {"model": predict(eid, start, ts, rng, n_members)["vil"]}
        v = baselines._motion(xm)
        pred["persistence"] = baselines.persistence(xm, N_OUT)
        pred["optical_flow"] = baselines.optical_flow(xm, N_OUT, v)
        try:
            pred["sprog"] = baselines.sprog(xm, N_OUT, v)
        except baselines.SprogFallback:
            pred["sprog"] = pred["optical_flow"]
            fallbacks.append(eid)
        tier_px += np.bincount(ts.tier.ravel(), minlength=3)
        for m in methods:
            acc[m].add(pred[m], y)
            for t in TIER_NAMES:
                region = ts.tier == t
                if region.any():
                    tier_acc[m][t].add(pred[m], y, region)
        print(f"  {k + 1}/{len(ids)} {eid} ({ts.source}) {time.time() - t0:.0f}s", flush=True)

    _, meta = load_model()
    out = {
        "kind": "model",
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git": _git(),
        "data": {
            "dataset": "SEVIR", "split": "test (time_utc >= %s)" % cfg()["sevir"]["split_date"],
            "n_events": len(ids), "event_ids": ids, "input_frames": N_IN, "window_start_frame": start,
            "units": "VIL pixel value 0-255; model trained at 2 km and bilinearly upsampled to 1 km for scoring",
        },
        "model": {"architecture": "TierUNet", "params_M": None, "best_epoch": meta.get("epoch"),
                  "n_train_events": len(meta.get("train_ids", [])), "mc_dropout_members": n_members,
                  "val_mean_csi_2km": meta.get("val_mean_csi_2km")},
        "coverage": {
            "tier_source": "m1-grid" if TIER_GRID.exists() else "SIMULATED radar networks (M1 tier grid not available)",
            "partial_tier_vil_scaling": "ASSUMED beam-height factor",
            "pixel_share": {TIER_NAMES[i]: float(tier_px[i] / tier_px.sum()) for i in range(3)},
        },
        "thresholds": c["vil_thresholds"],
        "fss_scales_km": c["fss_scales_km"],
        "methods": {},
        "notes": {"sprog_fallback_to_optical_flow": {"events": fallbacks}},
    }
    for m in methods:
        s = acc[m].summary(f["step_min"])
        s["by_tier"] = {TIER_NAMES[t]: tier_acc[m][t].summary(f["step_min"])["by_threshold"] | {
            "mean_csi": tier_acc[m][t].summary(f["step_min"])["mean_csi"]} for t in TIER_NAMES}
        out["methods"][m] = s
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=["baselines", "model"])
    ap.add_argument("--selection", default="selection_dev.csv")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--leads", type=int, default=max(cfg()["frames"]["leads"]))
    a = ap.parse_args(argv)
    if a.what == "model":
        res = eval_model(a.limit)
        out = path("results") / "model.json"
        out.write_text(json.dumps(res, indent=1, allow_nan=True))
        print(f"wrote {out.relative_to(ROOT)}")
        for m, r in res["methods"].items():
            mc, bt = r["mean_csi"], r["by_tier"]
            print(f"  {m:13s} mean CSI T+30m {mc[5]:.3f} T+60m {mc[11]:.3f} | T+30m by tier "
                  + " ".join(f"{t} {bt[t]['mean_csi'][5]:.3f}" for t in ("full", "partial", "none")))
        return
    res = eval_baselines(a.selection, a.limit, a.leads)
    out = path("results") / "baselines.json"
    out.write_text(json.dumps(res, indent=1, allow_nan=True))
    print(f"wrote {out.relative_to(ROOT)}")
    for m, r in res["methods"].items():
        mc = r["mean_csi"]
        pick = {lm: mc[i] for i, lm in enumerate(r["lead_min"]) if lm in (15, 30, 60, 120, 180)}
        print(f"  {m:13s} mean CSI " + "  ".join(f"T+{k}m {v:.3f}" for k, v in pick.items()))


if __name__ == "__main__":
    main()
