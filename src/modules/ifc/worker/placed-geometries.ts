import { getApi } from "./api";

// Helper file is purposely small — it's a thin abstraction over web-ifc's
// stream API. It uses no untyped surface itself; web-ifc's PlacedGeometry
// fields we access are all number-typed. No eslint-disable needed.

/** Column-major 4x4 transformation matrix, exactly 16 entries. */
export type Mat16 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/**
 * One placed geometry from a streamed IFC product. Vertices are in web-ifc's
 * mesh-local frame (Y-up); apply `matrix`, then swap axes
 * `(mesh_X, -mesh_Z, mesh_Y) → (IFC_X, IFC_Y, IFC_Z)` to land in IFC-native
 * Z-up. Both `footprint.ts` and `meshes.ts` follow this convention.
 *
 * Concretely, for a vertex `(x, y, z)` and column-major 4x4 `matrix` `m`:
 *   IFC_X =  m[0]*x + m[4]*y + m[8]*z  + m[12]
 *   IFC_Y = -(m[2]*x + m[6]*y + m[10]*z + m[14])
 *   IFC_Z =   m[1]*x + m[5]*y + m[9]*z  + m[13]
 */
export interface PlacedGeometry {
  /** Express ID of the parent IFC product (wall, slab, …). */
  expressID: number;
  /** web-ifc line type constant (IFCWALL, IFCSLAB, IFCSPACE, …). */
  ifcClass: number;
  /** 4x4 column-major flat transformation. Length-checked by the helper. */
  matrix: Mat16;
  /** Interleaved [x, y, z, nx, ny, nz, ...]. Stride 6. */
  vertices: Float32Array;
  /** Triangle indices into `vertices` (stride 3). */
  indices: Uint32Array;
  /** RGBA, components in [0..1]. */
  color: { x: number; y: number; z: number; w: number };
}

function asMat16(m: ArrayLike<number>): Mat16 {
  if (m.length !== 16) {
    throw new Error(`flatTransformation length ${m.length}, expected 16`);
  }
  return m as unknown as Mat16;
}

/**
 * Apply `matrix` to mesh-local point `(x, y, z)` and write the IFC-frame
 * (Z-up) result into `out[outIndex..outIndex+2]`. Out-parameter pattern
 * because hot per-vertex loops can't tolerate the per-call allocation of
 * an object/tuple return.
 */
export function transformPositionToIfcFrame(
  matrix: Mat16,
  x: number, y: number, z: number,
  out: Float32Array | Float64Array,
  outIndex: number,
): void {
  out[outIndex] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  out[outIndex + 1] = -(matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]);
  out[outIndex + 2] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
}

/**
 * Apply the rotation portion of `matrix` to mesh-local direction `(x, y, z)`
 * (no translation), renormalise to unit length, and write the IFC-frame
 * result into `out[outIndex..outIndex+2]`. Use for normals.
 *
 * IFC placements are typically rigid (orthonormal rotation + uniform scale at
 * most), so inverse-transpose collapses to the same 3x3 — renormalise
 * absorbs any uniform scale. Degenerate (zero-length) directions write a
 * `+Z` sentinel so Three.js shades them as facing up rather than producing
 * NaNs.
 */
export function transformDirectionToIfcFrame(
  matrix: Mat16,
  x: number, y: number, z: number,
  out: Float32Array | Float64Array,
  outIndex: number,
): void {
  const dx = matrix[0] * x + matrix[4] * y + matrix[8] * z;
  const dy = -(matrix[2] * x + matrix[6] * y + matrix[10] * z);
  const dz = matrix[1] * x + matrix[5] * y + matrix[9] * z;
  const length = Math.hypot(dx, dy, dz);
  if (length > 1e-8) {
    const inv = 1 / length;
    out[outIndex] = dx * inv;
    out[outIndex + 1] = dy * inv;
    out[outIndex + 2] = dz * inv;
  } else {
    out[outIndex] = 0;
    out[outIndex + 1] = 0;
    out[outIndex + 2] = 1;
  }
}

/**
 * Stream every placed geometry in the model. Hides web-ifc gotchas:
 *
 *   - `geometry.delete()` is called after each callback returns.
 *   - The streamed FlatMesh is owned by web-ifc — calling `mesh.delete()`
 *     throws at runtime.
 *   - Vertex / index buffers are live views into WASM memory; copy them
 *     before the next callback if you need to retain them.
 *
 * Filtering by `ifcClass` (IfcSpace skip, etc.) is the caller's job.
 */
export async function streamPlacedGeometries(
  modelID: number,
  callback: (g: PlacedGeometry) => void,
): Promise<void> {
  const ifcAPI = await getApi();
  ifcAPI.StreamAllMeshes(modelID, (mesh) => {
    // GetLineType is typed `any` in web-ifc; it's documented to return the
    // numeric type constant.
    const ifcClass = Number(ifcAPI.GetLineType(modelID, mesh.expressID));
    const placedGeometries = mesh.geometries;
    const count = placedGeometries.size();
    for (let g = 0; g < count; g++) {
      const placed = placedGeometries.get(g);
      const geometry = ifcAPI.GetGeometry(modelID, placed.geometryExpressID);
      const vertices = ifcAPI.GetVertexArray(
        geometry.GetVertexData(),
        geometry.GetVertexDataSize(),
      );
      const indices = ifcAPI.GetIndexArray(
        geometry.GetIndexData(),
        geometry.GetIndexDataSize(),
      );
      const color = placed.color;
      callback({
        expressID: mesh.expressID,
        ifcClass,
        matrix: asMat16(placed.flatTransformation),
        vertices,
        indices,
        color: { x: color.x, y: color.y, z: color.z, w: color.w },
      });
      geometry.delete();
    }
  });
}
