import { err, ok, type Result } from "neverthrow";
import { applyHelmert } from "./helmert";
import { transformProjectedToWgs84, type CrsDef, type TransformError } from "./crs";
import type { IfcMetadata } from "../worker/ifc";

export type DeriveMapReferenceError =
  | { kind: "no-site-reference-and-no-georef" }
  | { kind: "crs-not-ready" }
  | { kind: "site-reference-outside-crs"; lat: number; lon: number; crsCode: number }
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
 *    Validated against `activeCrs.bbox` so a stale geocoded site reference
 *    in the wrong country (seen in Revit-style placeholder files) doesn't
 *    quietly fly the camera somewhere absurd.
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
    return transformProjectedToWgs84(activeCrs, projected.x, projected.y);
  }
  if (metadata.siteReference) {
    const { latitude, longitude } = metadata.siteReference;
    // If we know the CRS's area of use, refuse a site reference that
    // sits outside it — that's a sign the IfcSite RefLat/RefLon is a
    // stale placeholder, and flying the map to whatever bogus place it
    // names is more confusing than admitting we don't know where the
    // file belongs. (Symmetric with the bbox guard in
    // transformWgs84ToProjected.)
    if (activeCrs && !isWithinBboxLoose(longitude, latitude, activeCrs)) {
      return err({
        kind: "site-reference-outside-crs",
        lat: latitude,
        lon: longitude,
        crsCode: activeCrs.code,
      });
    }
    return ok({ latitude, longitude });
  }
  return err({ kind: "no-site-reference-and-no-georef" });
}

function isWithinBboxLoose(
  longitude: number,
  latitude: number,
  def: CrsDef,
): boolean {
  if (!def.bbox) {return true;}
  const [north, west, south, east] = def.bbox;
  const slack = 0.5;
  return (
    longitude >= west - slack
    && longitude <= east + slack
    && latitude >= south - slack
    && latitude <= north + slack
  );
}
