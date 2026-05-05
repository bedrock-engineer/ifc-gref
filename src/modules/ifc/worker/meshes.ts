/* eslint-disable @typescript-eslint/no-explicit-any,
                  @typescript-eslint/no-unsafe-assignment,
                  @typescript-eslint/no-unsafe-member-access,
                  @typescript-eslint/no-unsafe-return,
                  @typescript-eslint/no-unsafe-call,
                  @typescript-eslint/no-base-to-string
*/

import { IFCSITE, IFCSPACE } from "web-ifc";
import { getApi } from "./api";

/**
 * Raw mesh data, ready to feed into a THREE.BufferGeometry on the main thread.
 * Vertices are already transformed into the IFC's local coordinate frame
 * (placed.flatTransformation baked in), so the renderer only has to place the
 * whole model via Helmert + MercatorCoordinate.
 */
export interface MeshExtract {
  positions: Float32Array;
  /**
   * Per-vertex normals from web-ifc, transformed by the rotation portion of
   * `placed.flatTransformation` and put into the same Z-up frame as positions.
   * web-ifc emits face-flat normals at hard edges (duplicated vertices) and
   * smooth normals on curved surfaces — preserving them keeps architectural
   * edges crisp in Lambert shading. Recomputing via `computeVertexNormals()`
   * would smooth-average across shared corners and turn every wall/slab seam
   * into a soft gradient.
   */
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
  /** IfcSpace volumes render semi-transparent so rooms don't occlude each other. */
  isSpace: boolean;
  /** web-ifc line type (e.g. IFCWALL, IFCROOF). Used for class-based default colouring when the file has no surface styles. */
  ifcClass: number;
}

/** Column-major 4x4 transformation matrix, as returned by web-ifc. */
type Mat16 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

function isMat16(m: ArrayLike<number>): m is Mat16 {
  return m.length === 16;
}

export async function extractMeshes(
  modelID: number,
): Promise<Array<MeshExtract>> {
  const ifcAPI = await getApi();
  const out: Array<MeshExtract> = [];

  // Entity census so we can tell whether the file actually has geometry.
  // If there are thousands of IfcWall / IfcSlab / IfcProduct entries but
  // StreamAllMeshes fires zero times, the problem is in web-ifc's geometry
  // decoder — not in our code.
  const schema = ifcAPI.GetModelSchema(modelID);
  const totalLines = ifcAPI.GetAllLines(modelID).size();
  const productCount = ifcAPI
    .GetLineIDsWithType(modelID, 4_217_277_830 /* IFCPRODUCT is not exported */)
    .size();
  const wallCount = ifcAPI
    .GetLineIDsWithType(modelID, 2_391_406_946 /* IFCWALL */)
    .size();
  const slabCount = ifcAPI
    .GetLineIDsWithType(modelID, 1_529_196_076 /* IFCSLAB */)
    .size();
  const siteCount = ifcAPI.GetLineIDsWithType(modelID, IFCSITE).size();
  const buildingCount = ifcAPI
    .GetLineIDsWithType(modelID, 4_031_249_490 /* IFCBUILDING */)
    .size();
  console.log("[worker] extractMeshes census:", {
    schema,
    totalLines,
    productCount,
    wallCount,
    slabCount,
    siteCount,
    buildingCount,
  });

  let callbackFires = 0;
  let totalPlacedGeometries = 0;
  let firstType: number | null = null;

  // Unlike extractFootprint, we DO render IfcSpace here. For spaces-only
  // models (e.g. "Ruimtelijke Elementen" exports) the rooms are the entire
  // model; filtering them out would leave us with nothing to draw. The main
  // thread renders spaces with transparency so they don't occlude each other.
  ifcAPI.StreamAllMeshes(modelID, (mesh) => {
    callbackFires += 1;
    const lineType = ifcAPI.GetLineType(modelID, mesh.expressID);
    firstType ??= lineType;
    const isSpace = lineType === IFCSPACE;
    const placedGeometries = mesh.geometries;
    const count = placedGeometries.size();
    totalPlacedGeometries += count;
    for (let g = 0; g < count; g++) {
      const placed = placedGeometries.get(g);
      const geometry = ifcAPI.GetGeometry(modelID, placed.geometryExpressID);
      const verts = ifcAPI.GetVertexArray(
        geometry.GetVertexData(),
        geometry.GetVertexDataSize(),
      );
      const indices = ifcAPI.GetIndexArray(
        geometry.GetIndexData(),
        geometry.GetIndexDataSize(),
      );

      // web-ifc vertex stride: [x, y, z, nx, ny, nz] interleaved (6 floats).
      // We bake placed.flatTransformation into positions and rotate normals
      // by its 3×3 rotation portion (no translation), so the main thread
      // doesn't need a per-mesh matrix.
      //
      // web-ifc applies a default rotateX(-π/2) so its output is Y-up
      // (mesh = (IFC_X, IFC_Z, -IFC_Y)). We undo that here so everything
      // downstream — the centroid, the convex-hull footprint, and the
      // Helmert transform — can work in IFC-native Z-up coords. The inverse
      // is rotateX(π/2): (x_m, y_m, z_m) → (x_m, -z_m, y_m).
      const m = placed.flatTransformation;
      if (!isMat16(m)) {
        throw new Error(`flatTransformation length ${m.length}, expected 16`);
      }
      // Column-major 4x4. Pull matrix entries into locals once so the
      // per-vertex loop doesn't re-index on every iteration.
      const [m0, m1, m2, , m4, m5, m6, , m8, m9, m10, , m12, m13, m14] = m;

      const vertexCount = verts.length / 6;
      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);
      for (let index = 0; index < vertexCount; index++) {
        // Per-vertex reads into a Float32Array of unknown length. The stride
        // invariant (length % 6 === 0, index < vertexCount) isn't visible to
        // TS under noUncheckedIndexedAccess, and an allocation-free narrowing
        // isn't possible in a hot loop — so assert directly.
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        const x = verts[index * 6]!;
        const y = verts[index * 6 + 1]!;
        const z = verts[index * 6 + 2]!;
        const nx = verts[index * 6 + 3]!;
        const ny = verts[index * 6 + 4]!;
        const nz = verts[index * 6 + 5]!;
        /* eslint-enable @typescript-eslint/no-non-null-assertion */
        const mx = m0 * x + m4 * y + m8 * z + m12;
        const my = m1 * x + m5 * y + m9 * z + m13;
        const mz = m2 * x + m6 * y + m10 * z + m14;
        positions[index * 3] = mx; // IFC_X = mesh_X (east)
        positions[index * 3 + 1] = -mz; // IFC_Y = -mesh_Z (north)
        positions[index * 3 + 2] = my; // IFC_Z = mesh_Y (up)

        // Normals get the 3×3 rotation only — no translation. IFC placements
        // are typically rigid (orthonormal rotation + uniform scale at most),
        // so the inverse-transpose simplifies to the same matrix; we
        // renormalise below to absorb any uniform-scale factor. Then apply
        // the same Y/Z swap as positions to land in IFC-native Z-up.
        const mnx = m0 * nx + m4 * ny + m8 * nz;
        const mny = m1 * nx + m5 * ny + m9 * nz;
        const mnz = m2 * nx + m6 * ny + m10 * nz;
        const swappedX = mnx;
        const swappedY = -mnz;
        const swappedZ = mny;
        const length = Math.hypot(swappedX, swappedY, swappedZ);
        // Degenerate normals (zero-length) get a sentinel +Z; Three.js will
        // shade them as if facing up, which is far less jarring than NaNs.
        const inv = length > 1e-8 ? 1 / length : 0;
        normals[index * 3] = swappedX * inv;
        normals[index * 3 + 1] = swappedY * inv;
        normals[index * 3 + 2] = length > 1e-8 ? swappedZ * inv : 1;
      }

      // Copy indices into a fresh Uint32Array backed by its own buffer so
      // Comlink can clone it across the worker boundary cleanly (the WASM
      // view is a live window into the heap).
      const indexOut = new Uint32Array(indices.length);
      indexOut.set(indices);

      const c = placed.color;
      out.push({
        positions,
        normals,
        indices: indexOut,
        color: [c.x, c.y, c.z, c.w],
        isSpace,
        ifcClass: lineType,
      });

      geometry.delete();
    }
  });

  console.log("[worker] extractMeshes diagnostics:", {
    modelID,
    callbackFires,
    totalPlacedGeometries,
    extractedMeshes: out.length,
    spaceMeshes: out.filter((x) => x.isSpace).length,
    firstTypeSeen: firstType,
    IFCSPACE,
  });

  return out;
}
