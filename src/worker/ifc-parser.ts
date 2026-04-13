/**
 * web-ifc operations. Runs in a Web Worker, called from the main thread
 * via Comlink. This module owns the IfcAPI instance and exposes a small
 * API surface for reading metadata, writing IfcMapConversion, and
 * extracting geometry.
 *
 * The Worker boundary is the natural place to hold the WASM module and
 * keep heavy parsing off the main thread. See docs/large-file-handling.md.
 */

import * as WebIFC from 'web-ifc'
import {
  Handle,
  IFCSITE,
  IFCSPACE,
  IFCPROJECT,
  IFCUNITASSIGNMENT,
  IFCMAPCONVERSION,
  IFCPROJECTEDCRS,
  IFCGEOMETRICREPRESENTATIONCONTEXT,
  IFCLENGTHMEASURE,
  IFCLABEL,
  IFCREAL,
} from 'web-ifc'
import { polygonHull } from 'd3-polygon'
// Vite resolves these to URLs at build time. The worker bundle would
// otherwise try to fetch web-ifc.wasm from the document root and get
// the SPA fallback HTML back, which fails the WASM magic-word check.
import wasmUrl from 'web-ifc/web-ifc.wasm?url'
import type {
  ExistingGeoref,
  HelmertParams,
  IfcMetadata,
  IfcSchema,
} from '../lib/types'

let api: WebIFC.IfcAPI | null = null

async function getApi(): Promise<WebIFC.IfcAPI> {
  if (api) return api
  api = new WebIFC.IfcAPI()
  // Force single-threaded mode: it sidesteps the multithreaded wasm
  // (which needs SharedArrayBuffer + COOP/COEP headers — painful on
  // GitHub Pages) and we only need to ship one .wasm asset.
  await api.Init((path) => {
    if (path.endsWith('.wasm')) return wasmUrl
    return path
  }, true)
  return api
}

export async function openModel(buffer: Uint8Array): Promise<number> {
  const ifcAPI = await getApi()
  return ifcAPI.OpenModel(buffer)
}

export async function readMetadata(modelID: number): Promise<IfcMetadata> {
  const ifcAPI = await getApi()
  const schema = parseSchema(ifcAPI.GetModelSchema(modelID))

  const site = firstOf(ifcAPI, modelID, IFCSITE)
  const project = firstOf(ifcAPI, modelID, IFCPROJECT)

  return {
    schema,
    siteReference: readSiteReference(site),
    localOrigin: readLocalOrigin(site),
    lengthUnit: readLengthUnit(ifcAPI, modelID, project),
    trueNorth: readTrueNorth(ifcAPI, modelID, project),
    existingGeoref: readExistingGeoref(ifcAPI, modelID),
  }
}

export async function writeMapConversion(
  modelID: number,
  epsgCode: number,
  params: HelmertParams,
): Promise<void> {
  const ifcAPI = await getApi()
  const schema = parseSchema(ifcAPI.GetModelSchema(modelID))
  if (schema === 'IFC2X3') {
    // TODO: hand-construct ePset_MapConversion + ePset_ProjectedCRS property
    // sets on the IfcSite via IfcRelDefinesByProperties. Deferred for now.
    throw new Error('IFC2X3 georeferencing not yet implemented')
  }
  writeMapConversionIfc4(ifcAPI, modelID, epsgCode, params)
}

/**
 * Hand-constructs IfcProjectedCRS + IfcMapConversion for IFC4 schemas and
 * attaches them to the first IfcGeometricRepresentationContext (which acts
 * as the SourceCRS, per the IFC4 IfcCoordinateReferenceSystemSelect rule).
 *
 * Mirrors `set_mapconversion_crs_ifc4` in georeference_ifc/main.py.
 */
function writeMapConversionIfc4(
  ifcAPI: WebIFC.IfcAPI,
  modelID: number,
  epsgCode: number,
  params: HelmertParams,
): void {
  const contextIds = ifcAPI.GetLineIDsWithType(
    modelID,
    IFCGEOMETRICREPRESENTATIONCONTEXT,
  )
  if (contextIds.size() === 0) {
    throw new Error('No IfcGeometricRepresentationContext found in model')
  }
  const sourceContextID = contextIds.get(0)

  const crsName = `EPSG:${epsgCode}`

  // IfcProjectedCRS(Name, Description, GeodeticDatum, VerticalDatum,
  //                 MapProjection, MapZone, MapUnit)
  const projectedCRS = ifcAPI.CreateIfcEntity(
    modelID,
    IFCPROJECTEDCRS,
    ifcAPI.CreateIfcType(modelID, IFCLABEL, crsName),
    null,
    null,
    null,
    null,
    null,
    null,
  )

  // IfcMapConversion(SourceCRS, TargetCRS, Eastings, Northings,
  //                  OrthogonalHeight, XAxisAbscissa, XAxisOrdinate, Scale)
  // Convert our internal rotation (radians) into the IFC pair via cos/sin.
  const xAxisAbscissa = Math.cos(params.rotation)
  const xAxisOrdinate = Math.sin(params.rotation)

  const mapConversion = ifcAPI.CreateIfcEntity(
    modelID,
    IFCMAPCONVERSION,
    new Handle(sourceContextID),
    projectedCRS,
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, params.easting),
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, params.northing),
    ifcAPI.CreateIfcType(modelID, IFCLENGTHMEASURE, params.height),
    ifcAPI.CreateIfcType(modelID, IFCREAL, xAxisAbscissa),
    ifcAPI.CreateIfcType(modelID, IFCREAL, xAxisOrdinate),
    ifcAPI.CreateIfcType(modelID, IFCREAL, params.scale),
  )

  // WriteLine recursively writes nested entities (the projectedCRS) first,
  // assigns expressIDs, and replaces them with Handles.
  ifcAPI.WriteLine(modelID, mapConversion)
}

/**
 * Extract a 2D convex-hull footprint of all model geometry, in the local
 * IFC coordinate system. Streams every product mesh, transforms its vertices
 * by `flatTransformation` to model space, and accumulates only XY into a
 * single hull computation.
 *
 * IfcSpace meshes are skipped — they are virtual room volumes and would
 * inflate the hull beyond the physical building envelope.
 *
 * Returns null when there is no usable geometry (empty model, all-Space, or
 * fewer than 3 unique points).
 */
export async function extractFootprint(
  modelID: number,
): Promise<{ x: number; y: number }[] | null> {
  const ifcAPI = await getApi()

  // Accumulator for XY pairs in flat array form (cheaper than object allocs).
  // We rely on d3-polygon's tolerance for duplicates rather than dedup here —
  // the hull is O(n log n) and a few million points hash-deduping would cost
  // more than just sorting them.
  const xy: number[][] = []

  ifcAPI.StreamAllMeshes(modelID, (mesh) => {
    if (ifcAPI.GetLineType(modelID, mesh.expressID) === IFCSPACE) return

    const placedGeometries = mesh.geometries
    const count = placedGeometries.size()
    for (let g = 0; g < count; g++) {
      const placed = placedGeometries.get(g)
      const geometry = ifcAPI.GetGeometry(modelID, placed.geometryExpressID)
      const verts = ifcAPI.GetVertexArray(
        geometry.GetVertexData(),
        geometry.GetVertexDataSize(),
      )
      // web-ifc vertex stride: [x, y, z, nx, ny, nz] interleaved.
      const m = placed.flatTransformation // 4x4 column-major
      for (let i = 0; i < verts.length; i += 6) {
        const x = verts[i]
        const y = verts[i + 1]
        const z = verts[i + 2]
        // Apply only the rows we need (X and Y of the result).
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12]
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13]
        xy.push([wx, wy])
      }
      geometry.delete()
    }
    // Note: do NOT call mesh.delete() — the FlatMesh handed to the
    // StreamAllMeshes callback is owned by the stream and freed after
    // the callback returns. Calling delete() here throws at runtime
    // (the method only exists on FlatMesh instances returned by
    // GetFlatMesh / LoadAllGeometry, not on streamed meshes).
  })

  if (xy.length < 3) return null
  const hull = polygonHull(xy as [number, number][])
  if (!hull) return null
  return hull.map(([x, y]) => ({ x, y }))
}

export async function saveModel(modelID: number): Promise<Uint8Array> {
  const ifcAPI = await getApi()
  return ifcAPI.SaveModel(modelID)
}

export async function closeModel(modelID: number): Promise<void> {
  const ifcAPI = await getApi()
  ifcAPI.CloseModel(modelID)
}

// ----- helpers -----

function parseSchema(raw: string): IfcSchema {
  // web-ifc returns strings like "IFC2X3", "IFC4", "IFC4X3"
  switch (raw) {
    case 'IFC2X3':
    case 'IFC4':
    case 'IFC4X1':
    case 'IFC4X2':
    case 'IFC4X3':
      return raw
    default:
      // IFC4X3_ADD2 etc — collapse to IFC4X3 for our purposes
      if (raw.startsWith('IFC4X3')) return 'IFC4X3'
      if (raw.startsWith('IFC4')) return 'IFC4'
      throw new Error(`Unsupported IFC schema: ${raw}`)
  }
}

/**
 * Returns the flattened first entity of a given type, or null if there are none.
 * "Flattened" means references like ObjectPlacement, RelativePlacement, Location
 * are recursively expanded into nested objects instead of left as Handle refs.
 */
function firstOf(ifcAPI: WebIFC.IfcAPI, modelID: number, type: number): any | null {
  const ids = ifcAPI.GetLineIDsWithType(modelID, type)
  if (ids.size() === 0) return null
  return ifcAPI.GetLine(modelID, ids.get(0), true)
}

/** Unwrap an IFC value wrapper (IfcLabel, IfcLengthMeasure, IfcReal, etc.). */
function rawValue(v: any): any {
  if (v == null) return null
  if (typeof v === 'object' && 'value' in v) return v.value
  return v
}

/**
 * Convert an IfcCompoundPlaneAngleMeasure (an array of integers
 * `[degrees, minutes, seconds, micro-seconds?]`) to decimal degrees.
 *
 * Mirrors the Flask app's calculation in app.py:70-71. Sign follows the
 * first non-zero component.
 */
function dmsToDecimal(parts: any): number | null {
  if (!Array.isArray(parts) || parts.length < 3) return null
  const nums = parts.map((p) => Number(rawValue(p)))
  const [d, m, s, micro = 0] = nums
  const sign =
    d < 0 || m < 0 || s < 0 || micro < 0 ? -1 : 1
  const abs = Math.abs(d) + Math.abs(m) / 60 + (Math.abs(s) + Math.abs(micro) / 1e6) / 3600
  return sign * abs
}

function readSiteReference(
  site: any,
): { latitude: number; longitude: number; elevation: number } | null {
  if (!site) return null
  const lat = dmsToDecimal(site.RefLatitude)
  const lon = dmsToDecimal(site.RefLongitude)
  if (lat == null || lon == null) return null
  const elev = Number(rawValue(site.RefElevation) ?? 0)
  return { latitude: lat, longitude: lon, elevation: elev }
}

function readLocalOrigin(
  site: any,
): { x: number; y: number; z: number } | null {
  if (!site) return null
  const placement = site.ObjectPlacement
  if (!placement) return null
  const rel = placement.RelativePlacement
  const coords: any[] | undefined = rel?.Location?.Coordinates
  if (!Array.isArray(coords) || coords.length < 3) return null
  return {
    x: Number(rawValue(coords[0])),
    y: Number(rawValue(coords[1])),
    z: Number(rawValue(coords[2])),
  }
}

function readLengthUnit(
  ifcAPI: WebIFC.IfcAPI,
  modelID: number,
  project: any,
): string {
  // Prefer IfcProject.UnitsInContext, fall back to any IfcUnitAssignment.
  const assignment =
    project?.UnitsInContext ?? firstOf(ifcAPI, modelID, IFCUNITASSIGNMENT)
  if (!assignment?.Units) return 'METRE'
  for (const unit of assignment.Units) {
    if (unit?.UnitType !== 'LENGTHUNIT') continue
    // IfcSIUnit: combine optional Prefix + Name -> e.g. MILLI + METRE -> MILLIMETRE
    if (unit.Name) {
      const prefix = unit.Prefix ?? ''
      return `${prefix}${unit.Name}`
    }
    // IfcConversionBasedUnit: use Name directly
    if (typeof unit.Name === 'string') return unit.Name
  }
  return 'METRE'
}

function readTrueNorth(
  ifcAPI: WebIFC.IfcAPI,
  modelID: number,
  project: any,
): { abscissa: number; ordinate: number } | null {
  // Walk IfcProject.RepresentationContexts -> first IfcGeometricRepresentationContext.TrueNorth
  const contexts: any[] | undefined = project?.RepresentationContexts
  let trueNorth: any = null
  if (Array.isArray(contexts)) {
    for (const ctx of contexts) {
      if (ctx?.TrueNorth) {
        trueNorth = ctx.TrueNorth
        break
      }
    }
  }
  // Fall back to scanning all geometric representation contexts.
  if (!trueNorth) {
    const ctx = firstOf(ifcAPI, modelID, IFCGEOMETRICREPRESENTATIONCONTEXT)
    trueNorth = ctx?.TrueNorth ?? null
  }
  const ratios: any[] | undefined = trueNorth?.DirectionRatios
  if (!Array.isArray(ratios) || ratios.length < 2) return null
  return {
    abscissa: Number(rawValue(ratios[0])),
    ordinate: Number(rawValue(ratios[1])),
  }
}

function readExistingGeoref(
  ifcAPI: WebIFC.IfcAPI,
  modelID: number,
): ExistingGeoref | null {
  const ids = ifcAPI.GetLineIDsWithType(modelID, IFCMAPCONVERSION)
  if (ids.size() === 0) return null
  const mc = ifcAPI.GetLine(modelID, ids.get(0), true)
  const target: any = mc.TargetCRS
  const helmert: HelmertParams = {
    scale: Number(rawValue(mc.Scale) ?? 1),
    rotation: Math.atan2(
      Number(rawValue(mc.XAxisOrdinate) ?? 0),
      Number(rawValue(mc.XAxisAbscissa) ?? 1),
    ),
    easting: Number(rawValue(mc.Eastings) ?? 0),
    northing: Number(rawValue(mc.Northings) ?? 0),
    height: Number(rawValue(mc.OrthogonalHeight) ?? 0),
  }
  return {
    targetCrsName: String(rawValue(target?.Name) ?? ''),
    helmert,
  }
}

