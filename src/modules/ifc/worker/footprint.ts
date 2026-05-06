/* eslint-disable @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access
*/

import { polygonHull } from "d3-polygon";
import {
  type IfcAPI,
  IFCBUILDINGELEMENTPROXY,
  IFCBUILDINGSTOREY,
  IFCSPACE,
} from "web-ifc";
import { emitLog } from "#lib/log";
import { getApi } from "./api";
import { deriveIfcMetresPerUnit } from "./metadata";
import {
  streamPlacedGeometries,
  transformPositionToIfcFrame,
} from "./placed-geometries";
import { rawValue } from "./shared";

interface Storey {
  elevationM: number;
  name: string;
}

/**
 * MiniBIM-style "Referentie-object" proxies are tiny markers at the survey /
 * CRS origin and would drag the convex hull far beyond the actual building.
 */
function findReferencePointIds(
  ifcAPI: IfcAPI,
  modelID: number,
): Set<number> {
  const ids = new Set<number>();
  const proxyIds = ifcAPI.GetLineIDsWithType(modelID, IFCBUILDINGELEMENTPROXY);
  for (let index = 0; index < proxyIds.size(); index++) {
    const id = proxyIds.get(index);
    const proxy = ifcAPI.GetLine(modelID, id, false);
    if (proxy?.ObjectType?.value === "Referentie-object") {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Ground floor = storey with the smallest non-negative elevation. Returns
 * null for infrastructure schemas (IfcBridge, IfcRoad, …) which have no
 * IfcBuildingStorey, and for storey-less buildings.
 */
function findGroundStorey(
  ifcAPI: IfcAPI,
  modelID: number,
  ifcMetresPerUnit: number,
): Storey | null {
  const ids = ifcAPI.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
  let best: Storey | null = null;
  for (let index = 0; index < ids.size(); index++) {
    const storey = ifcAPI.GetLine(modelID, ids.get(index), false);
    const elevation = Number(rawValue(storey?.Elevation));
    if (!Number.isFinite(elevation) || elevation < 0) {
      continue;
    }
    const elevationM = elevation * ifcMetresPerUnit;
    if (best === null || elevationM < best.elevationM) {
      best = { elevationM, name: String(rawValue(storey?.Name) ?? "") };
    }
  }
  return best;
}

/**
 * 2D convex hull of the building's ground-floor outline, in local IFC
 * coordinates. Filters meshes by Z-range overlap with a 1m-tall band sitting
 * 10cm above the ground storey — excludes basement, roof, and balconies on
 * other floors. The filter is whole-mesh, not per-vertex: vertical walls only
 * have corner vertices, so a strict per-vertex test would drop walls entirely.
 *
 * Falls back to a full-mesh hull when no IfcBuildingStorey exists. IfcSpace
 * meshes are skipped — they are virtual room volumes that would inflate the
 * hull. Returns null when fewer than 3 points contribute.
 */
export async function extractFootprint(
  modelID: number,
): Promise<Array<{ x: number; y: number }> | null> {
  const ifcAPI = await getApi();
  const ifcMetresPerUnit = deriveIfcMetresPerUnit(ifcAPI, modelID);
  const ground = findGroundStorey(ifcAPI, modelID, ifcMetresPerUnit);
  const referencePointIds = findReferencePointIds(ifcAPI, modelID);

  // web-ifc auto-converts geometry to metres, so the slice band is in metres
  // and we compare directly to per-vertex Z without a unit factor.
  const sliceLo = ground ? ground.elevationM + 0.1 : -Infinity;
  const sliceHi = ground ? ground.elevationM + 1.1 : Infinity;

  const xy: Array<[number, number]> = [];
  // Scratch buffer reused across vertices — Float64Array preserves precision
  // (the global xy is plain JS doubles), and the out-parameter pattern keeps
  // the hot loop allocation-free.
  const ifcXyz = new Float64Array(3);
  let included = 0;
  let skipped = 0;

  await streamPlacedGeometries(modelID, ({ expressID, ifcClass, matrix, vertices }) => {
    if (ifcClass === IFCSPACE || referencePointIds.has(expressID)) {
      return;
    }

    const start = xy.length;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let index = 0; index < vertices.length; index += 6) {
      const x = vertices[index];
      const y = vertices[index + 1];
      const z = vertices[index + 2];
      if (x === undefined || y === undefined || z === undefined) {
        continue;
      }
      transformPositionToIfcFrame(matrix, x, y, z, ifcXyz, 0);
      const ifcZ = ifcXyz[2] ?? 0;
      if (ifcZ < zMin) {
        zMin = ifcZ;
      }
      if (ifcZ > zMax) {
        zMax = ifcZ;
      }
      xy.push([ifcXyz[0] ?? 0, ifcXyz[1] ?? 0]);
    }
    if (zMax >= sliceLo && zMin <= sliceHi) {
      included += 1;
    } else {
      // Roll back: this mesh's Z range doesn't overlap the band.
      xy.length = start;
      skipped += 1;
    }
  });

  emitLog({
    source: "worker",
    level: ground ? "info" : "warn",
    message: ground
      ? `Footprint: ground floor at Z=${ground.elevationM.toFixed(2)}m${ground.name ? ` ('${ground.name}')` : ""} (${included} meshes in slice, ${skipped} excluded)`
      : `Footprint: no IfcBuildingStorey — using full-mesh hull (may include overhangs / basement)`,
  });

  if (xy.length < 3) {
    return null;
  }
  const hull = polygonHull(xy);
  return hull?.map(([x, y]) => ({ x, y })) ?? null;
}
