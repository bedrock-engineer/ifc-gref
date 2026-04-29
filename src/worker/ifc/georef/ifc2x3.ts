/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-base-to-string,
*/

import {
  type IfcAPI,
  Handle,
  IFCIDENTIFIER,
  IFCLABEL,
  IFCLENGTHMEASURE,
  IFCPROPERTYSET,
  IFCPROPERTYSINGLEVALUE,
  IFCREAL,
  IFCRELDEFINESBYPROPERTIES,
} from "web-ifc";
import type { HelmertParams } from "../../../lib/helmert";
import { emitLog } from "../../../lib/log";
import {
  buildHelmertFromFields,
  expressIDOf,
  findFirstSiteId,
  rawValue,
  rotationToAxisPair,
} from "../shared";
import { classifyGeorefRead, type GeorefRead } from "./shared";

/**
 * IFC2X3 has no native IfcMapConversion. The community convention (OSArch
 * wiki) is two property sets on IfcSite: ePset_MapConversion holds the 7
 * transform fields, ePset_ProjectedCRS holds the target CRS name. Accept
 * both `ePset_` and `ePSet_` casings — files in the wild use both.
 *
 * Implementation note: we read every rel with `flatten=false` so references
 * stay as cheap Handle objects. Only when RelatedObjects contains the site
 * do we fetch the pset by ID, and only on a name match do we read its
 * properties. Old code used `flatten=true` and recursively materialised
 * every rel's entire subtree — a factor-of-hundreds multiplier vs. the
 * cheap-check-first path below.
 */
export function readGeorefIfc2x3(
  ifcAPI: IfcAPI,
  modelID: number,
  ifcMetresPerUnit: number,
): GeorefRead {
  const siteID = findFirstSiteId(ifcAPI, modelID);
  if (siteID == null) {
    return {
      existingGeoref: null,
      targetCrsHint: null,
      verticalDatumHint: null,
    };
  }

  let mapConvID: number | null = null;
  let projectedCrsID: number | null = null;

  for (const { psetID, name } of iterateSitePsets(ifcAPI, modelID, siteID)) {
    if (name === "epset_mapconversion") {
      mapConvID = psetID;
    } else if (name === "epset_projectedcrs") {
      projectedCrsID = psetID;
    }
    if (mapConvID != null && projectedCrsID != null) {
      break;
    }
  }

  if (mapConvID == null && projectedCrsID == null) {
    return {
      existingGeoref: null,
      targetCrsHint: null,
      verticalDatumHint: null,
    };
  }

  const mcProperties =
    mapConvID == null ? {} : readPsetProperties(ifcAPI, modelID, mapConvID);
  const crsProperties =
    projectedCrsID == null
      ? {}
      : readPsetProperties(ifcAPI, modelID, projectedCrsID);
  const targetCrsName = String(
    mcProperties.TargetCRS ?? crsProperties.Name ?? "",
  );
  const verticalRaw = crsProperties.VerticalDatum;
  const verticalDatum =
    typeof verticalRaw === "string" && verticalRaw.length > 0
      ? verticalRaw
      : null;
  // ePset_MapConversion has no MapUnit concept; values are conventionally
  // in the IFC project's length unit. Pass `ifcMetresPerUnit` for both
  // factors so the scale ratio is 1 (on-disk Scale == internal scale).
  const helmert = buildHelmertFromFields(
    {
      scale: mcProperties.Scale,
      xAxisAbscissa: mcProperties.XAxisAbscissa,
      xAxisOrdinate: mcProperties.XAxisOrdinate,
      eastings: mcProperties.Eastings,
      northings: mcProperties.Northings,
      orthogonalHeight: mcProperties.OrthogonalHeight,
    },
    {
      mapUnitMetresPerUnit: ifcMetresPerUnit,
      ifcMetresPerUnit,
    },
  );

  return classifyGeorefRead(
    helmert,
    targetCrsName,
    verticalDatum,
    "ePset_MapConversion",
  );
}

/**
 * Mirrors `set_mapconversion_crs_ifc2x3` in georeference_ifc/main.py, which
 * goes through ifcopenshell.api's pset helpers. Here we build the entities
 * directly via web-ifc because there is no equivalent high-level API.
 */
export function writeGeorefIfc2x3(
  ifcAPI: IfcAPI,
  modelID: number,
  epsgCode: number,
  verticalDatum: string | null,
  parameters: HelmertParams,
): void {
  const siteID = findFirstSiteId(ifcAPI, modelID);
  if (siteID == null) {
    const message = "No IfcSite found in IFC2X3 model";
    emitLog({ level: "error", source: "worker", message });
    throw new Error(message);
  }

  removeExistingGeorefIfc2x3(ifcAPI, modelID, siteID);

  // Reuse the site's OwnerHistory; don't fabricate a new one.
  const siteRaw = ifcAPI.GetLine(modelID, siteID, false);
  const ownerHistoryHandle = siteRaw.OwnerHistory;

  const crsName = `EPSG:${epsgCode}`;
  const { xAxisAbscissa, xAxisOrdinate } = rotationToAxisPair(
    parameters.rotation,
  );

  const projectedCrsProperties = [
    property(ifcAPI, modelID, "Name", IFCLABEL, crsName),
  ];
  if (verticalDatum && verticalDatum.length > 0) {
    projectedCrsProperties.push(
      property(ifcAPI, modelID, "VerticalDatum", IFCIDENTIFIER, verticalDatum),
    );
  }
  const projectedCrsPset = buildPset(
    ifcAPI,
    modelID,
    "ePset_ProjectedCRS",
    ownerHistoryHandle,
    projectedCrsProperties,
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
 * Iterate every IfcRelDefinesByProperties whose RelatedObjects includes the
 * site, yielding the rel ID, pset ID, and lowercased pset name. Shared by
 * the ePSet read path and the ePSet remove path — both need the same
 * cheap-lookup-first traversal.
 */
export function* iterateSitePsets(
  ifcAPI: IfcAPI,
  modelID: number,
  siteID: number,
): Generator<{ relID: number; psetID: number; name: string; pset: any }> {
  const relIds = ifcAPI.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
  for (let index = 0; index < relIds.size(); index++) {
    const relID = relIds.get(index);
    const rel = ifcAPI.GetLine(modelID, relID, false);
    const related = Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : [];
    if (!related.some((o: any) => expressIDOf(o) === siteID)) {
      continue;
    }
    const psetID = expressIDOf(rel.RelatingPropertyDefinition);
    if (psetID == null) {
      continue;
    }
    const pset = ifcAPI.GetLine(modelID, psetID, false);
    const name = String(rawValue(pset?.Name) ?? "").toLowerCase();
    yield { relID, psetID, name, pset };
  }
}

/**
 * Read name/value pairs from an IfcPropertySet by express ID, doing only
 * shallow lookups (one GetLine per IfcPropertySingleValue). The IfcValue
 * wrapped inside NominalValue is inline, so no further flattening is needed.
 */
function readPsetProperties(
  ifcAPI: IfcAPI,
  modelID: number,
  psetID: number,
): Record<string, unknown> {
  const pset = ifcAPI.GetLine(modelID, psetID, false);
  const properties = Array.isArray(pset?.HasProperties)
    ? pset.HasProperties
    : [];
  const out: Record<string, unknown> = {};
  for (const handle of properties) {
    const id = expressIDOf(handle);
    if (id == null) {
      continue;
    }
    const property = ifcAPI.GetLine(modelID, id, false);
    const name = rawValue(property?.Name);
    if (typeof name !== "string") {
      continue;
    }
    out[name] = rawValue(property?.NominalValue);
  }

  return out;
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
