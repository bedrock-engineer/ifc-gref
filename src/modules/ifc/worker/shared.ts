/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-return
*/

/* web-ifc's public API is typed as `any` for entity reads
   (GetLine, CreateIfcType, GetLineType) and variadic `any[]` for writes
   (CreateIfcEntity). Every IFC entity traversal in this file flows from
   those `any` returns, so the unsafe-* family fires on ~every line. Not
   worth hand-writing per-entity interfaces for a WASM interop shim. */

import { type IfcAPI, IFCSITE } from "web-ifc";
import type { HelmertParams } from "#modules/helmert/solve";
import { unitToMetres } from "#modules/units/convert";

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
 * An IfcMapConversion with horizontal translation `(E, N) = (0, 0)` is
 * semantically meaningless regardless of the other fields:
 *
 *   - All-zeros + identity is the classic Revit "georef placeholder."
 *   - Zeros + a non-identity scale/rotation/H is a partial placeholder
 *     we've seen in real files (e.g. the project's TrueNorth baked into
 *     the rotation, OrthogonalHeight set, but horizontal still zero).
 *
 * In every variant, applying the transform lands all geometry at the
 * projected CRS's false origin in plan view — which for grid-backed CRSs
 * (RD, BD72, …) un-projects to a Bessel/Lambert lat/lon outside the
 * grid's domain and triggers proj4js's "Failed to find a grid shift
 * table" warning, plus an unusable display.
 *
 * Treat any horizontal-zero helmert as a placeholder and rely on the
 * downstream "use IfcSite reference" / "enter survey points manually"
 * paths instead.
 */
export function isTrivialHelmert(h: HelmertParams): boolean {
  return h.easting === 0 && h.northing === 0;
}

/**
 * The `IfcMapConversion.Scale` unit-conversion ratio: source-unit (IFC
 * project length unit) ↔ MapUnit. Codebase canonical is dimensionless
 * geometric scale (metres in, metres out — see `modules/helmert/solve.ts`),
 * but IFC stores Scale as this dimensionful ratio. Read inverts; write
 * applies:
 *
 *     on_disk = internal × onDiskScaleRatio(ifc, map)
 *     internal = on_disk / onDiskScaleRatio(ifc, map)
 *
 * Worked cases:
 *   - mm IFC + METRE map: ratio = 0.001 (an identity transform writes 0.001)
 *   - metric IFC + METRE map: ratio = 1 (identity writes 1)
 *   - metric IFC + FOOT map: ratio = 1/0.3048 ≈ 3.28
 *   - IFC2X3 ePset (no MapUnit, callers pass map = ifc): ratio = 1, Scale
 *     round-trips unchanged
 *
 * Skipping this conversion shrinks the rendered model by 1000× for an mm
 * project + METRE MapUnit — the 3D layer disappears and the footprint
 * collapses to a dot.
 */
export function onDiskScaleRatio(
  ifcMetresPerUnit: number,
  mapUnitMetresPerUnit: number,
): number {
  return ifcMetresPerUnit / mapUnitMetresPerUnit;
}

/**
 * Build HelmertParams from the six raw numeric fields read off either an
 * IfcMapConversion entity (IFC4+) or an ePset_MapConversion property bag
 * (IFC2X3). Callers pass already-unwrapped values; missing fields get the
 * identity defaults (scale=1, abscissa=1, rest=0).
 *
 * Two unit conversions happen at this boundary:
 *
 * 1. **Translation fields** (`Eastings`, `Northings`, `OrthogonalHeight`)
 *    — IFC 4.x stores these in `IfcProjectedCRS.MapUnit`, *not* the IFC
 *    project's length unit. We multiply by `mapUnitMetresPerUnit` to land
 *    in canonical metres. (IFC2X3 ePset has no MapUnit concept; the
 *    convention there is project units, so callers pass
 *    `mapUnitMetresPerUnit = ifcMetresPerUnit`.)
 *
 * 2. **`Scale`** — strip the on-disk source-unit/MapUnit ratio via
 *    `onDiskScaleRatio` (see above) to land in dimensionless canonical.
 */
export function buildHelmertFromFields(
  fields: {
    scale?: unknown;
    xAxisAbscissa?: unknown;
    xAxisOrdinate?: unknown;
    eastings?: unknown;
    northings?: unknown;
    orthogonalHeight?: unknown;
    /**
     * IFC 4.3 IfcMapConversionScaled per-axis factors. Default to 1 when
     * absent (plain IfcMapConversion / ePset_MapConversion). Per spec,
     * effective per-axis scale is `scale × factor<axis>`.
     */
    factorX?: unknown;
    factorY?: unknown;
    factorZ?: unknown;
  },
  units: {
    mapUnitMetresPerUnit: number;
    ifcMetresPerUnit: number;
  },
): HelmertParams {
  const { mapUnitMetresPerUnit, ifcMetresPerUnit } = units;
  const scale =
    Number(fields.scale ?? 1)
    / onDiskScaleRatio(ifcMetresPerUnit, mapUnitMetresPerUnit);
  const factorX = Number(fields.factorX ?? 1);
  const factorY = Number(fields.factorY ?? 1);
  const factorZ = Number(fields.factorZ ?? 1);
  return {
    xScale: scale * factorX,
    yScale: scale * factorY,
    zScale: scale * factorZ,
    rotation: Math.atan2(
      Number(fields.xAxisOrdinate ?? 0),
      Number(fields.xAxisAbscissa ?? 1),
    ),
    easting: Number(fields.eastings ?? 0) * mapUnitMetresPerUnit,
    northing: Number(fields.northings ?? 0) * mapUnitMetresPerUnit,
    height: Number(fields.orthogonalHeight ?? 0) * mapUnitMetresPerUnit,
  };
}

/**
 * Resolve metres-per-unit from an IfcSIUnit/IfcConversionBasedUnit's
 * Prefix + Name pair. Returns null when the name isn't in our table —
 * callers decide whether to fall back to a project default (read path)
 * or refuse to preserve an unrecognised MapUnit (write path).
 *
 * Handles both branches:
 *  - **IfcSIUnit** (METRE with optional prefix): combine `Prefix + Name`
 *    and resolve through the SI table.
 *  - **IfcConversionBasedUnit** (FOOT, INCH, US-survey-foot, …): use
 *    `Name` directly through the shared `unitToMetres` table. We don't
 *    read `ConversionFactor` for arbitrary precision; for the units we
 *    care about (international foot, inch, yard, mile) the name-based
 *    factor is exact, and US-survey-foot is rare enough as a MapUnit
 *    that the 2 ppm aliasing to international foot is tolerable.
 */
export function nameToMetresPerUnit(prefix: string, name: string): number | null {
  const fullName = `${prefix}${name}`;
  switch (fullName) {
    case "METRE": {
      return 1;
    }
    case "MILLIMETRE": {
      return 0.001;
    }
    case "CENTIMETRE": {
      return 0.01;
    }
    case "DECIMETRE": {
      return 0.1;
    }
    case "KILOMETRE": {
      return 1000;
    }
  }
  const conv = unitToMetres(name);
  if (conv.isOk()) {
    return conv.value;
  }
  return null;
}

/**
 * Resolve the metres-per-unit factor for `IfcProjectedCRS.MapUnit`. If
 * MapUnit is set (the typical Revit / modern-tool case), parse it. If
 * unset or unrecognised, fall back to the IFC project's length unit
 * factor — that's what the IFC spec says.
 */
export function readMapUnitMetresPerUnit(
  projectedCrs: any,
  projectFallback: number,
): number {
  const mapUnit = projectedCrs?.MapUnit;
  if (!mapUnit) {
    return projectFallback;
  }
  const prefix = String(rawValue(mapUnit.Prefix) ?? "");
  const name = String(rawValue(mapUnit.Name) ?? "");
  if (name.length === 0) {
    return projectFallback;
  }
  return nameToMetresPerUnit(prefix, name) ?? projectFallback;
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
