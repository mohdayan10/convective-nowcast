"""Download a SEVIR subset: VIL, IR 6.9 µm, IR 10.7 µm and GLM lightning per event.

SEVIR's VIL/IR files are 4–16 GB each, but each image type is stored as one
contiguous, uncompressed array (event, y, x, frame). So an event is a single
byte range: we read each file's dataset offset once (cached), then fetch only
the events we need with HTTP range requests. Lightning is a per-event dataset
inside monthly files; we read those datasets the same way.

    python -m data.download_sevir --dev          # small subset for development
    python -m data.download_sevir                # full subset (config: n_train/n_test)
    python -m data.download_sevir --list-only    # write the selection, fetch nothing
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import fsspec
import h5py
import numpy as np
import pandas as pd
import requests

from pipeline.settings import cfg, path

TYPES = ("vil", "ir069", "ir107", "lght")
SHAPES = {"vil": (384, 384, 49), "ir069": (192, 192, 49), "ir107": (192, 192, 49)}
DTYPES = {"vil": np.uint8, "ir069": np.int16, "ir107": np.int16}


# ---- selection ---------------------------------------------------------------

def load_catalog() -> pd.DataFrame:
    p = path("raw") / "CATALOG.csv"
    if not p.exists():
        print("downloading CATALOG.csv …")
        r = requests.get(cfg()["sevir"]["catalog_url"], timeout=600)
        r.raise_for_status()
        p.write_bytes(r.content)
    return pd.read_csv(p, parse_dates=["time_utc"], low_memory=False)


def select_events(cat: pd.DataFrame, n_train: int, n_test: int) -> pd.DataFrame:
    """Events that have all four image types, split by date, severe types oversampled."""
    s = cfg()["sevir"]
    have = cat[cat.img_type.isin(TYPES)].groupby("id").img_type.nunique()
    ids = have[have == len(TYPES)].index
    vil = cat[(cat.img_type == "vil") & cat.id.isin(ids)].drop_duplicates("id").copy()
    vil["split"] = np.where(vil.time_utc < pd.Timestamp(s["split_date"]), "train", "test")
    vil["severe"] = vil.event_type.isin(s["severe_types"])
    rng = np.random.default_rng(s["seed"])
    out = []
    for split, n in (("train", n_train), ("test", n_test)):
        pool = vil[vil.split == split]
        w = np.where(pool.severe, s["severe_weight"], 1.0)
        pick = rng.choice(len(pool), size=min(n, len(pool)), replace=False, p=w / w.sum())
        out.append(pool.iloc[np.sort(pick)])
    sel = pd.concat(out)
    # One row per event with the file + index of every image type.
    wide = cat[cat.id.isin(sel.id) & cat.img_type.isin(TYPES)].pivot_table(
        index="id", columns="img_type", values=["file_name", "file_index"], aggfunc="first")
    wide.columns = [f"{t}_{'file' if v == 'file_name' else 'index'}" for v, t in wide.columns]
    keep = ["id", "time_utc", "split", "severe", "event_type", "episode_id", "event_id",
            "llcrnrlat", "llcrnrlon", "urcrnrlat", "urcrnrlon", "proj"]
    return sel[keep].merge(wide.reset_index(), on="id").sort_values(["split", "time_utc"])


# ---- remote HDF5 offsets --------------------------------------------------------

def _remote(fname: str):
    fs = fsspec.filesystem("https", block_size=256 * 1024)
    return fs.open(cfg()["sevir"]["base_url"] + fname, "rb")


def dataset_offset(fname: str, key: str) -> dict:
    """Byte offset/shape of a contiguous dataset in a remote SEVIR file (cached)."""
    cache = path("h5index") / (fname.replace("/", "__") + f"__{key}.json")
    if cache.exists():
        return json.loads(cache.read_text())
    with _remote(fname) as fh, h5py.File(fh, "r") as h:
        d = h[key]
        info = {"offset": int(d.id.get_offset()), "shape": list(d.shape), "dtype": d.dtype.str}
    cache.write_text(json.dumps(info))
    return info


def lightning_offsets(fname: str, ids: list[str]) -> dict:
    """Per-event lightning dataset offsets within one monthly file (cached, incremental)."""
    cache = path("h5index") / (fname.replace("/", "__") + "__lght.json")
    known = json.loads(cache.read_text()) if cache.exists() else {}
    todo = [i for i in ids if i not in known]
    if todo:
        with _remote(fname) as fh, h5py.File(fh, "r") as h:
            for i in todo:
                d = h[i]
                off = d.id.get_offset()
                known[i] = {"offset": None if off is None else int(off), "shape": list(d.shape)}
        cache.write_text(json.dumps(known))
    return known


def range_get(fname: str, start: int, n: int, session: requests.Session) -> bytes:
    url = cfg()["sevir"]["base_url"] + fname
    for attempt in range(5):
        try:
            r = session.get(url, headers={"Range": f"bytes={start}-{start + n - 1}"}, timeout=300)
            r.raise_for_status()
            if len(r.content) == n:
                return r.content
        except requests.RequestException:
            pass
        time.sleep(2 * (attempt + 1))
    raise IOError(f"range read failed: {fname} @{start}+{n}")


# ---- fetching -------------------------------------------------------------------

def fetch_event(row: pd.Series, lght_index: dict, out_dir: Path, session: requests.Session) -> str:
    out = out_dir / f"{row.id}.npz"
    if out.exists():
        return "skip"
    arrays = {}
    for t in ("vil", "ir069", "ir107"):
        fname, idx = row[f"{t}_file"], int(row[f"{t}_index"])
        info = dataset_offset(fname, t)
        per = int(np.prod(SHAPES[t])) * np.dtype(DTYPES[t]).itemsize
        raw = range_get(fname, info["offset"] + idx * per, per, session)
        arrays[t] = np.frombuffer(raw, dtype=DTYPES[t]).reshape(SHAPES[t])
    li = lght_index[row["lght_file"]][row.id]
    n = li["shape"][0]
    if n and li["offset"] is not None:
        raw = range_get(row["lght_file"], li["offset"], n * 5 * 4, session)
        arrays["lght"] = np.frombuffer(raw, dtype="<f4").reshape(n, 5)
    else:
        arrays["lght"] = np.zeros((0, 5), np.float32)
    tmp = out.with_suffix(".tmp.npz")
    np.savez_compressed(tmp, **arrays)
    tmp.rename(out)
    return "ok"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dev", action="store_true", help="small development subset")
    ap.add_argument("--list-only", action="store_true")
    a = ap.parse_args(argv)
    s = cfg()["sevir"]
    n_train, n_test = (s["dev_train"], s["dev_test"]) if a.dev else (s["n_train"], s["n_test"])

    sel = select_events(load_catalog(), n_train, n_test)
    name = "selection_dev.csv" if a.dev else "selection.csv"
    sel.to_csv(path("raw") / name, index=False)
    print(f"{len(sel)} events ({(sel.split == 'train').sum()} train / {(sel.split == 'test').sum()} test, "
          f"{sel.severe.sum()} severe) → store/raw/{name}")
    if a.list_only:
        return

    for t in ("vil", "ir069", "ir107"):
        for f in sorted(sel[f"{t}_file"].unique()):
            dataset_offset(f, t)
    print("indexed VIL/IR files")
    lght_index = {f: lightning_offsets(f, sorted(g.id)) for f, g in sel.groupby("lght_file")}
    print("indexed lightning files")

    out_dir = path("events")
    todo = [r for _, r in sel.iterrows() if not (out_dir / f"{r.id}.npz").exists()]
    print(f"{len(sel) - len(todo)} already present, fetching {len(todo)} …")
    t0, done = time.time(), 0
    with ThreadPoolExecutor(s["workers"]) as ex, requests.Session() as session:
        futs = {ex.submit(fetch_event, r, lght_index, out_dir, session): r.id for r in todo}
        for f in as_completed(futs):
            try:
                f.result()
                done += 1
            except Exception as e:  # keep going; a rerun resumes
                print(f"  {futs[f]}: {e}", file=sys.stderr)
            if done and done % 10 == 0:
                rate = done / (time.time() - t0)
                print(f"  {done}/{len(todo)}  {rate * 60:.1f} events/min  eta {(len(todo) - done) / rate / 60:.0f} min", flush=True)
    print(f"done: {done}/{len(todo)} fetched")


if __name__ == "__main__":
    main()
