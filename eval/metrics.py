"""Verification metrics: CSI / POD / FAR / bias at thresholds, FSS, amplitude bias.

Scores are accumulated as contingency counts over all events and pixels, then
turned into ratios at the end (the SEVIR convention), not averaged per event.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import uniform_filter


def contingency(pred: np.ndarray, obs: np.ndarray, thr: float) -> tuple[int, int, int]:
    p, o = pred >= thr, obs >= thr
    return int((p & o).sum()), int((~p & o).sum()), int((p & ~o).sum())


def scores(hits: int, misses: int, fas: int) -> dict:
    nan = float("nan")
    return {
        "csi": hits / (hits + misses + fas) if hits + misses + fas else nan,
        "pod": hits / (hits + misses) if hits + misses else nan,
        "far": fas / (hits + fas) if hits + fas else nan,
        "bias": (hits + fas) / (hits + misses) if hits + misses else nan,
    }


def fss_parts(pred: np.ndarray, obs: np.ndarray, thr: float, scale: int) -> tuple[float, float]:
    """Numerator and reference sums for FSS (Roberts & Lean 2008) at one scale in pixels."""
    pf = uniform_filter((pred >= thr).astype(np.float32), size=scale, mode="constant")
    of = uniform_filter((obs >= thr).astype(np.float32), size=scale, mode="constant")
    return float(((pf - of) ** 2).sum()), float((pf ** 2).sum() + (of ** 2).sum())


def fss_from(num: float, den: float) -> float:
    return 1.0 - num / den if den > 0 else float("nan")


@dataclass
class Accumulator:
    """Accumulates scores per lead time for one forecast method."""
    thresholds: list[float]
    fss_thresholds: list[float]
    fss_scales: list[int]
    n_leads: int
    counts: np.ndarray = field(init=False)      # [lead, thr, (h, m, f)]
    fss: np.ndarray = field(init=False)         # [lead, thr, scale, (num, den)]
    amp: np.ndarray = field(init=False)         # [lead, (sum pred, sum obs)]

    def __post_init__(self):
        self.counts = np.zeros((self.n_leads, len(self.thresholds), 3), np.int64)
        self.fss = np.zeros((self.n_leads, len(self.fss_thresholds), len(self.fss_scales), 2))
        self.amp = np.zeros((self.n_leads, 2))

    def add(self, pred: np.ndarray, obs: np.ndarray, region: np.ndarray | None = None):
        """pred, obs: [lead, y, x] in the same units as the thresholds.

        With `region` (bool [y, x]) only contingency counts inside it are kept
        (per-tier scores); FSS and amplitude need the full field and are skipped.
        """
        for l in range(self.n_leads):
            p, o = pred[l], obs[l]
            valid = np.isfinite(p) & np.isfinite(o)
            p, o = np.where(valid, p, 0), np.where(valid, o, 0)
            if region is not None:
                for i, t in enumerate(self.thresholds):
                    self.counts[l, i] += contingency(p[region], o[region], t)
                continue
            for i, t in enumerate(self.thresholds):
                self.counts[l, i] += contingency(p, o, t)
            for i, t in enumerate(self.fss_thresholds):
                for j, s in enumerate(self.fss_scales):
                    self.fss[l, i, j] += fss_parts(p, o, t, s)
            self.amp[l] += (float(p.sum()), float(o.sum()))

    def summary(self, step_min: int) -> dict:
        out = {"lead_min": [(l + 1) * step_min for l in range(self.n_leads)], "by_threshold": {}, "fss": {}}
        for i, t in enumerate(self.thresholds):
            s = [scores(*self.counts[l, i]) for l in range(self.n_leads)]
            out["by_threshold"][str(t)] = {k: [x[k] for x in s] for k in ("csi", "pod", "far", "bias")}
        for i, t in enumerate(self.fss_thresholds):
            out["fss"][str(t)] = {
                f"{sc}km": [fss_from(*self.fss[l, i, j]) for l in range(self.n_leads)]
                for j, sc in enumerate(self.fss_scales)
            }
        out["amplitude_bias"] = [a / b if b else float("nan") for a, b in self.amp]
        # Mean CSI over thresholds per lead: the headline SEVIR summary.
        out["mean_csi"] = [float(np.nanmean([out["by_threshold"][str(t)]["csi"][l] for t in self.thresholds]))
                           for l in range(self.n_leads)]
        return out
