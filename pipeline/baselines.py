"""Reference nowcasts the ML model has to beat.

All work on SEVIR VIL pixel values (0-255). SEVIR's pixel scale is already
logarithmic in kg/m² (x = 38.9·ln(VIL) + 83.9), so S-PROG's usual log/dB
transform is effectively built in; values below the lowest threshold (16) are
treated as no precipitation.
"""
from __future__ import annotations

import warnings

import numpy as np
from pysteps import motion, nowcasts

NO_RAIN = 16.0


def persistence(frames: np.ndarray, n_leads: int) -> np.ndarray:
    """Last observed frame, repeated."""
    return np.repeat(frames[-1:], n_leads, axis=0)


def _motion(frames: np.ndarray) -> np.ndarray:
    lk = motion.get_method("LK")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return lk(np.where(frames >= NO_RAIN, frames, 0.0)[-4:])


def optical_flow(frames: np.ndarray, n_leads: int, velocity: np.ndarray | None = None) -> np.ndarray:
    """Lucas-Kanade motion + semi-Lagrangian advection of the last frame."""
    v = _motion(frames) if velocity is None else velocity
    extrap = nowcasts.get_method("extrapolation")
    out = extrap(frames[-1], v, n_leads)
    return np.nan_to_num(out, nan=0.0)


class SprogFallback(Exception):
    """S-PROG could not run (near-empty field); caller substitutes optical flow and counts it."""


def sprog(frames: np.ndarray, n_leads: int, velocity: np.ndarray | None = None) -> np.ndarray:
    """S-PROG (Seed 2003): scale-dependent AR(2) evolution of an advected cascade."""
    v = _motion(frames) if velocity is None else velocity
    f = nowcasts.get_method("sprog")
    x = np.where(frames >= NO_RAIN, frames, NO_RAIN - 1)[-3:]
    # Its AR(2) autocorrelations are undefined on (near-)empty fields.
    if (x >= NO_RAIN).mean() < 1e-3:
        raise SprogFallback("rain fraction < 0.1%")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            out = f(x, v, n_leads, precip_thr=NO_RAIN, n_cascade_levels=6, ar_order=2,
                    probmatching_method="cdf", norain_thr=0.0)
        except ValueError as e:
            raise SprogFallback(str(e)) from e
    out = np.nan_to_num(out, nan=0.0)
    return np.where(out >= NO_RAIN, out, 0.0)


def run_all(frames: np.ndarray, n_leads: int) -> dict[str, np.ndarray]:
    v = _motion(frames)
    return {
        "persistence": persistence(frames, n_leads),
        "optical_flow": optical_flow(frames, n_leads, v),
        "sprog": _sprog_or_flow(frames, n_leads, v),
    }


def _sprog_or_flow(frames, n_leads, v):
    try:
        return sprog(frames, n_leads, v)
    except SprogFallback:
        return optical_flow(frames, n_leads, v)
