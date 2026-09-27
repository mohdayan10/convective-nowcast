"""Turn a raw SEVIR event into aligned model channels on the 384×384 1 km grid.

Raw event (.npz from data.download_sevir):
    vil   (384, 384, 49) uint8   SEVIR VIL pixel value 0-255
    ir069 (192, 192, 49) int16   6.9 µm (water vapour) brightness temperature, °C × 100
    ir107 (192, 192, 49) int16   10.7 µm (clean IR) brightness temperature, °C × 100
    lght  (N, 5) float32         GLM flashes: [t_sec rel. to event time, lat, lon, x, y]
                                 x, y on SEVIR's 48×48 (8 km) lightning grid

Outputs are float32 (frame, y, x) arrays. Normalisation constants are fixed
here so training and inference can never disagree.
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter, zoom

from pipeline.settings import cfg

IR_SCALE = 0.01                   # stored °C × 100
FRAME_SEC = np.arange(-120, 125, 5) * 60.0

# Normalisation: VIL pixel /255; IR in °C mapped roughly to [-1, 1]; lightning log1p.
NORM = {
    "vil": (0.0, 255.0),
    "ir069": (-30.0, 40.0),       # (centre, half-range) in °C
    "ir107": (-10.0, 60.0),
    "lght": (0.0, 1.0),
}


def ir_celsius(raw: np.ndarray) -> np.ndarray:
    """(192, 192, 49) int16 → (49, 384, 384) float32 °C, bilinear upsample (for fusion only)."""
    c = raw.astype(np.float32) * IR_SCALE
    c = np.moveaxis(c, -1, 0)
    return zoom(c, (1, 2, 2), order=1)


def grid_lightning(flashes: np.ndarray, size: int = 384, sigma_px: float | None = None,
                   event_id: str | None = None) -> np.ndarray:
    """Flash points → flashes per pixel per 5 min, (49, size, size), Gaussian-smoothed in space.

    With `event_id`, each flash's own lat/lon is projected onto the event grid (exact).
    Without it, SEVIR's integer 8 km cell index is used: measured on real events, a
    flash in cell i lies 4–12 km past 8·i, so its centre is 8·i + 8 km.
    Rows count from the south edge, like the SEVIR image arrays.
    Frame k counts flashes in (FRAME_SEC[k-1], FRAME_SEC[k]]; frame 0 takes the first bin.
    """
    sigma_px = cfg()["grid"]["lightning_sigma_px"] if sigma_px is None else sigma_px
    out = np.zeros((len(FRAME_SEC), size, size), np.float32)
    if len(flashes) == 0:
        return out
    km = size_km = 384.0
    if event_id is not None:
        from pipeline.meta import projector
        xk, yk = projector(event_id)[0](flashes[:, 2], flashes[:, 1])
    else:
        xk, yk = flashes[:, 3] * 8 + 8, flashes[:, 4] * 8 + 8
    t, x, y = flashes[:, 0], xk * size / km, yk * size / size_km
    m = (x >= 0) & (x < size) & (y >= 0) & (y < size) & (t > FRAME_SEC[0] - 300) & (t <= FRAME_SEC[-1])
    t, x, y = t[m], x[m].astype(int), y[m].astype(int)
    k = np.clip(np.searchsorted(FRAME_SEC, t, side="left"), 0, len(FRAME_SEC) - 1)
    np.add.at(out, (k, y, x), 1.0)
    if sigma_px > 0:
        out = gaussian_filter(out, sigma=(0, sigma_px, sigma_px))
    return out


def vil_frames(raw: np.ndarray) -> np.ndarray:
    """(384, 384, 49) uint8 → (49, 384, 384) float32 pixel values, 255 (missing) → 0."""
    v = np.moveaxis(raw, -1, 0).astype(np.float32)
    v[v >= 255] = 0
    return v


def normalise(name: str, x: np.ndarray) -> np.ndarray:
    if name == "lght":
        return np.log1p(x)
    c, h = NORM[name]
    return (x - c) / h


def event_channels(ev: dict, event_id: str | None = None) -> dict[str, np.ndarray]:
    """All four channels in physical units, (49, 384, 384) each."""
    return {
        "vil": vil_frames(ev["vil"]),
        "ir069": ir_celsius(ev["ir069"]),
        "ir107": ir_celsius(ev["ir107"]),
        "lght": grid_lightning(ev["lght"], event_id=event_id),
    }
