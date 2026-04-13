/**
 * Shared types for the IFC georeferencing app.
 *
 * Domain errors are modeled as discriminated unions and returned via
 * neverthrow Result/ResultAsync from the IFC, CRS, units, and Helmert
 * modules. Plain Errors are reserved for truly exceptional cases.
 */

// ----- Geometry / coordinates -----

export type PointPair = {
  /** Local IFC coordinates */
  local: { x: number; y: number; z: number }
  /** Target CRS coordinates */
  target: { x: number; y: number; z: number }
}

export type HelmertParams = {
  /** Scale factor (S) */
  scale: number
  /** Rotation around Z in radians (θ) */
  rotation: number
  /** Easting translation (E) */
  easting: number
  /** Northing translation (N) */
  northing: number
  /** Vertical translation / OrthogonalHeight (H) */
  height: number
}

// ----- Survey input modes (the 3-mode flow from the Flask app) -----

export type SurveySource =
  | { kind: 'use-existing'; ifcSitePoint: PointPair }
  | { kind: 'add-to-existing'; ifcSitePoint: PointPair; userPoints: PointPair[] }
  | { kind: 'ignore-existing'; userPoints: PointPair[] }

// ----- IFC metadata read from a file -----

export type IfcSchema = 'IFC2X3' | 'IFC4' | 'IFC4X1' | 'IFC4X2' | 'IFC4X3'

export type IfcMetadata = {
  schema: IfcSchema
  /** Set if the IfcSite has RefLatitude/RefLongitude */
  siteReference: { latitude: number; longitude: number; elevation: number } | null
  /** Local origin from IfcSite.ObjectPlacement.RelativePlacement */
  localOrigin: { x: number; y: number; z: number } | null
  /** Length unit name from IfcUnitAssignment, e.g. "METRE", "MILLIMETRE" */
  lengthUnit: string
  /** TrueNorth direction (XAxisOrdinate, XAxisAbscissa) if present */
  trueNorth: { abscissa: number; ordinate: number } | null
  /** Existing georeferencing if the file is already georeferenced */
  existingGeoref: ExistingGeoref | null
}

export type ExistingGeoref = {
  targetCrsName: string
  helmert: HelmertParams
}

// ----- Domain error unions -----

export type IfcError =
  | { kind: 'parse-failed'; cause: unknown }
  | { kind: 'unsupported-schema'; schema: string }
  | { kind: 'missing-entity'; entity: string }
  | { kind: 'write-failed'; cause: unknown }

export type CrsError =
  | { kind: 'fetch-failed'; code: number; cause: unknown }
  | { kind: 'not-found'; code: number }
  | { kind: 'not-projected'; code: number }
  | { kind: 'invalid-definition'; code: number }

export type UnitError = { kind: 'unknown-unit'; name: string }

export type HelmertError =
  | { kind: 'no-points' }
  | { kind: 'collinear-points' }
  | { kind: 'solver-diverged' }
