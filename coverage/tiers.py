"""Radar coverage tiers and how they are applied to SEVIR samples (brief M4).

Tier per pixel:  2 = full, 1 = partial, 0 = none.

Source of tier patches:
  * `store/coverage/tier_grid_base.npz` from M1 (overlap_check.py on the real
    IMD network) when it exists — patches are cut from it, weighted toward the
    Himalaya.
  * Until then: SIMULATED radar networks. Radars are placed at random around
    the 384 km tile; each pixel's tier follows the lowest beam height over it
    (0.5° elevation, 4/3-Earth refraction) plus random terrain-blocked sectors.
    Every output that uses these is badged SIMULATED.

Application (brief M4):
  tier 0 → VIL = 0, radar mask = 0
  tier 1 → VIL × factor(beam height) + noise   (an approximation, badged ASSUMED)
  tier 2 → unchanged
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from pipeline.settings import ROOT

RE_EFF_KM = 6371.0 * 4 / 3
ELEV_RAD = np.deg2rad(0.5)
FULL_MAX_KM = 2.0      # beam below 2 km AGL: sees the storm's lower levels
PARTIAL_MAX_KM = 5.0   # 2–5 km: overshoots low cores, sees only the upper part
MAX_RANGE_KM = 250.0

TIER_GRID = ROOT / "store" / "coverage" / "tier_grid_base.npz"


def beam_height_km(r_km: np.ndarray) -> np.ndarray:
    return r_km * np.sin(ELEV_RAD) + r_km ** 2 / (2 * RE_EFF_KM)


@dataclass
class TierSample:
    tier: np.ndarray        # (H, W) uint8 in {0, 1, 2}
    beam_km: np.ndarray     # (H, W) lowest beam height, inf where uncovered
    source: str             # "simulated" | "m1-grid" | "rect" | "none"


def simulated_network(rng: np.random.Generator, size: int = 384) -> TierSample:
    """0–3 radars within ~200 km of the tile; tiers from beam height; blocked sectors."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    beam = np.full((size, size), np.inf, np.float32)
    n = rng.choice([0, 1, 1, 2, 2, 3], p=[0.1, 0.25, 0.2, 0.2, 0.15, 0.1])
    for _ in range(n):
        cx, cy = rng.uniform(-150, size + 150, 2)
        r = np.hypot(xx - cx, yy - cy)
        h = np.where(r <= MAX_RANGE_KM, beam_height_km(r), np.inf)
        # Terrain blockage: up to 3 azimuth sectors where the beam is raised or lost.
        az = np.arctan2(yy - cy, xx - cx)
        for _ in range(rng.integers(0, 4)):
            a0, w = rng.uniform(-np.pi, np.pi), rng.uniform(0.15, 0.7)
            d = np.angle(np.exp(1j * (az - a0)))
            blocked = np.abs(d) < w / 2
            h = np.where(blocked, np.where(rng.random() < 0.5, np.inf, h + rng.uniform(1.5, 4)), h)
        beam = np.minimum(beam, h)
    tier = np.where(beam <= FULL_MAX_KM, 2, np.where(beam <= PARTIAL_MAX_KM, 1, 0)).astype(np.uint8)
    return TierSample(tier, beam, "simulated")


def random_rect(rng: np.random.Generator, size: int = 384) -> TierSample:
    """Robustness masks: 1–3 random rectangles without radar."""
    tier = np.full((size, size), 2, np.uint8)
    for _ in range(rng.integers(1, 4)):
        h, w = rng.integers(size // 6, size // 1.5, 2)
        y, x = rng.integers(0, size - h), rng.integers(0, size - w)
        tier[y:y + h, x:x + w] = 0
    beam = np.where(tier == 2, 1.0, np.inf).astype(np.float32)
    return TierSample(tier, beam, "rect")


def from_m1_grid(rng: np.random.Generator, size: int = 384) -> TierSample | None:
    if not TIER_GRID.exists():
        return None
    z = np.load(TIER_GRID)
    grid, beam_g = z["tier"], z["beam_km"] if "beam_km" in z.files else None
    H, W = grid.shape
    # Weight patch centres toward rows with more tier-0/1 (the Himalaya in the India grid).
    row_w = (grid < 2).mean(axis=1) + 0.05
    cy = rng.choice(np.arange(size // 2, H - size // 2), p=(row_w[size // 2:H - size // 2] / row_w[size // 2:H - size // 2].sum()))
    cx = rng.integers(size // 2, W - size // 2)
    sl = np.s_[cy - size // 2: cy + size // 2, cx - size // 2: cx + size // 2]
    beam = beam_g[sl] if beam_g is not None else np.where(grid[sl] == 2, 1.0, np.where(grid[sl] == 1, 3.5, np.inf))
    return TierSample(grid[sl].astype(np.uint8), beam.astype(np.float32), "m1-grid")


def sample_tiers(rng: np.random.Generator, size: int = 384) -> TierSample:
    """Brief M4 mix: 20% random rectangles, 20% no mask, 60% coverage patches."""
    u = rng.random()
    if u < 0.2:
        return random_rect(rng, size)
    if u < 0.4:
        return TierSample(np.full((size, size), 2, np.uint8), np.ones((size, size), np.float32), "none")
    return from_m1_grid(rng, size) or simulated_network(rng, size)


def partial_factor(beam_km: np.ndarray) -> np.ndarray:
    """ASSUMED: fraction of column VIL a raised beam still sees (1 at 2 km → 0.3 at 5 km)."""
    return np.clip(1.0 - 0.7 * (beam_km - FULL_MAX_KM) / (PARTIAL_MAX_KM - FULL_MAX_KM), 0.3, 1.0)


def apply_tiers(vil: np.ndarray, ts: TierSample, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """vil: (T, H, W) any units ≥ 0. Returns (masked vil, radar mask (H, W) in {0, 0.5, 1})."""
    tier = ts.tier
    if tier.shape != vil.shape[-2:]:
        f = tier.shape[0] // vil.shape[-1]
        tier = tier[::f, ::f]
        beam = ts.beam_km[::f, ::f]
    else:
        beam = ts.beam_km
    out = vil.copy()
    part = tier == 1
    if part.any():
        fac = partial_factor(np.where(part, beam, FULL_MAX_KM))
        noise = rng.normal(1.0, 0.15, size=vil.shape).astype(vil.dtype)
        out = np.where(part, out * fac * noise, out)
    out = np.where(tier == 0, 0, out)
    mask = np.where(tier == 2, 1.0, np.where(tier == 1, 0.5, 0.0)).astype(np.float32)
    return np.clip(out, 0, None).astype(vil.dtype), mask
