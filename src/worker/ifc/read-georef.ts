/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-return,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-base-to-string
*/

import {
  type IfcAPI,
  IFCMAPCONVERSION,
  IFCRELDEFINESBYPROPERTIES,
} from "web-ifc";
import type { HelmertParams } from "../../lib/helmert";
import { emitLog } from "../../lib/log";
import type { IfcSchema } from "./schema";
import {
  buildHelmertFromFields,
  expressIDOf,
  findFirstSiteId,
  isTrivialHelmert,
  rawValue,
} from "./shared";

export interface ExistingGeoref {
  targetCrsName: string;
  helmert: HelmertParams;
}

export interface GeorefRead {
  existingGeoref: ExistingGeoref | null;
  /**
   * EPSG name harvested from IfcProjectedCRS even when the accompanying
   * IfcMapConversion is a Revit-style placeholder (E=N=H=0, Scale=1,
   * rotation≈0). Such a transform is geometrically meaningless — applying
   * it lands coordinates near the CRS's false origin — so we strip it
   * from `existingGeoref` and surface the intended CRS here. The UI
   * pre-fills the EPSG input from the hint but keeps Helmert params null
   * so the user still has to solve from IfcSite ref or survey points.
   */
  targetCrsHint: string | null;
}

export function readExistingGeoref(
  ifcAPI: IfcAPI,
  modelID: number,
  schema: IfcSchema,
): GeorefRead {
  const ids = ifcAPI.GetLineIDsWithType(modelID, IFCMAPCONVERSION);
  if (ids.size() > 0) {
    const mc = ifcAPI.GetLine(modelID, ids.get(0), true);
    const target: any = mc.TargetCRS;
    const targetCrsName = String(rawValue(target?.Name) ?? "");
    const helmert = buildHelmertFromFields({
      scale: rawValue(mc.Scale),
      xAxisAbscissa: rawValue(mc.XAxisAbscissa),
      xAxisOrdinate: rawValue(mc.XAxisOrdinate),
      eastings: rawValue(mc.Eastings),
      northings: rawValue(mc.Northings),
      orthogonalHeight: rawValue(mc.OrthogonalHeight),
    });
    return classifyGeorefRead(helmert, targetCrsName, "IfcMapConversion");
  }
  // ePSet_MapConversion / ePSet_ProjectedCRS is an IFC2X3-only community
  // convention — IFC4+ uses IfcMapConversion above. Scanning every
  // IfcRelDefinesByProperties with flatten=true is expensive on large
  // files, so skip it for schemas that wouldn't contain ePSets anyway.
  if (schema !== "IFC2X3") {
    return { existingGeoref: null, targetCrsHint: null };
  }
  return readEpsetGeoref(ifcAPI, modelID);
}

/**
 * IFC2X3 fallback: scan IfcRelDefinesByProperties for psets named
 * ePset_MapConversion / ePset_ProjectedCRS attached to the IfcSite.
 * Accepts both `ePset_` and `ePSet_` casings — files in the wild use both.
 *
 * Implementation note: we read every rel with `flatten=false` so references
 * stay as cheap Handle objects. Only when RelatedObjects contains the site
 * do we fetch the pset by ID, and only on a name match do we read its
 * properties. Old code used `flatten=true` and recursively materialised
 * every rel's entire subtree — a factor-of-hundreds multiplier vs. the
 * cheap-check-first path below.
 */
function readEpsetGeoref(
  ifcAPI: IfcAPI,
  modelID: number,
): GeorefRead {
  const siteID = findFirstSiteId(ifcAPI, modelID);
  if (siteID == null) {
    return { existingGeoref: null, targetCrsHint: null };
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
    return { existingGeoref: null, targetCrsHint: null };
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
  const helmert = buildHelmertFromFields({
    scale: mcProperties.Scale,
    xAxisAbscissa: mcProperties.XAxisAbscissa,
    xAxisOrdinate: mcProperties.XAxisOrdinate,
    eastings: mcProperties.Eastings,
    northings: mcProperties.Northings,
    orthogonalHeight: mcProperties.OrthogonalHeight,
  });
  return classifyGeorefRead(helmert, targetCrsName, "ePset_MapConversion");
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
 * Shared terminator for both read paths: if the Helmert is Revit's
 * placeholder (zeros + identity), emit a log and keep only the CRS hint;
 * otherwise return it as a real existingGeoref.
 */
function classifyGeorefRead(
  helmert: HelmertParams,
  targetCrsName: string,
  sourceLabel: string,
): GeorefRead {
  const hint = targetCrsName || null;
  if (isTrivialHelmert(helmert)) {
    emitLog({
      source: "worker",
      message: `${sourceLabel} is a placeholder (zeros/identity) — ignoring transform, keeping ${targetCrsName} as CRS hint`,
    });
    return { existingGeoref: null, targetCrsHint: hint };
  }
  return {
    existingGeoref: { targetCrsName, helmert },
    targetCrsHint: hint,
  };
}
