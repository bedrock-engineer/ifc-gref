/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
*/

import {
  type IfcAPI,
  Handle,
  IFCGEOMETRICREPRESENTATIONCONTEXT,
  IFCIDENTIFIER,
  IFCLABEL,
  IFCLENGTHMEASURE,
  IFCMAPCONVERSION,
  IFCMAPCONVERSIONSCALED,
  IFCPROJECTEDCRS,
  IFCREAL,
  IFCSIUNIT,
} from "web-ifc";
import type { HelmertParams } from "#modules/helmert/solve";
import { emitLog } from "#lib/log";
import {
  buildHelmertFromFields,
  rawValue,
  readMapUnitMetresPerUnit,
  rotationToAxisPair,
} from "../shared";
import {
  absentGeorefRead,
  classifyGeorefRead,
  type GeorefRead,
  type RawProjectedCrs,
} from "./shared";

/**
 * IFC4+ read path. Looks for a native IfcMapConversion entity and reads
 * its six Helmert fields + the referenced IfcProjectedCRS attributes.
 */
export function readGeorefIfc4(
  ifcAPI: IfcAPI,
  modelID: number,
  ifcMetresPerUnit: number,
): GeorefRead {
  // `includeInherited: true` makes the query also return IfcMapConversionScaled
  // instances (an IFC 4.3 subtype that adds FactorX/Y/Z for non-isotropic
  // scaling). We dispatch on the entity's type tag below.
  const ids = ifcAPI.GetLineIDsWithType(modelID, IFCMAPCONVERSION, true);
  if (ids.size() === 0) {
    // Even without a MapConversion, a stand-alone IfcProjectedCRS may
    // still exist in the file (rare; the IFC4 model is supposed to
    // attach via MapConversion). We don't pursue it — without a
    // transform there's nothing to anchor it to.
    return absentGeorefRead(null);
  }
  const mc = ifcAPI.GetLine(modelID, ids.get(0), true);
  const target: any = mc.TargetCRS;
  const rawProjectedCrs = readRawProjectedCrsIfc4(target);
  // Eastings/Northings/OrthogonalHeight live in IfcProjectedCRS.MapUnit,
  // not in the IFC project's length unit (see Revit-authored mm files
  // that nonetheless write Eastings in metres because MapUnit=METRE).
  const mapUnitMetresPerUnit = readMapUnitMetresPerUnit(
    target,
    ifcMetresPerUnit,
  );
  const onDiskScale = optionalNumber(mc.Scale, 1);
  const onDiskXAbs = optionalNumber(mc.XAxisAbscissa, 1);
  const onDiskXOrd = optionalNumber(mc.XAxisOrdinate, 0);
  const onDiskE = optionalNumber(mc.Eastings, 0);
  const onDiskN = optionalNumber(mc.Northings, 0);
  const onDiskH = optionalNumber(mc.OrthogonalHeight, 0);

  // IFC 4.3 IfcMapConversionScaled: per-spec, effective per-axis scale is
  // Scale × Factor<axis>. FactorX/Y/Z default to 1 when the entity is plain
  // IfcMapConversion (the fields don't exist; rawValue returns undefined →
  // optionalNumber falls back to 1).
  const isScaled = mc.type === IFCMAPCONVERSIONSCALED;
  const factorX = isScaled ? optionalNumber(mc.FactorX, 1) : 1;
  const factorY = isScaled ? optionalNumber(mc.FactorY, 1) : 1;
  const factorZ = isScaled ? optionalNumber(mc.FactorZ, 1) : 1;

  const helmert = buildHelmertFromFields(
    {
      scale: onDiskScale,
      xAxisAbscissa: onDiskXAbs,
      xAxisOrdinate: onDiskXOrd,
      eastings: onDiskE,
      northings: onDiskN,
      orthogonalHeight: onDiskH,
      factorX,
      factorY,
      factorZ,
    },
    { mapUnitMetresPerUnit, ifcMetresPerUnit },
  );

  if (isScaled && factorX !== factorY) {
    emitLog({
      level: "warn",
      source: "worker",
      message: `IfcMapConversionScaled has FactorX (${factorX}) ≠ FactorY (${factorY}) — non-conformal projection or unusual workflow. Using FactorX for both axes; the asymmetry will not survive a save through this tool.`,
    });
  }

  return classifyGeorefRead({
    helmert,
    rawProjectedCrs,
    rawMapConversion: {
      eastings: onDiskE,
      northings: onDiskN,
      orthogonalHeight: onDiskH,
      scale: onDiskScale,
      xAxisAbscissa: onDiskXAbs,
      xAxisOrdinate: onDiskXOrd,
      factorX: isScaled ? factorX : null,
      factorY: isScaled ? factorY : null,
      factorZ: isScaled ? factorZ : null,
    },
    sourceLabel: isScaled ? "IfcMapConversionScaled" : "IfcMapConversion",
  });
}

function readRawProjectedCrsIfc4(target: any): RawProjectedCrs | null {
  if (!target) {
    return null;
  }
  return {
    name: optionalString(target.Name),
    description: optionalString(target.Description),
    geodeticDatum: optionalString(target.GeodeticDatum),
    verticalDatum: optionalString(target.VerticalDatum),
    mapProjection: optionalString(target.MapProjection),
    mapZone: optionalString(target.MapZone),
    mapUnit: readMapUnitLabel(target.MapUnit),
  };
}

/**
 * Combine an IfcSIUnit's Prefix + Name into a single readable label
 * ("MILLIMETRE", "METRE", …). Falls back to a free-form Name string for
 * IfcConversionBasedUnit. Null when MapUnit is unset.
 */
function readMapUnitLabel(mapUnit: any): string | null {
  if (!mapUnit) {
    return null;
  }
  const prefix = optionalString(mapUnit.Prefix) ?? "";
  const name = optionalString(mapUnit.Name);
  if (name == null) {
    return null;
  }
  return `${prefix}${name}`;
}

function optionalString(v: unknown): string | null {
  const raw = rawValue(v);
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return raw;
}

function optionalNumber(v: unknown, fallback: number): number {
  const raw = rawValue(v);
  if (raw == null) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Hand-constructs IfcProjectedCRS + IfcMapConversion for IFC4 schemas and
 * attaches them to the first IfcGeometricRepresentationContext (which acts
 * as the SourceCRS, per the IFC4 IfcCoordinateReferenceSystemSelect rule).
 *
 * Mirrors `set_mapconversion_crs_ifc4` in georeference_ifc/main.py.
 *
 * `parameters` are codebase-canonical (metres + dimensionless scale, see
 * `modules/helmert/solve.ts`). We always emit `MapUnit=METRE` so eastings/northings/
 * height go on disk in metres directly. The on-disk Scale, however, is the
 * IFC convention (project unit ↔ MapUnit ratio) — so an mm project's
 * Scale field carries the project unit factor (× `ifcMetresPerUnit`)
 * even though the internal scale is dimensionless.
 */
export function writeGeorefIfc4(
  ifcAPI: IfcAPI,
  modelID: number,
  epsgCode: number,
  verticalDatum: string | null,
  parameters: HelmertParams,
  ifcMetresPerUnit: number,
): void {
  removeExistingGeorefIfc4(ifcAPI, modelID);

  const contextIds = ifcAPI.GetLineIDsWithType(
    modelID,
    IFCGEOMETRICREPRESENTATIONCONTEXT,
  );
  if (contextIds.size() === 0) {
    const message = "No IfcGeometricRepresentationContext found in model";
    emitLog({ level: "error", source: "worker", message });
    throw new Error(message);
  }
  const sourceContextID = contextIds.get(0);

  const crsName = `EPSG:${epsgCode}`;
  const verticalDatumValue =
    verticalDatum && verticalDatum.length > 0
      ? ifcAPI.CreateIfcType(modelID, IFCIDENTIFIER, verticalDatum)
      : null;

  // IfcSIUnit for MapUnit. We always write in metres so the file is
  // unambiguous — Eastings/Northings/OrthogonalHeight on the
  // IfcMapConversion are then in metres regardless of the IFC project's
  // length unit. This matches Revit-authored output and round-trips
  // through readMapUnitMetresPerUnit cleanly.
  // IfcSIUnit(Dimensions, UnitType, Prefix, Name)
  const metreUnit = ifcAPI.CreateIfcEntity(
    modelID,
    IFCSIUNIT,
    null,
    { type: 3, value: "LENGTHUNIT" },
    null,
    { type: 3, value: "METRE" },
  );

  // IfcProjectedCRS(Name, Description, GeodeticDatum, VerticalDatum,
  //                 MapProjection, MapZone, MapUnit)
  const projectedCRS = ifcAPI.CreateIfcEntity(
    modelID,
    IFCPROJECTEDCRS,
    ifcAPI.CreateIfcType(modelID, IFCLABEL, crsName),
    null,
    null,
    verticalDatumValue,
    null,
    null,
    metreUnit,
  );

  // IfcMapConversion(SourceCRS, TargetCRS, Eastings, Northings,
  //                  OrthogonalHeight, XAxisAbscissa, XAxisOrdinate, Scale)
  const { xAxisAbscissa, xAxisOrdinate } = rotationToAxisPair(
    parameters.rotation,
  );

  // Inverse of the read-side scale conversion (see `buildHelmertFromFields`):
  //   on_disk = internal × ifcUnit / mapUnit
  // We always write mapUnit=METRE here, so the formula simplifies to
  // × ifcMetresPerUnit. For an mm IFC + identity Helmert this writes the
  // spec-mandated 0.001; for a metric IFC it writes 1.0.
  //
  // Writing plain IfcMapConversion drops the per-axis distinction. On
  // pre-4.3 the fitter uses solveHelmertJoint which sets all three scales
  // equal, so nothing is lost. On 4.3 with anisotropic params (from
  // solveHelmertSplit or from reading an IfcMapConversionScaled file), the
  // schema-aware writer in writeMapConversion dispatches to a separate
  // IfcMapConversionScaled writer instead of this function.
  const onDiskScale = parameters.xScale * ifcMetresPerUnit;

  const mapConversion = ifcAPI.CreateIfcEntity(
    modelID,
    IFCMAPCONVERSION,
    new Handle(sourceContextID),
    projectedCRS,
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, parameters.easting),
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, parameters.northing),
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, parameters.height),
    ifcAPI.CreateIfcType(modelID, IFCREAL, xAxisAbscissa),
    ifcAPI.CreateIfcType(modelID, IFCREAL, xAxisOrdinate),
    ifcAPI.CreateIfcType(modelID, IFCREAL, onDiskScale),
  );

  // WriteLine recursively writes nested entities (the projectedCRS) first,
  // assigns expressIDs, and replaces them with Handles.
  ifcAPI.WriteLine(modelID, mapConversion);
}

/**
 * Hand-constructs IfcProjectedCRS + IfcMapConversionScaled (IFC 4.3 only).
 * Used when the fitter produced anisotropic per-axis scales (typically from
 * `solveHelmertSplit`) — the Scaled subtype carries `FactorX/Y/Z` so the
 * file faithfully encodes the asymmetry instead of flattening to one Scale.
 *
 * Spec mapping: effective per-axis scale on disk is `Scale × Factor<axis>`.
 * We put the unit-conversion ratio in Scale (so it stays a unit-conversion
 * field, matching the inherited semantic) and the geometric per-axis values
 * in Factors. For MapUnit=METRE this gives Scale = ifcMetresPerUnit and
 * FactorX/Y/Z = the dimensionless geometric scales.
 */
export function writeGeorefIfc4Scaled(
  ifcAPI: IfcAPI,
  modelID: number,
  epsgCode: number,
  verticalDatum: string | null,
  parameters: HelmertParams,
  ifcMetresPerUnit: number,
): void {
  removeExistingGeorefIfc4(ifcAPI, modelID);

  const contextIds = ifcAPI.GetLineIDsWithType(
    modelID,
    IFCGEOMETRICREPRESENTATIONCONTEXT,
  );
  if (contextIds.size() === 0) {
    const message = "No IfcGeometricRepresentationContext found in model";
    emitLog({ level: "error", source: "worker", message });
    throw new Error(message);
  }
  const sourceContextID = contextIds.get(0);

  const crsName = `EPSG:${epsgCode}`;
  const verticalDatumValue =
    verticalDatum && verticalDatum.length > 0
      ? ifcAPI.CreateIfcType(modelID, IFCIDENTIFIER, verticalDatum)
      : null;

  const metreUnit = ifcAPI.CreateIfcEntity(
    modelID,
    IFCSIUNIT,
    null,
    { type: 3, value: "LENGTHUNIT" },
    null,
    { type: 3, value: "METRE" },
  );

  const projectedCRS = ifcAPI.CreateIfcEntity(
    modelID,
    IFCPROJECTEDCRS,
    ifcAPI.CreateIfcType(modelID, IFCLABEL, crsName),
    null,
    null,
    verticalDatumValue,
    null,
    null,
    metreUnit,
  );

  const { xAxisAbscissa, xAxisOrdinate } = rotationToAxisPair(
    parameters.rotation,
  );

  const onDiskScale = ifcMetresPerUnit;

  // IfcMapConversionScaled(SourceCRS, TargetCRS, Eastings, Northings,
  //                        OrthogonalHeight, XAxisAbscissa, XAxisOrdinate,
  //                        Scale, FactorX, FactorY, FactorZ)
  const mapConversion = ifcAPI.CreateIfcEntity(
    modelID,
    IFCMAPCONVERSIONSCALED,
    new Handle(sourceContextID),
    projectedCRS,
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, parameters.easting),
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, parameters.northing),
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, parameters.height),
    ifcAPI.CreateIfcType(modelID, IFCREAL, xAxisAbscissa),
    ifcAPI.CreateIfcType(modelID, IFCREAL, xAxisOrdinate),
    ifcAPI.CreateIfcType(modelID, IFCREAL, onDiskScale),
    ifcAPI.CreateIfcType(modelID, IFCREAL, parameters.xScale),
    ifcAPI.CreateIfcType(modelID, IFCREAL, parameters.yScale),
    ifcAPI.CreateIfcType(modelID, IFCREAL, parameters.zScale),
  );

  ifcAPI.WriteLine(modelID, mapConversion);
}

/**
 * Delete existing IfcMapConversion (and the IFC 4.3 IfcMapConversionScaled
 * subtype, via includeInherited) and IfcProjectedCRS entities from an IFC4+
 * model so a subsequent write doesn't create duplicates.
 */
function removeExistingGeorefIfc4(ifcAPI: IfcAPI, modelID: number): void {
  // Delete IfcMapConversion first (it references IfcProjectedCRS). The
  // includeInherited flag ensures IfcMapConversionScaled instances are
  // collected in the same query.
  const mcIds = ifcAPI.GetLineIDsWithType(modelID, IFCMAPCONVERSION, true);
  for (let index = 0; index < mcIds.size(); index++) {
    ifcAPI.DeleteLine(modelID, mcIds.get(index));
  }
  const crsIds = ifcAPI.GetLineIDsWithType(modelID, IFCPROJECTEDCRS);
  for (let index = 0; index < crsIds.size(); index++) {
    ifcAPI.DeleteLine(modelID, crsIds.get(index));
  }
}
