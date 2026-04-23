import { useCallback, useSyncExternalStore, type RefObject } from "react";
import { type Map as MlMap } from "maplibre-gl";

export type MapScope = "nl" | "world";

const NL_BBOX = { west: 3.2, south: 50.7, east: 7.3, north: 53.6 };

function noop(): void {
  // empty cleanup: called by useSyncExternalStore when mapRef.current is null
}

function scopeForLngLat(longitude: number, latitude: number): MapScope {
  return longitude >= NL_BBOX.west &&
    longitude <= NL_BBOX.east &&
    latitude >= NL_BBOX.south &&
    latitude <= NL_BBOX.north
    ? "nl"
    : "world";
}

export function useMapScope(mapRef: RefObject<MlMap | null>): MapScope {
  const subscribe = useCallback(
    (notify: () => void) => {
      const map = mapRef.current;
      if (!map) {
        return noop;
      }
      map.on("moveend", notify);
      return () => {
        map.off("moveend", notify);
      };
    },
    [mapRef],
  );
  const getSnapshot = useCallback((): MapScope => {
    const map = mapRef.current;
    if (!map) {
      return "world";
    }
    const center = map.getCenter();
    return scopeForLngLat(center.lng, center.lat);
  }, [mapRef]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
