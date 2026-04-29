import proj4 from "proj4";
import type { CrsDef } from "./crs-types";

/**
 * A best-guess place to aim the map camera for a CRS when the file has no
 * georeferencing yet. `bounds` is the CRS's area-of-use rectangle (fit the
 * camera to it); `center` is the projection's natural origin, used only when
 * a bbox isn't available.
 */
export type CrsViewTarget =
  | { kind: "bounds"; west: number; south: number; east: number; north: number }
  | { kind: "center"; longitude: number; latitude: number };

/**
 * Pick a WGS84 target to centre the map on for this CRS. Prefers the bbox
 * (covers the whole area of use), falls back to the projection's natural
 * origin `+lat_0`/`+lon_0` pulled off proj4's parsed definition (stored in
 * radians, hence the conversion). Returns null for degenerate origins like
 * Pseudo-Mercator's (0, 0) where auto-zooming would send the camera to the
 * Gulf of Guinea.
 */
export function deriveCrsViewTarget(def: CrsDef): CrsViewTarget | null {
  if (def.bbox) {
    const [north, west, south, east] = def.bbox;
    return { kind: "bounds", west, south, east, north };
  }
  const parsed = proj4.defs(`EPSG:${def.code}`) as
    | { lat0?: number; long0?: number }
    | undefined;
  const lat0 = parsed?.lat0;
  const long0 = parsed?.long0;
  if (typeof lat0 !== "number" || typeof long0 !== "number") {
    return null;
  }
  if (lat0 === 0 && long0 === 0) {
    return null;
  }
  const toDeg = 180 / Math.PI;
  return { kind: "center", longitude: long0 * toDeg, latitude: lat0 * toDeg };
}
