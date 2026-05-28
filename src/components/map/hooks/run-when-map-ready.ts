import type { Map as MlMap } from "maplibre-gl";

/**
 * Run `apply` as soon as the map is ready for `addSource` / `addLayer` calls.
 *
 * MapLibre's lifecycle events have foot-guns when used naively from React
 * effects:
 *
 * - `map.once("load", ...)` only fires for the *first* load event. Re-
 *   registering after load has fired sits there forever — common when
 *   effects start running after async data (CRS picks, file metadata)
 *   arrives post-load.
 * - `map.isStyleLoaded()` flickers false during sibling addSource/addLayer
 *   calls. Two effects mounting in the same tick can race: the first sets
 *   the flag to false transiently, the second checks it and bails.
 *
 * `idle` is the safe choice. It fires whenever the map fully settles
 * (style + tiles + animations done), and keeps firing on every subsequent
 * settle, so registering for it always wakes up shortly even if load
 * already fired.
 *
 * Returns a cleanup suitable for direct return from `useEffect`.
 */
export function runWhenMapReady(map: MlMap, apply: () => void): () => void {
  if (map.isStyleLoaded()) {
    apply();
    return () => {
      /* empty */
    };
  }
  let cancelled = false;
  const onIdle = () => {
    if (cancelled) {
      return;
    }
    map.off("idle", onIdle);
    apply();
  };
  map.on("idle", onIdle);
  return () => {
    cancelled = true;
    map.off("idle", onIdle);
  };
}
