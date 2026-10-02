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


# Events whose grid has been georeferenced somewhere else: {event id: (lon, lat)}
# of the new tile centre. Nothing about the data changes — the fields, the cells
# and every metric are computed on the grid, which is the same grid — only where
# that grid is drawn on the Earth. Used to read the console against Indian
# terrain and Indian cities; a package built this way is badged RELOCATED.
_RELOCATED: dict[str, tuple[float, float]] = {}


def relocate(eid: str, lon0: float, lat0: float) -> None:
    """Draw this event's tile centred on (lon0, lat0) instead of where it happened."""
    _RELOCATED[eid] = (lon0, lat0)
    projector.cache_clear()


@lru_cache(maxsize=4096)
def projector(eid: str):
    """lon, lat → (x_km from west edge, y_km from south edge) on the event's 384 km grid."""
    if eid in _RELOCATED:
        lon0, lat0 = _RELOCATED[eid]
        # Azimuthal equidistant on the new centre: distances from the centre are
        # true, which is what a 384 km tile of radar grid needs.
        p = Proj(proj="aeqd", lon_0=lon0, lat_0=lat0, datum="WGS84", units="m")
        half = 384_000.0 / 2
        x0, y0 = -half, -half

        def g(lon, lat):
            x, y = p(lon, lat)
            return (x - x0) / 1000.0, (y - y0) / 1000.0

        return g, p, (x0, y0)

    m = event_meta(eid)
    p = Proj(m["proj"])
    x0, y0 = p(m["llcrnrlon"], m["llcrnrlat"])

    def f(lon, lat):
        x, y = p(lon, lat)
        return (x - x0) / 1000.0, (y - y0) / 1000.0

    return f, p, (x0, y0)


def from_package(meta: dict) -> str:
    """The SEVIR event a replay package was built from, with its georeference applied.

    A relocated package is named after its tile, not its event, and its data still
    comes from the original SEVIR event. The companion exporters call this so they
    read the right arrays and draw them where the package already drew them.
    """
    eid = meta.get("source_event") or meta["event"]
    r = meta.get("relocated")
    if r:
        relocate(eid, *r["centre"])
    return eid
