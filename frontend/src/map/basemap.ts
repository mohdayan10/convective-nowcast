// Fully offline basemap: a Protomaps vector extract, glyphs, sprites and
// Terrarium DEM tiles bundled under public/offline/ (see scripts/fetch-offline.sh).

import maplibregl, { StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";

let registered = false;

/** Extent of the bundled tiles; the map is kept inside it. */
export const OFFLINE_BOUNDS: [number, number, number, number] = [77.35, 29.6, 79.25, 31.1];

const base = () => new URL(`${import.meta.env.BASE_URL}offline/`, window.location.href).href;

export function demTiles() {
  return {
    type: "raster-dem" as const,
    tiles: [`${base()}dem/{z}/{x}/{y}.png`],
    tileSize: 256,
    encoding: "terrarium" as const,
    minzoom: 5,
    maxzoom: 12,
    bounds: OFFLINE_BOUNDS,
  };
}

export function offlineStyle(): StyleSpecification {
  if (!registered) {
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    registered = true;
  }
  // Protomaps "dark", shifted toward the dashboard's navy.
  const flavor = {
    ...namedFlavor("dark"),
    background: "#0b1119",
    earth: "#0d141d",
    water: "#0a1826",
    glacier: "#16202c",
    park_a: "#0f1a1a", park_b: "#0f1c1a",
    wood_a: "#0e1719", wood_b: "#0e1719",
    scrub_a: "#0f161d", scrub_b: "#0f161d",
    buildings: "#0a0f16",
  };
  return {
    version: 8,
    glyphs: `${base()}fonts/{fontstack}/{range}.pbf`,
    sprite: `${base()}sprites/dark`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${base()}basemap.pmtiles`,
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a> · Terrain: Mapzen/AWS',
      },
    },
    layers: layers("protomaps", flavor, { lang: "en" }),
  };
}
