import { type Result } from "neverthrow";
import { type CrsDef } from "./crs-types";
import {
  transformProjectedToWgs84,
  type TransformError,
} from "./crs-transform";
import { applyHelmert, type HelmertParams, type XYZ } from "./helmert";

export interface LngLat {
  longitude: number;
  latitude: number;
}

/**
 * Compose Helmert + proj4: take a point in the local IFC frame (metres,
 * canonical) and return its WGS84 lng/lat in the active projected CRS.
 *
 * Centralises the two-step "apply Helmert, then unproject" that footprint
 * projection, anchor placement, and bbox sanity-gating all need. Callers
 * that also need the projected XY (e.g. residual computation) should call
 * `applyHelmert` directly — `applyHelmert` is pure math and free to call
 * twice, so this primitive stays focused on the lng/lat-only case.
 */
export function projectLocalToWgs84(
  local: XYZ,
  parameters: HelmertParams,
  activeCrs: CrsDef,
): Result<LngLat, TransformError> {
  const projected = applyHelmert(local, parameters);
  return transformProjectedToWgs84(activeCrs, projected.x, projected.y);
}
