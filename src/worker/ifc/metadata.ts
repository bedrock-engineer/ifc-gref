/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-return,
*/

import {
  type IfcAPI,
  IFCGEOMETRICREPRESENTATIONCONTEXT,
  IFCPROJECT,
  IFCSITE,
  IFCUNITASSIGNMENT,
} from "web-ifc";
import type { XYZ } from "../../lib/helmert";
import { emitLog } from "../../lib/log";
import { unitToMetres } from "../../lib/units";
import { isValidLatLon } from "../../lib/validators";
import { getApi } from "./api";
import {
  type ExistingGeoref,
  type MapConversionStatus,
  type RawMapConversion,
  type RawProjectedCrs,
  readExistingGeoref,
} from "./georef";
import { type IfcSchema, parseSchema } from "./schema";
import { dmsToDecimal, firstOf, rawValue } from "./shared";

export interface IfcMetadata {
  schema: IfcSchema;
  /** Set if the IfcSite has RefLatitude/RefLongitude */
  siteReference: {
    latitude: number;
    longitude: number;
    elevation: number;
  } | null;
  /** Local origin from IfcSite.ObjectPlacement.RelativePlacement */
  localOrigin: XYZ | null;
  /** Length unit name from IfcUnitAssignment, e.g. "METRE", "MILLIMETRE" */
  lengthUnit: string;
  /** TrueNorth direction (XAxisOrdinate, XAxisAbscissa) if present */
  trueNorth: { abscissa: number; ordinate: number } | null;
  /** Existing georeferencing if the file is already georeferenced */
  existingGeoref: ExistingGeoref | null;
  /** See GeorefRead.targetCrsHint. */
  targetCrsHint: string | null;
  /** See GeorefRead.verticalDatumHint. */
  verticalDatumHint: string | null;
  /** Verbatim-from-file IfcProjectedCRS / ePset_ProjectedCRS attributes. */
  rawProjectedCrs: RawProjectedCrs | null;
  /** Verbatim-from-file IfcMapConversion / ePset_MapConversion fields. */
  rawMapConversion: RawMapConversion | null;
  mapConversionStatus: MapConversionStatus;
}

/**
 * Worker-side unit boundary. The codebase-wide canonical is metres (see
 * `lib/helmert.ts`); every IfcLengthMeasure-typed value read by this module
 * is multiplied by this factor exactly once, here. The inverse multiplier
 * is applied symmetrically by the write path (`writeMapConversion`).
 * Unknown units fall back to 1.
 */
export function deriveIfcMetresPerUnit(
  ifcAPI: IfcAPI,
  modelID: number,
): number {
  const project = firstOf(ifcAPI, modelID, IFCPROJECT);
  const lengthUnit = readLengthUnit(ifcAPI, modelID, project);
  const result = unitToMetres(lengthUnit);
  return result.isOk() ? result.value : 1;
}

export async function readMetadata(modelID: number): Promise<IfcMetadata> {
  const ifcAPI = await getApi();
  const schema = parseSchema(ifcAPI.GetModelSchema(modelID));

  const site = firstOf(ifcAPI, modelID, IFCSITE);
  const project = firstOf(ifcAPI, modelID, IFCPROJECT);
  const lengthUnit = readLengthUnit(ifcAPI, modelID, project);
  const lengthUnitMetres = unitToMetres(lengthUnit);
  const ifcMetresPerUnit = lengthUnitMetres.isOk() ? lengthUnitMetres.value : 1;

  const georef = readExistingGeoref(ifcAPI, modelID, schema, ifcMetresPerUnit);
  const metadata: IfcMetadata = {
    schema,
    siteReference: readSiteReference(site, ifcMetresPerUnit),
    localOrigin: readLocalOrigin(site, ifcMetresPerUnit),
    lengthUnit,
    trueNorth: readTrueNorth(ifcAPI, modelID, project),
    existingGeoref: georef.existingGeoref,
    targetCrsHint: georef.targetCrsHint,
    verticalDatumHint: georef.verticalDatumHint,
    rawProjectedCrs: georef.rawProjectedCrs,
    rawMapConversion: georef.rawMapConversion,
    mapConversionStatus: georef.mapConversionStatus,
  };

  emitLog({
    source: "worker",
    message: `Read metadata: ${metadata.schema}, unit=${metadata.lengthUnit}${
      metadata.siteReference
        ? `, IfcSite ref=${metadata.siteReference.latitude.toFixed(6)},${metadata.siteReference.longitude.toFixed(6)}`
        : ""
    }`,
  });

  return metadata;
}

function readSiteReference(
  site: any,
  ifcMetresPerUnit: number,
): { latitude: number; longitude: number; elevation: number } | null {
  if (!site) {
    return null;
  }

  const lat = dmsToDecimal(site.RefLatitude);
  const lon = dmsToDecimal(site.RefLongitude);
  if (lat == null || lon == null || !isValidLatLon(lat, lon)) {
    return null;
  }
  const elev = Number(rawValue(site.RefElevation) ?? 0) * ifcMetresPerUnit;
  return { latitude: lat, longitude: lon, elevation: elev };
}

function readLocalOrigin(site: any, ifcMetresPerUnit: number): XYZ | null {
  if (!site) {
    return null;
  }
  const placement = site.ObjectPlacement;
  if (!placement) {
    return null;
  }
  const rel = placement.RelativePlacement;
  const coords: Array<any> | undefined = rel?.Location?.Coordinates;
  if (!Array.isArray(coords) || coords.length < 3) {
    return null;
  }
  return {
    x: Number(rawValue(coords[0])) * ifcMetresPerUnit,
    y: Number(rawValue(coords[1])) * ifcMetresPerUnit,
    z: Number(rawValue(coords[2])) * ifcMetresPerUnit,
  };
}

function readLengthUnit(ifcAPI: IfcAPI, modelID: number, project: any): string {
  // Prefer IfcProject.UnitsInContext, fall back to any IfcUnitAssignment.
  const assignment =
    project?.UnitsInContext ?? firstOf(ifcAPI, modelID, IFCUNITASSIGNMENT);
  if (!assignment?.Units) {
    return "METRE";
  }
  for (const unit of assignment.Units) {
    // UnitType is also enum-wrapped in newer web-ifc versions, so unwrap
    // before comparing — otherwise `{type, value: "LENGTHUNIT"} !== "LENGTHUNIT"`
    // skips every unit and we fall through to the METRE fallback.
    if (rawValue(unit?.UnitType) !== "LENGTHUNIT") {
      continue;
    }
    // IfcSIUnit: combine optional Prefix + Name -> e.g. MILLI + METRE -> MILLIMETRE.
    // web-ifc wraps enums as `{type, value}` — without rawValue we'd get
    // `[object Object][object Object]` and fall through to METRE.
    if (unit.Name) {
      const prefix = rawValue(unit.Prefix) ?? "";
      const name = rawValue(unit.Name) ?? "";
      return `${String(prefix)}${String(name)}`;
    }
    // IfcConversionBasedUnit: use Name directly.
    const name = rawValue(unit.Name);
    if (typeof name === "string") {
      return name;
    }
  }
  return "METRE";
}

function readTrueNorth(
  ifcAPI: IfcAPI,
  modelID: number,
  project: any,
): { abscissa: number; ordinate: number } | null {
  // Walk IfcProject.RepresentationContexts -> first IfcGeometricRepresentationContext.TrueNorth
  const contexts: Array<any> | undefined = project?.RepresentationContexts;
  let trueNorth: any = null;
  if (Array.isArray(contexts)) {
    for (const context of contexts) {
      if (context?.TrueNorth) {
        trueNorth = context.TrueNorth;
        break;
      }
    }
  }
  // Fall back to scanning all geometric representation contexts.
  if (!trueNorth) {
    const context = firstOf(ifcAPI, modelID, IFCGEOMETRICREPRESENTATIONCONTEXT);
    trueNorth = context?.TrueNorth ?? null;
  }
  const ratios: Array<any> | undefined = trueNorth?.DirectionRatios;
  if (!Array.isArray(ratios) || ratios.length < 2) {
    return null;
  }
  return {
    abscissa: Number(rawValue(ratios[0])),
    ordinate: Number(rawValue(ratios[1])),
  };
}
