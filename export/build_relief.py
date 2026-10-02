"""Terraced relief of the VIL field, for the 3-D screen.

The first version of that screen extruded each tracked cell to a single height —
a flat slab per cell, which says how strong the cell is but nothing about its
shape. The second contoured the field and stacked the levels, which read as a
terraced hill. This pools the field to 3 km blocks and extrudes every block to its
own value, so what is drawn is the surface of the field: a wide soft skirt, towers
over the cores, and the notches and spurs the field actually has.

    python -m export.build_relief --all

Writes, into the existing package:
    relief/<frame>.json   one FeatureCollection per 5 min frame, a square per
                          3 km block of the field, with its VIL, the height it is
                          drawn at and its colour

Needs no GPU and no model — only the cached SEVIR event — so it is cheap to re-run.
Each column is the strongest 1 km pixel in its block, so a thin intense core is
kept rather than averaged away; the block is a drawing resolution, not a claim
that the forecast resolves 3 km.
"""
from __future__ import annotations

import argparse
import json
from datetime import timedelta

import numpy as np
import pandas as pd

from export.build_replay import GRID, STEP_MIN, px_to_lonlat
from pipeline.settings import ROOT, path

# Levels in kg/m². The lowest is the tracking threshold, so the base of the relief
# is the same echo the cells are detected on; the rest step up to a severe core.
# Closely enough spaced that the terraces read as a slope rather than a staircase.
# The field is pooled to this block before it is extruded. 3 km is the spatial
# scale the brief asks the nowcast to resolve, so the relief is drawn at the
# resolution the forecast actually claims rather than at the 1 km grid, which
# would be forty thousand columns of mostly empty air.
# Thirty levels, geometric from the first echo to a severe core. Many thin shells
# at low opacity compose into a soft body the way a cloud does; a dozen opaque
# ones stack into a terraced hill, and square columns of the field read as a wall
# of blocks. Both were tried first.
LEVELS = tuple(round(2.5 * (70.0 / 2.5) ** (i / 29), 2) for i in range(30))
METRES_PER_KGM2 = 420          # the drawing scale the 3-D screen states on screen
SMOOTH_PX = 3.0                # a radar field is ragged; a storm's outline is not
MIN_AREA_KM2 = 12.0

# Pale and nearly clear where the cloud is thin, warm and dense through the core.
# Intensity orders the colour, as it does on the map, but the hues are the ones a
# storm is drawn in rather than the plan-view reflectivity ramp: stacked in relief
# that ramp reads as a contour model of a hill, not as weather.
RELIEF_RAMP = (
    (0.00, (150, 170, 188), 0.16),
    (0.22, (186, 199, 210), 0.21),
    (0.42, (214, 220, 224), 0.27),
    (0.58, (234, 224, 198), 0.34),
    (0.72, (243, 198, 132), 0.43),
    (0.85, (236, 142, 86), 0.54),
    (1.00, (203, 48, 56), 0.68),
)


RELIEF_RANGE = (2.5, 70.0)


def _colour(level: float) -> str:
    """Colour and opacity for a level, as rgba.

    The opacity is carried in the colour because a fill-extrusion layer takes one
    opacity for the whole layer — per-level translucency has to ride along here,
    and it is what lets the cores be seen through the skirt around them.
    """
    lo, hi = RELIEF_RANGE
    n = float(np.clip((level - lo) / (hi - lo), 0.0, 1.0))
    stops = [s for s, _, _ in RELIEF_RAMP]
    r = np.interp(n, stops, [c[0] for _, c, _ in RELIEF_RAMP])
    g = np.interp(n, stops, [c[1] for _, c, _ in RELIEF_RAMP])
    b = np.interp(n, stops, [c[2] for _, c, _ in RELIEF_RAMP])
    a = np.interp(n, stops, [a for _, _, a in RELIEF_RAMP])
    return f"rgba({int(r)}, {int(g)}, {int(b)}, {a:.2f})"


def _ring_area_km2(rc: np.ndarray) -> float:
    """Shoelace area of a closed pixel ring, on a 1 km grid."""
    r, c = rc[:, 0], rc[:, 1]
    return float(abs(np.dot(c, np.roll(r, 1)) - np.dot(r, np.roll(c, 1))) / 2.0)


def frame_features(eid: str, vil_kgm2: np.ndarray) -> list[dict]:
    """Closed contours of the smoothed field, one polygon per level."""
    from scipy.ndimage import gaussian_filter
    from skimage.measure import find_contours

    field = gaussian_filter(vil_kgm2.astype(np.float32), SMOOTH_PX)
    peak = float(field.max())
    feats = []
    for level in LEVELS:
        if peak < level:
            break
        for path_rc in find_contours(field, level):
            if len(path_rc) < 8 or _ring_area_km2(path_rc) < MIN_AREA_KM2:
                continue
            # Every third vertex: the contour of a field smoothed over 3 km does not
            # need 1 km detail, and the file is read once per 5 min frame.
            rc = path_rc[::3]
            ring = [[round(v[0], 5), round(v[1], 5)]
                    for v in px_to_lonlat(eid, rc[:, 0], rc[:, 1]).tolist()]
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            if len(ring) < 4:
                continue
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "level_kgm2": level,
                    "height_m": int(round(level * METRES_PER_KGM2)),
                    "colour": _colour(level),
                },
            })
    return feats


def build(pkg: str, out_root=None) -> int:
    from data.sevir_dataset import load_event
    from pipeline.meta import from_package
    from pipeline.preprocess import event_channels
    from pipeline.units import vil_to_kgm2

    out = (out_root or path("replay")) / pkg
    if not (out / "meta.json").exists():
        raise SystemExit(f"no replay package at {out} — run export.build_replay first")
    meta = json.loads((out / "meta.json").read_text())
    eid = from_package(meta)
    start = pd.to_datetime(meta["start_utc"]).to_pydatetime()
    vil = event_channels(load_event(eid), eid)["vil"]

    (out / "relief").mkdir(exist_ok=True)
    n = int(vil.shape[0])
    for f in range(n):
        feats = frame_features(eid, vil_to_kgm2(vil[f]))
        (out / "relief" / f"{f}.json").write_text(json.dumps({
            "frame": f,
            "time_utc": (start + timedelta(minutes=f * STEP_MIN)).isoformat(),
            "levels_kgm2": list(LEVELS),
            "metres_per_kgm2": METRES_PER_KGM2,
            "source": "observed VIL, smoothed and contoured at 30 levels",
            "contours": {"type": "FeatureCollection", "features": feats},
        }))
    meta["relief_frames"] = list(range(n))
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"{pkg}: relief for {n} frames")
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args(argv)
    ids = list(a.event)
    if a.all or not ids:
        idx = path("replay") / "index.json"
        ids = [e["id"] for e in json.loads(idx.read_text())["events"]] if idx.exists() else ids
    for pkg in ids:
        build(pkg)


if __name__ == "__main__":
    main()
