"""M4 acceptance: six masked samples + tier-share statistics.

    python -m coverage.make_training_masks   # → docs/m4_masks.png, eval/results/tier_shares.json
"""
from __future__ import annotations

import json

import numpy as np

from coverage.tiers import TIER_GRID, apply_tiers, sample_tiers
from data.sevir_dataset import available, load_event
from pipeline.preprocess import vil_frames
from pipeline.settings import ROOT, cfg, path


def main():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap

    rng = np.random.default_rng(cfg()["sevir"]["seed"])
    shares, sources = np.zeros(3), {}
    for _ in range(2000):
        ts = sample_tiers(rng)
        shares += np.bincount(ts.tier.ravel(), minlength=3)
        sources[ts.source] = sources.get(ts.source, 0) + 1
    shares /= shares.sum()
    stats = {
        "kind": "tier_shares",
        "tier_source": "m1-grid" if TIER_GRID.exists() else "SIMULATED radar networks (M1 tier grid not available yet)",
        "n_samples": 2000,
        "pixel_share": {"none": shares[0], "partial": shares[1], "full": shares[2]},
        "sample_source_counts": sources,
    }
    (path("results") / "tier_shares.json").write_text(json.dumps(stats, indent=1))
    print(json.dumps(stats, indent=1))

    ids = list(available("train").id[:30])
    rng = np.random.default_rng(7)
    fig, ax = plt.subplots(3, 6, figsize=(18, 9))
    cmap = ListedColormap(["#3b1d1d", "#a57c1b", "#1f5f4a"])
    shown = 0
    for eid in ids:
        vil = vil_frames(load_event(eid)["vil"])[24:25]
        if (vil > 74).mean() < 0.01:
            continue
        ts = sample_tiers(rng)
        while ts.source == "none":
            ts = sample_tiers(rng)
        masked, _ = apply_tiers(vil, ts, rng)
        ax[0, shown].imshow(vil[0], vmin=0, vmax=255); ax[0, shown].set_title(f"{eid}\nVIL", fontsize=8)
        ax[1, shown].imshow(ts.tier, cmap=cmap, vmin=0, vmax=2); ax[1, shown].set_title(f"tiers ({ts.source})", fontsize=8)
        ax[2, shown].imshow(masked[0], vmin=0, vmax=255); ax[2, shown].set_title("VIL seen by model", fontsize=8)
        shown += 1
        if shown == 6:
            break
    for a in ax.ravel():
        a.set_xticks([]); a.set_yticks([])
    fig.suptitle("M4 coverage masks — tier 2 full (green), 1 partial (amber, VIL scaled: ASSUMED), 0 none (red)")
    fig.tight_layout()
    out = ROOT / "docs" / "m4_masks.png"
    fig.savefig(out, dpi=80)
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
