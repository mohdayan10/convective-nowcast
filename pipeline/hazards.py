"""The four hazards and coverage-tier gating (brief M6).

Hail, downburst — cell-level LightGBM on storm features.
    Labels: SEVIR storm events are centred on their NOAA Storm Events report
    (frame 24, tile centre; verified on all 393 events in the selection), so the
    cell over the centre at frame 24 is a positive for its report type. The
    strongest cell of a random event is a negative (no linked report — a noisy
    negative, stated as such). Features are read `lead` minutes before the
    report. The downburst output is a PROXY: core collapse, not Doppler velocity.
    Freezing level (NWP) is not used — no NWP is wired in.
Lightning density — the U-Net's lightning head.
Cloudburst — forecast VIL → rain rate (relation below) → 1 h accumulation over
    5×5 km → P(≥ 100 mm) with the relation's uncertainty.

    python -m pipeline.hazards      # trains hail/downburst, writes eval/results/hazards.json (cell part)
"""
from __future__ import annotations

import json
import zlib
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.ndimage import binary_dilation, uniform_filter
from scipy.stats import norm

from coverage.tiers import partial_factor
from data.sevir_dataset import load_event
from pipeline.preprocess import event_channels
from pipeline.settings import ROOT, path
from pipeline.tracking import detect, track
from pipeline.units import vil_to_kgm2

# ---- cloudburst: VIL → rain rate ------------------------------------------------
# VIL = 3.44e-6 · Z^(4/7) · D  (Greene & Clark 1972, uniform Z over a column of depth D m)
# Z = 200 · R^1.6              (Marshall-Palmer)
# ⇒ R = ((VIL / (3.44e-6 · D))^(7/4) / 200)^(1/1.6)
COLUMN_DEPTH_M = 8000.0
RAIN_SIGMA_LN = np.log(2.0) / 1.645     # ×/÷ 2 at 90 %: D 5–11 km and Z-R spread
CLOUDBURST_MM = 100.0


def rain_rate_mmh(vil_kgm2: np.ndarray) -> np.ndarray:
    z = np.power(np.maximum(vil_kgm2, 0) / (3.44e-6 * COLUMN_DEPTH_M), 7 / 4)
    return np.power(z / 200.0, 1 / 1.6)


def accumulation_mm(vil_px_frames: np.ndarray, step_min: int = 5, window_km: int = 5) -> np.ndarray:
    """[T, H, W] VIL pixel values → accumulated rain over the frames, 5×5 km mean (≈25 km²)."""
    r = rain_rate_mmh(vil_to_kgm2(vil_px_frames)) * step_min / 60
    return uniform_filter(r.sum(0), size=window_km)


def p_cloudburst(acc_mm: np.ndarray) -> np.ndarray:
    return norm.cdf((np.log(np.maximum(acc_mm, 1e-3)) - np.log(CLOUDBURST_MM)) / RAIN_SIGMA_LN)


# ---- cell features --------------------------------------------------------------
FEATURES = ["vil_max", "vil_p95", "area_133", "area_181", "trend10", "trend20", "collapse20",
            "ir_min", "ot_index", "wv_ir_max", "lght_rate", "lght_jump"]
RADAR_FEATURES = ["vil_max", "vil_p95", "area_133", "area_181", "trend10", "trend20", "collapse20"]


def cell_features(ch: dict, cell_mask_t: np.ndarray, t: int, history: dict[int, float]) -> dict:
    vil = vil_to_kgm2(ch["vil"][t])
    region = binary_dilation(cell_mask_t, iterations=5)
    v = vil[cell_mask_t]
    ir, wv = ch["ir107"][t][region], ch["ir069"][t][region]
    y0, x0 = np.argwhere(cell_mask_t).mean(0).astype(int)
    box = ch["ir107"][t][max(0, y0 - 15):y0 + 15, max(0, x0 - 15):x0 + 15]
    lr = float(ch["lght"][t][region].sum())
    lr10 = float(ch["lght"][max(t - 2, 0)][region].sum())
    now = float(v.max())
    past10, past20 = history.get(t - 2, now), history.get(t - 4, now)
    recent_max = max([now] + [history.get(t - k, now) for k in (1, 2, 3, 4)])
    return {
        "vil_max": now, "vil_p95": float(np.percentile(v, 95)),
        "area_133": float((vil[region] >= 3.5).sum()), "area_181": float((vil[region] >= 12.0).sum()),
        "trend10": now - past10, "trend20": now - past20,
        "collapse20": (recent_max - now) / max(recent_max, 0.1),
        "ir_min": float(ir.min()), "ot_index": float(np.median(box) - ir.min()),
        "wv_ir_max": float((wv - ir).max()),
        "lght_rate": lr, "lght_jump": (lr + 1) / (lr10 + 1),
    }


def samples_for(eid: str, event_type: str | None, wind_kt: float | None, hail_in: float | None,
                leads=(0, 15)) -> list[dict]:
    ch = event_channels(load_event(eid), eid)
    cells, ids = track(ch["vil"][:30])
    rows = []
    # Target cell at the report frame: the one over the tile centre, else the strongest.
    idimg = ids[24]
    cid = int(idimg[185:200, 185:200].max()) if event_type else 0
    if cid == 0:
        vals = [(c.track[-1]["vil_max_kgm2"], k) for k, c in cells.items() if c.first <= 24 <= c.last]
        if not vals:
            return rows
        cid = max(vals)[1]
    c = cells[cid]
    hist = {tr["t"]: tr["vil_max_kgm2"] for tr in c.track}
    for lead in leads:
        t = 24 - lead // 5
        if t not in hist:
            continue
        mask = ids[t] == cid
        if not mask.any():
            continue
        f = cell_features(ch, mask, t, hist)
        f.update({"event": eid, "lead_min": lead, "cell": cid, "event_type": event_type or "random",
                  "hail": int(event_type == "Hail"), "downburst": int(event_type == "Thunderstorm Wind"),
                  "wind_kt": wind_kt, "hail_in": hail_in})
        rows.append(f)
    return rows


def apply_tier(df: pd.DataFrame, tier: int) -> pd.DataFrame:
    """Degrade radar features as the coverage tier would (0: none, 1: partial ASSUMED scaling)."""
    d = df.copy()
    if tier == 0:
        d[RADAR_FEATURES] = np.nan
    elif tier == 1:
        f = float(partial_factor(np.array(3.5)))
        for k in ("vil_max", "vil_p95", "trend10", "trend20"):
            d[k] = d[k] * f
        d["area_133"] = d["area_133"] * f
        d["area_181"] = d["area_181"] * f
    d["tier"] = tier
    return d


def build_table() -> pd.DataFrame:
    from pipeline.train import splits
    lab = pd.read_csv(path("raw") / "labels.csv").set_index("id")
    s = splits()
    rows = []
    for split, ids in s.items():
        for eid in ids:
            r = lab.loc[eid] if eid in lab.index else None
            et = None if r is None or pd.isna(r.get("EVENT_TYPE")) else r["EVENT_TYPE"]
            for row in samples_for(eid, et, None if r is None else r.get("wind_kt"), None if r is None else r.get("hail_in")):
                row["split"] = split
                rows.append(row)
    return pd.DataFrame(rows)


def fit_eval(df: pd.DataFrame, target: str) -> tuple[dict, object, float]:
    import lightgbm as lgb
    from sklearn.metrics import brier_score_loss, roc_auc_score

    aug = lambda d: pd.concat([apply_tier(d, t) for t in (2, 1, 0)], ignore_index=True)
    tr, va, te = (aug(df[df.split == k]) for k in ("train", "val", "test"))
    pos = max(int(tr[target].sum()), 1)
    model = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=15,
                               subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                               scale_pos_weight=(len(tr) - pos) / pos, verbose=-1)
    model.fit(tr[FEATURES], tr[target])
    pv = model.predict_proba(va[FEATURES])[:, 1]
    thr = float(max(np.linspace(0.05, 0.95, 91), key=lambda th: _csi(pv >= th, va[target].values)))
    out = {"threshold": thr, "n_train_pos": int(df[(df.split == "train")][target].sum()),
           "n_test_pos": int(df[df.split == "test"][target].sum()), "n_test": int((df.split == "test").sum()),
           "by_tier_and_lead": {}}
    for tier, name in ((2, "full"), (1, "partial"), (0, "none")):
        for lead in sorted(te.lead_min.unique()):
            d = te[(te.tier == tier) & (te.lead_min == lead)]
            if d[target].nunique() < 2:
                continue
            p = model.predict_proba(d[FEATURES])[:, 1]
            y = d[target].values
            hits, misses, fas = int(((p >= thr) & (y == 1)).sum()), int(((p < thr) & (y == 1)).sum()), int(((p >= thr) & (y == 0)).sum())
            out["by_tier_and_lead"][f"{name}|{lead}"] = {
                "tier": name, "lead_min": int(lead), "n": len(d), "n_pos": int(y.sum()),
                "auc": float(roc_auc_score(y, p)), "brier": float(brier_score_loss(y, p)),
                "pod": hits / max(hits + misses, 1), "far": fas / max(hits + fas, 1),
                "csi": hits / max(hits + misses + fas, 1),
                "climatology_brier": float(brier_score_loss(y, np.full(len(y), y.mean()))),
            }
    return out, model, thr


def _csi(p, y):
    h, m, f = (p & (y == 1)).sum(), (~p & (y == 1)).sum(), (p & (y == 0)).sum()
    return h / max(h + m + f, 1)


def gust_band(df: pd.DataFrame, model, thr: float) -> dict:
    tr = df[(df.split == "train") & (df.downburst == 1) & df.wind_kt.notna()]
    if tr.empty:
        return {}
    p = model.predict_proba(tr[FEATURES])[:, 1]
    w = tr.wind_kt[p >= thr]
    w = w if len(w) >= 5 else tr.wind_kt
    return {"p25_kt": float(np.percentile(w, 25)), "p50_kt": float(np.percentile(w, 50)),
            "p75_kt": float(np.percentile(w, 75)), "n": int(len(w)),
            "note": "Observed wind at training reports the proxy flagged — a band, not a measured velocity"}


# ---- tier gating (display) ----------------------------------------------------------
def gate(hazard: str, prob: np.ndarray, tier: np.ndarray, tier1_min: float = 0.5) -> np.ndarray:
    """Brief M6: downburst hidden at tier 0 and shown at tier 1 only above tier1_min;
    other hazards are shown everywhere (their confidence is reported per tier)."""
    if hazard != "downburst":
        return prob
    out = np.where(tier == 0, np.nan, prob)
    return np.where((tier == 1) & (prob < tier1_min), np.nan, out)


def main():
    import pickle
    df = build_table()
    df.to_csv(path("store") / "hazard_cells.csv", index=False)
    print(f"{len(df)} cell samples; positives train/test — hail {df[df.split == 'train'].hail.sum()}/{df[df.split == 'test'].hail.sum()}, "
          f"downburst {df[df.split == 'train'].downburst.sum()}/{df[df.split == 'test'].downburst.sum()}", flush=True)
    res = {"kind": "hazards", "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "features": FEATURES, "label_source": "NOAA Storm Events via SEVIR event_id (report at tile centre, frame 24)",
           "negatives": "strongest cell of random events + cells of other storm-event types (noisy: no report linked)",
           "not_used": "freezing level (needs NWP)", "tier_source": "SIMULATED coverage; partial = ASSUMED scaling",
           "hazards": {}}
    models = {}
    for target in ("hail", "downburst"):
        r, m, thr = fit_eval(df, target)
        if target == "downburst":
            r["badge"] = "PROXY"
            r["gust_band"] = gust_band(df, m, thr)
        res["hazards"][target] = r
        models[target] = (m, thr)
        full0 = r["by_tier_and_lead"].get("full|15", {})
        print(f"{target}: test AUC full-tier @15 min {full0.get('auc', float('nan')):.2f}, "
              f"CSI {full0.get('csi', float('nan')):.2f}", flush=True)
    res["hazards"]["cloudburst"] = {
        "relation": "R = ((VIL / (3.44e-6 · D))^(7/4) / 200)^(1/1.6), D = 8 km column (Greene & Clark 1972; Marshall-Palmer Z-R)",
        "uncertainty": "lognormal, ×/÷ 2 at 90 %",
        "threshold_mm_1h": CLOUDBURST_MM, "area_km2": 25,
        "verification": "see hazards_fields.json (forecast vs VIL-derived accumulation; no gauge/MRMS truth on SEVIR)",
    }
    (path("store") / "models").mkdir(exist_ok=True)
    with open(path("store") / "models" / "hazards.pkl", "wb") as f:
        pickle.dump(models, f)
    out = path("results") / "hazards.json"
    out.write_text(json.dumps(res, indent=1))
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
