"""Storm cells, persistent IDs with merge/split lineage, arrival windows (brief M7).

TITAN-style (Dixon & Wiener 1993), adopted and extended for alert continuity:
cells are connected components of smoothed VIL ≥ threshold; the previous
frame's labels are advected with the pysteps motion field and matched by overlap.
  * one parent, one child        → ID continues
  * several parents, one child   → merge: the largest-overlap parent's ID continues,
                                   the others end and are listed in `parents`
  * one parent, several children → split: the largest child keeps the ID, the
                                   others start new IDs with that parent recorded
Keeping the dominant ID is the extension: an alert raised for a storm stays
attached to it through merges and splits.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from skimage.measure import label, regionprops

from pipeline.units import kgm2_to_vil, vil_to_kgm2

THRESH_KGM2 = 3.5          # ≈ SEVIR pixel 133
MIN_AREA_KM2 = 32
SMOOTH_PX = 2.0
MIN_OVERLAP = 0.1          # of the smaller cell


@dataclass
class Cell:
    id: int
    first: int
    last: int
    parents: list[int] = field(default_factory=list)
    children: list[int] = field(default_factory=list)
    track: list[dict] = field(default_factory=list)   # per frame: t, y, x, area, vil_max, label


def detect(vil_px: np.ndarray) -> np.ndarray:
    """Label image of cells (0 = background) from one VIL frame in pixel units."""
    lab = label(gaussian_filter(vil_px, SMOOTH_PX) >= float(kgm2_to_vil(np.array(THRESH_KGM2))), connectivity=2)
    for r in regionprops(lab):
        if r.area < MIN_AREA_KM2:
            lab[lab == r.label] = 0
    return lab


def advect_labels(lab: np.ndarray, velocity: np.ndarray) -> np.ndarray:
    """Move a label image one step along velocity (pixels/step, [2, H, W] = (u, v))."""
    H, W = lab.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    # Backward (semi-Lagrangian) lookup: where did this pixel come from?
    src = np.array([yy - velocity[1], xx - velocity[0]])
    return map_coordinates(lab, src, order=0, mode="constant", cval=0).astype(lab.dtype)


def track(vil: np.ndarray, velocity: np.ndarray | None = None) -> tuple[dict[int, Cell], list[np.ndarray]]:
    """vil: [T, H, W] pixel units. Returns cells by ID and per-frame ID images."""
    if velocity is None:
        from pipeline.baselines import _motion
        velocity = _motion(vil[: min(len(vil), 4)])
    cells: dict[int, Cell] = {}
    id_imgs: list[np.ndarray] = []
    next_id = 1
    prev_lab, prev_map = None, {}
    for t in range(len(vil)):
        lab = detect(vil[t])
        props = {r.label: r for r in regionprops(lab, intensity_image=vil[t])}
        idimg = np.zeros_like(lab)
        cur_map: dict[int, int] = {}
        # overlaps[k] = {parent id: overlapping pixels}
        overlaps: dict[int, dict[int, int]] = {k: {} for k in props}
        if prev_lab is not None:
            adv = advect_labels(prev_lab, velocity)
            for k, r in props.items():
                under = adv[lab == k]
                for pl, n in zip(*np.unique(under[under > 0], return_counts=True)):
                    parea = (prev_lab == pl).sum()
                    if n / min(r.area, parea) >= MIN_OVERLAP:
                        overlaps[k][prev_map[int(pl)]] = int(n)
        # For each parent, the child with the largest overlap inherits its ID.
        heir: dict[int, int] = {}
        for k, ov in overlaps.items():
            for p, n in ov.items():
                if p not in heir or n > overlaps[heir[p]][p]:
                    heir[p] = k
        for k, r in props.items():
            ov = overlaps[k]
            main = max(ov, key=ov.get) if ov else None
            if main is not None and heir.get(main) == k:
                cid = main
                for p in ov:                      # merged-in cells end here
                    if p != main and p not in cells[cid].parents:
                        cells[cid].parents.append(p)
                        cells[p].children.append(cid)
            else:
                cid, next_id = next_id, next_id + 1
                cells[cid] = Cell(cid, t, t, parents=sorted(ov))
                for p in ov:
                    cells[p].children.append(cid)
            c = cells[cid]
            c.last = t
            y, x = r.centroid
            c.track.append({"t": t, "y": float(y), "x": float(x), "area": int(r.area),
                            "vil_max_kgm2": float(vil_to_kgm2(np.array(r.intensity_max)))})
            cur_map[k] = cid
            idimg[lab == k] = cid
        id_imgs.append(idimg)
        prev_lab, prev_map = lab, cur_map
    return cells, id_imgs


def cell_velocity(c: Cell, steps: int = 3) -> tuple[float, float]:
    """Centroid displacement per frame over the last few frames (pixels / 5 min)."""
    tr = c.track[-(steps + 1):]
    if len(tr) < 2:
        return 0.0, 0.0
    dt = tr[-1]["t"] - tr[0]["t"]
    return (tr[-1]["x"] - tr[0]["x"]) / dt, (tr[-1]["y"] - tr[0]["y"]) / dt


def arrival_window(c: Cell, point_yx: tuple[float, float], horizon_frames: int = 36,
                   n: int = 200, seed: int = 0, velocity: tuple[float, float] | None = None) -> dict | None:
    """Ensemble of perturbed motions (speed ±15 %, direction ±10°) → arrival window at a point."""
    rng = np.random.default_rng(seed)
    last = c.track[-1]
    u, v = velocity if velocity is not None else cell_velocity(c)
    radius = np.sqrt(last["area"] / np.pi) + 2.0
    sp = np.hypot(u, v)
    ang = np.arctan2(v, u) + np.deg2rad(rng.normal(0, 10, n))
    spd = sp * rng.normal(1.0, 0.15, n)
    t = np.arange(0, horizon_frames + 1)[None, :]
    y = last["y"] + np.sin(ang)[:, None] * spd[:, None] * t
    x = last["x"] + np.cos(ang)[:, None] * spd[:, None] * t
    inside = np.hypot(y - point_yx[0], x - point_yx[1]) <= radius
    hit = inside.any(axis=1)
    if not hit.any():
        return None
    first = np.argmax(inside, axis=1)[hit] * 5
    return {"p": float(hit.mean()), "start_min": int(np.percentile(first, 10)),
            "end_min": int(np.percentile(first, 90)), "median_min": int(np.median(first))}


def lineage_image(cells: dict[int, Cell], out_path, title: str = ""):
    """Time-vs-ID lineage tree (brief M7 acceptance)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fam = {cid for cid, c in cells.items() if c.parents or c.children}
    show = sorted(fam | {p for c in fam for p in cells[c].parents} | {k for c in fam for k in cells[c].children})
    if not show:
        show = sorted(cells, key=lambda k: -(cells[k].last - cells[k].first))[:8]
    row = {cid: i for i, cid in enumerate(show)}
    fig, ax = plt.subplots(figsize=(10, 0.4 * len(show) + 1.5))
    for cid in show:
        c = cells[cid]
        ax.plot([c.first * 5, c.last * 5 + 2], [row[cid]] * 2, lw=4, solid_capstyle="round", color="#3987e5")
        ax.text(c.last * 5 + 5, row[cid], str(cid), va="center", fontsize=8)
        for p in c.parents:
            if p not in row:
                continue
            pc = cells[p]
            # Split: the child starts while the parent lives on. Merge: the parent ends into a living cell.
            t_link = c.first - 1 if pc.first < c.first <= pc.last + 1 else pc.last
            ax.plot([t_link * 5, (t_link + 1) * 5], [row[p], row[cid]], color="#d95926", lw=1.4)
    ax.set_yticks([]); ax.set_xlabel("minutes from event start")
    ax.set_title(title or "Storm lineage (orange = merge/split links)")
    fig.tight_layout(); fig.savefig(out_path, dpi=90); plt.close(fig)


def match_error(x_in: np.ndarray, obs: np.ndarray, fcst: np.ndarray,
                velocity: np.ndarray | None = None,
                min_area_km2: float = MIN_AREA_KM2) -> dict:
    """Per-lead centroid error for the cells alive when the forecast was made.

    `x_in` is the observed input the forecast came from, `obs` what followed and
    `fcst` what was forecast, all in pixel units and all on the same grid. Both
    sequences are tracked with the input frames in front and the same motion
    field, so a cell ID at the analysis frame is the same storm in both: new IDs
    allocated after that frame are larger than every ID present at it, so they
    cannot collide. A cell the forecast has dropped is left out of `errors` and
    counted in `alive` only, so losing a storm cannot improve the error.

    Returns `errors` (one list of (cell id, error in pixels, forecast-to-observed
    area ratio) per lead) and `alive` (observed cells still tracked at that lead).
    The area ratio is what keeps the error readable: a smooth forecast merges
    neighbouring cells, the merged blob inherits the ID under the merge rule above,
    and its centroid sits between the cells it swallowed — so a large error with a
    large area ratio is a merge, not a displacement.
    """
    if velocity is None:
        from pipeline.baselines import _motion
        velocity = _motion(x_in[: min(len(x_in), 4)])
    pos = lambda cells: {cid: {p["t"]: p for p in c.track} for cid, c in cells.items()}
    o = pos(track(np.concatenate([x_in, obs]), velocity)[0])
    f = pos(track(np.concatenate([x_in, fcst]), velocity)[0])
    a = len(x_in) - 1
    ids = [cid for cid, p in o.items() if a in p and p[a]["area"] >= min_area_km2]
    errors: list[list[tuple[int, float, float]]] = []
    alive: list[int] = []
    for i in range(len(fcst)):
        t, row, n = a + 1 + i, [], 0
        for cid in ids:
            seen = o[cid].get(t)
            if seen is None:                     # the storm itself is gone
                continue
            n += 1
            got = f.get(cid, {}).get(t)
            if got is not None:
                row.append((cid, float(np.hypot(got["y"] - seen["y"], got["x"] - seen["x"])),
                            float(got["area"]) / max(float(seen["area"]), 1.0)))
        errors.append(row)
        alive.append(n)
    return {"errors": errors, "alive": alive, "analysis_cells": ids}
