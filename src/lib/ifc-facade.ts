import type { HelmertParams } from "./helmert";
import type { IfcMetadata, MeshExtract, SiteReferenceSync } from "../worker/ifc";

/**
 * Backend-agnostic interface for IFC file operations. The UI calls
 * these methods without knowing whether the backend is web-ifc,
 * IfcOpenShell via Pyodide, or something else.
 *
 * Stateful: at most one model is "open" at a time. Calling `open()`
 * again implicitly closes the previous model.
 */
export interface IfcFacade {
  /**
   * Parse an IFC file. Closes any previously opened model. The backend
   * streams chunks from the `File` on demand rather than materializing
   * the whole file in JS heap. `onProgress` receives a fraction between
   * 0 and 1 during parsing.
   */
  open(
    file: File,
    onProgress?: (fraction: number) => void,
  ): Promise<void>;
  /** Read georeferencing metadata from the currently open model. */
  readMetadata(): Promise<IfcMetadata>;
  /** Extract the 2D convex-hull footprint in local coordinates. */
  extractFootprint(): Promise<Array<{ x: number; y: number }> | null>;
  /** Extract triangle meshes for 3D rendering. */
  extractMeshes(): Promise<Array<MeshExtract>>;
  /**
   * Write IfcMapConversion + IfcProjectedCRS into the open model. When
   * `siteReference` is provided, IfcSite.RefLatitude/RefLongitude/
   * RefElevation are overwritten to match, keeping the two georef
   * mechanisms in sync per the Geonovum/bSI AU guidance. `verticalDatum`
   * is written into IfcProjectedCRS.VerticalDatum (or the equivalent
   * ePset property in IFC2X3); pass null to leave it unset.
   */
  writeMapConversion(
    epsgCode: number,
    verticalDatum: string | null,
    parameters: HelmertParams,
    siteReference: SiteReferenceSync | null,
  ): Promise<void>;
  /**
   * Serialize the (possibly modified) model back to an IFC file. Returned
   * as a `Blob` so the backend can stream chunks out without materializing
   * the whole output in JS heap on either side of the worker boundary.
   */
  save(): Promise<Blob>;
  /** Close the current model and free resources. */
  close(): Promise<void>;
}
