/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-return,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-base-to-string
*/

import { polygonHull } from "d3-polygon";
import { type IfcAPI, IFCBUILDINGELEMENTPROXY, IFCSPACE } from "web-ifc";
import { getApi } from "./api";

/**
 * Express IDs of IfcBuildingElementProxy instances whose ObjectType marks
 * them as reference points (e.g. MiniBIM's "Referentie-object" — the
 * Lokaal-coordinatiepunt and CRS-coordinatiepunt markers). Their tiny
 * geometries sit at the survey / CRS origin and would otherwise drag the
 * convex hull far beyond the actual building envelope.
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
 * Extract a 2D convex-hull footprint of all model geometry, in the local
 * IFC coordinate system. Streams every product mesh, transforms its vertices
 * by `flatTransformation` to model space, and accumulates only XY into a
 * single hull computation.
 *
 * IfcSpace meshes are skipped — they are virtual room volumes and would
 * inflate the hull beyond the physical building envelope. MiniBIM-style
 * reference-point proxies are skipped for the same reason.
 *
 * Returns null when there is no usable geometry (empty model, all-Space, or
 * fewer than 3 unique points).
 */
export async function extractFootprint(
  modelID: number,
): Promise<Array<{ x: number; y: number }> | null> {
  const ifcAPI = await getApi();

  const referencePointIds = findReferencePointIds(ifcAPI, modelID);

  // Accumulator for XY pairs in flat array form (cheaper than object allocs).
  // We rely on d3-polygon's tolerance for duplicates rather than dedup here —
  // the hull is O(n log n) and a few million points hash-deduping would cost
  // more than just sorting them.
  const xy: Array<Array<number>> = [];

  ifcAPI.StreamAllMeshes(modelID, (mesh) => {
    if (ifcAPI.GetLineType(modelID, mesh.expressID) === IFCSPACE) {
      return;
    }
    if (referencePointIds.has(mesh.expressID)) {
      return;
    }

    const placedGeometries = mesh.geometries;
    const count = placedGeometries.size();
    for (let g = 0; g < count; g++) {
      const placed = placedGeometries.get(g);
      const geometry = ifcAPI.GetGeometry(modelID, placed.geometryExpressID);
      const verts = ifcAPI.GetVertexArray(
        geometry.GetVertexData(),
        geometry.GetVertexDataSize(),
      );
      // web-ifc vertex stride: [x, y, z, nx, ny, nz] interleaved.
      // Undo web-ifc's default Y-up rotation so we emit IFC-native Z-up
      // coords. The ground-plane projection is then (IFC_X, IFC_Y) =
      // (mesh_X, -mesh_Z), which is what Helmert expects.
      // 4x4 column-major; destructure only the cells we need (skipping
      // the rest with empty slots) so each has a concrete `number` type —
      // the array is guaranteed 16-long by web-ifc, defaults just satisfy
      // `noUncheckedIndexedAccess`.
      const [
        m0 = 0,
        ,
        m2 = 0,
        ,
        m4 = 0,
        ,
        m6 = 0,
        ,
        m8 = 0,
        ,
        m10 = 0,
        ,
        m12 = 0,
        ,
        m14 = 0,
      ] = placed.flatTransformation;
      for (let index = 0; index < verts.length; index += 6) {
        const x = verts[index];
        const y = verts[index + 1];
        const z = verts[index + 2];
        if (x === undefined || y === undefined || z === undefined) {
          continue;
        }
        const wx = m0 * x + m4 * y + m8 * z + m12;
        const wz = m2 * x + m6 * y + m10 * z + m14;
        xy.push([wx, -wz]);
      }
      geometry.delete();
    }
    // Note: do NOT call mesh.delete() — the FlatMesh handed to the
    // StreamAllMeshes callback is owned by the stream and freed after
    // the callback returns. Calling delete() here throws at runtime
    // (the method only exists on FlatMesh instances returned by
    // GetFlatMesh / LoadAllGeometry, not on streamed meshes).
  });

  if (xy.length < 3) {
    return null;
  }
  const hull = polygonHull(xy as Array<[number, number]>);
  if (!hull) {
    return null;
  }
  return hull.map(([x, y]) => ({ x, y }));
}
