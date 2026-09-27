"""PyTorch Dataset over downloaded SEVIR events.

Each sample: 13 input frames × (VIL, IR069, IR107, lightning), plus targets —
future VIL and lightning for `n_out` frames. Coverage-tier masking (M4) plugs in
through `mask_fn` once the tier grid exists.

    python -m data.sevir_dataset --check      # shapes + one aligned plot (M2 acceptance)
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from pipeline.preprocess import event_channels, normalise
from pipeline.settings import ROOT, cfg, path

CHANNELS = ("vil", "ir069", "ir107", "lght")


def load_event(event_id: str) -> dict:
    with np.load(path("events") / f"{event_id}.npz") as z:
        return {k: z[k] for k in z.files}


def available(split: str | None = None, selection: str = "selection_dev.csv") -> pd.DataFrame:
    sel = pd.read_csv(path("raw") / selection, parse_dates=["time_utc"])
    sel = sel[[(path("events") / f"{i}.npz").exists() for i in sel.id]]
    return sel if split is None else sel[sel.split == split]


class SevirDataset:
    """Framework-agnostic core; `torch_dataset()` wraps it for training."""

    def __init__(self, ids: list[str], n_out: int = 12, start: int = 0,
                 mask_fn: Callable[[np.ndarray], np.ndarray] | None = None):
        f = cfg()["frames"]
        self.ids, self.n_in, self.n_out, self.start = list(ids), f["n_in"], n_out, start
        self.mask_fn = mask_fn
        assert start + self.n_in + n_out <= f["n"], "window exceeds the 49-frame event"

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, i: int) -> dict[str, np.ndarray]:
        ch = event_channels(load_event(self.ids[i]), self.ids[i])
        a, b = self.start, self.start + self.n_in
        x = np.stack([normalise(c, ch[c][a:b]) for c in CHANNELS], axis=1)  # [T, C, H, W]
        radar_mask = np.ones(x.shape[-2:], np.float32)
        if self.mask_fn is not None:
            radar_mask = self.mask_fn(radar_mask)
            x[:, 0] *= radar_mask
        return {
            "x": x.astype(np.float32),
            "radar_mask": radar_mask,
            "y_vil": ch["vil"][b:b + self.n_out],           # pixel units, for metrics
            "y_lght": ch["lght"][b:b + self.n_out],
            "id": self.ids[i],
        }


def check():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    sel = available()
    print(f"{len(sel)} events on disk ({(sel.split == 'train').sum()} train / {(sel.split == 'test').sum()} test)")
    # Pick the event with the most lightning for a meaningful alignment plot.
    counts = {i: len(load_event(i)["lght"]) for i in sel.id[:40]}
    eid = max(counts, key=counts.get)
    ds = SevirDataset([eid], n_out=12)
    s = ds[0]
    print(f"event {eid}: x {s['x'].shape} {s['x'].dtype}, y_vil {s['y_vil'].shape}, y_lght {s['y_lght'].shape}")
    for k, c in enumerate(CHANNELS):
        v = s["x"][:, k]
        print(f"  {c:6s} normalised range {v.min():7.2f} … {v.max():7.2f}")

    ev = load_event(eid)
    ch = event_channels(ev, eid)
    raw = ev["lght"]
    if len(raw):
        print(f"  lightning raw: t {raw[:, 0].min():.0f}…{raw[:, 0].max():.0f} s, "
              f"x {raw[:, 3].min():.1f}…{raw[:, 3].max():.1f}, y {raw[:, 4].min():.1f}…{raw[:, 4].max():.1f}")
    t = 24
    fig, ax = plt.subplots(1, 4, figsize=(16, 4.4))
    ax[0].imshow(ch["vil"][t], cmap="viridis", vmin=0, vmax=255); ax[0].set_title("VIL (pixel)")
    ax[1].imshow(ch["ir107"][t], cmap="Greys", vmin=-70, vmax=30); ax[1].set_title("IR 10.7 µm (°C)")
    ax[2].imshow(ch["ir069"][t], cmap="Greys", vmin=-70, vmax=0); ax[2].set_title("IR 6.9 µm (°C)")
    ax[3].imshow(ch["vil"][t], cmap="Greys", vmin=0, vmax=255)
    ly, lx = np.nonzero(ch["lght"][t] > 0.02)
    ax[3].scatter(lx, ly, s=1, c="gold", alpha=0.6); ax[3].set_title("VIL + lightning")
    for a in ax:
        a.set_xticks([]); a.set_yticks([])
    fig.suptitle(f"SEVIR {eid}, frame {t} (T+0) — channels on the 384×384 1 km grid")
    out = ROOT / "docs" / "m2_alignment.png"
    fig.tight_layout(); fig.savefig(out, dpi=90)
    print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    if ap.parse_args().check:
        check()
