/* eslint-disable @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access
*/

import { polygonHull } from "d3-polygon";
import { IFCSPACE } from "web-ifc";
import { emitLog } from "#lib/log";
import { getApi } from "./api";
import {
  streamPlacedGeometriesOfTypes,
  transformPositionToIfcFrame,
} from "./placed-geometries";
import { stringOrNull } from "./shared";

/**
 * One IfcSpace's 2D outline. `hull` is the convex hull of the projected XY
 * vertices in IFC-local metres (web-ifc auto-converts to metres, see
 * placed-geometries.ts). Cheap-path: convex hull misrepresents L/U-shaped
 * rooms but gets per-room separation on the map without parsing the actual
 * floor face out of the volume.
 */
export interface SpaceExtract {
  expressID: number;
  /** `IfcSpace.Name` — typically the room number ("01.23"). */
  name: string | null;
  /** `IfcSpace.LongName` — typically the room description ("Kitchen"). */
  longName: string | null;
  hull: Array<{ x: number; y: number }>;
}

/**
 * Z-band height used to keep "lowest-storey" spaces and drop upper floors.
 * Spaces on the same storey vary by slab thickness / raised-floor depth
 * (≤~0,5m); spaces on the next storey are at least typical floor-to-floor
 * (~2,7m residential, more in commercial) above. 1,5m sits comfortably
 * between, so same-storey variation survives and a half-storey mezzanine
 * is the only ambiguous case.
 *
 * Cheap-path limitation: this picks the *lowest* cluster, so a building
 * with a basement keeps the basement instead of the ground floor. Promote
 * to `IfcRelContainedInSpatialStructure → IfcBuildingStorey.Elevation`
 * when a real file hits this.
 */
const GROUND_FLOOR_BAND_M = 1.5;

export async function extractSpaces(
  modelID: number,
): Promise<Array<SpaceExtract>> {
  const ifcAPI = await getApi();

  // One IfcSpace can emit multiple PlacedGeometry callbacks; bucket then hull.
  // `StreamAllMeshes` would skip IFCSPACE entirely (web-ifc's WASM-side
  // default filter treats spaces as non-physical), so use the typed variant.
  const pointsByExpressID = new Map<number, Array<[number, number]>>();
  const minZByExpressID = new Map<number, number>();
  const ifcXyz = new Float64Array(3);

  await streamPlacedGeometriesOfTypes(modelID, [IFCSPACE], ({ expressID, matrix, vertices }) => {
    let bucket = pointsByExpressID.get(expressID);
    if (!bucket) {
      bucket = [];
      pointsByExpressID.set(expressID, bucket);
    }
    let minZ = minZByExpressID.get(expressID) ?? Infinity;
    for (let index = 0; index < vertices.length; index += 6) {
      const x = vertices[index];
      const y = vertices[index + 1];
      const z = vertices[index + 2];
      if (x === undefined || y === undefined || z === undefined) {
        continue;
      }
      transformPositionToIfcFrame(matrix, x, y, z, ifcXyz, 0);
      bucket.push([ifcXyz[0] ?? 0, ifcXyz[1] ?? 0]);
      const ifcZ = ifcXyz[2] ?? 0;
      if (ifcZ < minZ) {
        minZ = ifcZ;
      }
    }
    minZByExpressID.set(expressID, minZ);
  });

  let groundMinZ = Infinity;
  for (const z of minZByExpressID.values()) {
    if (z < groundMinZ) {
      groundMinZ = z;
    }
  }
  const cutoffZ = groundMinZ + GROUND_FLOOR_BAND_M;

  const out: Array<SpaceExtract> = [];
  let droppedCount = 0;
  for (const [expressID, points] of pointsByExpressID) {
    if (points.length < 3) {
      continue;
    }
    const minZ = minZByExpressID.get(expressID) ?? Infinity;
    if (minZ > cutoffZ) {
      droppedCount += 1;
      continue;
    }
    const hull = polygonHull(points);
    if (!hull || hull.length < 3) {
      continue;
    }
    const entity = ifcAPI.GetLine(modelID, expressID, false);
    const name = stringOrNull(entity?.Name);
    const longName = stringOrNull(entity?.LongName);
    out.push({
      expressID,
      name,
      longName,
      hull: hull.map(([x, y]) => ({ x, y })),
    });
  }

  const droppedSuffix =
    droppedCount > 0 ? ` (skipped ${droppedCount} on upper storeys)` : "";
  emitLog({
    source: "worker",
    level: "info",
    message: `Extracted ${out.length} IfcSpace footprint${out.length === 1 ? "" : "s"}${droppedSuffix}`,
  });

  return out;
}
