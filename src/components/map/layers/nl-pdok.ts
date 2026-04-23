/**
 * Dutch layer definitions: PDOK basemaps + overlays + 3D BAG.
 *
 * Adding another country means a sibling file (e.g. `ch-swisstopo.ts`)
 * that exports its own BasemapDef/OverlayDef consts and pushes them into
 * `registry.ts`.
 */

import type { BasemapDef, OverlayDef } from "./types";

const KADASTER_ATTRIBUTION =
  'Kaartgegevens © <a href="https://www.kadaster.nl/">Kadaster</a>';

const BGT_MIN_ZOOM = 15;

export const PDOK_BRT: BasemapDef = {
  id: "brt",
  label: "Topo NL (BRT)",
  region: "nl",
  source: {
    type: "raster",
    tiles: [
      "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: KADASTER_ATTRIBUTION,
  },
  layer: { id: "pdok-brt", type: "raster", source: "pdok-brt" },
};

export const PDOK_LUCHTFOTO: BasemapDef = {
  id: "luchtfoto",
  label: "Luchtfoto NL",
  region: "nl",
  source: {
    type: "raster",
    tiles: [
      "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
    ],
    tileSize: 256,
    attribution: KADASTER_ATTRIBUTION,
  },
  layer: { id: "pdok-luchtfoto", type: "raster", source: "pdok-luchtfoto" },
};

export const PDOK_BGT: OverlayDef = {
  id: "bgt",
  label: "BGT",
  kind: "raster",
  region: "nl",
  source: {
    type: "raster",
    tiles: [
      "https://service.pdok.nl/lv/bgt/wmts/v1_0/achtergrondvisualisatie/EPSG:3857/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: KADASTER_ATTRIBUTION,
  },
  layer: {
    id: "pdok-bgt",
    type: "raster",
    source: "pdok-bgt",
    minzoom: BGT_MIN_ZOOM,
  },
};

export const PDOK_KADASTER: OverlayDef = {
  id: "kadaster",
  label: "Kadaster",
  kind: "raster",
  region: "nl",
  source: {
    type: "raster",
    tiles: [
      "https://service.pdok.nl/kadaster/kadastralekaart/wmts/v5_0/Kadastralekaart/EPSG:3857/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: KADASTER_ATTRIBUTION,
  },
  layer: {
    id: "pdok-kadaster",
    type: "raster",
    source: "pdok-kadaster",
    minzoom: 17,
  },
};

export const PDOK_BAG_2D: OverlayDef = {
  id: "bag2d",
  label: "2D BAG",
  kind: "raster",
  region: "nl",
  source: {
    type: "raster",
    tiles: [
      "https://service.pdok.nl/lv/bag/wms/v2_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=pand&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true",
    ],
    tileSize: 256,
    attribution: KADASTER_ATTRIBUTION,
  },
  layer: {
    id: "pdok-bag",
    type: "raster",
    source: "pdok-bag",
    minzoom: 16,
  },
};

export const BAG_3D: OverlayDef = {
  id: "bag3d",
  label: "3D BAG",
  kind: "custom",
  region: "nl",
  load: async () => {
    const { createThreeDBagLayer } = await import("../../three-d-bag-layer");
    return { create: () => createThreeDBagLayer() };
  },
};
