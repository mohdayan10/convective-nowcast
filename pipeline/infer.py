"""Run the trained U-Net on one event window (brief M5 inference).

Returns fields on the 1 km (384) grid: ensemble-mean VIL in pixel units, the
per-pixel exceedance probability for each verification threshold (MC-dropout,
10 members) and lightning density (flashes per km² per 5 min).
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import torch
import torch.nn.functional as F

from coverage.tiers import TierSample
from pipeline.cache import cache_path
from pipeline.model_unet import TierUNet, mc_dropout
from pipeline.settings import path
from pipeline.train import N_IN, N_OUT, make_input

DEV = "cuda" if torch.cuda.is_available() else "cpu"


@lru_cache(maxsize=1)
def load_model(name: str = "unet_2km.pt") -> tuple[TierUNet, dict]:
    ck = torch.load(path("store") / "models" / name, map_location=DEV, weights_only=False)
    m = TierUNet(base=ck["base"], n_out=ck["n_out"]).to(DEV)
    m.load_state_dict(ck["state"])
    m.eval()
    return m, {k: v for k, v in ck.items() if k != "state"}


def downsample_tiers(ts: TierSample) -> TierSample:
    return TierSample(ts.tier[::2, ::2], ts.beam_km[::2, ::2], ts.source)


def predict(event_id: str, start: int, ts: TierSample, rng: np.random.Generator,
            n_members: int = 10, thresholds=(16, 74, 133, 160, 181, 219),
            drop_lightning: bool = False) -> dict:
    """`ts` carries the radar coverage the model is allowed to see, so an all-tier-0
    sample gives a genuine radar-denied forecast through the modality-dropout path
    the model was trained on. `drop_lightning` additionally blanks the lightning
    channel, leaving satellite only. Lightning normalises to itself (NORM["lght"]
    is (0, 1)), so "no flashes" is exactly 0."""
    model, _ = load_model()
    arr = np.load(cache_path(event_id), mmap_mode="r")[start:start + N_IN].astype(np.float32)
    if drop_lightning:
        arr = arr.copy()
        arr[:, 3] = 0.0
    x, _ = make_input(arr, downsample_tiers(ts), rng)
    xt = torch.from_numpy(x)[None].to(DEV)
    # The dropout masks come from torch's global generator, so without this the same
    # call twice gives two different ensembles — on the track-error metric that was a
    # 3 km spread between runs. Seeding it from the caller's generator makes every
    # evaluation and every exported package reproducible from its event id.
    torch.manual_seed(int(rng.integers(2 ** 63)))
    vil, lg = mc_dropout(model, xt, n_members)            # [n, 1, 12, 192, 192]
    vil = F.interpolate(vil[:, 0] * 255.0, scale_factor=2, mode="bilinear", align_corners=False)
    lg = F.interpolate(torch.expm1(lg[:, 0]).clamp(min=0) / 4.0, scale_factor=2, mode="bilinear", align_corners=False)
    prob = torch.stack([(vil >= t).float().mean(0) for t in thresholds])  # [thr, 12, H, W]
    return {
        "vil": vil.mean(0).cpu().numpy(),
        "vil_members": vil.cpu().numpy().astype(np.float16),
        "prob": prob.cpu().numpy(),
        "lightning": lg.mean(0).cpu().numpy(),
        "thresholds": list(thresholds),
        "n_out": N_OUT,
    }
