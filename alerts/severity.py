"""Impact-based severity and audience thresholds (brief M10).

severity = hazard probability × arrival probability × exposure weight

Exposure (US events): Natural Earth populated places (log-population weight)
and airports. Audience thresholds are tuned on validation data:
    aviation          maximise F2   (recall-weighted: few misses)
    district, farmers maximise F0.5 (precision-weighted: few false alarms)
and compared with one fixed threshold (validation CSI optimum).

    python -m alerts.severity   # → eval/results/alerts.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache

import numpy as np
import pandas as pd

from pipeline.settings import ROOT, path

AUDIENCES = {
    "aviation": {"beta": 2.0, "hazards": ["lightning", "hail", "downburst"], "sites": ["airport"]},
    "district": {"beta": 0.5, "hazards": ["hail", "downburst", "cloudburst", "lightning"], "sites": ["city", "airport"]},
    "farmers": {"beta": 0.5, "hazards": ["hail", "cloudburst", "lightning"], "sites": ["city"]},
}


@lru_cache(maxsize=1)
def exposure_points() -> pd.DataFrame:
    import shapefile
    base = path("store") / "exposure"
    rows = []
    r = shapefile.Reader(str(base / "ne_10m_populated_places_simple" / "ne_10m_populated_places_simple.shp"))
    for rec, shp in zip(r.records(), r.shapes()):
        d = rec.as_dict()
        lon, lat = shp.points[0]
        rows.append({"name": d["name"], "kind": "city", "lon": lon, "lat": lat, "pop": float(d.get("pop_max") or 0)})
    r = shapefile.Reader(str(base / "ne_10m_airports" / "ne_10m_airports.shp"))
    for rec, shp in zip(r.records(), r.shapes()):
        d = rec.as_dict()
        lon, lat = shp.points[0]
        rows.append({"name": f"{d['name']} ({d['iata_code'] or d['abbrev']})", "kind": "airport", "lon": lon, "lat": lat,
                     "pop": 0.0})
    return pd.DataFrame(rows)


def exposure_weight(kind: str, pop: float) -> float:
    if kind == "airport":
        return 1.0
    return float(np.clip(np.log10(max(pop, 1.0)) / 6.0, 0.2, 1.0))  # 1 M people → 1.0


def points_in_event(eid: str, margin_km: float = 10) -> pd.DataFrame:
    """Exposure points inside an event's 384 km tile, in grid km."""
    from pipeline.meta import projector
    pts = exposure_points()
    f = projector(eid)[0]
    x, y = f(pts.lon.values, pts.lat.values)
    m = (x > margin_km) & (x < 384 - margin_km) & (y > margin_km) & (y < 384 - margin_km)
    out = pts[m].copy()
    out["x_km"], out["y_km"] = x[m], y[m]
    out["weight"] = [exposure_weight(k, p) for k, p in zip(out.kind, out["pop"])]
    return out.sort_values("weight", ascending=False)


def severity(p_hazard: float, p_arrival: float, weight: float) -> float:
    return float(p_hazard * p_arrival * weight)


def _fbeta_thr(p: np.ndarray, y: np.ndarray, beta: float) -> float:
    best, bt = -1.0, 0.5
    for th in np.linspace(0.05, 0.95, 91):
        pr = p >= th
        tp, fp, fn = (pr & (y == 1)).sum(), (pr & (y == 0)).sum(), (~pr & (y == 1)).sum()
        f = (1 + beta ** 2) * tp / max((1 + beta ** 2) * tp + beta ** 2 * fn + fp, 1)
        if f > best:
            best, bt = f, th
    return float(bt)


def _stats(p, y, thr):
    pr = p >= thr
    tp, fp, fn = int((pr & (y == 1)).sum()), int((pr & (y == 0)).sum()), int((~pr & (y == 1)).sum())
    return {"threshold": float(thr), "alerts": tp + fp, "hits": tp, "misses": fn, "false_alarms": fp,
            "pod": tp / max(tp + fn, 1), "far": fp / max(tp + fp, 1)}


def tune() -> dict:
    """Audience thresholds on validation cells; alert counts and FAR on test vs a fixed threshold."""
    import pickle
    from pipeline.hazards import FEATURES
    with open(path("store") / "models" / "hazards.pkl", "rb") as f:
        models = pickle.load(f)
    df = pd.read_csv(path("store") / "hazard_cells.csv")
    df = df[df.lead_min == 15]
    out = {}
    for hz, (m, fixed) in models.items():
        va, te = df[df.split == "val"], df[df.split == "test"]
        pv, pt = m.predict_proba(va[FEATURES])[:, 1], m.predict_proba(te[FEATURES])[:, 1]
        r = {"fixed": _stats(pt, te[hz].values, fixed)}
        for aud, a in AUDIENCES.items():
            if hz not in a["hazards"]:
                continue
            r[aud] = _stats(pt, te[hz].values, _fbeta_thr(pv, va[hz].values, a["beta"]))
        out[hz] = r
    return out


def main():
    res = {"kind": "alerts", "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "severity": "hazard probability × arrival probability × exposure weight",
           "exposure": "Natural Earth 10m populated places (log10 population / 6, clipped 0.2-1) and airports (1.0)",
           "audiences": {k: {"beta": v["beta"], "hazards": v["hazards"]} for k, v in AUDIENCES.items()},
           "lead_min": 15, "by_hazard": tune()}
    out = path("results") / "alerts.json"
    out.write_text(json.dumps(res, indent=1))
    for hz, r in res["by_hazard"].items():
        print(hz, {k: (v["alerts"], round(v["far"], 2)) for k, v in r.items()})
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
