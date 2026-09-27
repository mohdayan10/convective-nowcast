#!/usr/bin/env bash
# Rebuild public/offline/: Protomaps basemap extract, glyphs, sprites and
# Terrarium DEM tiles for the demo region, so the dashboard runs with no internet.
# Needs: curl, python3, and the pmtiles CLI (github.com/protomaps/go-pmtiles/releases).
set -euo pipefail
cd "$(dirname "$0")/../public/offline"
BBOX="77.35,29.6,79.25,31.1"
BUILD="${BUILD:-$(curl -s https://build-metadata.protomaps.dev/builds.json | python3 -c 'import json,sys; print(json.load(sys.stdin)[-2]["key"])')}"

echo "basemap from $BUILD"
pmtiles extract "https://build.protomaps.com/$BUILD" basemap.pmtiles --bbox="$BBOX" --maxzoom=14

ASSETS=https://raw.githubusercontent.com/protomaps/basemaps-assets/main
for f in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  mkdir -p "fonts/$f"
  for r in 0-255 256-511 512-767 768-1023 2304-2559 2560-2815 2816-3071 3840-4095 8192-8447; do
    curl -sf -o "fonts/$f/$r.pbf" "$ASSETS/fonts/${f// /%20}/$r.pbf" || echo "no $f $r"
  done
done
f="Noto Sans Devanagari Regular v1"; mkdir -p "fonts/$f"
for s in $(seq 57344 256 65280); do
  curl -sf -o "fonts/$f/$s-$((s + 255)).pbf" "$ASSETS/fonts/${f// /%20}/$s-$((s + 255)).pbf" || true
done
mkdir -p sprites
for s in dark.json dark.png dark@2x.json dark@2x.png; do curl -sf -o "sprites/$s" "$ASSETS/sprites/v4/$s"; done

python3 - "$BBOX" <<'PY'
import math, os, sys, urllib.request, concurrent.futures as cf
W, S, E, N = map(float, sys.argv[1].split(","))
def tile(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
jobs = []
for z in range(5, 13):
    (x0, y0), (x1, y1) = tile(W, N, z), tile(E, S, z)
    jobs += [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
def get(j):
    z, x, y = j
    p = f"dem/{z}/{x}/{y}.png"
    if os.path.exists(p): return
    os.makedirs(os.path.dirname(p), exist_ok=True)
    urllib.request.urlretrieve(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", p)
with cf.ThreadPoolExecutor(16) as ex: list(ex.map(get, jobs))
print(len(jobs), "DEM tiles")
PY
