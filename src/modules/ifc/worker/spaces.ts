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

export async function extractSpaces(
  modelID: number,
): Promise<Array<SpaceExtract>> {
  const ifcAPI = await getApi();

  // One IfcSpace can emit multiple PlacedGeometry callbacks; bucket then hull.
  // `StreamAllMeshes` would skip IFCSPACE entirely (web-ifc's WASM-side
  // default filter treats spaces as non-physical), so use the typed variant.
  const pointsByExpressID = new Map<number, Array<[number, number]>>();
  const ifcXyz = new Float64Array(3);

  await streamPlacedGeometriesOfTypes(modelID, [IFCSPACE], ({ expressID, matrix, vertices }) => {
    let bucket = pointsByExpressID.get(expressID);
    if (!bucket) {
      bucket = [];
      pointsByExpressID.set(expressID, bucket);
    }
    for (let index = 0; index < vertices.length; index += 6) {
      const x = vertices[index];
      const y = vertices[index + 1];
      const z = vertices[index + 2];
      if (x === undefined || y === undefined || z === undefined) {
        continue;
      }
      transformPositionToIfcFrame(matrix, x, y, z, ifcXyz, 0);
      bucket.push([ifcXyz[0] ?? 0, ifcXyz[1] ?? 0]);
    }
  });

  const out: Array<SpaceExtract> = [];
  for (const [expressID, points] of pointsByExpressID) {
    if (points.length < 3) {
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

  emitLog({
    source: "worker",
    level: "info",
    message: `Extracted ${out.length} IfcSpace footprint${out.length === 1 ? "" : "s"}`,
  });

  return out;
}
