// Fully offline basemap: Protomaps vector extracts, glyphs, sprites and Terrarium
// DEM tiles bundled under public/offline/ (see scripts/fetch-offline.sh).
//
// Needs MapLibre 5: Protomaps builds from 2026 encode non-Latin labels (Kannada
// and Tamil here) in PGF, which MapLibre 4 cannot decode — it fails the tile with
// "Unimplemented type: 4" and the style never finishes loading, so no overlay is
// ever added. The US extract never hit it because its labels are all Latin.
//
// Three regions are bundled: the SEVIR demo event (US plains), the Doon valley
// case-study area, and Karnataka, which is where a relocated package is drawn.
// The style picks whichever extract contains the event, so the demo needs no
// network. DEM is bundled only for the Doon valley, where terrain matters;
// hillshade is enabled only there rather than faked elsewhere.

import maplibregl, { StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";

let registered = false;

export interface Region {
  id: string;
  bundle: string;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  dem: boolean;
}

export const REGIONS: Region[] = [
  { id: "india-doon", bundle: "basemap.pmtiles", bounds: [77.35, 29.6, 79.25, 31.1], dem: true },
  // Karnataka and the western Tamil Nadu border: the tile a relocated package is
  // drawn on, centred on Bengaluru and wide enough for the whole 384 km grid.
  { id: "india-karnataka", bundle: "basemap-in.pmtiles", bounds: [75.6, 11.0, 79.6, 14.9], dem: false },
  { id: "us-plains", bundle: "basemap-us.pmtiles", bounds: [-98.3, 36.8, -92.5, 41.4], dem: false },
];

const base = () => new URL(`${import.meta.env.BASE_URL}offline/`, window.location.href).href;

function contains(r: Region, lon: number, lat: number) {
  return lon >= r.bounds[0] && lon <= r.bounds[2] && lat >= r.bounds[1] && lat <= r.bounds[3];
}

/** The bundled region containing a point, or the one whose centre is nearest. */
export function regionFor(lon: number, lat: number): Region {
  const hit = REGIONS.find((r) => contains(r, lon, lat));
  if (hit) return hit;
  const d = (r: Region) =>
    Math.hypot((r.bounds[0] + r.bounds[2]) / 2 - lon, (r.bounds[1] + r.bounds[3]) / 2 - lat);
  return [...REGIONS].sort((a, b) => d(a) - d(b))[0];
}

export function demTiles(region: Region) {
  return {
    type: "raster-dem" as const,
    tiles: [`${base()}dem/{z}/{x}/{y}.png`],
    tileSize: 256,
    encoding: "terrarium" as const,
    minzoom: 5,
    maxzoom: 12,
    bounds: region.bounds,
  };
}

export function offlineStyle(region: Region): StyleSpecification {
  if (!registered) {
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    registered = true;
  }
  // Protomaps "dark", pulled toward the console's slate so the basemap stays
  // quiet under the hazard layers.
  const flavor = {
    ...namedFlavor("dark"),
    background: "#0B1116",
    earth: "#0E1419",
    water: "#0A1821",
    glacier: "#16202B",
    park_a: "#0F1A19", park_b: "#0F1C1A",
    wood_a: "#0E1719", wood_b: "#0E1719",
    scrub_a: "#0F161B", scrub_b: "#0F161B",
    buildings: "#0A0F14",
  };
  return {
    version: 8,
    glyphs: `${base()}fonts/{fontstack}/{range}.pbf`,
    sprite: `${base()}sprites/dark`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${base()}${region.bundle}`,
        attribution:
          '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers("protomaps", flavor, { lang: "en" }),
  };
}
