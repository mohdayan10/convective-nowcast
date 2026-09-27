"""Reliability per hazard × tier and isotonic recalibration (brief M8).

Fitted on validation (late-train period), judged on test:
  * hail, downburst — cell classifiers from pipeline.hazards
  * nowcast — MC-dropout exceedance probability P(VIL ≥ 133) per pixel, 1 h
  * ci      — initiation probability (30 min)

    python -m pipeline.calibrate   # → eval/results/calibration.json, docs/m8_reliability.png,
                                   #   store/models/isotonic.pkl
"""
from __future__ import annotations

import json
import pickle
import zlib
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from pipeline.settings import ROOT, path

BINS = np.linspace(0, 1, 11)


def reliability(p: np.ndarray, y: np.ndarray) -> dict:
    idx = np.clip(np.digitize(p, BINS) - 1, 0, len(BINS) - 2)
    rows = []
    for b in range(len(BINS) - 1):
        m = idx == b
        rows.append({"p_mean": float(p[m].mean()) if m.any() else None,
                     "obs_freq": float(y[m].mean()) if m.any() else None, "n": int(m.sum())})
    brier = float(np.mean((p - y) ** 2))
    clim = float(np.mean((y.mean() - y) ** 2))
    return {"bins": rows, "brier": brier, "brier_skill_vs_climatology": 1 - brier / clim if clim else None,
            "n": int(len(y)), "base_rate": float(y.mean())}


def hazard_sets():
    """(name, tier, p_val, y_val, p_test, y_test) for hail / downburst from saved models."""
    from pipeline.hazards import FEATURES, apply_tier
    with open(path("store") / "models" / "hazards.pkl", "rb") as f:
        models = pickle.load(f)
    df = pd.read_csv(path("store") / "hazard_cells.csv")
    for name, (m, _) in models.items():
        for tier, tname in ((2, "full"), (1, "partial"), (0, "none")):
            va, te = (apply_tier(df[df.split == s], tier) for s in ("val", "test"))
            yield name, tname, m.predict_proba(va[FEATURES])[:, 1], va[name].values, m.predict_proba(te[FEATURES])[:, 1], te[name].values


def nowcast_sets(max_events: int = 40, px_per_event: int = 4000):
    """Pixel samples of P(VIL ≥ 133) at T+30/60 min per tier (subsampled per event)."""
    from coverage.tiers import sample_tiers
    from data.sevir_dataset import load_event
    from pipeline.infer import predict
    from pipeline.preprocess import vil_frames
    from pipeline.train import N_IN, N_OUT, splits

    start = 49 - N_IN - N_OUT - 12
    s = splits()
    out = {}
    for split in ("val", "test"):
        acc = {t: ([], []) for t in ("full", "partial", "none")}
        for eid in s[split][:max_events]:
            seed = zlib.crc32(eid.encode())
            ts = sample_tiers(np.random.default_rng(seed + 1))
            pr = predict(eid, start, ts, np.random.default_rng(seed))
            k = pr["thresholds"].index(133)
            obs = vil_frames(load_event(eid)["vil"])[start + N_IN:start + N_IN + N_OUT]
            rng = np.random.default_rng(seed + 2)
            for lead in (5, 11):
                p, y = pr["prob"][k, lead].ravel(), (obs[lead] >= 133).ravel().astype(float)
                for t, name in ((2, "full"), (1, "partial"), (0, "none")):
                    idx = np.flatnonzero(ts.tier.ravel() == t)
                    if len(idx):
                        pick = rng.choice(idx, size=min(px_per_event, len(idx)), replace=False)
                        acc[name][0].append(p[pick]); acc[name][1].append(y[pick])
        out[split] = {t: (np.concatenate(a) if a else np.array([]), np.concatenate(b) if b else np.array([]))
                      for t, (a, b) in acc.items()}
    for t in ("full", "partial", "none"):
        yield "nowcast_vil133", t, *out["val"][t], *out["test"][t]


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    res = {"kind": "calibration", "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "method": "isotonic regression fitted on validation, evaluated on test", "items": {}}
    iso = {}
    sets = list(hazard_sets()) if (path("store") / "models" / "hazards.pkl").exists() else []
    if (path("store") / "models" / "unet_2km.pt").exists():
        sets += list(nowcast_sets())
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.6))
    names = sorted({s[0] for s in sets})
    for (name, tier, pv, yv, pt, yt) in sets:
        if len(yv) < 20 or yv.sum() < 3 or len(yt) == 0:
            continue
        ir = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(pv, yv)
        iso[f"{name}|{tier}"] = ir
        res["items"][f"{name}|{tier}"] = {"hazard": name, "tier": tier,
                                          "raw": reliability(pt, yt), "calibrated": reliability(ir.predict(pt), yt)}
        ax = axes[names.index(name) % 3]
        r = res["items"][f"{name}|{tier}"]["calibrated"]["bins"]
        xs = [b["p_mean"] for b in r if b["n"] >= 10]
        ys = [b["obs_freq"] for b in r if b["n"] >= 10]
        ax.plot(xs, ys, marker="o", label=f"{tier} (calibrated)")
        ax.plot([0, 1], [0, 1], color="#999", lw=1, ls="--")
        ax.set_title(name); ax.set_xlabel("forecast probability"); ax.set_ylabel("observed frequency")
        ax.legend(fontsize=8)
    fig.suptitle("M8 reliability on test after isotonic recalibration (per coverage tier)")
    fig.tight_layout()
    fig.savefig(ROOT / "docs" / "m8_reliability.png", dpi=85)
    with open(path("store") / "models" / "isotonic.pkl", "wb") as f:
        pickle.dump(iso, f)
    out = path("results") / "calibration.json"
    out.write_text(json.dumps(res, indent=1))
    for k, v in res["items"].items():
        print(f"{k:28s} Brier raw {v['raw']['brier']:.4f} → calibrated {v['calibrated']['brier']:.4f} (n={v['raw']['n']})")
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
