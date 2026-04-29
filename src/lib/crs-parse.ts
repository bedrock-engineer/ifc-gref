/**
 * Pulls the numeric EPSG code out of strings like "EPSG:28992", "epsg:4326",
 * or just "28992". Returns null if no integer is found.
 */
export function parseEpsgCode(name: string | null | undefined): number | null {
  if (!name) {
    return null;
  }
  const captured = /(\d+)/.exec(name)?.[1];
  if (captured === undefined) {
    return null;
  }
  const n = Number.parseInt(captured, 10);
  return Number.isFinite(n) ? n : null;
}
