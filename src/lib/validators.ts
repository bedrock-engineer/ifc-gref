/**
 * Pure value validators. No dependencies — safe to import from workers
 * without pulling in proj4 / web-ifc / three.
 */

/**
 * True when `lat` / `lon` are finite numbers within WGS84 ranges and not
 * the (0, 0) placeholder that non-georeferenced IFC files often carry on
 * IfcSite. (0, 0) is technically valid Null Island but in the BIM domain
 * it's always a "no reference set" signal — a real building is never there.
 */
export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180 &&
    !(lat === 0 && lon === 0)
  )
}
