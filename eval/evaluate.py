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


def eval_modes(limit: int | None, n_members: int = 10) -> dict:
    """Radar-denied skill: the same model scored over the test split with inputs removed.

    `eval_model`'s per-tier breakdown answers a different question — it scores one
    forecast over the pixels radar can and cannot see. This re-runs the forecast
    with the radar input actually taken away, which is what the console's coverage
    switch does to a single event, and measures it over the whole split.

    The extrapolation baselines are scored on the same denied input. They collapse,
    which is the point: with no radar there is nothing to extrapolate, so the
    comparison that matters for a radar gap is the model against zero skill, not
    the model against optical flow.
    """
    from coverage.tiers import TIER_GRID, TierSample, apply_tiers, sample_tiers
    from pipeline.infer import load_model, predict
    from pipeline.train import N_IN, N_OUT, splits

    c, f = cfg()["verification"], cfg()["frames"]
    ids = splits()["test"][:limit] if limit else splits()["test"]
    if not ids:
        raise SystemExit("no cached test events — run pipeline.cache")
    start = 49 - N_IN - N_OUT - 12
    mk = lambda: Accumulator(c["vil_thresholds"], c["fss_thresholds"], c["fss_scales_km"], N_OUT)
    # "all" is the simulated coverage map, the same sample eval_model scores on;
    # "noradar" and "satonly" are the modes the console offers.
    modes = ("all", "noradar", "satonly")
    acc = {m: mk() for m in modes}
    # One extrapolation reference per mode, on the input that mode leaves behind.
    base_acc = {m: mk() for m in modes}
    seconds = {m: 0.0 for m in modes}
    t0 = time.time()
    for k, eid in enumerate(ids):
        seed = zlib.crc32(eid.encode())
        ts = sample_tiers(np.random.default_rng(seed + 1))
        blind = TierSample(np.zeros_like(ts.tier),
                           np.full(ts.tier.shape, np.inf, np.float32), "none")
        vil = vil_frames(load_event(eid)["vil"])
        x, y = vil[start:start + N_IN], vil[start + N_IN:start + N_IN + N_OUT]
        for m in modes:
            tier = ts if m == "all" else blind
            t1 = time.time()
            pred = predict(eid, start, tier, np.random.default_rng(seed), n_members,
                           drop_lightning=(m == "satonly"))["vil"]
            seconds[m] += time.time() - t1
            acc[m].add(pred, y)
            xm, _ = apply_tiers(x, tier, np.random.default_rng(0))
            base_acc[m].add(baselines.optical_flow(xm, N_OUT, baselines._motion(xm)), y)
        print(f"  {k + 1}/{len(ids)} {eid} ({ts.source}) {time.time() - t0:.0f}s", flush=True)

    _, meta = load_model()
    out = {
        "kind": "modes",
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git": _git(),
        "host": platform.node(),
        "question": ("What does the forecast lose when an input is removed? Each mode is a "
                     "separate forward pass with that input denied, scored against the same "
                     "observed VIL over the same events."),
        "modes": {
            "all": "the simulated coverage map: radar damped where the beam is high",
            "noradar": "every pixel tier 0 — the modality-dropout path the model was trained on",
            "satonly": "tier 0 and the lightning channel blanked as well",
        },
        "data": {
            "dataset": "SEVIR", "split": "test (time_utc >= %s)" % cfg()["sevir"]["split_date"],
            "n_events": len(ids), "event_ids": ids, "input_frames": N_IN,
            "window_start_frame": start,
            "units": "VIL pixel value 0-255; model trained at 2 km, upsampled to 1 km for scoring",
        },
        "model": {"architecture": "TierUNet", "best_epoch": meta.get("epoch"),
                  "mc_dropout_members": n_members},
        "coverage": {
            "tier_source": "m1-grid" if TIER_GRID.exists()
                           else "SIMULATED radar networks (M1 tier grid not available)",
        },
        "thresholds": c["vil_thresholds"],
        "fss_scales_km": c["fss_scales_km"],
        "latency": {
            "what": ("Wall-clock seconds for one forward pass of %d MC-dropout members over a "
                     "384 km tile, 12 lead frames, on %s." % (n_members, _device())),
            "seconds_per_event": {m: seconds[m] / len(ids) for m in modes},
        },
        "methods": {},
        "baseline": {},
    }
    for m in modes:
        out["methods"][m] = acc[m].summary(f["step_min"])
        out["baseline"][m] = base_acc[m].summary(f["step_min"])
    out["baseline_note"] = ("Optical flow on the same denied input, as a floor. With radar "
                            "removed its input is empty, so it forecasts nothing and scores "
                            "zero; any skill the model keeps in that column comes from "
                            "satellite and lightning.")
    return out


def eval_track(limit: int | None, n_members: int = 10) -> dict:
    """Object track error: how far a forecast puts a storm from where it went.

    Cells are tracked through the forecast sequence and through the observation
    with the same detector and the same motion field, and both sequences carry the
    same observed input frames in front, so a cell ID at the analysis frame is the
    same storm in both. The error for that ID at a lead is the distance between
    its forecast centroid and its observed centroid at the same valid time. A cell
    the forecast has dropped is not scored — it is counted in the match share
    instead, because a method that forecasts only the one cell it is sure of would
    otherwise post the best error.
    """
    from coverage.tiers import TIER_GRID, apply_tiers, sample_tiers
    from pipeline.infer import load_model, predict
    from pipeline.tracking import MIN_AREA_KM2, THRESH_KGM2, match_error
    from pipeline.train import N_IN, N_OUT, splits

    f = cfg()["frames"]
    ids = splits()["test"][:limit] if limit else splits()["test"]
    if not ids:
        raise SystemExit("no cached test events — run pipeline.cache")
    start = 49 - N_IN - N_OUT - 12
    methods = ("model", "optical_flow", "persistence")
    err: dict[str, list[list[float]]] = {m: [[] for _ in range(N_OUT)] for m in methods}
    ratio: dict[str, list[list[float]]] = {m: [[] for _ in range(N_OUT)] for m in methods}
    kept = {m: np.zeros(N_OUT) for m in methods}     # the forecast still has the cell
    alive = np.zeros(N_OUT)                          # the observation still has it
    n_cells, n_events = 0, 0
    t0 = time.time()
    for k, eid in enumerate(ids):
        seed = zlib.crc32(eid.encode())
        ts = sample_tiers(np.random.default_rng(seed + 1))
        vil = vil_frames(load_event(eid)["vil"])
        x, y = vil[start:start + N_IN], vil[start + N_IN:start + N_IN + N_OUT]
        xm, _ = apply_tiers(x, ts, np.random.default_rng(0))
        v = baselines._motion(xm)
        fields = {
            "model": predict(eid, start, ts, np.random.default_rng(seed), n_members)["vil"],
            "optical_flow": baselines.optical_flow(xm, N_OUT, v),
            "persistence": baselines.persistence(xm, N_OUT),
        }
        res = {m: match_error(xm, y, fields[m], v) for m in methods}
        n_here = len(res["model"]["analysis_cells"])
        if not n_here:
            print(f"  {k + 1}/{len(ids)} {eid} no cell at the analysis frame", flush=True)
            continue
        n_cells += n_here
        n_events += 1
        alive += np.array(res["model"]["alive"], float)
        for m in methods:
            for i, row in enumerate(res[m]["errors"]):
                kept[m][i] += len(row)
                err[m][i] += [e for _, e, _ in row]
                ratio[m][i] += [r for _, _, r in row]
        print(f"  {k + 1}/{len(ids)} {eid} ({ts.source}) {n_here} cells"
              f" {time.time() - t0:.0f}s", flush=True)

    _, meta = load_model()
    q = lambda e, s: None if not e else round(float(np.percentile(e, s)), 2)
    out = {
        "kind": "track_error",
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git": _git(),
        "host": platform.node(),
        "question": ("How far from the storm does the forecast put it? Centroid distance "
                     "between a tracked cell's forecast position and its observed position "
                     "at the same valid time, over the test split."),
        "method": (f"Cells are connected components of VIL >= {THRESH_KGM2} kg/m2 smoothed, "
                   f"at least {MIN_AREA_KM2} km2, tracked by advected overlap (pipeline.tracking). "
                   "Forecast and observation are tracked as one sequence each, both beginning "
                   "with the same observed input frames, so IDs at the analysis frame match."),
        "data": {
            "dataset": "SEVIR", "split": "test (time_utc >= %s)" % cfg()["sevir"]["split_date"],
            "n_events": n_events, "n_events_attempted": len(ids),
            "n_analysis_cells": n_cells, "input_frames": N_IN,
            "window_start_frame": start, "km_per_px": 1,
        },
        "model": {"architecture": "TierUNet", "best_epoch": meta.get("epoch"),
                  "mc_dropout_members": n_members},
        "coverage": {"tier_source": "m1-grid" if TIER_GRID.exists()
                     else "SIMULATED radar networks (M1 tier grid not available)"},
        "lead_min": [(i + 1) * f["step_min"] for i in range(N_OUT)],
        "observed_cells_alive": [int(n) for n in alive],
        "methods": {},
        "note": ("Read the three columns together. Matched share is the fraction of "
                 "still-living observed cells the forecast also has, and the error is the "
                 "median over those: persistence keeps every cell but leaves it where it was, "
                 "so its error is the distance the storm travelled. The area ratio is the "
                 "matched forecast cell's area over the observed cell's — well above 1 means "
                 "the forecast has merged neighbouring storms into one object, which inherits "
                 "the ID and carries a centroid between them, so part of the error it reports "
                 "is a merge rather than a displacement."),
    }
    for m in methods:
        out["methods"][m] = {
            "median_error_km": [q(e, 50) for e in err[m]],
            "p90_error_km": [q(e, 90) for e in err[m]],
            "mean_error_km": [None if not e else round(float(np.mean(e)), 2) for e in err[m]],
            "n_scored": [len(e) for e in err[m]],
            "median_area_ratio": [q(r, 50) for r in ratio[m]],
            "matched_share": [None if alive[i] == 0 else round(float(kept[m][i] / alive[i]), 3)
                              for i in range(N_OUT)],
        }
    return out


def _device() -> str:
    try:
        import torch
        return torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    except Exception:
        return "unknown device"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=["baselines", "model", "modes", "track"])
    ap.add_argument("--selection", default="selection_dev.csv")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--leads", type=int, default=max(cfg()["frames"]["leads"]))
    a = ap.parse_args(argv)
    if a.what == "track":
        res = eval_track(a.limit)
        out = path("results") / "track.json"
        out.write_text(json.dumps(res, indent=1, allow_nan=True))
        print(f"wrote {out.relative_to(ROOT)}")
        for m, r in res["methods"].items():
            print(f"  {m:13s} median error km T+30m {r['median_error_km'][5]}"
                  f" T+60m {r['median_error_km'][11]}"
                  f" | matched {r['matched_share'][11]}"
                  f" | area ratio {r['median_area_ratio'][11]} at T+60m")
        return
    if a.what == "modes":
        res = eval_modes(a.limit)
        out = path("results") / "modes.json"
        out.write_text(json.dumps(res, indent=1, allow_nan=True))
        print(f"wrote {out.relative_to(ROOT)}")
        for m, r in res["methods"].items():
            mc, bc = r["mean_csi"], res["baseline"][m]["mean_csi"]
            print(f"  {m:8s} model mean CSI T+30m {mc[5]:.3f} T+60m {mc[11]:.3f}"
                  f" | optical flow T+60m {bc[11]:.3f}"
                  f" | {res['latency']['seconds_per_event'][m]:.2f} s/event")
        return
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
