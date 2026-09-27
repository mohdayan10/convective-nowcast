"""Attach NOAA Storm Events labels (hail size, wind speed) to SEVIR events.

SEVIR's catalog stores the NOAA `event_id` for storm events, so this is an
exact join, not a space-time match. Random (non-storm) events get no label.

    python -m data.storm_events_join [--selection selection_dev.csv]
"""
from __future__ import annotations

import argparse
import re

import pandas as pd
import requests

from pipeline.settings import ROOT, path

INDEX = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
YEARS = (2017, 2018, 2019)
COLS = ["EVENT_ID", "EPISODE_ID", "EVENT_TYPE", "MAGNITUDE", "MAGNITUDE_TYPE", "BEGIN_DATE_TIME",
        "CZ_TIMEZONE", "BEGIN_LAT", "BEGIN_LON", "STATE", "INJURIES_DIRECT", "DEATHS_DIRECT", "DAMAGE_PROPERTY"]


def details(year: int) -> pd.DataFrame:
    local = path("raw") / f"stormevents_{year}.csv.gz"
    if not local.exists():
        listing = requests.get(INDEX, timeout=60).text
        name = sorted(set(re.findall(rf"StormEvents_details-ftp_v1\.0_d{year}_c\d+\.csv\.gz", listing)))[-1]
        r = requests.get(INDEX + name, timeout=600)
        r.raise_for_status()
        local.write_bytes(r.content)
    return pd.read_csv(local, usecols=COLS, low_memory=False)


def join(selection: str) -> pd.DataFrame:
    sel = pd.read_csv(path("raw") / selection)
    se = pd.concat([details(y) for y in YEARS], ignore_index=True)
    out = sel.merge(se, how="left", left_on="event_id", right_on="EVENT_ID")
    # Magnitudes: hail size in inches, wind in knots (MAGNITUDE_TYPE: EG/MG measured, ES/MS estimated).
    out["hail_in"] = out.MAGNITUDE.where(out.EVENT_TYPE == "Hail")
    out["wind_kt"] = out.MAGNITUDE.where(out.EVENT_TYPE == "Thunderstorm Wind")
    out["wind_ms"] = out.wind_kt * 0.514444
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--selection", default="selection_dev.csv")
    a = ap.parse_args(argv)
    out = join(a.selection)
    storm = out[out.id.str.startswith("S")]
    matched = storm.EVENT_ID.notna().sum()
    print(f"storm events: {len(storm)}, matched to NOAA details: {matched} ({matched / max(len(storm), 1):.0%})")
    print(f"  hail with size: {storm.hail_in.notna().sum()}, wind with speed: {storm.wind_kt.notna().sum()}")
    dest = path("raw") / a.selection.replace("selection", "labels")
    out.to_csv(dest, index=False)
    print(f"wrote {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
