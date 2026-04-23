import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { type RefObject, useEffect } from "react";

export interface PickedAnchor {
  longitude: number;
  latitude: number;
  /** Elevation sampled from the terrain source; null if unavailable. */
  elevation: number | null;
}

/**
 * While `isPicking` is true, swap the canvas cursor to a crosshair, arm a
 * one-shot click listener that emits the clicked lng/lat + terrain elevation,
 * and listen for Escape to let the user back out. The caller is expected to
 * flip `isPicking` back to false in response to either callback, which
 * triggers the cleanup path.
 */
export function useAnchorPicker(
  mapRef: RefObject<MlMap | null>,
  isPicking: boolean,
  onPick: (point: PickedAnchor) => void,
  onCancel: () => void,
): void {
  useEffect(() => {
    if (!isPicking) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const canvas = map.getCanvas();
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";

    const clickHandler = (event: MapMouseEvent) => {
      const { lng, lat } = event.lngLat;
      // queryTerrainElevation returns null when terrain isn't set up or the
      // tile isn't loaded yet. We pass that through so the caller can decide
      // whether to keep the existing height.
      const elevation = map.queryTerrainElevation(event.lngLat) ?? null;
      onPick({ longitude: lng, latitude: lat, elevation });
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    // maplibre's `once` overload returns a promise when no handler is passed
    // but here we DO pass a handler, so the returned value is the map itself.
    // The type still surfaces a union with a thenable, so void it.
    void map.once("click", clickHandler);
    globalThis.addEventListener("keydown", keyHandler);

    return () => {
      canvas.style.cursor = previousCursor;
      map.off("click", clickHandler);
      globalThis.removeEventListener("keydown", keyHandler);
    };
  }, [mapRef, isPicking, onPick, onCancel]);
}
