"""SEVIR unit conversions. One place, so metrics and tracking agree."""
from __future__ import annotations

import numpy as np


def vil_to_kgm2(x: np.ndarray) -> np.ndarray:
    """SEVIR VIL pixel value (0-255) → kg/m² (SEVIR data documentation).

    0-5 → 0; 6-17 linear; 18-254 exponential; 255 is 'no data' and maps to 0.
    """
    x = np.asarray(x, dtype=np.float32)
    out = np.zeros_like(x)
    lin = (x > 5) & (x <= 17)
    exp = (x > 17) & (x < 255)
    out[lin] = (x[lin] - 2.0) / 90.66
    out[exp] = np.exp((x[exp] - 83.9) / 38.9)
    return out


def kgm2_to_vil(v: np.ndarray) -> np.ndarray:
    """Inverse of vil_to_kgm2 (continuous), for thresholds stated in kg/m²."""
    v = np.asarray(v, dtype=np.float32)
    lin_top = (17 - 2.0) / 90.66
    return np.where(v <= 0, 0.0,
                    np.where(v <= lin_top, v * 90.66 + 2.0, 38.9 * np.log(np.maximum(v, 1e-9)) + 83.9))
