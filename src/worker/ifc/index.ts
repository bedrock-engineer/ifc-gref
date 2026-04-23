/**
 * Barrel for web-ifc operations. Consumers import types and functions from
 * `../worker/ifc` rather than from individual files so refactors inside the
 * folder don't ripple across the app.
 */

export { closeModel, openModel, saveModel } from "./api";
export { extractFootprint } from "./footprint";
export { extractMeshes, type MeshExtract } from "./meshes";
export { type IfcMetadata, readMetadata } from "./metadata";
export { type ExistingGeoref } from "./read-georef";
export { type IfcSchema } from "./schema";
export { type SiteReferenceSync, writeMapConversion } from "./write-georef";
