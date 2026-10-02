"""Re-colour the VIL rasters of built packages onto the heat ramp.

`build_replay` wrote them as a white alpha ramp, where a severe core and a weak
echo differ only in how grey they are. The value is recoverable exactly — alpha
was (value normalised) ** 0.75 — so the rasters can be re-coloured in place
without re-running the model:

    python -m export.recolour --all

Touches `hazards/<a>/<mode>/vil_*.png` and `obs/<frame>.png`, which are the two
places `write_png(..., "vil", ...)` writes. The satellite and lightning rasters
keep their single hue and are left alone.
"""
from __future__ import annotations

import argparse
import json

import numpy as np

from export.build_replay import ramp_rgb
from pipeline.settings import ROOT, path

# Every encoding this script has written, so alpha can be inverted back to a value
# whichever one is on disk. `white` is the original single-hue ramp.
ENCODINGS = {
    "white": lambda a: a ** (1.0 / 0.75),
    "heat-v1": lambda a: np.clip((a - 0.35) / 0.65, 0.0, 1.0) ** (1.0 / 0.7),
    "heat": lambda a: np.clip((a - 0.10) / 0.90, 0.0, 1.0) ** (1.0 / 0.85),
    "heat-v2": lambda a: np.clip((a - 0.12) / 0.88, 0.0, 1.0) ** (1.0 / 0.6),
}


def recolour(png, src: str) -> None:
    from PIL import Image

    img = np.array(Image.open(png).convert("RGBA"))
    a = img[..., 3].astype(np.float32) / 255.0
    n = np.where(a > 0, ENCODINGS[src](a), 0.0).astype(np.float32)
    out = np.empty_like(img)
    out[..., :3] = ramp_rgb(n ** 0.55)
    out[..., 3] = (np.where(n > 0, 0.12 + 0.88 * n ** 0.6, 0.0) * 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(png, optimize=True)


def build(pkg: str, src: str = "white", out_root=None) -> int:
    out = (out_root or path("replay")) / pkg
    if not (out / "meta.json").exists():
        raise SystemExit(f"no replay package at {out}")
    files = sorted(out.glob("hazards/*/*/vil_*.png"))
    files += [p for p in sorted(out.glob("obs/*.png")) if p.stem.isdigit()]
    for f in files:
        recolour(f, src)
    print(f"{pkg}: re-coloured {len(files)} rasters")
    return len(files)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--from", dest="src", choices=sorted(ENCODINGS), default="white",
                    help="the encoding currently on disk")
    a = ap.parse_args(argv)
    ids = list(a.event)
    if a.all or not ids:
        idx = path("replay") / "index.json"
        ids = [e["id"] for e in json.loads(idx.read_text())["events"]] if idx.exists() else ids
    for pkg in ids:
        build(pkg, a.src)


if __name__ == "__main__":
    main()
