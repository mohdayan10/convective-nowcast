"""Convective initiation (CI): flag new storms from satellite before radar sees them (brief M7).

Candidates: 16 km patches with no echo (VIL < 16) in the patch or its 8
neighbours, so a later echo is a new cell, not an advected one.
Label: VIL ≥ 74 appears in the patch within H minutes (H = 15, 30, 60).
Features — satellite first:
    IR 10.7 µm min / mean, cooling over 15 and 30 min, cold-cloud fraction,
    WV−IR (6.9 − 10.7 µm) max, overshooting-top index (patch min vs surroundings),
    radar (only where coverage tier ≥ 1, else NaN): VIL max and 10-min growth,
    lightning (confirmation): flashes in the last 10 min.
Model: LightGBM, SHAP top-3 reasons. Re-evaluated with satellite degraded to
INSAT-like 4 km and 15 / 30-minute scans.

    python -m pipeline.initiation        # → eval/results/ci.json, store/models/ci_*.txt
"""
from __future__ import annotations

import json
import zlib
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from coverage.tiers import sample_tiers
from pipeline.cache import cache_path
from pipeline.preprocess import NORM
from pipeline.settings import ROOT, path
from pipeline.train import splits

P = 8                       # patch = 8 px at 2 km = 16 km
G = 192 // P                # 24 × 24 patches
NO_ECHO, ECHO = 16 / 255, 74 / 255
HORIZONS = (15, 30, 60)
FEATURES = ["ir_min", "ir_mean", "cool15", "cool30", "cold_frac", "wv_ir_max", "ot_index",
            "vil_max", "vil_growth", "lightning"]
LABELS = {"ir_min": "Coldest cloud top", "ir_mean": "Mean cloud top", "cool15": "Cloud-top cooling (15 min)",
          "cool30": "Cloud-top cooling (30 min)", "cold_frac": "Cold-cloud cover", "wv_ir_max": "WV−IR difference",
          "ot_index": "Overshooting-top index", "vil_max": "Weak radar echo", "vil_growth": "Echo growth",
          "lightning": "Lightning onset"}


def denorm(x: np.ndarray, name: str) -> np.ndarray:
    c, h = NORM[name]
    return x * h + c


def patches(a: np.ndarray, fn) -> np.ndarray:
    return fn(a.reshape(G, P, G, P), axis=(1, 3))


def neighbour_max(a: np.ndarray) -> np.ndarray:
    pad = np.pad(a, 1, constant_values=0)
    return np.max([pad[i:i + G, j:j + G] for i in range(3) for j in range(3)], axis=0)


def degrade(ir: np.ndarray, km: int) -> np.ndarray:
    """Average-pool to `km` resolution and back (2 km native)."""
    f = km // 2
    if f <= 1:
        return ir
    T, H, W = ir.shape
    c = ir.reshape(T, H // f, f, W // f, f).mean(axis=(2, 4))
    return np.repeat(np.repeat(c, f, axis=1), f, axis=2)


def event_rows(eid: str, tier_mask: np.ndarray, sat_km: int = 2, cadence: int = 5) -> pd.DataFrame:
    """Candidate patches of one event at frames 6…36 every 10 min, with features and labels."""
    x = np.load(cache_path(eid), mmap_mode="r").astype(np.float32)
    vil, lg = x[:, 0], x[:, 3]
    ir107 = degrade(denorm(x[:, 2], "ir107"), sat_km)
    ir069 = degrade(denorm(x[:, 1], "ir069"), sat_km)
    step = cadence // 5                     # frames between satellite scans
    tier_p = patches(tier_mask, np.min)     # patch radar tier (worst pixel)
    rows = []
    for t in range(6, 37, 2):
        ts = t - (t % step)                 # latest available scan at this cadence
        if ts - 6 < 0:
            continue
        vmax = patches(vil[t], np.max)
        cand = neighbour_max(vmax) < NO_ECHO
        if not cand.any():
            continue
        irm = patches(ir107[ts], np.min)
        prev15 = patches(ir107[max(ts - max(3, step), 0)], np.min)
        prev30 = patches(ir107[max(ts - max(6, step), 0)], np.min)
        surround = neighbour_max(-patches(ir107[ts], np.median)) * -1  # coldest neighbour median
        fut = np.stack([patches(vil[k], np.max) for k in range(t + 1, t + 13)])
        f = {
            "ir_min": irm, "ir_mean": patches(ir107[ts], np.mean),
            "cool15": prev15 - irm, "cool30": prev30 - irm,
            "cold_frac": patches((ir107[ts] < -40).astype(np.float32), np.mean),
            "wv_ir_max": patches(ir069[ts] - ir107[ts], np.max),
            "ot_index": patches(ir107[ts], np.median) - irm,
            "vil_max": np.where(tier_p >= 1, vmax * 255, np.nan),
            "vil_growth": np.where(tier_p >= 1, (vmax - patches(vil[t - 2], np.max)) * 255, np.nan),
            "lightning": patches(np.expm1(lg[t - 1:t + 1]).sum(0), np.sum),
        }
        del surround
        gy, gx = np.nonzero(cand)
        df = pd.DataFrame({k: v[gy, gx] for k, v in f.items()})
        df["event"], df["t"], df["gy"], df["gx"] = eid, t, gy, gx
        for h in HORIZONS:
            df[f"y{h}"] = (fut[: h // 5, gy, gx] >= ECHO).any(axis=0).astype(np.int8)
        first = np.argmax(fut[:, gy, gx] >= ECHO, axis=0)
        df["echo_in_min"] = np.where((fut[:, gy, gx] >= ECHO).any(axis=0), (first + 1) * 5, -1)
        rows.append(df)
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def tier_for(eid: str) -> np.ndarray:
    ts = sample_tiers(np.random.default_rng(zlib.crc32(eid.encode()) + 7))
    return ts.tier[::2, ::2]


def build(ids: list[str], sat_km=2, cadence=5) -> pd.DataFrame:
    return pd.concat([event_rows(e, tier_for(e), sat_km, cadence) for e in ids], ignore_index=True)


def fit(train: pd.DataFrame, val: pd.DataFrame, h: int):
    import lightgbm as lgb
    pos = max(int(train[f"y{h}"].sum()), 1)
    model = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=40,
                               subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                               scale_pos_weight=(len(train) - pos) / pos, verbose=-1)
    model.fit(train[FEATURES], train[f"y{h}"], eval_set=[(val[FEATURES], val[f"y{h}"])],
              callbacks=[lgb.early_stopping(40, verbose=False)])
    # Threshold that maximises CSI on validation.
    pv = model.predict_proba(val[FEATURES])[:, 1]
    best = max(np.linspace(0.05, 0.95, 91), key=lambda th: _csi(pv >= th, val[f"y{h}"].values))
    return model, float(best)


def _csi(p, y):
    h, m, f = (p & (y == 1)).sum(), (~p & (y == 1)).sum(), (p & (y == 0)).sum()
    return h / max(h + m + f, 1)


def score(model, thr: float, test: pd.DataFrame, h: int) -> dict:
    p = model.predict_proba(test[FEATURES])[:, 1] >= thr
    y = test[f"y{h}"].values == 1
    hits, misses, fas = int((p & y).sum()), int((~p & y).sum()), int((p & ~y).sum())
    # Lead before first echo: for each (event, patch) that initiates, the earliest flag.
    t = test.assign(flag=p)
    ci = t[t.echo_in_min > 0]
    leads = []
    for (_, gy, gx), g in ci.groupby(["event", "gy", "gx"]):
        echo_t = (g.t + g.echo_in_min // 5).min()
        flagged = g[g.flag & (g.t < echo_t)]
        if len(flagged):
            leads.append(int((echo_t - flagged.t.min()) * 5))
    return {"threshold": thr, "hits": hits, "misses": misses, "false_alarms": fas,
            "pod": hits / max(hits + misses, 1), "far": fas / max(hits + fas, 1),
            "csi": hits / max(hits + misses + fas, 1),
            "median_lead_before_echo_min": float(np.median(leads)) if leads else None,
            "n_initiations_flagged": len(leads), "n_candidates": len(test), "n_positive": int(y.sum())}


def shap_reasons(model, X: pd.DataFrame, k: int = 3) -> list[list[dict]]:
    import shap
    sv = shap.TreeExplainer(model).shap_values(X[FEATURES])
    sv = sv[1] if isinstance(sv, list) else sv
    out = []
    for i in range(len(X)):
        top = np.argsort(-sv[i])[:k]
        out.append([{"feature": FEATURES[j], "label": LABELS[FEATURES[j]], "value": None if np.isnan(X.iloc[i][FEATURES[j]]) else float(X.iloc[i][FEATURES[j]]),
                     "shap": float(sv[i, j])} for j in top])
    return out


def main():
    s = splits()
    res = {"kind": "ci", "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "features": FEATURES, "candidate_rule": "16 km patch with VIL < 16 in it and its 8 neighbours",
           "label_rule": "VIL >= 74 in the patch within H minutes", "tier_source": "SIMULATED (see tier_shares.json)",
           "n_events": {k: len(v) for k, v in s.items()}, "conditions": {}}
    models_dir = path("store") / "models"
    models_dir.mkdir(exist_ok=True)
    for name, km, cad in (("goes_2km_5min", 2, 5), ("insat_like_4km_15min", 4, 15), ("insat_like_4km_30min", 4, 30)):
        tr, va, te = (build(s[k], km, cad) for k in ("train", "val", "test"))
        cond = {"satellite_km": km, "cadence_min": cad, "n_train_rows": len(tr), "horizons": {}}
        for h in HORIZONS:
            model, thr = fit(tr, va, h)
            cond["horizons"][str(h)] = score(model, thr, te, h)
            if name == "goes_2km_5min":
                model.booster_.save_model(str(models_dir / f"ci_{h}.txt"))
                (models_dir / f"ci_{h}.json").write_text(json.dumps({"threshold": thr, "features": FEATURES}))
                imp = dict(zip(FEATURES, model.booster_.feature_importance("gain").tolist()))
                cond["horizons"][str(h)]["feature_gain"] = imp
        res["conditions"][name] = cond
        c30 = cond["horizons"]["30"]
        print(f"{name}: 30-min CI  POD {c30['pod']:.2f} FAR {c30['far']:.2f} CSI {c30['csi']:.2f} "
              f"median lead {c30['median_lead_before_echo_min']} min ({c30['n_initiations_flagged']} initiations)", flush=True)
    out = path("results") / "ci.json"
    out.write_text(json.dumps(res, indent=1))
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
