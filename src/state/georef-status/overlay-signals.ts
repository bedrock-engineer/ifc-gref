import { type CrsDef, projectLocalToWgs84 } from "#modules/crs";
import type { HelmertParams } from "#modules/helmert/solve";
import type { MapOverlaySignals, MapReferences } from "./types";

/**
 * Project the IFC-local footprint hull through the active Helmert + CRS
 * to WGS84 lng/lat, and combine with the already-derived references into
 * the full overlay-signals struct used by the map.
 *
 * Pure — used both at render time (Workspace memoizes it) and at event
 * time (handlers compute "next" signals from new params before
 * dispatching, so the imperative frame call doesn't have to wait for
 * React to commit the state update).
 */
export function deriveOverlaySignals(arguments_: {
  references: MapReferences;
  effectiveParameters: HelmertParams | null;
  activeCrs: CrsDef | null;
  footprintLocal: ReadonlyArray<{ x: number; y: number }> | null;
}): MapOverlaySignals {
  const { references, effectiveParameters, activeCrs, footprintLocal } =
    arguments_;
  let footprint: Array<[number, number]> | null = null;

  if (footprintLocal && effectiveParameters && activeCrs) {
    const projected: Array<[number, number]> = [];
    for (const point of footprintLocal) {
      const ll = projectLocalToWgs84(
        { x: point.x, y: point.y, z: 0 },
        effectiveParameters,
        activeCrs,
      );
      if (ll.isOk()) {
        projected.push([ll.value.longitude, ll.value.latitude]);
      }
    }

    if (projected.length >= 3) {
      footprint = projected;
    }
  }

  return {
    footprint,
    mapConversion: references.mapConversion,
    siteReference: references.siteReference,
  };
}
