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
  IFCPROJECTEDCRS,
  IFCPROPERTYSET,
  IFCPROPERTYSINGLEVALUE,
  IFCREAL,
  IFCRELDEFINESBYPROPERTIES,
} from "web-ifc";
import type { HelmertParams } from "../../lib/helmert";
import { emitLog } from "../../lib/log";
import { getApi } from "./api";
import { iterateSitePsets } from "./read-georef";
import { parseSchema } from "./schema";
import {
  decimalToDms,
  expressIDOf,
  findFirstSiteId,
  rotationToAxisPair,
} from "./shared";

/**
 * The WGS84 anchor synced onto IfcSite when writing a new MapConversion.
 * Computed on the main thread by reverse-projecting (Eastings, Northings)
 * through the target CRS, so the worker doesn't need proj4.
 */
export interface SiteReferenceSync {
  latitude: number;
  longitude: number;
  elevation: number;
}

export async function writeMapConversion(
  modelID: number,
  epsgCode: number,
  parameters: HelmertParams,
  siteReference: SiteReferenceSync | null,
): Promise<void> {
  const ifcAPI = await getApi();
  const schema = parseSchema(ifcAPI.GetModelSchema(modelID));

  // Sync IfcSite.RefLatitude/RefLongitude/RefElevation to the new
  // MapConversion so Level-20-only consumers see a consistent location,
  // and so the next re-load of this file doesn't show stale coordinates
  // from the file's original export. Policy per Geonovum §03 + bSI AU
  // "User Guide for Geo-referencing in IFC" — IfcMapConversion is
  // authoritative; IfcSite ref must not diverge.
  if (siteReference) {
    syncSiteReference(ifcAPI, modelID, siteReference);
  }

  if (schema === "IFC2X3") {
    writeMapConversionIfc2x3(ifcAPI, modelID, epsgCode, parameters);
    emitLog({
      source: "worker",
      message: `Wrote ePset_MapConversion (EPSG:${epsgCode}, scale=${parameters.scale.toFixed(6)}, rot=${parameters.rotation.toFixed(4)} rad)`,
    });
    return;
  }
  writeMapConversionIfc4(ifcAPI, modelID, epsgCode, parameters);
  emitLog({
    source: "worker",
    message: `Wrote IfcMapConversion (EPSG:${epsgCode}, scale=${parameters.scale.toFixed(6)}, rot=${parameters.rotation.toFixed(4)} rad)`,
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
  site.RefElevation = ifcAPI.CreateIfcType(
    modelID,
    IFCLENGTHMEASURE,
    ref.elevation,
  );
  ifcAPI.WriteLine(modelID, site);
  emitLog({
    source: "worker",
    message: `Synced IfcSite ref to ${ref.latitude.toFixed(6)},${ref.longitude.toFixed(6)} (elev ${ref.elevation.toFixed(3)})`,
  });
}

/**
 * Hand-constructs IfcProjectedCRS + IfcMapConversion for IFC4 schemas and
 * attaches them to the first IfcGeometricRepresentationContext (which acts
 * as the SourceCRS, per the IFC4 IfcCoordinateReferenceSystemSelect rule).
 *
 * Mirrors `set_mapconversion_crs_ifc4` in georeference_ifc/main.py.
 */
function writeMapConversionIfc4(
  ifcAPI: IfcAPI,
  modelID: number,
  epsgCode: number,
  parameters: HelmertParams,
): void {
  // Remove any existing IfcMapConversion + IfcProjectedCRS so we don't
  // produce duplicates when the user re-writes georeferencing.
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

  // IfcProjectedCRS(Name, Description, GeodeticDatum, VerticalDatum,
  //                 MapProjection, MapZone, MapUnit)
  const projectedCRS = ifcAPI.CreateIfcEntity(
    modelID,
    IFCPROJECTEDCRS,
    ifcAPI.CreateIfcType(modelID, IFCLABEL, crsName),
    null,
    null,
    null,
    null,
    null,
    null,
  );

  // IfcMapConversion(SourceCRS, TargetCRS, Eastings, Northings,
  //                  OrthogonalHeight, XAxisAbscissa, XAxisOrdinate, Scale)
  const { xAxisAbscissa, xAxisOrdinate } = rotationToAxisPair(parameters.rotation);

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
    ifcAPI.CreateIfcType(modelID, IFCREAL, parameters.scale),
  );

  // WriteLine recursively writes nested entities (the projectedCRS) first,
  // assigns expressIDs, and replaces them with Handles.
  ifcAPI.WriteLine(modelID, mapConversion);
}

/**
 * IFC2X3 has no native IfcMapConversion entity. The community convention
 * (OSArch wiki) is two property sets on IfcSite: ePset_MapConversion holds
 * the 7 transform fields, ePset_ProjectedCRS holds the target CRS name.
 *
 * Mirrors `set_mapconversion_crs_ifc2x3` in georeference_ifc/main.py, which
 * goes through ifcopenshell.api's pset helpers. Here we build the entities
 * directly via web-ifc because there is no equivalent high-level API.
 */
function writeMapConversionIfc2x3(
  ifcAPI: IfcAPI,
  modelID: number,
  epsgCode: number,
  parameters: HelmertParams,
): void {
  const siteID = findFirstSiteId(ifcAPI, modelID);
  if (siteID == null) {
    const message = "No IfcSite found in IFC2X3 model";
    emitLog({ level: "error", source: "worker", message });
    throw new Error(message);
  }

  // Remove any existing ePset_MapConversion / ePset_ProjectedCRS so we
  // don't produce duplicates when the user re-writes georeferencing.
  removeExistingGeorefIfc2x3(ifcAPI, modelID, siteID);

  // Reuse the site's OwnerHistory; don't fabricate a new one.
  const siteRaw = ifcAPI.GetLine(modelID, siteID, false);
  const ownerHistoryHandle = siteRaw.OwnerHistory;

  const crsName = `EPSG:${epsgCode}`;
  const { xAxisAbscissa, xAxisOrdinate } = rotationToAxisPair(parameters.rotation);

  const projectedCrsPset = buildPset(
    ifcAPI,
    modelID,
    "ePset_ProjectedCRS",
    ownerHistoryHandle,
    [property(ifcAPI, modelID, "Name", IFCLABEL, crsName)],
  );
  writePsetRel(ifcAPI, modelID, ownerHistoryHandle, siteID, projectedCrsPset);

  const mapConvPset = buildPset(
    ifcAPI,
    modelID,
    "ePset_MapConversion",
    ownerHistoryHandle,
    [
      property(ifcAPI, modelID, "TargetCRS", IFCLABEL, crsName),
      property(ifcAPI, modelID, "Eastings", IFCLENGTHMEASURE, parameters.easting),
      property(ifcAPI, modelID, "Northings", IFCLENGTHMEASURE, parameters.northing),
      property(ifcAPI, modelID, "OrthogonalHeight", IFCLENGTHMEASURE, parameters.height),
      property(ifcAPI, modelID, "XAxisAbscissa", IFCREAL, xAxisAbscissa),
      property(ifcAPI, modelID, "XAxisOrdinate", IFCREAL, xAxisOrdinate),
      property(ifcAPI, modelID, "Scale", IFCREAL, parameters.scale),
    ],
  );
  writePsetRel(ifcAPI, modelID, ownerHistoryHandle, siteID, mapConvPset);
}

/**
 * Delete existing IfcMapConversion and IfcProjectedCRS entities from an
 * IFC4+ model so a subsequent write doesn't create duplicates.
 */
function removeExistingGeorefIfc4(
  ifcAPI: IfcAPI,
  modelID: number,
): void {
  // Delete IfcMapConversion first (it references IfcProjectedCRS).
  const mcIds = ifcAPI.GetLineIDsWithType(modelID, IFCMAPCONVERSION);
  for (let index = 0; index < mcIds.size(); index++) {
    ifcAPI.DeleteLine(modelID, mcIds.get(index));
  }
  const crsIds = ifcAPI.GetLineIDsWithType(modelID, IFCPROJECTEDCRS);
  for (let index = 0; index < crsIds.size(); index++) {
    ifcAPI.DeleteLine(modelID, crsIds.get(index));
  }
}

/**
 * Delete existing ePset_MapConversion / ePset_ProjectedCRS property sets
 * and their IfcRelDefinesByProperties from an IFC2X3 model so a subsequent
 * write doesn't create duplicates.
 *
 * Deletes the rel, the pset, and every IfcPropertySingleValue inside it.
 */
function removeExistingGeorefIfc2x3(
  ifcAPI: IfcAPI,
  modelID: number,
  siteID: number,
): void {
  for (const { relID, psetID, name, pset } of iterateSitePsets(
    ifcAPI,
    modelID,
    siteID,
  )) {
    if (name !== "epset_mapconversion" && name !== "epset_projectedcrs") {
      continue;
    }
    // Delete each IfcPropertySingleValue inside the pset.
    const properties = pset?.HasProperties;
    if (Array.isArray(properties)) {
      for (const singleValue of properties) {
        const singleValueID = expressIDOf(singleValue);
        if (singleValueID != null) {
          ifcAPI.DeleteLine(modelID, singleValueID);
        }
      }
    }
    ifcAPI.DeleteLine(modelID, psetID);
    ifcAPI.DeleteLine(modelID, relID);
  }
}

function property(
  ifcAPI: IfcAPI,
  modelID: number,
  name: string,
  valueType: number,
  value: number | string,
): any {
  return ifcAPI.CreateIfcEntity(
    modelID,
    IFCPROPERTYSINGLEVALUE,
    ifcAPI.CreateIfcType(modelID, IFCIDENTIFIER, name),
    null,
    ifcAPI.CreateIfcType(modelID, valueType, value),
    null,
  );
}

function buildPset(
  ifcAPI: IfcAPI,
  modelID: number,
  name: string,
  ownerHistory: any,
  properties: Array<any>,
): any {
  return ifcAPI.CreateIfcEntity(
    modelID,
    IFCPROPERTYSET,
    ifcAPI.CreateIFCGloballyUniqueId(modelID),
    ownerHistory,
    ifcAPI.CreateIfcType(modelID, IFCLABEL, name),
    null,
    properties,
  );
}

function writePsetRel(
  ifcAPI: IfcAPI,
  modelID: number,
  ownerHistory: any,
  siteID: number,
  pset: any,
): void {
  const rel = ifcAPI.CreateIfcEntity(
    modelID,
    IFCRELDEFINESBYPROPERTIES,
    ifcAPI.CreateIFCGloballyUniqueId(modelID),
    ownerHistory,
    null,
    null,
    [new Handle(siteID)],
    pset,
  );
  ifcAPI.WriteLine(modelID, rel);
}
