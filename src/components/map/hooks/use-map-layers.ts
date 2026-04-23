/**
 * One hook that drives basemap + overlay visibility from the registry.
 * Raster layers are present in the MapLibre style from startup and just
 * flip `visibility`; custom layers are lazy-loaded and added/removed on
 * demand.
 */

import type { Map as MlMap } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import { emitLog } from "../../../lib/log";
import {
  BASEMAPS,
  OVERLAYS,
  type BasemapId,
  type OverlayId,
} from "../layers/registry";
import type { CustomOverlayHandle, OverlayDef } from "../layers/types";

interface UseMapLayersArguments {
  basemap: BasemapId;
  overlays: Record<OverlayId, boolean>;
}

export function useMapLayers(
  mapRef: RefObject<MlMap | null>,
  { basemap, overlays }: UseMapLayersArguments,
): void {
  // Live handles for custom overlays, keyed by overlay id. Held in a ref
  // so it survives re-renders; teardown runs on unmount.
  const customHandlesRef = useRef<Map<OverlayId, CustomOverlayHandle>>(
    new Map(),
  );

  useEffect(function syncMapLayers() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    // `cancelled` guards against the map being torn down while a
    // lazy-import of a custom overlay is in flight.
    let cancelled = false;

    const apply = () => {
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
    };

    if (map.isStyleLoaded()) {
      apply();
      return () => {
        cancelled = true;
      };
    }

    const handleLoad = () => {
      if (cancelled) {
        return;
      }
      apply();
    };
    map.on("load", handleLoad);
    return () => {
      cancelled = true;
      map.off("load", handleLoad);
    };
  }, [mapRef, basemap, overlays]);

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

function syncRasterOverlays(
  map: MlMap,
  overlays: Record<OverlayId, boolean>,
) {
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
