/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-return,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-base-to-string
*/

/* web-ifc's public API is typed as `any` for entity reads
   (GetLine, CreateIfcType, GetLineType) and variadic `any[]` for writes
   (CreateIfcEntity). Every IFC entity traversal in this file flows from
   those `any` returns, so the unsafe-* family fires on ~every line. Not
   worth hand-writing per-entity interfaces for a WASM interop shim. */

import { type IfcAPI, IFCSITE } from "web-ifc";
import type { HelmertParams } from "../../lib/helmert";

/**
 * Returns the flattened first entity of a given type, or null if there are none.
 * "Flattened" means references like ObjectPlacement, RelativePlacement, Location
 * are recursively expanded into nested objects instead of left as Handle refs.
 */
export function firstOf(
  ifcAPI: IfcAPI,
  modelID: number,
  type: number,
): any {
  const ids = ifcAPI.GetLineIDsWithType(modelID, type);
  if (ids.size() === 0) {
    return null;
  }
  return ifcAPI.GetLine(modelID, ids.get(0), true);
}

/** Unwrap an IFC value wrapper (IfcLabel, IfcLengthMeasure, IfcReal, etc.). */
export function rawValue(v: any): any {
  if (v == undefined) {
    return null;
  }
  if (typeof v === "object" && "value" in v) {
    return v.value;
  }
  return v;
}

/**
 * IfcCompoundPlaneAngleMeasure → decimal degrees. Web-ifc returns the value in
 * one of two shapes depending on schema/path:
 *   - bare array of numbers (IFC2X3 path)
 *   - typed wrapper `{ type, value: [...] }` (IFC4X3 path, seen on Revit's
 *     Snowdon Towers export) — looked like a SELECT-wrapped measure
 * We `rawValue` first so both end up as the inner number array.
 */
export function dmsToDecimal(parts: any): number | null {
  const unwrapped = rawValue(parts);
  if (!Array.isArray(unwrapped) || unwrapped.length < 3) {
    return null;
  }
  const nums = unwrapped.map((p) => Number(rawValue(p)));
  const [d = 0, m = 0, s = 0, micro = 0] = nums;
  const sign = d < 0 || m < 0 || s < 0 || micro < 0 ? -1 : 1;
  const abs =
    Math.abs(d) +
    Math.abs(m) / 60 +
    (Math.abs(s) + Math.abs(micro) / 1e6) / 3600;
  return sign * abs;
}

/**
 * Decimal degrees → IfcCompoundPlaneAngleMeasure `[d, m, s, microseconds]`.
 * Inverse of `dmsToDecimal`. IFC convention: all four components share the
 * same sign (S/W are negative on every part, not just the degrees).
 */
export function decimalToDms(decimal: number): [number, number, number, number] {
  const sign = decimal < 0 ? -1 : 1;
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const secondsFloat = (minutesFloat - minutes) * 60;
  const seconds = Math.floor(secondsFloat);
  const microseconds = Math.round((secondsFloat - seconds) * 1e6);
  return [
    sign * degrees,
    sign * minutes,
    sign * seconds,
    sign * microseconds,
  ];
}

export function expressIDOf(o: any): number | null {
  if (o == undefined || typeof o !== "object") {
    return null;
  }
  if (typeof o.expressID === "number") {
    return o.expressID;
  }
  // Handle objects expose their target expressID as `.value`.
  if (typeof o.value === "number") {
    return o.value;
  }
  return null;
}

/**
 * Revit (and a handful of other exporters) write an IfcMapConversion with
 * all translations zero, scale 1 and rotation ≈0 as a "georef placeholder"
 * — structurally valid IFC, semantically meaningless. Treat those as
 * no-georef so we don't apply an identity transform that lands coords at
 * the projected CRS's false origin.
 */
export function isTrivialHelmert(h: HelmertParams): boolean {
  return (
    h.easting === 0
    && h.northing === 0
    && h.height === 0
    && Math.abs(h.scale - 1) < 1e-9
    && Math.abs(h.rotation) < 1e-6
  );
}

/**
 * Build HelmertParams from the six raw numeric fields read off either an
 * IfcMapConversion entity (IFC4+) or an ePset_MapConversion property bag
 * (IFC2X3). Callers pass already-unwrapped values; missing fields get the
 * identity defaults (scale=1, abscissa=1, rest=0).
 */
export function buildHelmertFromFields(fields: {
  scale?: unknown;
  xAxisAbscissa?: unknown;
  xAxisOrdinate?: unknown;
  eastings?: unknown;
  northings?: unknown;
  orthogonalHeight?: unknown;
}): HelmertParams {
  return {
    scale: Number(fields.scale ?? 1),
    rotation: Math.atan2(
      Number(fields.xAxisOrdinate ?? 0),
      Number(fields.xAxisAbscissa ?? 1),
    ),
    easting: Number(fields.eastings ?? 0),
    northing: Number(fields.northings ?? 0),
    height: Number(fields.orthogonalHeight ?? 0),
  };
}

/** IfcMapConversion stores rotation as a unit vector (cos θ, sin θ). */
export function rotationToAxisPair(rotation: number): {
  xAxisAbscissa: number;
  xAxisOrdinate: number;
} {
  return {
    xAxisAbscissa: Math.cos(rotation),
    xAxisOrdinate: Math.sin(rotation),
  };
}

/** First IfcSite's express ID, or null if the model has no site. */
export function findFirstSiteId(
  ifcAPI: IfcAPI,
  modelID: number,
): number | null {
  const ids = ifcAPI.GetLineIDsWithType(modelID, IFCSITE);
  if (ids.size() === 0) {
    return null;
  }
  return ids.get(0);
}
