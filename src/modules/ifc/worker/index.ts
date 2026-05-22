/**
 * Barrel for web-ifc operations. Consumers import types and functions from
 * `../worker/ifc` rather than from individual files so refactors inside the
 * folder don't ripple across the app.
 */

export { closeModel, openModel, saveModel } from "./api";
export { extractFootprint } from "./footprint";
export { extractMeshes, type MeshExtract } from "./meshes";
export { extractSpaces, type SpaceExtract } from "./spaces";
export {
  type ActiveCoordinateOperation,
  type ExistingGeoref,
  type MapConversionStatus,
  type RawMapConversion,
  type RawProjectedCrs,
  type RawRigidOperation,
  type RawSourceCrs,
  type SiteReferenceSync,
  writeMapConversion,
} from "./georef";
export {
  type IfcMetadata,
  type RawAxis2Placement,
  type RawGeometricRepresentationContext,
  type RawPostalAddress,
  type RawSite,
  readMetadata,
} from "./metadata";
export { zeroSitePlacementLocation } from "./repair";
export { type IfcSchema } from "./schema";
