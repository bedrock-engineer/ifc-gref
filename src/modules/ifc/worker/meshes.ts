import { IFCSITE, IFCSPACE } from "web-ifc";
import { getApi } from "./api";
import {
  type PlacedGeometry,
  streamPlacedGeometries,
  streamPlacedGeometriesOfTypes,
  transformDirectionToIfcFrame,
  transformPositionToIfcFrame,
} from "./placed-geometries";

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

export async function extractMeshes(
  modelID: number,
): Promise<Array<MeshExtract>> {
  const ifcAPI = await getApi();
  const out: Array<MeshExtract> = [];

  // Entity census so we can tell whether the file actually has geometry.
  // If there are thousands of IfcWall / IfcSlab / IfcProduct entries but
  // StreamAllMeshes fires zero times, the problem is in web-ifc's geometry
  // decoder — not in our code.
  console.log("[worker] extractMeshes census:", {
    schema: ifcAPI.GetModelSchema(modelID),
    totalLines: ifcAPI.GetAllLines(modelID).size(),
    productCount: ifcAPI
      .GetLineIDsWithType(
        modelID,
        4_217_277_830 /* IFCPRODUCT is not exported */,
      )
      .size(),
    wallCount: ifcAPI
      .GetLineIDsWithType(modelID, 2_391_406_946 /* IFCWALL */)
      .size(),
    slabCount: ifcAPI
      .GetLineIDsWithType(modelID, 1_529_196_076 /* IFCSLAB */)
      .size(),
    siteCount: ifcAPI.GetLineIDsWithType(modelID, IFCSITE).size(),
    buildingCount: ifcAPI
      .GetLineIDsWithType(modelID, 4_031_249_490 /* IFCBUILDING */)
      .size(),
  });

  // Two passes: the default `StreamAllMeshes` skips IFCSPACE (and other
  // non-physical types like IFCOPENINGELEMENT) via a WASM-side filter, so a
  // spaces-only "Ruimtelijke Elementen" export would otherwise have nothing
  // to draw. A second pass with explicit types picks them up.
  await streamPlacedGeometries(modelID, (placed) => {
    emitMesh(placed, out);
  });
  await streamPlacedGeometriesOfTypes(modelID, [IFCSPACE], (placed) => {
    emitMesh(placed, out);
  });

  console.log("[worker] extractMeshes diagnostics:", {
    modelID,
    extractedMeshes: out.length,
    spaceMeshes: out.filter((x) => x.isSpace).length,
  });

  return out;
}

function emitMesh(
  { ifcClass, matrix, vertices, indices, color }: PlacedGeometry,
  out: Array<MeshExtract>,
): void {
  const vertexCount = vertices.length / 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index++) {
    // Per-vertex reads into a Float32Array of unknown length. The stride
    // invariant (length % 6 === 0, index < vertexCount) isn't visible to
    // TS under noUncheckedIndexedAccess, and an allocation-free narrowing
    // isn't possible in a hot loop — so assert directly.
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    const x = vertices[index * 6]!;
    const y = vertices[index * 6 + 1]!;
    const z = vertices[index * 6 + 2]!;
    const nx = vertices[index * 6 + 3]!;
    const ny = vertices[index * 6 + 4]!;
    const nz = vertices[index * 6 + 5]!;
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
    transformPositionToIfcFrame(matrix, x, y, z, positions, index * 3);
    transformDirectionToIfcFrame(matrix, nx, ny, nz, normals, index * 3);
  }

  // Copy indices into a fresh Uint32Array backed by its own buffer so
  // Comlink can clone it across the worker boundary cleanly (the WASM
  // view is a live window into the heap).
  const indexOut = new Uint32Array(indices.length);
  indexOut.set(indices);

  out.push({
    positions,
    normals,
    indices: indexOut,
    color: [color.x, color.y, color.z, color.w],
    isSpace: ifcClass === IFCSPACE,
    ifcClass,
  });
}
