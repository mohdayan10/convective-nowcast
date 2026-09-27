"""Load config.yaml once; resolve paths against the repo root."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def cfg() -> dict:
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def path(key: str) -> Path:
    p = ROOT / cfg()["paths"][key]
    p.mkdir(parents=True, exist_ok=True)
    return p
