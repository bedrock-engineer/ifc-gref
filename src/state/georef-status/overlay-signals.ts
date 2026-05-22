import { type CrsDef, projectLocalToWgs84 } from "#modules/crs";
import type { HelmertParams } from "#modules/helmert/solve";
import type { SpaceExtract } from "#modules/ifc/worker";
import type {
  MapOverlaySignals,
  MapReferences,
  SpaceOverlay,
} from "./types";

/**
 * Project the IFC-local footprint hull and per-space hulls through the
 * active Helmert + CRS to WGS84 lng/lat, and combine with the
 * already-derived references into the full overlay-signals struct used
 * by the map.
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
  spacesLocal: ReadonlyArray<SpaceExtract> | null;
  /**
   * Entity name to render on the coordinate-operation marker label.
   */
  coordinateOperationLabel: string;
}): MapOverlaySignals {
  const {
    references,
    effectiveParameters,
    activeCrs,
    footprintLocal,
    spacesLocal,
    coordinateOperationLabel,
  } = arguments_;
  let footprint: Array<[number, number]> | null = null;
  let spaces: ReadonlyArray<SpaceOverlay> | null = null;

  if (effectiveParameters && activeCrs) {
    if (footprintLocal) {
      footprint = projectRing(footprintLocal, effectiveParameters, activeCrs);
    }
    if (spacesLocal) {
      spaces = projectSpaces(spacesLocal, effectiveParameters, activeCrs);
    }
  }

  return {
    footprint,
    spaces,
    mapConversion: references.mapConversion,
    coordinateOperationLabel,
    siteReference: references.siteReference,
  };
}

function projectRing(
  ring: ReadonlyArray<{ x: number; y: number }>,
  parameters: HelmertParams,
  crs: CrsDef,
): Array<[number, number]> | null {
  const projected: Array<[number, number]> = [];
  for (const point of ring) {
    const ll = projectLocalToWgs84(
      { x: point.x, y: point.y, z: 0 },
      parameters,
      crs,
    );
    if (ll.isOk()) {
      projected.push([ll.value.longitude, ll.value.latitude]);
    }
  }
  return projected.length >= 3 ? projected : null;
}

function projectSpaces(
  spacesLocal: ReadonlyArray<SpaceExtract>,
  parameters: HelmertParams,
  crs: CrsDef,
): ReadonlyArray<SpaceOverlay> | null {
  const out: Array<SpaceOverlay> = [];
  for (const space of spacesLocal) {
    const polygon = projectRing(space.hull, parameters, crs);
    if (!polygon) {
      continue;
    }
    out.push({
      expressID: space.expressID,
      name: space.name,
      longName: space.longName,
      polygon,
    });
  }
  return out.length > 0 ? out : null;
}
