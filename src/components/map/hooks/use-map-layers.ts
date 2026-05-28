/**
 * One hook that drives basemap + overlay visibility from the registry.
 * Raster layers are present in the MapLibre style from startup and just
 * flip `visibility`; custom layers are lazy-loaded and added/removed on
 * demand.
 */

import type { Map as MlMap } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import { emitLog } from "../../../lib/log";
import type { CustomBasemap } from "../layers/custom-basemap";
import {
  BASEMAPS,
  OVERLAYS,
  type BasemapId,
  type OverlayId,
} from "../layers/registry";
import type { CustomOverlayHandle, OverlayDef } from "../layers/types";
import { runWhenMapReady } from "./run-when-map-ready";

interface UseMapLayersArguments {
  basemap: BasemapId;
  overlays: Record<OverlayId, boolean>;
  /** User-added XYZ raster basemaps. Lifecycle is managed dynamically:
   *  added/removed from the live MapLibre style as this array changes. */
  customBasemaps: ReadonlyArray<CustomBasemap>;
}

/** Prefix for source/layer ids of user-added basemaps; keeps them out of
 *  the namespace of registry layers. */
const CUSTOM_BASEMAP_PREFIX = "custom-basemap-";

function customBasemapLayerId(id: string): string {
  return `${CUSTOM_BASEMAP_PREFIX}${id}`;
}

export function useMapLayers(
  mapRef: RefObject<MlMap | null>,
  { basemap, overlays, customBasemaps }: UseMapLayersArguments,
): void {
  // Live handles for custom overlays, keyed by overlay id. Held in a ref
  // so it survives re-renders; teardown runs on unmount.
  const customHandlesRef = useRef<Map<OverlayId, CustomOverlayHandle>>(
    new Map(),
  );

  useEffect(
    function syncMapLayers() {
      const map = mapRef.current;
      if (!map) {
        return;
      }

      // `cancelled` guards against the map being torn down while a
      // lazy-import of a custom overlay is in flight.
      let cancelled = false;

      const cleanupReady = runWhenMapReady(map, () => {
        syncCustomBasemaps(map, customBasemaps, basemap);
        syncBasemaps(map, basemap);
        syncRasterOverlays(map, overlays);
        syncCustomOverlays(
          map,
          overlays,
          customHandlesRef.current,
          () => cancelled,
        ).catch((error: unknown) => {
          emitLog({
            level: "error",
            message: `Map layer setup failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        });
      });

      return () => {
        cancelled = true;
        cleanupReady();
      };
    },
    [mapRef, basemap, overlays, customBasemaps],
  );

  useEffect(function disposeCustomOverlaysOnUnmount() {
    const ref = customHandlesRef;
    return () => {
      for (const handle of ref.current.values()) {
        handle.dispose();
      }
      ref.current.clear();
    };
  }, []);
}

function syncBasemaps(map: MlMap, activeBasemap: BasemapId) {
  for (const b of BASEMAPS) {
    if (!map.getLayer(b.layer.id)) {
      continue;
    }
    map.setLayoutProperty(
      b.layer.id,
      "visibility",
      b.id === activeBasemap ? "visible" : "none",
    );
  }
}

/**
 * Reconcile user-added XYZ basemaps with the live style. Built-in basemaps
 * sit in the style spec from startup; custom ones are unknown until the
 * user enters one, so we add/remove sources and layers on the fly.
 *
 * Layers are inserted *before* the first registry basemap so they share
 * the basemap z-order — overlays still draw on top.
 */
function syncCustomBasemaps(
  map: MlMap,
  basemaps: ReadonlyArray<CustomBasemap>,
  activeBasemap: BasemapId,
) {
  const wantedIds = new Set(basemaps.map((b) => b.id));

  // Remove any custom basemap layer/source that's no longer in the list.
  for (const layer of map.getStyle().layers) {
    if (!layer.id.startsWith(CUSTOM_BASEMAP_PREFIX)) {
      continue;
    }
    const id = layer.id.slice(CUSTOM_BASEMAP_PREFIX.length);
    if (!wantedIds.has(id)) {
      map.removeLayer(layer.id);
      if (map.getSource(layer.id)) {
        map.removeSource(layer.id);
      }
    }
  }

  // Insert before the first known basemap layer so registry basemaps and
  // user basemaps share the same band of the layer stack.
  const insertBefore = BASEMAPS.find((b) => map.getLayer(b.layer.id))?.layer.id;

  for (const b of basemaps) {
    const layerId = customBasemapLayerId(b.id);
    if (!map.getSource(layerId)) {
      map.addSource(layerId, {
        type: "raster",
        tiles: [b.url],
        tileSize: 256,
      });
    }
    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
          id: layerId,
          type: "raster",
          source: layerId,
          layout: { visibility: "none" },
        },
        insertBefore,
      );
    }
    map.setLayoutProperty(
      layerId,
      "visibility",
      b.id === activeBasemap ? "visible" : "none",
    );
  }
}

function syncRasterOverlays(map: MlMap, overlays: Record<OverlayId, boolean>) {
  for (const overlay of OVERLAYS) {
    if (overlay.kind !== "raster" || !map.getLayer(overlay.layer.id)) {
      continue;
    }
    map.setLayoutProperty(
      overlay.layer.id,
      "visibility",
      overlays[overlay.id] ? "visible" : "none",
    );
  }
}

async function syncCustomOverlays(
  map: MlMap,
  overlays: Record<OverlayId, boolean>,
  handles: Map<OverlayId, CustomOverlayHandle>,
  isCancelled: () => boolean,
) {
  for (const overlay of OVERLAYS) {
    if (overlay.kind !== "custom") {
      continue;
    }
    const wantOn = Boolean(overlays[overlay.id]);
    const have = handles.get(overlay.id);
    if (wantOn && !have) {
      await attachCustomOverlay(map, overlay, handles, isCancelled);
    } else if (!wantOn && have) {
      detachCustomOverlay(map, overlay.id, handles);
    }
  }
}

async function attachCustomOverlay(
  map: MlMap,
  overlay: OverlayDef & { kind: "custom" },
  handles: Map<OverlayId, CustomOverlayHandle>,
  isCancelled: () => boolean,
) {
  const factory = await overlay.load();

  if (isCancelled() || handles.has(overlay.id)) {
    return;
  }

  const handle = factory.create();
  handles.set(overlay.id, handle);

  if (!map.getLayer(handle.layer.id)) {
    map.addLayer(handle.layer);
  }
}

function detachCustomOverlay(
  map: MlMap,
  id: OverlayId,
  handles: Map<OverlayId, CustomOverlayHandle>,
) {
  const handle = handles.get(id);
  if (!handle) {
    return;
  }

  if (map.getLayer(handle.layer.id)) {
    map.removeLayer(handle.layer.id);
  }

  handle.dispose();
  handles.delete(id);
}
