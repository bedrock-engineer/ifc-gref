/**
 * App-specific visual tokens plus the derived MapLibre `StyleSpecification`.
 * Basemap + overlay definitions live in `./layers/` — `STYLE` here just
 * assembles them into the shape MapLibre wants at startup.
 */

import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { BASEMAPS, OVERLAYS, TERRAIN } from "./layers/registry";

export const ACCENT_COLOR = "#0f766e";

export const FOOTPRINT_SOURCE_ID = "ifc-footprint";
export const FOOTPRINT_FILL_LAYER_ID = "ifc-footprint-fill";
export const FOOTPRINT_LINE_LAYER_ID = "ifc-footprint-line";

export const AXES_SOURCE_ID = "ifc-axes";
export const AXES_LINE_LAYER_ID = "ifc-axes-line";
export const IFC_X_AXIS_COLOR = "#dc2626";
export const IFC_Y_AXIS_COLOR = "#16a34a";
export const NORTH_AXIS_COLOR = "#1d4ed8";

export const RESIDUALS_SOURCE_ID = "helmert-residuals";
export const RESIDUALS_FIT_LAYER_ID = "helmert-residuals-fit";
export const RESIDUAL_FIT_COLOR = "#0f766e";

/** Narrow `LayerSpecification` to layers that carry a source reference. */
function sourceIdOf(layer: LayerSpecification): string {
  if ("source" in layer && typeof layer.source === "string") {
    return layer.source;
  }
  throw new Error(
    `Registry layer '${layer.id}' has no string source — basemaps/overlays must reference a source by id.`,
  );
}

function buildStyle(): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {
    [TERRAIN.sourceId]: TERRAIN.source,
  };
  const layers: Array<LayerSpecification> = [];

  for (const [index, basemap] of BASEMAPS.entries()) {
    sources[sourceIdOf(basemap.layer)] = basemap.source;
    // First basemap is visible at startup; the rest are hidden.
    layers.push(
      index === 0
        ? basemap.layer
        : { ...basemap.layer, layout: { visibility: "none" } },
    );
  }

  for (const overlay of OVERLAYS) {
    if (overlay.kind !== "raster") {
      continue;
    }
    sources[sourceIdOf(overlay.layer)] = overlay.source;
    layers.push({ ...overlay.layer, layout: { visibility: "none" } });
  }

  return {
    version: 8,
    sources,
    terrain: { source: TERRAIN.sourceId, exaggeration: 1 },
    layers,
  };
}

export const STYLE: StyleSpecification = buildStyle();
