"""Pre-computed 2 km training tensors, one .npy per event (memory-mappable).

The local GPU (GTX 1050 Ti, 4 GB) trains at 2 km (192×192), the brief's
compute fallback and inside the 1–3 km requirement. Channels, float16:
    0 VIL   pixel value / 255, 2×2 mean of the 1 km field
    1 IR069 normalised (native 2 km)
    2 IR107 normalised (native 2 km)
    3 lightning  log1p(flashes per 2 km pixel per 5 min), Gaussian σ = 1 px

    python -m pipeline.cache            # cache every downloaded event (resumable)
    python -m pipeline.cache --watch    # keep caching while a download runs
"""
from __future__ import annotations

import argparse
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from pipeline.preprocess import IR_SCALE, grid_lightning, normalise, vil_frames
from pipeline.settings import path

SIZE = 192


CACHE_VERSION = "v2"  # v2: lightning placed from flash lat/lon


def cache_path(eid: str):
    return path("store") / "cache" / f"2km_{CACHE_VERSION}" / f"{eid}.npy"


def build(eid: str) -> str:
    out = cache_path(eid)
    if out.exists():
        return "skip"
    out.parent.mkdir(parents=True, exist_ok=True)
    with np.load(path("events") / f"{eid}.npz") as z:
        ev = {k: z[k] for k in z.files}
    vil = vil_frames(ev["vil"]).reshape(49, SIZE, 2, SIZE, 2).mean(axis=(2, 4))
    ir069 = np.moveaxis(ev["ir069"].astype(np.float32) * IR_SCALE, -1, 0)
    ir107 = np.moveaxis(ev["ir107"].astype(np.float32) * IR_SCALE, -1, 0)
    lg = grid_lightning(ev["lght"], size=SIZE, sigma_px=1.0, event_id=eid)
    x = np.stack([normalise("vil", vil), normalise("ir069", ir069), normalise("ir107", ir107),
                  normalise("lght", lg)], axis=1).astype(np.float16)
    tmp = out.with_suffix(".tmp.npy")
    np.save(tmp, x)
    tmp.rename(out)
    return "ok"


def pending() -> list[str]:
    return sorted(p.stem for p in path("events").glob("*.npz")
                  if not p.name.endswith(".tmp.npz") and not cache_path(p.stem).exists())


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    while True:
        todo = pending()
        if todo:
            with ProcessPoolExecutor(a.workers) as ex:
                list(ex.map(build, todo))
            print(f"cached {len(todo)} event(s); total {len(list(cache_path('x').parent.glob('*.npy')))}", flush=True)
        if not a.watch:
            break
        time.sleep(60)


if __name__ == "__main__":
    main()
