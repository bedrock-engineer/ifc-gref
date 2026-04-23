import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import {
  ACCENT_COLOR,
  FOOTPRINT_FILL_LAYER_ID,
  FOOTPRINT_LINE_LAYER_ID,
  FOOTPRINT_SOURCE_ID,
} from "../style";

/**
 * 2D overlays driven by the app's reference point and building footprint:
 * a marker for the reference point, a translucent polygon for the convex-
 * hull footprint. Both are (re-)applied whenever the inputs change.
 */
export function useFootprintLayer(
  mapRef: RefObject<MlMap | null>,
  referencePoint: { latitude: number; longitude: number } | null,
  footprint: Array<[number, number]> | null,
): void {
  const markerRef = useRef<Marker | null>(null);
  // Frame the camera only the first time content appears. Param edits
  // (easting/northing/rotation) re-project the footprint, which would
  // otherwise refit the camera on every keystroke — jarring for the user.
  const hasFramedRef = useRef(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const hasContent =
      (footprint != null && footprint.length >= 3) || referencePoint != null;

    const apply = () => {
      syncMarker(map, markerRef, referencePoint);
      syncFootprint(map, footprint);
      if (hasContent && !hasFramedRef.current) {
        frameCamera(map, referencePoint, footprint);
        hasFramedRef.current = true;
      } else if (!hasContent) {
        hasFramedRef.current = false;
      }
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      void map.once("load", apply);
    }
  }, [mapRef, referencePoint, footprint]);

  // Remove the marker on unmount. Sources/layers live on the map and are torn
  // down by `map.remove()` in useMapInit's cleanup.
  useEffect(() => {
    const ref = markerRef;
    return () => {
      ref.current?.remove();
      ref.current = null;
    };
  }, []);
}

function syncMarker(
  map: MlMap,
  markerRef: RefObject<Marker | null>,
  referencePoint: { latitude: number; longitude: number } | null,
): void {
  if (referencePoint) {
    const lngLat: [number, number] = [
      referencePoint.longitude,
      referencePoint.latitude,
    ];
    if (markerRef.current) {
      markerRef.current.setLngLat(lngLat);
    } else {
      markerRef.current = new maplibregl.Marker({ color: ACCENT_COLOR })
        .setLngLat(lngLat)
        .addTo(map);
    }
  } else if (markerRef.current) {
    markerRef.current.remove();
    markerRef.current = null;
  }
}

function syncFootprint(
  map: MlMap,
  footprint: Array<[number, number]> | null,
): void {
  const hasFootprint = footprint != null && footprint.length >= 3;
  // Typed lookup so setData() is reachable without a cast.
  const existing = map.getSource<maplibregl.GeoJSONSource>(
    FOOTPRINT_SOURCE_ID,
  );

  if (hasFootprint) {
    const ring = [...footprint];
    const first = ring[0];
    const last = ring.at(-1);
    // Length >= 3 guarantees both exist — this extra guard is just to keep
    // the strict-null type narrowing happy without non-null assertions.
    if (first && last) {
      const [fx, fy] = first;
      const [lx, ly] = last;
      if (fx !== lx || fy !== ly) {
        ring.push([fx, fy]);
      }
    }
    const data: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };

    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(FOOTPRINT_SOURCE_ID, { type: "geojson", data });
      map.addLayer({
        id: FOOTPRINT_FILL_LAYER_ID,
        type: "fill",
        source: FOOTPRINT_SOURCE_ID,
        paint: { "fill-color": ACCENT_COLOR, "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: FOOTPRINT_LINE_LAYER_ID,
        type: "line",
        source: FOOTPRINT_SOURCE_ID,
        paint: { "line-color": ACCENT_COLOR, "line-width": 2 },
      });
    }
  } else if (existing) {
    if (map.getLayer(FOOTPRINT_FILL_LAYER_ID)) {
      map.removeLayer(FOOTPRINT_FILL_LAYER_ID);
    }
    if (map.getLayer(FOOTPRINT_LINE_LAYER_ID)) {
      map.removeLayer(FOOTPRINT_LINE_LAYER_ID);
    }
    map.removeSource(FOOTPRINT_SOURCE_ID);
  }
}

/**
 * Frame the camera around the footprint (preferred) or reference point.
 * Exported so the "zoom to model" button can call it too — duration 0 is
 * instant (used on first appearance), >0 animates (used by the button).
 */
export function frameCamera(
  map: MlMap,
  referencePoint: { latitude: number; longitude: number } | null,
  footprint: Array<[number, number]> | null,
  options: { duration?: number } = {},
): void {
  const duration = options.duration ?? 0;
  if (footprint != null && footprint.length >= 3) {
    const seed = footprint[0];
    if (!seed) {
      return;
    }
    const bounds = new maplibregl.LngLatBounds(seed, seed);
    for (const point of footprint) {
      bounds.extend(point);
    }
    map.fitBounds(bounds, { padding: 40, duration, maxZoom: 19 });
  } else if (referencePoint) {
    const center: [number, number] = [
      referencePoint.longitude,
      referencePoint.latitude,
    ];
    if (duration === 0) {
      map.jumpTo({ center, zoom: 17 });
    } else {
      map.flyTo({ center, zoom: 17, duration });
    }
  }
}
