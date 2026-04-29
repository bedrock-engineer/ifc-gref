/**
 * Barrel for web-ifc operations. Consumers import types and functions from
 * `../worker/ifc` rather than from individual files so refactors inside the
 * folder don't ripple across the app.
 */

export { closeModel, openModel, saveModel } from "./api";
export { extractFootprint } from "./footprint";
export { extractMeshes, type MeshExtract } from "./meshes";
export {
  type ExistingGeoref,
  type SiteReferenceSync,
  writeMapConversion,
} from "./georef";
export { type IfcMetadata, readMetadata } from "./metadata";
export { type IfcSchema } from "./schema";
