"""Observed radar rasters and arrival error for an already-built replay package.

`build_replay` writes what the model forecast. This writes what actually
happened, on the same grid and the same colour ramp, so the Storm Replay screen
can put forecast and observation side by side and the comparison is honest: one
image is not brighter than the other because it was rendered differently.

Needs only the cached SEVIR event — no model, no GPU — so it can run after the
package exists:

    python -m export.build_observed --event S852920

Writes, into the existing package:
    obs/<frame>.png         observed VIL, same ramp as hazards/*/vil_*.png
    obs/ir107_<frame>.png   observed 10.7 um cloud-top temperature
    obs/lght_<frame>.png    observed GLM flash density
    observed.json           per-frame observed intensity, cloud-top cooling and
                            flash trend, plus per-site arrival error (predicted
                            arrival from frames/<a>.json against the first observed
                            exceedance of the threshold verification.json uses)

The three source rasters are what the model is fed, rendered from the same arrays
`pipeline.preprocess` hands the network, so the Data Fusion screen shows the real
inputs rather than an illustration of them.
"""
from __future__ import annotations

import argparse
import json
from datetime import timedelta

import numpy as np
import pandas as pd

from export.build_replay import CORE_KGM2, GRID, STEP_MIN, write_png
from pipeline.settings import ROOT, path
from pipeline.units import vil_to_kgm2

# The same site threshold verification.json uses, so "observed first" means the
# same thing on both screens.
SITE_THRESHOLD_KGM2 = 3.5
BOX_PX = 5                      # ±5 km around the site, as in build_replay.verify
# Render ranges for the two input channels, set from what this dataset contains:
# IR 10.7 µm in °C (cold cloud top drawn opaque), and GLM flash density per km²
# per 5 min on the same scale the forecast lightning layer uses.
IR_RANGE = (-70.0, 10.0)
# Observed flash density runs an order of magnitude above the forecast lightning
# field on this event (observed peaks near 1.5, the model's near 0.05), so the
# observed raster gets its own range. The gap is the model under-dispersing
# lightning, and observed.json records both ranges so the two are not confused.
LGHT_RANGE = (0.02, 1.5)
IR_COLOUR = (0xB9, 0xC9, 0xD6)
LGHT_COLOUR = (0xF2, 0xC5, 0x3D)


def write_ramp(field: np.ndarray, lo: float, hi: float, rgb, out, invert=False) -> None:
    """Single-hue alpha ramp, matching export.build_replay.write_png's convention.

    Same shape of rendering as the forecast layers, so a side-by-side comparison
    is a comparison of fields and not of two different colour treatments.
    """
    from PIL import Image

    a = np.clip((np.nan_to_num(field, nan=0.0) - lo) / (hi - lo), 0.0, 1.0)
    if invert:
        a = 1.0 - a
    a = a ** 0.75
    img = np.empty((*a.shape, 4), np.uint8)
    img[..., :3] = np.array(rgb, np.uint8)
    img[..., 3] = (a * 255).astype(np.uint8)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.flipud(img), "RGBA").save(out, optimize=True)


def site_series(vil_obs: np.ndarray, row: int, col: int) -> np.ndarray:
    """Peak observed VIL within ±BOX_PX km of a site, per frame, in kg/m²."""
    r0, r1 = max(0, row - BOX_PX), min(GRID, row + BOX_PX + 1)
    c0, c1 = max(0, col - BOX_PX), min(GRID, col + BOX_PX + 1)
    return vil_to_kgm2(vil_obs[:, r0:r1, c0:c1].max(axis=(1, 2)))


def build(pkg: str, out_root=None) -> dict:
    from data.sevir_dataset import load_event
    from pipeline.meta import from_package, projector
    from pipeline.preprocess import event_channels

    out = (out_root or path("replay")) / pkg
    if not (out / "meta.json").exists():
        raise SystemExit(f"no replay package at {out} — run export.build_replay first")
    meta = json.loads((out / "meta.json").read_text())
    start = pd.to_datetime(meta["start_utc"]).to_pydatetime()
    # A relocated package is named after its tile; its arrays are the source event's.
    eid = from_package(meta)

    ch = event_channels(load_event(eid), eid)
    vil_obs = ch["vil"]                                          # [49, 384, 384] pixel units
    ir107, lght = ch["ir107"], ch["lght"]                        # degrees C, flashes/km2/5 min
    n = int(vil_obs.shape[0])

    for f in range(n):
        write_png(vil_to_kgm2(vil_obs[f]), "vil", out / "obs" / f"{f}.png")
        write_ramp(ir107[f], *IR_RANGE, IR_COLOUR, out / "obs" / f"ir107_{f}.png", invert=True)
        write_ramp(lght[f], *LGHT_RANGE, LGHT_COLOUR, out / "obs" / f"lght_{f}.png")

    # ---- per-frame observed intensity (the Replay timeline ticks) --------------
    frames = []
    for f in range(n):
        g = vil_to_kgm2(vil_obs[f])
        frames.append({
            "frame": f,
            "time_utc": (start + timedelta(minutes=f * STEP_MIN)).isoformat(),
            # The peak saturates on this event — SEVIR VIL pixel 255 maps to one
            # fixed value and some pixel reaches it in every frame — so core area
            # is the series that actually tracks the storm's life cycle.
            "peak_kgm2": round(float(g.max()), 1),
            "area_km2": int((g >= SITE_THRESHOLD_KGM2).sum()),
            "core_area_km2": int((g >= CORE_KGM2).sum()),
            # The two other sources the model is fed, summarised the way the
            # fusion screen reads them: how cold the coldest cloud top is, and
            # how much lightning there is.
            "ctt_min_c": round(float(ir107[f].min()), 1),
            "ctt_area_lt_minus50_km2": int((ir107[f] <= -50.0).sum()),
            "flash_density_max": round(float(lght[f].max()), 4),
            "flash_area_km2": int((lght[f] >= LGHT_RANGE[0]).sum()),   # >= 0.02 fl/km2/5 min
        })

    # ---- per-site arrival error ----------------------------------------------
    # Predicted arrival comes from the package's own frames; observed arrival is
    # the first exceedance at or after the same analysis time. Nothing is
    # recomputed from the model: the forecast being scored is the one that shipped.
    to_km, _, _ = projector(eid)
    rows = []
    for s in meta["sites"]:
        x_km, y_km = to_km(s["lon"], s["lat"])
        series = site_series(vil_obs, int(round(y_km)), int(round(x_km)))
        forecasts = []
        for a in meta["analysis_frames"]:
            fr_path = out / "frames" / f"{a}.json"
            if not fr_path.exists():
                continue
            arr = next((v for v in json.loads(fr_path.read_text())["arrivals"]
                        if v["site"] == s["id"]), None)
            if arr is None:
                continue
            after = np.argwhere(series[a:] >= SITE_THRESHOLD_KGM2)
            obs_min = int(after[0][0] * STEP_MIN) if len(after) else None
            forecasts.append({
                "analysis_frame": a,
                "predicted_arrival_min": arr["median_min"],
                "window_min": [arr["start_min"], arr["end_min"]],
                "p": arr["p"],
                "observed_arrival_min": obs_min,
                "error_min": None if obs_min is None else arr["median_min"] - obs_min,
                "in_window": None if obs_min is None
                             else bool(arr["start_min"] <= obs_min <= arr["end_min"]),
            })
        ever = np.argwhere(series >= SITE_THRESHOLD_KGM2)
        errs = [f["error_min"] for f in forecasts if f["error_min"] is not None]
        rows.append({
            "site": s["id"], "name": s["name"], "kind": s["kind"],
            "observed_first_min": int(ever[0][0] * STEP_MIN) if len(ever) else None,
            "observed_peak_kgm2": round(float(series.max()), 1),
            "forecasts": forecasts,
            "median_error_min": float(np.median(errs)) if errs else None,
            "median_abs_error_min": float(np.median(np.abs(errs))) if errs else None,
        })

    # Trends over the 10 min preceding each frame, which is what "rapid cloud-top
    # cooling" and "lightning growth" mean on the fusion screen.
    for i, fr in enumerate(frames):
        back = frames[max(0, i - 2)]
        fr["ctt_cooling_c_per_10min"] = round(fr["ctt_min_c"] - back["ctt_min_c"], 1)
        fr["flash_change_per_10min"] = (
            None if back["flash_area_km2"] == 0
            else round((fr["flash_area_km2"] - back["flash_area_km2"]) / back["flash_area_km2"], 3))

    all_errs = [f["error_min"] for r in rows for f in r["forecasts"]
                if f["error_min"] is not None]
    in_win = [f["in_window"] for r in rows for f in r["forecasts"] if f["in_window"] is not None]
    doc = {
        "event": pkg,
        "threshold_kgm2": SITE_THRESHOLD_KGM2,
        "ir_range_c": list(IR_RANGE),
        "lght_range": list(LGHT_RANGE),
        "lght_note": ("Observed GLM flash density. Its range differs from the forecast "
                      "lightning layer's because the model's lightning field is weaker than "
                      "observation on this event; the two rasters are not on one scale."),
        "core_threshold_kgm2": CORE_KGM2,
        "box_km": BOX_PX,
        "note": ("Observed VIL from SEVIR on the same 1 km grid and the same colour ramp as "
                 "the forecast rasters. Arrival error is the forecast median arrival minus the "
                 "first observed exceedance of "
                 f"{SITE_THRESHOLD_KGM2} kg/m² within ±{BOX_PX} km of the site; positive means "
                 "the forecast was late. No gauge, Doppler or storm-report truth exists on this "
                 "dataset, so this is the only verification available for this event. "
                 "Frame peak VIL saturates on this event; core area is the intensity series "
                 "to read."),
        "frames": frames,
        "sites": rows,
        "summary": {
            "n_forecasts": len(all_errs),
            "median_error_min": float(np.median(all_errs)) if all_errs else None,
            "median_abs_error_min": float(np.median(np.abs(all_errs))) if all_errs else None,
            "in_window_share": round(sum(in_win) / len(in_win), 3) if in_win else None,
        },
    }
    (out / "observed.json").write_text(json.dumps(doc, indent=1))
    print(f"wrote {(out / 'observed.json').relative_to(ROOT)} and {3 * n} observed rasters")
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
        print(f"observed: {eid}", flush=True)
        build(eid)


if __name__ == "__main__":
    main()
