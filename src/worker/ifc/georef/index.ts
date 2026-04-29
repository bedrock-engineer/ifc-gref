/* eslint-disable @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-argument,
*/

import { type IfcAPI, IFCLENGTHMEASURE } from "web-ifc";
import type { HelmertParams } from "../../../lib/helmert";
import { emitLog } from "../../../lib/log";
import { getApi } from "../api";
import { deriveIfcMetresPerUnit } from "../metadata";
import { parseSchema, type IfcSchema } from "../schema";
import { decimalToDms, findFirstSiteId } from "../shared";
import { readGeorefIfc4, writeGeorefIfc4 } from "./ifc4";
import { readGeorefIfc2x3, writeGeorefIfc2x3 } from "./ifc2x3";
import type { GeorefRead, SiteReferenceSync } from "./shared";

export type { ExistingGeoref, GeorefRead, SiteReferenceSync } from "./shared";

/**
 * Read existing georeferencing from a model, picking the right path for the
 * schema: IFC4+ native IfcMapConversion vs. IFC2X3 ePSet convention.
 *
 * `ifcMetresPerUnit` is the boundary multiplier — IfcLengthMeasure-typed
 * fields (Eastings/Northings/OrthogonalHeight) are scaled to metres here so
 * downstream HelmertParams are unit-free in the codebase-wide canonical.
 */
export function readExistingGeoref(
  ifcAPI: IfcAPI,
  modelID: number,
  schema: IfcSchema,
  ifcMetresPerUnit: number,
): GeorefRead {
  if (schema === "IFC2X3") {
    return readGeorefIfc2x3(ifcAPI, modelID, ifcMetresPerUnit);
  }
  return readGeorefIfc4(ifcAPI, modelID, ifcMetresPerUnit);
}

export async function writeMapConversion(
  modelID: number,
  epsgCode: number,
  verticalDatum: string | null,
  parameters: HelmertParams,
  siteReference: SiteReferenceSync | null,
): Promise<void> {
  const ifcAPI = await getApi();
  const schema = parseSchema(ifcAPI.GetModelSchema(modelID));
  const ifcMetresPerUnit = deriveIfcMetresPerUnit(ifcAPI, modelID);

  // Sync IfcSite.RefLatitude/RefLongitude/RefElevation to the new
  // MapConversion so Level-20-only consumers see a consistent location,
  // and so the next re-load of this file doesn't show stale coordinates
  // from the file's original export.
  if (siteReference) {
    syncSiteReference(ifcAPI, modelID, siteReference, ifcMetresPerUnit);
  }

  const verticalSuffix = verticalDatum ? `, vertical=${verticalDatum}` : "";

  if (schema === "IFC2X3") {
    // ePset_MapConversion has no MapUnit concept; values are conventionally
    // in the IFC project's length unit. Convert canonical metres → project
    // units symmetrically with the IFC2X3 read path.
    const projectUnitParameters: HelmertParams = {
      scale: parameters.scale,
      rotation: parameters.rotation,
      easting: parameters.easting / ifcMetresPerUnit,
      northing: parameters.northing / ifcMetresPerUnit,
      height: parameters.height / ifcMetresPerUnit,
    };
    writeGeorefIfc2x3(
      ifcAPI,
      modelID,
      epsgCode,
      verticalDatum,
      projectUnitParameters,
    );
    emitLog({
      source: "worker",
      message: `Wrote ePset_MapConversion (EPSG:${epsgCode}${verticalSuffix}, scale=${projectUnitParameters.scale.toFixed(6)}, rot=${projectUnitParameters.rotation.toFixed(4)} rad)`,
    });
    return;
  }
  // IFC4+: write Eastings/Northings/OrthogonalHeight in metres directly,
  // and tag the new IfcProjectedCRS with MapUnit=METRE so the units are
  // unambiguous to any downstream reader (including our own — round-trip
  // through the MapUnit-aware reader gives identity). The writer also
  // converts internal (dimensionless) scale → on-disk scale (project unit
  // ↔ MapUnit ratio); see writeGeorefIfc4 for the formula.
  writeGeorefIfc4(
    ifcAPI,
    modelID,
    epsgCode,
    verticalDatum,
    parameters,
    ifcMetresPerUnit,
  );
  emitLog({
    source: "worker",
    message: `Wrote IfcMapConversion (EPSG:${epsgCode}${verticalSuffix}, scale=${parameters.scale.toFixed(6)}, rot=${parameters.rotation.toFixed(4)} rad)`,
  });
}

/**
 * Overwrite IfcSite.RefLatitude/RefLongitude/RefElevation with a lat/lon
 * derived from the new MapConversion. No-op if the model has no IfcSite
 * (IFC4 allows that — MapConversion attaches to the geometric
 * representation context, not the site).
 */
function syncSiteReference(
  ifcAPI: IfcAPI,
  modelID: number,
  ref: SiteReferenceSync,
  ifcMetresPerUnit: number,
): void {
  const siteID = findFirstSiteId(ifcAPI, modelID);
  if (siteID == null) {
    return;
  }
  // GetLine with flatten=false keeps Handles to referenced entities
  // (OwnerHistory, ObjectPlacement, ...) intact — WriteLine expects those
  // as handles, not as expanded nested objects.
  const site = ifcAPI.GetLine(modelID, siteID, false);
  // IfcSite has 14 attributes; optional ones (Description, ObjectType,
  // Representation, LandTitleNumber, SiteAddress, ...) are returned as
  // `undefined` when absent in the STEP file. ToRawLineData's serializer
  // then fails with "Cannot convert undefined to int". Normalize to null
  // so every attribute has an explicit value before WriteLine serializes.
  for (const key of Object.keys(site)) {
    if (site[key] === undefined) {
      site[key] = null;
    }
  }
  // web-ifc's CreateIfcType initialiser for IFCCOMPOUNDPLANEANGLEMEASURE
  // expects pre-wrapped `[{value:d},{value:m},...]` (it calls
  // `v.map(x => x.value)` internally) — passing plain numbers produces a
  // broken instance whose inner array is `[undefined, ...]` and then
  // WriteLine throws "Cannot convert undefined to int". We build the shape
  // GetLine would return directly: `{ type: 10, value: [d, m, s, us] }`
  // (`type: 10` is the IfcCompoundPlaneAngleMeasure tape-item tag).
  site.RefLatitude = { type: 10, value: decimalToDms(ref.latitude) };
  site.RefLongitude = { type: 10, value: decimalToDms(ref.longitude) };
  // ref.elevation is canonical metres; IfcLengthMeasure stores in project
  // units, so divide back by ifcMetresPerUnit (mirrors the read boundary).
  site.RefElevation = ifcAPI.CreateIfcType(
    modelID,
    IFCLENGTHMEASURE,
    ref.elevation / ifcMetresPerUnit,
  );
  ifcAPI.WriteLine(modelID, site);
  emitLog({
    source: "worker",
    message: `Synced IfcSite ref to ${ref.latitude.toFixed(6)},${ref.longitude.toFixed(6)} (elev ${ref.elevation.toFixed(3)} m)`,
  });
}
