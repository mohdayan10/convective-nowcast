"""Precomputed replay packages for the dashboard (app build spec §5).

Heavy work happens here, once, offline; the app only reads what this writes.
Nothing is invented: VIL and lightning come from the trained U-Net, cells and
lineage from `pipeline.tracking`, hail/downburst from the LightGBM cell models,
cloudburst from the documented VIL→rain relation, arrival windows from the
ensemble motion, alerts from `alerts.*`. Anything whose model has not been
trained yet is left out of the package and named in `meta.json → availability`,
so the UI can show a labelled placeholder instead of a fake number.

    python -m export.build_replay --list            # candidate demo events
    python -m export.build_replay --event S843100
    python -m export.build_replay --auto 1          # pick the best candidate

Layout written (one directory per event, under paths.replay):
    meta.json  frames/<a>.json  hazards/<a>/<hazard>_<lead>.png
    coverage.png  alerts.json  verification.json
"""
from __future__ import annotations

import argparse
import json
import pickle
import shutil
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter
from skimage.measure import find_contours

from alerts.cap import cap_xml
from alerts.severity import AUDIENCES, points_in_event, severity
from alerts.sms_templates import sms
from coverage.tiers import TierSample, from_m1_grid
from pipeline.hazards import accumulation_mm, p_cloudburst
from pipeline import meta as meta_mod
from pipeline.meta import event_meta, projector
from pipeline.settings import ROOT, cfg, path
from pipeline.tracking import Cell, arrival_window, cell_velocity, detect, track
from pipeline.units import vil_to_kgm2

STEP_MIN = 5
N_IN = 13
GRID = 384                     # 1 km, the resolution the problem statement asks for
# Analysis frames: every 20 min, even (pipeline.initiation scores even frames only),
# and late enough that 13 input frames exist / early enough that 12 lead frames do.
ANALYSIS = list(range(12, 37, 4))
HAZARD_COLOUR = {              # spec §3 palette; hazard colours used only for hazards
    "vil": (0xE4, 0xEC, 0xF2),
    "lightning": (0xF2, 0xC5, 0x3D),
    "hail": (0x9B, 0x6D, 0xFF),
    "downburst": (0xFF, 0x6B, 0x5A),
    "cloudburst": (0x3D, 0xA5, 0xFF),
}
TIER_COLOUR = {0: (0x5A, 0x4A, 0x4A), 1: (0xB5, 0x85, 0x2E), 2: (0x2E, 0x7D, 0x5B)}
TIER_NAME = {0: "none", 1: "partial", 2: "full"}
# Rendering ranges, set from what the trained model actually produces on this
# dataset (measured, not guessed) so a layer is neither blank nor saturated.
#   vil        kg/m²                          lightning  flashes/km²/5 min
#   cloudburst forecast 1 h accumulation, mm — the physical driver. P(≥100 mm)
#              is reported as a number per frame; on US plains events it is ~0,
#              and a colour ramp over a ~2 % probability would read as alarming.
RANGE = {"vil": (1.5, 30.0), "lightning": (0.008, 0.045), "cloudburst": (6.0, 45.0)}
RANGE_UNITS = {"vil": "kg/m²", "lightning": "flashes/km²/5 min", "cloudburst": "mm / 1 h"}
CELL_HAZARDS = ("hail", "downburst")
# The differentiator (spec §2). Each mode is a real forward pass with the radar
# input the model is allowed to see — not a styled copy of the all-sources run.
#   all      the simulated coverage map, so cores are damped where the beam is high
#   noradar  every pixel tier 0: VIL and the radar-available channel are zeroed
#   satonly  tier 0 and the lightning channel blanked as well
MODES = ("all", "noradar", "satonly")


# ---- relocation -----------------------------------------------------------------
# The SEVIR events are American. A package can be built with its 384 km grid
# georeferenced onto an Indian tile instead, so the console can be read against
# Indian terrain, cities and airports — the exposure points come from the same
# global Natural Earth tables, so the named locations and airports are the real
# ones for wherever the tile lands. Nothing about the forecast changes: the
# fields, the cells, the arrival windows and every metric are computed on the
# grid, and the grid is unchanged. The package is badged RELOCATED and says so.
REGIONS = {
    "karnataka": {
        "lon": 77.5946, "lat": 12.9716,
        "where": "Karnataka — tile centred on Bengaluru",
        "suffix": "IN-KA",
    },
}


# ---- georeference ---------------------------------------------------------------
def corners(eid: str) -> list[list[float]]:
    """MapLibre image-source coordinates: TL, TR, BR, BL as [lon, lat].

    Rasters are written north-up (see `write_png`), so the PNG's top row is the
    grid's northern edge and TL is the north-west corner.
    """
    _, p, (x0, y0) = projector(eid)
    m = GRID * 1000.0
    pt = lambda dx, dy: [float(v) for v in p(x0 + dx, y0 + dy, inverse=True)]
    return [pt(0, m), pt(m, m), pt(m, 0), pt(0, 0)]


def px_to_lonlat(eid: str, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Grid pixel (row, col) → [lon, lat].

    SEVIR rows count from the SOUTH edge — verified against the lightning array's
    own 8 km cell indices, which correlate +0.9998 with a south origin.
    """
    _, p, (x0, y0) = projector(eid)
    x = x0 + (cols + 0.5) * 1000.0
    y = y0 + (rows + 0.5) * 1000.0
    lon, lat = p(x, y, inverse=True)
    return np.stack([lon, lat], axis=-1)


# ---- coverage -------------------------------------------------------------------
# Deliberate SIMULATED network for the replay. `coverage.tiers.simulated_network`
# draws radars at random, which is right for training but leaves a demo to luck —
# one seed put no radar on the tile at all. These positions (grid km east, north)
# sit west of the storm track so the system moves from full coverage into a gap,
# which is the case the problem statement is about. Still simulated, still badged.
DEMO_RADARS = ((40.0, 265.0), (55.0, 80.0))
DEMO_BLOCKED = ((0, 2.5, 0.45), (1, -1.1, 0.35))      # (radar, azimuth rad, width rad)


def demo_network(size: int = GRID) -> TierSample:
    from coverage.tiers import FULL_MAX_KM, MAX_RANGE_KM, PARTIAL_MAX_KM, beam_height_km

    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    beam = np.full((size, size), np.inf, np.float32)
    for i, (cx, cy) in enumerate(DEMO_RADARS):
        r = np.hypot(xx - cx, yy - cy)
        h = np.where(r <= MAX_RANGE_KM, beam_height_km(r), np.inf)
        for j, a0, w in DEMO_BLOCKED:
            if j != i:
                continue
            d = np.angle(np.exp(1j * (np.arctan2(yy - cy, xx - cx) - a0)))
            h = np.where(np.abs(d) < w / 2, np.inf, h)     # terrain-blocked sector
        beam = np.minimum(beam, h)
    tier = np.where(beam <= FULL_MAX_KM, 2, np.where(beam <= PARTIAL_MAX_KM, 1, 0)).astype(np.uint8)
    return TierSample(tier, beam, "simulated-demo")


# ---- rasters --------------------------------------------------------------------
# Radar reflectivity reads as a heat scale everywhere in meteorology, and a single
# white alpha ramp made a severe core and a weak echo the same grey smudge. The
# stops below are the one multi-hue scale in the console: it is a continuous field,
# never a category, so it cannot be confused with the hazard colours, which stay
# categorical and are only ever used on cells and alerts.
VIL_RAMP = (
    (0.00, (0x15, 0x33, 0x4d)),   # faint echo, barely above the basemap
    (0.22, (0x1f, 0x82, 0x96)),
    (0.42, (0x2f, 0xa6, 0x7c)),
    (0.60, (0xd6, 0xc2, 0x44)),
    (0.78, (0xe0, 0x78, 0x33)),
    (1.00, (0xc4, 0x33, 0x3c)),   # core
)


def ramp_rgb(n: np.ndarray) -> np.ndarray:
    """[H, W] in 0-1 → [H, W, 3] uint8 along VIL_RAMP, linear between stops."""
    stops = np.array([s for s, _ in VIL_RAMP], np.float32)
    cols = np.array([c for _, c in VIL_RAMP], np.float32)
    out = np.empty((*n.shape, 3), np.float32)
    for k in range(3):
        out[..., k] = np.interp(n, stops, cols[:, k])
    return out.astype(np.uint8)


def write_png(field: np.ndarray, kind: str, out) -> None:
    """Value → colour and alpha. Radar VIL takes the heat ramp; the other layers
    keep a single hazard colour with alpha from the value, so that when several are
    layered each one is still identifiable by hue.

    Both ramps start at zero alpha — an earlier version lifted every pixel above
    the range minimum to 25 %, which washed the whole tile in one colour and made
    a weak, widespread field look like a severe one.
    """
    from PIL import Image

    lo, hi = RANGE[kind]
    n = np.clip((np.nan_to_num(field, nan=0.0) - lo) / (hi - lo), 0.0, 1.0)
    img = np.empty((*n.shape, 4), np.uint8)
    if kind == "vil":
        # The forecast field is smooth and sits low in the range — a 30 kg/m² pixel
        # is rare — so a linear lookup would leave every storm at the blue end of
        # the ramp. The exponent spends the ramp where the data is; it is monotonic,
        # so the colour still orders intensity, and the legend shows the scale.
        img[..., :3] = ramp_rgb(n ** 0.55)
        # Alpha only has to lift an echo clear of the basemap. Kept low at the weak
        # end: a wide field of light rain must not haze the whole tile, which is the
        # failure the single-hue ramp had.
        img[..., 3] = (np.where(n > 0, 0.12 + 0.88 * n ** 0.6, 0.0) * 255).astype(np.uint8)
    else:
        img[..., :3] = np.array(HAZARD_COLOUR[kind], np.uint8)
        img[..., 3] = ((n ** 0.75) * 255).astype(np.uint8)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Grid row 0 is the south edge; a PNG's first row draws at the top, so flip.
    Image.fromarray(np.flipud(img), "RGBA").save(out, optimize=True)


def write_coverage_png(ts: TierSample, out) -> None:
    from PIL import Image

    # Kept deliberately faint: coverage is context, and the hazard layers have to
    # stay dominant over it (spec §3).
    alpha = {2: 0, 1: 70, 0: 105}               # full coverage drawn as clear
    img = np.zeros((*ts.tier.shape, 4), np.uint8)
    for t, c in TIER_COLOUR.items():
        m = ts.tier == t
        img[m, :3] = c
        img[m, 3] = alpha[t]
    Image.fromarray(np.flipud(img), "RGBA").save(out, optimize=True)


# ---- cells ----------------------------------------------------------------------
CORE_KGM2 = 12.0        # ≈ SEVIR pixel 181; the intense core drawn as the hazard zone


def at_frame(c: Cell, a: int, cells: dict[int, Cell]) -> Cell | None:
    """The cell as known at analysis frame `a`, with no future information.

    `track()` runs over the whole event, so a replay must not read past `a`: the
    position, motion and lineage shown are only what had happened by then. A
    merged-in parent is one that had already ended; a split child one that had
    already started.
    """
    tr = [t for t in c.track if t["t"] <= a]
    if not tr or tr[-1]["t"] != a:
        return None
    return Cell(c.id, c.first, a,
                parents=[p for p in c.parents if cells[p].last <= a],
                children=[k for k in c.children if cells[k].first <= a],
                track=tr)


def rings(eid: str, mask: np.ndarray, simplify: int = 3) -> list[list[list[float]]]:
    """Closed lon/lat rings for every component of a boolean mask."""
    out = []
    for c in find_contours(gaussian_filter(mask.astype(np.float32), 1.0), 0.5):
        c = c[::simplify]
        if len(c) < 4:
            continue
        ring = px_to_lonlat(eid, c[:, 0], c[:, 1]).tolist()
        ring.append(ring[0])
        out.append(ring)
    return out


def cell_geometry(eid: str, mask: np.ndarray, vil_kgm2: np.ndarray) -> tuple[dict | None, int]:
    """Hazard zone for a cell: its intense cores, or the whole cell if it has none.

    A mesoscale system is one connected component at the tracking threshold and
    can span thousands of km²; the cores are what a forecaster acts on and what
    "1 km hazard zone" means on the map.
    """
    core = mask & (vil_kgm2 >= CORE_KGM2)
    use, area = (core, int(core.sum())) if core.sum() >= 16 else (mask, int(mask.sum()))
    rs = rings(eid, use)
    if not rs:
        return None, area
    if len(rs) == 1:
        return {"type": "Polygon", "coordinates": [rs[0]]}, area
    return {"type": "MultiPolygon", "coordinates": [[r] for r in rs]}, area


def cone(eid: str, c: Cell, horizon_min: int = 60) -> list[list[list[float]]] | None:
    """Uncertainty cone: the cell's radius widening along the perturbed ensemble motion."""
    u, v = cell_velocity(c)
    if not np.hypot(u, v):
        return None
    last = c.track[-1]
    r0 = float(np.sqrt(last["area"] / np.pi))
    steps = horizon_min // STEP_MIN
    ang = np.arctan2(v, u)
    left, right = [], []
    for k in range(steps + 1):
        # Spread grows with lead: ±10° heading and ±15 % speed, as in arrival_window.
        d = np.hypot(u, v) * k
        w = r0 + d * np.tan(np.deg2rad(10)) + 0.15 * d
        cy, cx = last["y"] + v * k, last["x"] + u * k
        n = np.array([-np.sin(ang), np.cos(ang)])
        left.append((cy + n[0] * w, cx + n[1] * w))
        right.append((cy - n[0] * w, cx - n[1] * w))
    pts = np.array(left + right[::-1])
    ring = px_to_lonlat(eid, pts[:, 0], pts[:, 1]).tolist()
    ring.append(ring[0])
    return [ring]


# ---- cell hazard models ---------------------------------------------------------
def cell_features(eid: str, cells: dict[int, Cell], ids: list[np.ndarray], a: int,
                  vil_obs: np.ndarray, ts: TierSample,
                  probs: dict[int, dict[str, float]]) -> list[dict]:
    """The tracked cells as GeoJSON at frame `a`, with no future information in them.

    Written for every frame, not only the frames the model runs on: the cells are
    tracked on observed radar at the full 5 min cadence, so the map can advance at
    that cadence between the 20 min analysis times rather than standing still.
    """
    vil_now = vil_to_kgm2(vil_obs[a])
    feats = []
    for cid, c0 in cells.items():
        c = at_frame(c0, a, cells)
        if c is None:
            continue
        geom, core_area = cell_geometry(eid, ids[a] == cid, vil_now)
        if geom is None:
            continue
        tr = c.track[-1]
        row, col = int(tr["y"]), int(tr["x"])
        feats.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": cid, "parents": c.parents, "children": c.children,
                "first_min": c.first * STEP_MIN, "vil_max_kgm2": round(tr["vil_max_kgm2"], 1),
                "area_km2": tr["area"], "core_area_km2": core_area,
                "tier": TIER_NAME[int(ts.tier[np.clip(row, 0, GRID - 1), np.clip(col, 0, GRID - 1)])],
                "hazards": {k: round(v, 3) for k, v in probs.get(cid, {}).items()},
                "track": [[*px_to_lonlat(eid, np.array([t["y"]]), np.array([t["x"]]))[0]]
                          for t in c.track],
                "vil_series": [[t["t"] * STEP_MIN, round(t["vil_max_kgm2"], 1)] for t in c.track],
                "cone": cone(eid, c),
            },
        })
    return feats


def load_cell_models() -> dict:
    p = path("store") / "models" / "hazards.pkl"
    if not p.exists():
        return {}
    with open(p, "rb") as f:
        return pickle.load(f)


def cell_hazard_probs(models: dict, ch: dict, ids: list[np.ndarray], cells: dict[int, Cell],
                      a: int) -> dict[int, dict[str, float]]:
    """Hail and downburst probability per live cell at analysis frame `a`."""
    from pipeline.hazards import FEATURES, cell_features

    if not models:
        return {}
    out: dict[int, dict[str, float]] = {}
    for cid, c in cells.items():
        if not (c.first <= a <= c.last):
            continue
        mask = ids[a] == cid
        if not mask.any():
            continue
        hist = {tr["t"]: tr["vil_max_kgm2"] for tr in c.track}
        row = pd.DataFrame([cell_features(ch, mask, a, hist)])[FEATURES]
        out[cid] = {hz: float(m.predict_proba(row)[:, 1][0]) for hz, (m, _) in models.items()}
    return out


# ---- convective initiation ------------------------------------------------------
def load_ci() -> tuple[object, float] | tuple[None, None]:
    """The 30-min initiation model and its validation-tuned threshold."""
    import lightgbm as lgb

    p = path("store") / "models" / "ci_30.txt"
    if not p.exists():
        return None, None
    thr = json.loads((path("store") / "models" / "ci_30.json").read_text())["threshold"]
    return lgb.Booster(model_file=str(p)), float(thr)


def ci_table(eid: str, tier: np.ndarray) -> pd.DataFrame:
    """Candidate patches for the whole event, computed once (event_rows is expensive)."""
    from pipeline.initiation import event_rows

    return event_rows(eid, tier[::2, ::2])


def ci_scores(booster, thr: float, table: pd.DataFrame, eid: str, a: int) -> list[dict]:
    """Initiation candidates at frame `a`, with LightGBM SHAP top-3 reasons in plain words."""
    if booster is None or table.empty:
        return []
    from pipeline.initiation import FEATURES, LABELS, P

    df = table[table.t == a]
    if df.empty:
        return []
    x = df[FEATURES]
    p = booster.predict(x)
    sv = booster.predict(x, pred_contrib=True)[:, :len(FEATURES)]
    out = []
    for i, (_, r) in enumerate(df.iterrows()):
        if p[i] < thr:
            continue
        top = np.argsort(-np.abs(sv[i]))[:3]
        # Patch index → 2 km patch centre → 1 km grid pixel.
        row = (int(r.gy) * P + P / 2) * 2
        col = (int(r.gx) * P + P / 2) * 2
        lon, lat = px_to_lonlat(eid, np.array([row]), np.array([col]))[0]
        out.append({
            "score": int(round(float(p[i]) * 100)),
            "lon": float(lon), "lat": float(lat),
            "reasons": [{"feature": LABELS[FEATURES[j]], "effect": float(sv[i][j])} for j in top],
        })
    return sorted(out, key=lambda d: -d["score"])[:6]


# ---- arrival windows and alerts -------------------------------------------------
def site_rows(eid: str, limit: int = 8) -> pd.DataFrame:
    """Named locations for the countdown clocks: airports first, then the largest places.

    Natural Earth repeats names (several "Kansas City" records, airports labelled
    by a neighbouring city); duplicates would read as a bug on screen.
    """
    pts = points_in_event(eid).drop_duplicates("name")
    air = pts[pts.kind == "airport"].head(3)
    city = pts[pts.kind == "city"].head(limit - len(air))
    s = pd.concat([air, city])
    s = s.reset_index(drop=True)
    s["id"] = [f"s{i}" for i in range(len(s))]
    return s


def windows_for(eid: str, cells: dict[int, Cell], a: int, sites: pd.DataFrame,
                probs: dict[int, dict[str, float]]) -> list[dict]:
    """Per site: the soonest arrival window over live cells, with that cell's hazards."""
    live = {cid: v for cid, v in ((cid, at_frame(c, a, cells)) for cid, c in cells.items())
            if v is not None and len(v.track) >= 2}
    out = []
    for _, s in sites.iterrows():
        best = None
        for cid, c in live.items():
            # Grid km and grid rows both count from the south edge, so y_km is the row.
            w = arrival_window(c, (s.y_km, s.x_km), horizon_frames=12, seed=a)
            if w and (best is None or w["median_min"] < best["median_min"]):
                best = {**w, "cell": cid, "hazards": probs.get(cid, {})}
        if best:
            out.append({"site": s.id, "name": s["name"], "kind": s.kind,
                        "lon": float(s.lon), "lat": float(s.lat), **best})
    return out


def build_alerts(eid: str, start_utc: datetime, per_frame: list[dict], sites: pd.DataFrame,
                 tier: np.ndarray, thresholds: dict[str, float]) -> list[dict]:
    """One alert per (site, hazard) at the first analysis time that crosses the audience threshold."""
    site_by_id = {r.id: r for r in sites.itertuples()}
    seen: set[tuple[str, str, str]] = set()
    out: list[dict] = []
    for fr in per_frame:
        a = fr["analysis_frame"]
        sent = start_utc + timedelta(minutes=a * STEP_MIN)
        for w in fr["arrivals"]:
            s = site_by_id[w["site"]]
            # Tier at the site decides what may be shown (hazards.gate, display side).
            row, col = int(s.y_km), int(s.x_km)
            tv = int(tier[np.clip(row, 0, GRID - 1), np.clip(col, 0, GRID - 1)])
            for hz, p_h in w["hazards"].items():
                if hz == "downburst" and (tv == 0 or (tv == 1 and p_h < 0.5)):
                    continue
                for aud, a_cfg in AUDIENCES.items():
                    if hz not in a_cfg["hazards"] or s.kind not in a_cfg["sites"]:
                        continue
                    key = (w["site"], hz, aud)
                    if key in seen:
                        continue
                    thr = thresholds.get(f"{hz}|{aud}")
                    if thr is None or p_h < thr:
                        continue
                    seen.add(key)
                    sev = severity(p_h, w["p"], float(s.weight))
                    site = {"name": s.name, "lat": float(s.lat), "lon": float(s.lon),
                            "radius_km": 5.0}
                    al = {"id": f"{eid}-{w['site']}-{hz}-{aud}", "sent_utc": sent.isoformat(),
                          "analysis_frame": a, "audience": aud, "hazard": hz, "site": w["site"],
                          "site_name": s.name, "lon": float(s.lon), "lat": float(s.lat),
                          "p": round(p_h, 3), "p_arrival": round(w["p"], 3),
                          "start_min": w["start_min"], "end_min": w["end_min"],
                          "severity": round(sev, 3), "tier": TIER_NAME[tv],
                          "threshold": round(thr, 3), "cell": w["cell"]}
                    al["cap_xml"] = cap_xml({**al, "sent": sent, "site": site, "calibrated": False})
                    al["sms"] = sms(hz, s.name, w["start_min"], w["end_min"], p_h)
                    out.append(al)
    return sorted(out, key=lambda d: (d["analysis_frame"], -d["severity"]))


def audience_thresholds() -> dict[str, float]:
    """Thresholds tuned on validation data by alerts.severity; empty if not computed."""
    p = path("results") / "alerts.json"
    if not p.exists():
        return {}
    d = json.loads(p.read_text())
    return {f"{hz}|{aud}": v["threshold"]
            for hz, r in d.get("by_hazard", {}).items()
            for aud, v in r.items() if aud != "fixed"}


# ---- verification ---------------------------------------------------------------
def verify(eid: str, vil_obs: np.ndarray, alerts: list[dict], sites: pd.DataFrame) -> dict:
    """Did the hazard reach the site inside the alerted window? Lead time vs persistence."""
    site_by_id = {r.id: r for r in sites.itertuples()}
    thr_kgm2 = 3.5
    rows = []
    for al in alerts:
        s = site_by_id[al["site"]]
        row, col = int(s.y_km), int(s.x_km)
        r0, r1 = max(0, row - 5), min(GRID, row + 6)
        c0, c1 = max(0, col - 5), min(GRID, col + 6)
        series = vil_to_kgm2(vil_obs[:, r0:r1, c0:c1].max(axis=(1, 2)))
        a = al["analysis_frame"]
        w0 = a + al["start_min"] // STEP_MIN
        w1 = min(len(series) - 1, a + al["end_min"] // STEP_MIN)
        hit = bool((series[w0:w1 + 1] >= thr_kgm2).any()) if w1 >= w0 else False
        ever = np.argwhere(series[a:] >= thr_kgm2)
        rows.append({"alert": al["id"], "audience": al["audience"], "hazard": al["hazard"],
                     "site_name": al["site_name"], "outcome": "hit" if hit else "false_alarm",
                     "observed_first_min": int(ever[0][0] * STEP_MIN) if len(ever) else None,
                     "lead_min_achieved": int(ever[0][0] * STEP_MIN) if len(ever) and hit else None})
    hits = sum(r["outcome"] == "hit" for r in rows)
    leads = [r["lead_min_achieved"] for r in rows if r["lead_min_achieved"]]
    return {
        "threshold_kgm2": thr_kgm2,
        "note": "Truth is the observed VIL at the site (SEVIR); no gauge or Doppler truth on this dataset.",
        "alerts": rows,
        "summary": {"n": len(rows), "hits": hits, "false_alarms": len(rows) - hits,
                    "median_lead_min": float(np.median(leads)) if leads else None},
    }


# ---- event choice ---------------------------------------------------------------
def candidates(selection: str = "selection.csv") -> pd.DataFrame:
    from pipeline.cache import cache_path

    tab = pd.read_csv(path("raw") / selection)
    tab = tab[(tab.split == "test") & tab.event_type.notna()]
    rows = []
    for r in tab.itertuples():
        if not cache_path(r.id).exists():
            continue
        x = np.load(cache_path(r.id), mmap_mode="r")
        vil = np.asarray(x[:40, 0], np.float32) * 255.0
        try:
            n_sites = len(points_in_event(r.id))
        except Exception:
            n_sites = 0
        rows.append({"id": r.id, "event_type": r.event_type, "n_sites": n_sites,
                     "vil_max": float(vil.max()), "vil_area": float((vil >= 133).sum() / 40),
                     "lght": float(np.asarray(x[:40, 3], np.float32).sum())})
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    # A good demo event: strong, long-lived convection over somewhere with named places.
    df["score"] = (df.vil_area.rank(pct=True) + df.n_sites.clip(0, 12).rank(pct=True)
                   + df.lght.rank(pct=True))
    return df.sort_values("score", ascending=False)


# ---- main ----------------------------------------------------------------------
def build(eid: str, out_root=None, region: str | None = None) -> dict:
    from data.sevir_dataset import load_event
    from pipeline.infer import predict
    from pipeline.preprocess import event_channels

    reg = REGIONS[region] if region else None
    if reg:
        # Everything downstream — corners, cell outlines, tracks, cones, the
        # exposure points that become the named locations, the alert geography —
        # reads its georeference from here, so one call moves the whole package.
        meta_mod.relocate(eid, reg["lon"], reg["lat"])
    pkg = f"{eid}-{reg['suffix']}" if reg else eid

    out = (out_root or path("replay")) / pkg
    if out.exists():
        shutil.rmtree(out)
    (out / "frames").mkdir(parents=True)

    meta_row = event_meta(eid)
    start_utc = pd.to_datetime(meta_row["time_utc"]).to_pydatetime().replace(tzinfo=timezone.utc)
    ch = event_channels(load_event(eid), eid)
    vil_obs = ch["vil"]                                  # [49, 384, 384] pixel units
    ts = from_m1_grid(np.random.default_rng(cfg()["sevir"]["seed"]), GRID) or demo_network(GRID)
    write_coverage_png(ts, out / "coverage.png")

    cells, ids = track(vil_obs)
    models = load_cell_models()
    booster, ci_thr = load_ci()
    ci_rows = ci_table(eid, ts.tier) if booster is not None else pd.DataFrame()
    sites = site_rows(eid)
    thresholds = audience_thresholds()

    availability = {
        "vil_nowcast": True, "lightning_nowcast": True, "cloudburst": True,
        "hail": bool(models), "downburst": bool(models), "initiation": booster is not None,
        "audience_thresholds": bool(thresholds),
        "nwp_blend_3_6h": False,
        "coverage_tiers_real": ts.source == "m1-grid",
    }

    blind = TierSample(np.zeros_like(ts.tier), np.full(ts.tier.shape, np.inf, np.float32), "none")
    per_frame = []
    for a in ANALYSIS:
        mode_stats = {}
        for mode in MODES:
            pr = predict(eid, a - N_IN + 1, ts if mode == "all" else blind,
                         np.random.default_rng(a), n_members=10,
                         drop_lightning=(mode == "satonly"))
            vil_f, lght_f = pr["vil"], pr["lightning"]        # [12, 384, 384]
            hz_dir = out / "hazards" / str(a) / mode
            for k in range(vil_f.shape[0]):
                write_png(vil_to_kgm2(vil_f[k]), "vil", hz_dir / f"vil_{(k + 1) * STEP_MIN}.png")
                write_png(lght_f[k], "lightning", hz_dir / f"lightning_{(k + 1) * STEP_MIN}.png")
            acc = accumulation_mm(vil_f)
            write_png(acc, "cloudburst", hz_dir / "cloudburst_60.png")
            p_cb = p_cloudburst(acc)
            mode_stats[mode] = {
                "vil_max_kgm2": round(float(vil_to_kgm2(vil_f).max()), 1),
                "lightning_max": round(float(lght_f.max()), 4),
                "accum_max_mm": round(float(acc.max()), 1),
                "p_ge_100mm_max": round(float(p_cb.max()), 4),
            }

        probs = cell_hazard_probs(models, ch, ids, cells, a)
        feats = cell_features(eid, cells, ids, a, vil_obs, ts, probs)
        fr = {
            "analysis_frame": a,
            "time_utc": (start_utc + timedelta(minutes=a * STEP_MIN)).isoformat(),
            "leads_min": [(k + 1) * STEP_MIN for k in range(vil_f.shape[0])],
            "cells": {"type": "FeatureCollection", "features": feats},
            "arrivals": windows_for(eid, cells, a, sites, probs),
            "initiation": ci_scores(booster, ci_thr, ci_rows, eid, a),
            "modes": mode_stats,
        }
        (out / "frames" / f"{a}.json").write_text(json.dumps(fr))
        per_frame.append(fr)
        print(f"  frame {a}: {len(feats)} cells, {len(fr['arrivals'])} arrivals, "
              f"{len(fr['initiation'])} CI candidates", flush=True)

    # Cells at every 5 min frame, so the maps advance between analysis times.
    (out / "cells").mkdir(exist_ok=True)
    for f in range(int(vil_obs.shape[0])):
        fe = cell_features(eid, cells, ids, f, vil_obs, ts,
                           cell_hazard_probs(models, ch, ids, cells, f))
        (out / "cells" / f"{f}.json").write_text(json.dumps(
            {"frame": f, "time_utc": (start_utc + timedelta(minutes=f * STEP_MIN)).isoformat(),
             "cells": {"type": "FeatureCollection", "features": fe}}))
    print(f"  cells at {vil_obs.shape[0]} frames", flush=True)

    alerts = build_alerts(eid, start_utc, per_frame, sites, ts.tier, thresholds)
    (out / "alerts.json").write_text(json.dumps({"event": eid, "alerts": alerts}, indent=1))
    (out / "verification.json").write_text(json.dumps(verify(eid, vil_obs, alerts, sites), indent=1))

    tiers, counts = np.unique(ts.tier, return_counts=True)
    corner_pts = corners(eid)
    meta = {
        "event": pkg,
        "source_event": eid,
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": "SEVIR",
        "event_type": meta_row.get("event_type"),
        "start_utc": start_utc.isoformat(),
        "step_min": STEP_MIN,
        "n_frames": int(vil_obs.shape[0]),
        "analysis_frames": ANALYSIS,
        "cell_frames": list(range(int(vil_obs.shape[0]))),
        "modes": list(MODES),
        "radars_km": [list(r) for r in DEMO_RADARS] if ts.source == "simulated-demo" else [],
        "grid": {"size": GRID, "km_per_px": 1},
        "corners": corner_pts,
        # From the corners, not from the catalog row: the two agree for an event
        # drawn where it happened, and only the corners follow a relocated grid.
        "bbox": [min(c[0] for c in corner_pts), min(c[1] for c in corner_pts),
                 max(c[0] for c in corner_pts), max(c[1] for c in corner_pts)],
        "badges": ["REPLAY", "US-SEVIR"] + ([] if ts.source == "m1-grid" else ["SIMULATED GAP"])
                  + (["PROXY"] if models else []) + (["RELOCATED"] if reg else []),
        "relocated": None if not reg else {
            "where": reg["where"], "centre": [reg["lon"], reg["lat"]],
            "what_moved": ("the georeference of the 384 km grid, and with it the named "
                           "locations and airports, which are the real ones for this tile"),
            "what_did_not": ("the forecast, the observed fields, the storm cells, the arrival "
                             "windows and every metric — all computed on the grid, which is "
                             "unchanged — and the timestamps, which are the original event's"),
        },
        "coverage": {"source": ts.source,
                     "share": {TIER_NAME[int(t)]: float(c / ts.tier.size) for t, c in zip(tiers, counts)}},
        "sites": [{"id": r.id, "name": r.name, "kind": r.kind, "lon": float(r.lon),
                   "lat": float(r.lat), "weight": round(float(r.weight), 3)}
                  for r in sites.itertuples()],
        "ml_horizon_min": 12 * STEP_MIN,
        "availability": availability,
        "hazard_ranges": {k: {"min": v[0], "max": v[1], "units": RANGE_UNITS[k]}
                          for k, v in RANGE.items()},
        "core_threshold_kgm2": CORE_KGM2,
        "notes": {
            "replay": "Recorded event played back from precomputed files; not a live forecast.",
            **({"relocated": (
                f"This storm happened over the United States on {start_utc:%d %B %Y}. Its grid is "
                f"drawn here over {reg['where']}, so the console can be read against Indian "
                "terrain, cities and airports — the named locations are the real ones for this "
                "tile. No Indian radar, satellite or gauge data is involved, and no number on "
                "any screen changes when the grid moves.")} if reg else {}),
            "downburst": "PROXY — VIL-core collapse, not Doppler velocity.",
            "coverage": "Radar coverage tiers are SIMULATED; partial-tier scaling is ASSUMED.",
            "horizon": "ML nowcast covers 0–60 min at 1 km; 3–6 h NWP blend is designed, not validated.",
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {out.relative_to(ROOT)}  ({len(alerts)} alerts, "
          f"{sum(1 for _ in out.rglob('*.png'))} rasters)")
    return meta


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--auto", type=int, default=0, help="build the N best-scoring candidates")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--relocate", choices=sorted(REGIONS),
                    help="georeference the grid onto this region instead (badged RELOCATED)")
    a = ap.parse_args(argv)

    if a.list or a.auto:
        df = candidates()
        if df.empty:
            print("no cached test events with storm-event labels")
            return
        print(df.head(12).to_string(index=False))
        if a.auto:
            a.event += list(df.head(a.auto).id)
    built = []
    for eid in a.event:
        print(f"building {eid}{' → ' + a.relocate if a.relocate else ''}", flush=True)
        built.append(build(eid, region=a.relocate))
    if built:
        idx = path("replay") / "index.json"
        # Keep packages this run did not touch: building one event must not drop
        # the others out of the console's event list.
        rows = {e["id"]: e for e in (json.loads(idx.read_text())["events"] if idx.exists() else [])}
        for m in built:
            rows[m["event"]] = {"id": m["event"], "event_type": m["event_type"],
                                "start_utc": m["start_utc"], "badges": m["badges"]}
        idx.write_text(json.dumps({"events": list(rows.values())}, indent=1))
        print(f"index: {len(rows)} event(s)")


if __name__ == "__main__":
    main()
