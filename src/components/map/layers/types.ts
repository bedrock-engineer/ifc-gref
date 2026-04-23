/**
 * Layer registry types.
 *
 * Each basemap and overlay is one `LayerDef` object that owns everything
 * the map needs to know about it: its style contribution (source + layer
 * spec for raster layers, or a lazy loader for custom 3D layers) plus
 * its UI label. Adding support for another country's basemap is a new
 * file that pushes entries onto the registry — no edits to `style.ts`,
 * `LayersPanel`, or the toggle hook.
 */

import type {
  CustomLayerInterface,
  LayerSpecification,
  SourceSpecification,
} from "maplibre-gl";

/**
 * Where a layer has data. `"global"` layers are always available; `"nl"`
 * layers are PDOK/Kadaster services with no data outside the Netherlands
 * and should be hidden from the picker when the map is looking elsewhere.
 */
export type LayerRegion = "global" | "nl";

/**
 * A basemap: a raster tile source rendered underneath overlays. Exactly
 * one basemap is visible at a time (radio group).
 */
export interface BasemapDef {
  readonly id: string;
  readonly label: string;
  readonly region: LayerRegion;
  /** Source spec injected into the MapLibre style at startup. */
  readonly source: SourceSpecification;
  /** Layer spec — its `id` is the target of visibility toggles. */
  readonly layer: LayerSpecification;
}

/**
 * Simple raster overlay (PDOK BGT/Kadaster/BAG, …). Present in the style
 * from startup; toggled via `visibility`. Keeps tiles warm in the cache
 * across on/off cycles.
 */
export interface RasterOverlayDef {
  readonly id: string;
  readonly label: string;
  readonly kind: "raster";
  readonly region: LayerRegion;
  readonly source: SourceSpecification;
  readonly layer: LayerSpecification;
}

/**
 * Custom 3D overlay (3D BAG, future Swiss swissBUILDINGS3D, …). Lazy-
 * imported and added/removed rather than toggled, because the renderer
 * keeps fetching tiles and holding GL resources while alive.
 */
export interface CustomOverlayDef {
  readonly id: string;
  readonly label: string;
  readonly kind: "custom";
  readonly region: LayerRegion;
  /**
   * Code-split entry point. Returning a factory (not the instance
   * directly) keeps the call to `create()` for after the style is
   * ready.
   */
  readonly load: () => Promise<CustomOverlayFactory>;
}

export interface CustomOverlayFactory {
  create: () => CustomOverlayHandle;
}

export interface CustomOverlayHandle {
  readonly layer: CustomLayerInterface;
  dispose(): void;
}

export type OverlayDef = RasterOverlayDef | CustomOverlayDef;
