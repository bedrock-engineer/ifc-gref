/* eslint-disable @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-argument
*/

import { IFCLENGTHMEASURE } from "web-ifc";
import { emitLog } from "#lib/log";
import { getApi } from "./api";
import { findFirstSiteId } from "./shared";

/**
 * Zero `IfcSite.ObjectPlacement.RelativePlacement.Location.Coordinates`
 * in place. Used to "unbake" projected coordinates that an exporter wrote
 * into the site placement instead of `IfcMapConversion` — the caller
 * pairs this with a `writeMapConversion` call whose `(E, N, H)` equals
 * the original baked translation, so the world position is preserved.
 *
 * Math: vertex chain becomes `placement(0,0,0) → MC(E,N,H)` instead of
 * `placement(E,N,H) → no-MC`. Same world coords, but the offset now sits
 * in the IFC-spec-correct entity.
 *
 * Leaves the placement's `Axis` / `RefDirection` alone — any rotation
 * baked into the placement stays there. That's mathematically equivalent
 * (the placement still applies the rotation in the same place in the
 * transform chain) and avoids the additional complexity of decomposing
 * placement-rotation onto `MC.XAxisAbscissa`/`Ordinate`.
 *
 * Overwrites the existing `IfcCartesianPoint` in place rather than
 * minting a fresh one. The site-placement Location point is
 * conceptually owned by the site placement; sharing is vanishingly
 * rare in practice. If a file is ever caught sharing the entity, the
 * fix is to clone instead — but the simpler path covers every real-
 * world case we've seen.
 */
export async function zeroSitePlacementLocation(
  modelID: number,
): Promise<void> {
  const ifcAPI = await getApi();
  const siteID = findFirstSiteId(ifcAPI, modelID);
  if (siteID == null) {
    return;
  }
  // GetLine(flatten=false): keeps referenced entities as Handles so we
  // can walk by expressID. flatten=true would expand into nested
  // objects, which WriteLine won't accept on a sibling entity.
  const site = ifcAPI.GetLine(modelID, siteID, false);
  const placementID: number | undefined = site.ObjectPlacement?.value;
  if (placementID == null) {
    return;
  }
  const placement = ifcAPI.GetLine(modelID, placementID, false);
  const relID: number | undefined = placement.RelativePlacement?.value;
  if (relID == null) {
    return;
  }
  const rel = ifcAPI.GetLine(modelID, relID, false);
  const locationID: number | undefined = rel.Location?.value;
  if (locationID == null) {
    return;
  }
  const location = ifcAPI.GetLine(modelID, locationID, false);

  // IfcCartesianPoint.Coordinates is `LIST [1:3] OF IfcLengthMeasure`.
  // Zero is unit-agnostic — 0 mm = 0 m = 0 ft — so we skip the
  // ifcMetresPerUnit factor here. Use three fresh wrappers; WriteLine
  // serializes each.
  const zero = ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, 0);
  location.Coordinates = [zero, zero, zero];

  // ToRawLineData rejects `undefined` attributes ("Cannot convert
  // undefined to int"). IfcCartesianPoint has only one user-set field
  // (Coordinates), but inherited / internal slots can still surface as
  // undefined — normalise defensively, same pattern as syncSiteReference.
  for (const key of Object.keys(location)) {
    if (location[key] === undefined) {
      location[key] = null;
    }
  }

  ifcAPI.WriteLine(modelID, location);
  emitLog({
    source: "worker",
    message:
      "Zeroed IfcSite.ObjectPlacement.RelativePlacement.Location, baked offset moved to IfcMapConversion",
  });
}
