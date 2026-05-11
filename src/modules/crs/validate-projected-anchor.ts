import proj4 from "proj4";
import { isWithinBbox } from "./transform";
import type { CrsDef } from "./types";

/**
 * Sanity-check that a user-typed Easting/Northing pair falls inside the
 * selected CRS's published area of use. Catches the common "wrong CRS for
 * these values" mistake — e.g. UTM eastings (~700000) pasted into RD
 * (~95000), where the model lands far outside NL on the map but the form
 * gives no other signal.
 *
 * Inverse-projects (E, N) → (lon, lat) via the selected CRS, then reuses
 * the existing WGS84 bbox containment check from `transform.ts`. Symmetric
 * with `transformWgs84ToProjected`'s forward gate at the other boundary.
 *
 * Fail-open on missing bbox: returns `ok` so the UI stays quiet on CRSes
 * we can't sanity-check rather than flagging a false positive. Callers can
 * read CRS metadata off the `def` they passed in.
 */
export type AnchorValidation =
  | { kind: "ok" }
  | { kind: "outside-area-of-use" }
  | { kind: "inverse-failed" };

interface ValidateInput {
  /** Easting in canonical metres. */
  easting: number;
  /** Northing in canonical metres. */
  northing: number;
  def: CrsDef;
}

export function validateProjectedAnchor({
  easting,
  northing,
  def,
}: ValidateInput): AnchorValidation {
  if (def.bbox === null) {
    return { kind: "ok" };
  }
  const xNative = easting / def.metresPerUnit;
  const yNative = northing / def.metresPerUnit;
  let lon: number;
  let lat: number;
  try {
    [lon, lat] = proj4(`EPSG:${def.code}`, "EPSG:4326", [xNative, yNative]);
  } catch {
    return { kind: "inverse-failed" };
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return { kind: "inverse-failed" };
  }
  if (!isWithinBbox(lon, lat, def.bbox)) {
    return { kind: "outside-area-of-use" };
  }
  return { kind: "ok" };
}
