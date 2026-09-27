"""Train the tier-aware U-Net on the 2 km cache (brief M5, 1 h horizon).

    python -m pipeline.train                    # defaults below
    python -m pipeline.train --epochs 2 --limit 40   # smoke test

Split: SEVIR train (< 2019-06-01) is divided by time: the last 15 % is validation
(early stopping, calibration, audience thresholds). Test events are never read here.
Writes store/models/unet_2km.pt and eval/results/train_log.json.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader, Dataset

from coverage.tiers import apply_tiers, sample_tiers
from pipeline.cache import cache_path
from pipeline.model_unet import TierUNet, n_params
from pipeline.settings import ROOT, cfg, path

N_IN, N_OUT = 13, 12
THR = np.array([16, 74, 133, 160, 181, 219]) / 255.0


def splits(selection: str = "selection.csv") -> dict[str, list[str]]:
    """train / val / test ids among cached events, from the selection files."""
    frames = []
    for name in (selection, "selection_dev.csv"):
        p = path("raw") / name
        if p.exists():
            frames.append(pd.read_csv(p, parse_dates=["time_utc"]))
    sel = pd.concat(frames).drop_duplicates("id")
    sel = sel[[cache_path(i).exists() for i in sel.id]].sort_values("time_utc")
    tr = sel[sel.split == "train"]
    cut = tr.time_utc.quantile(0.85)
    return {
        "train": list(tr[tr.time_utc < cut].id),
        "val": list(tr[tr.time_utc >= cut].id),
        "test": list(sel[sel.split == "test"].id),
    }


def make_input(x: np.ndarray, tiers, rng) -> tuple[np.ndarray, np.ndarray]:
    """x: (13, 4, H, W) float32 → (54, H, W) with coverage applied to the VIL channel."""
    vil, mask = apply_tiers(x[:, 0], tiers, rng)
    x = x.copy()
    x[:, 0] = vil
    tier_ch = mask  # 0 none, 0.5 partial, 1 full
    avail = (mask > 0).astype(np.float32)
    return np.concatenate([x.reshape(-1, *x.shape[-2:]), tier_ch[None], avail[None]]), mask


class WindowSet(Dataset):
    def __init__(self, ids: list[str], train: bool, seed: int = 0):
        self.ids, self.train, self.seed = ids, train, seed
        self.epoch = 0

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, i):
        rng = np.random.default_rng((self.seed, self.epoch, i) if self.train else (self.seed, i))
        a = int(rng.integers(0, 49 - N_IN - N_OUT + 1)) if self.train else 49 - N_IN - N_OUT - 12  # fixed start 12 for val
        arr = np.load(cache_path(self.ids[i]), mmap_mode="r")[a:a + N_IN + N_OUT].astype(np.float32)
        tiers = sample_tiers(rng)
        x, mask = make_input(arr[:N_IN], tiers, rng)
        return (torch.from_numpy(x), torch.from_numpy(arr[N_IN:, 0].copy()),
                torch.from_numpy(arr[N_IN:, 3].copy()), torch.from_numpy(mask[::1]))


def weights(y: torch.Tensor) -> torch.Tensor:
    """SEVIR-style intensity weights: rarer, stronger VIL counts more."""
    w = torch.ones_like(y)
    for t, k in zip(THR[1:], (2.0, 4.0, 6.0, 8.0, 10.0)):
        w = w + k * (y >= t)
    return w


def val_csi(model, loader, dev) -> tuple[float, float]:
    model.eval()
    h = m = f = np.zeros(len(THR))
    loss_sum, n = 0.0, 0
    with torch.no_grad():
        for x, yv, yl, _ in loader:
            x, yv = x.to(dev), yv.to(dev)
            pv, _ = model(x)
            loss_sum += float(((pv - yv) ** 2 * weights(yv)).mean()) * len(x); n += len(x)
            p, o = pv.cpu().numpy(), yv.cpu().numpy()
            h = h + np.array([((p >= t) & (o >= t)).sum() for t in THR])
            m = m + np.array([((p < t) & (o >= t)).sum() for t in THR])
            f = f + np.array([((p >= t) & (o < t)).sum() for t in THR])
    csi = h / np.maximum(h + m + f, 1)
    return float(csi.mean()), loss_sum / max(n, 1)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--patience", type=int, default=6)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--base", type=int, default=48)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)

    torch.manual_seed(cfg()["sevir"]["seed"])
    s = splits()
    tr, va = s["train"][: a.limit], s["val"][: (a.limit // 4 if a.limit else None)]
    print(f"train {len(tr)} events, val {len(va)} events (test {len(s['test'])} untouched)")
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = TierUNet(base=a.base).to(dev)
    print(f"TierUNet base={a.base}: {n_params(model) / 1e6:.2f} M params on {dev}")
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=a.epochs)
    trs, vas = WindowSet(tr, True), WindowSet(va, False)
    tl = DataLoader(trs, a.batch, shuffle=True, num_workers=a.workers, drop_last=True, persistent_workers=a.workers > 0)
    vl = DataLoader(vas, a.batch, num_workers=a.workers)

    out_dir = path("store") / "models"
    out_dir.mkdir(exist_ok=True)
    ckpt = out_dir / "unet_2km.pt"
    log = {"kind": "train_log", "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "n_train_events": len(tr), "n_val_events": len(va), "params_M": n_params(model) / 1e6,
           "resolution_km": 2, "horizon_min": N_OUT * 5, "epochs": []}
    best, bad = -1.0, 0
    for ep in range(a.epochs):
        trs.epoch = ep
        model.train()
        t0, tot, n = time.time(), 0.0, 0
        for x, yv, yl, _ in tl:
            x, yv, yl = x.to(dev, non_blocking=True), yv.to(dev), yl.to(dev)
            pv, pl = model(x)
            loss = ((pv - yv) ** 2 * weights(yv)).mean() + 0.1 * (pl - yl).abs().mean()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += float(loss.detach()) * len(x); n += len(x)
        sched.step()
        csi, vloss = val_csi(model, vl, dev)
        rec = {"epoch": ep + 1, "train_loss": tot / n, "val_loss": vloss, "val_mean_csi_2km": csi,
               "seconds": round(time.time() - t0, 1)}
        log["epochs"].append(rec)
        print(json.dumps(rec), flush=True)
        if csi > best:
            best, bad = csi, 0
            torch.save({"state": model.state_dict(), "base": a.base, "n_out": N_OUT, "epoch": ep + 1,
                        "val_mean_csi_2km": csi, "train_ids": tr, "val_ids": va}, ckpt)
        else:
            bad += 1
            if bad >= a.patience:
                print("early stop")
                break
        log["best_epoch"] = max(log["epochs"], key=lambda r: r["val_mean_csi_2km"])["epoch"]
        (path("results") / "train_log.json").write_text(json.dumps(log, indent=1))
    print(f"best val mean CSI (2 km, 1 h) {best:.3f} → {ckpt.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
