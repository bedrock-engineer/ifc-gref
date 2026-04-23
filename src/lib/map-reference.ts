import { err, ok, type Result } from "neverthrow";
import { applyHelmert } from "./helmert";
import { transformProjectedToWgs84, type CrsDef, type TransformError } from "./crs";
import type { IfcMetadata } from "../worker/ifc";

export type DeriveMapReferenceError =
  | { kind: "no-site-reference-and-no-georef" }
  | { kind: "crs-not-ready" }
  | TransformError;

/**
 * Derive a WGS84 lat/lon for the map marker. Synchronous — by the time this
 * is called, the CrsDef handed in is known to be registered with proj4
 * (that's the point of threading CrsDef through props rather than a raw
 * code string).
 *
 * Paths, in order of priority per Geonovum's LoGeoRef ranking (higher
 * level wins):
 * 1. IfcMapConversion + local origin → Helmert forward + reverse-project
 *    through `activeCrs.code`. LoGeoRef 50, authoritative when present.
 * 2. IfcSite RefLatitude/RefLongitude → use directly. LoGeoRef 20.
 *
 * We deliberately do NOT fall back to the site reference when a
 * MapConversion exists but the target CRS hasn't resolved yet — the site
 * reference is often a stale geocoded address left over from an earlier
 * export, and returning it would briefly fly the camera to the wrong
 * place. `crs-not-ready` is the honest state.
 */
export function deriveMapReference(
  metadata: IfcMetadata,
  activeCrs: CrsDef | null,
): Result<{ latitude: number; longitude: number }, DeriveMapReferenceError> {
  if (metadata.existingGeoref && metadata.localOrigin) {
    if (!activeCrs) {
      return err({ kind: "crs-not-ready" });
    }
    const projected = applyHelmert(
      metadata.localOrigin,
      metadata.existingGeoref.helmert,
    );
    return transformProjectedToWgs84(activeCrs.code, projected.x, projected.y);
  }
  if (metadata.siteReference) {
    return ok({
      latitude: metadata.siteReference.latitude,
      longitude: metadata.siteReference.longitude,
    });
  }
  return err({ kind: "no-site-reference-and-no-georef" });
}
