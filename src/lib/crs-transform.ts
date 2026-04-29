import proj4 from "proj4";
import { err, ok, type Result } from "neverthrow";
import type { CrsBbox, CrsDef } from "./crs-types";
import type { XYZ } from "./helmert";

export interface TransformError {
  kind: "transform-failed";
  cause: unknown;
}

interface TransformWgs84ToProjected {
  def: CrsDef;
  longitude: number;
  latitude: number;
  /** Elevation in metres (canonical). Passed through unchanged — proj4
   * doesn't transform vertical for projected CRS. */
  elevation: number;
}

/**
 * Forward: WGS84 lat/lon -> projected CRS, returning planar metres.
 *
 * Takes a `CrsDef` (rather than a bare code) as type-level proof that
 * `lookupCrs` has resolved — i.e. that proj4.defs has the code registered.
 * Without that, proj4 throws.
 *
 * Unit boundary: proj4 returns coordinates in the CRS's natural units
 * (metres for UTM, US-feet for EPSG:2272, etc.). The codebase canonical is
 * metres, so we multiply by `def.metresPerUnit` here. This is the only
 * place `metresPerUnit` is consulted; downstream code stays unit-agnostic.
 *
 * Two failure paths handled symmetrically with the inverse:
 * 1. Out-of-bbox WGS84 inputs are rejected up front. Grid-backed CRSs
 *    (RD, BD72, …) silently produce NaN when proj4js's nadgrid lookup
 *    falls outside the grid's domain — see "Failed to find a grid shift
 *    table for location" warnings in the console. Catching those at the
 *    bbox check gives the caller an actionable error instead of NaN.
 * 2. proj4js can also return Infinity / NaN for far-out-of-area inputs
 *    that don't trigger the bbox check (e.g. when bbox is null). Validate
 *    the output too.
 */
export function transformWgs84ToProjected({
  def,
  longitude,
  latitude,
  elevation,
}: TransformWgs84ToProjected): Result<XYZ, TransformError> {
  if (!isWithinBbox(longitude, latitude, def.bbox)) {
    return err({
      kind: "transform-failed",
      cause: new Error(
        `WGS84 (${longitude.toFixed(4)}, ${latitude.toFixed(4)}) is outside `
        + `the area of use for EPSG:${def.code}`
        + (def.areaOfUse ? ` (${def.areaOfUse})` : ""),
      ),
    });
  }
  try {
    const [xNative, yNative] = proj4("EPSG:4326", `EPSG:${def.code}`, [
      longitude,
      latitude,
    ]);
    if (!Number.isFinite(xNative) || !Number.isFinite(yNative)) {
      return err({
        kind: "transform-failed",
        cause: new Error(
          `proj4js returned non-finite (${xNative}, ${yNative}) for WGS84 `
          + `(${longitude}, ${latitude}) → EPSG:${def.code}`,
        ),
      });
    }
    return ok({
      x: xNative * def.metresPerUnit,
      y: yNative * def.metresPerUnit,
      z: elevation,
    });
  } catch (error) {
    return err({ kind: "transform-failed", cause: error });
  }
}

/**
 * CrsBbox is `[north, west, south, east]` per epsg-index. `null` means we
 * don't know the area of use, in which case we skip the check (better to
 * try and fail than to refuse a CRS that might actually work).
 */
function isWithinBbox(
  longitude: number,
  latitude: number,
  bbox: CrsBbox | null,
): boolean {
  if (!bbox) {return true;}
  const [north, west, south, east] = bbox;
  // Allow a small slack outside the published bbox — area-of-use polygons
  // are conservative and the underlying transformations usually work for a
  // few km past the edge. Surveyors who need centimetre accuracy at the
  // border are a niche concern; the priority is rejecting wildly-wrong
  // inputs (an IfcSite in central France for an NL CRS).
  const slackDeg = 0.5;
  return (
    longitude >= west - slackDeg
    && longitude <= east + slackDeg
    && latitude >= south - slackDeg
    && latitude <= north + slackDeg
  );
}

/**
 * Reverse: projected CRS (planar metres) -> WGS84 lat/lon. Same
 * `CrsDef`-as-proof contract.
 *
 * Unit boundary: caller passes metres (codebase canonical); we divide by
 * `def.metresPerUnit` to feed proj4 in CRS-native units (metres for UTM,
 * US-feet for EPSG:2272, etc.). Symmetric with `transformWgs84ToProjected`.
 *
 * Three failure paths handled:
 * 1. proj4 throws — caught.
 * 2. proj4 returns Infinity / NaN / out-of-globe values — caught.
 * 3. proj4js's nadgrid lookup falls outside the grid (e.g. a placeholder
 *    helmert lands projected coords near RD's false-origin (0,0), which
 *    un-projects to a Bessel lat/lon in central France). proj4js logs
 *    "Failed to find a grid shift table for location 'X Y'" then silently
 *    returns the un-shifted result — which is a *valid* WGS84 lat/lon
 *    but outside the CRS's area of use. Catch this by sanity-checking the
 *    output against `def.bbox`.
 */
export function transformProjectedToWgs84(
  def: CrsDef,
  x: number,
  y: number,
): Result<{ longitude: number; latitude: number }, TransformError> {
  try {
    const xNative = x / def.metresPerUnit;
    const yNative = y / def.metresPerUnit;
    const [longitude, latitude] = proj4(`EPSG:${def.code}`, "EPSG:4326", [
      xNative,
      yNative,
    ]);
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180
    ) {
      return err({ kind: "transform-failed", cause: { longitude, latitude } });
    }
    if (!isWithinBbox(longitude, latitude, def.bbox)) {
      return err({
        kind: "transform-failed",
        cause: new Error(
          `proj4js returned WGS84 (${longitude.toFixed(4)}, ${latitude.toFixed(4)}) `
          + `for projected (${x}, ${y}) in EPSG:${def.code}, but that's outside `
          + `the CRS's area of use`
          + (def.areaOfUse ? ` (${def.areaOfUse})` : "")
          + ". Likely a placeholder IfcMapConversion or a grid-shift miss.",
        ),
      });
    }
    return ok({ longitude, latitude });
  } catch (error) {
    return err({ kind: "transform-failed", cause: error });
  }
}
