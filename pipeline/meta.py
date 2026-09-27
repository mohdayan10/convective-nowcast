"""Per-event georeference from the selection files (catalog rows)."""
from __future__ import annotations

from functools import lru_cache

import pandas as pd
from pyproj import Proj

from pipeline.settings import path


@lru_cache(maxsize=1)
def _table() -> pd.DataFrame:
    frames = [pd.read_csv(p) for p in sorted(path("raw").glob("selection*.csv"))]
    return pd.concat(frames).drop_duplicates("id").set_index("id")


def event_meta(eid: str) -> dict:
    return _table().loc[eid].to_dict()


@lru_cache(maxsize=4096)
def projector(eid: str):
    """lon, lat → (x_km from west edge, y_km from south edge) on the event's 384 km grid."""
    m = event_meta(eid)
    p = Proj(m["proj"])
    x0, y0 = p(m["llcrnrlon"], m["llcrnrlat"])

    def f(lon, lat):
        x, y = p(lon, lat)
        return (x - x0) / 1000.0, (y - y0) / 1000.0

    return f, p, (x0, y0)
