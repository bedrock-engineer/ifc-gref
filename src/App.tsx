import { useMemo, useState } from 'react'
import { MapView } from './components/MapView'
import {
  SurveyPointsPanel,
  type SolveRequest,
} from './components/SurveyPointsPanel'
import { getIfcApi } from './ifc-api'
import {
  lookupCrs,
  parseEpsgCode,
  transformProjectedToWgs84,
  transformWgs84ToProjected,
} from './lib/crs'
import { applyHelmert, buildPointList, solveHelmert } from './lib/helmert'
import {
  detectLogeoref,
  logeorefDescription,
  logeorefLabel,
} from './lib/logeoref'
import { unitToMetres } from './lib/units'
import type {
  HelmertParams,
  IfcMetadata,
  PointPair,
  SurveySource,
} from './lib/types'

type Stage =
  | { kind: 'idle' }
  | { kind: 'loading'; filename: string }
  | { kind: 'loaded'; filename: string; modelID: number; metadata: IfcMetadata }
  | { kind: 'error'; message: string }

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [epsgCode, setEpsgCode] = useState('28992')
  const [params, setParams] = useState<HelmertParams | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mapReference, setMapReference] = useState<
    { latitude: number; longitude: number } | null
  >(null)
  const [footprintLocal, setFootprintLocal] = useState<
    { x: number; y: number }[] | null
  >(null)

  // Project the local-coordinate footprint into WGS84 lng/lat for the map.
  // Pure derivation: re-runs whenever the footprint, params, or target CRS
  // change. The forward Helmert + proj4 transform is cheap (≤ a few hundred
  // hull vertices), so we don't memoise the inner work — useMemo just keeps
  // the array identity stable across unrelated re-renders so MapView's effect
  // doesn't refire.
  const footprintLngLat = useMemo<[number, number][] | null>(() => {
    if (!footprintLocal || !params) return null
    const epsg = parseInt(epsgCode, 10)
    if (Number.isNaN(epsg)) return null
    try {
      return footprintLocal.map((p) => {
        const proj = applyHelmert({ x: p.x, y: p.y, z: 0 }, params)
        const ll = transformProjectedToWgs84(epsg, proj.x, proj.y)
        return [ll.longitude, ll.latitude]
      })
    } catch {
      return null
    }
  }, [footprintLocal, params, epsgCode])

  async function handleFile(file: File) {
    setStage({ kind: 'loading', filename: file.name })
    setParams(null)
    setDownloadUrl(null)
    setMapReference(null)
    setFootprintLocal(null)
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const ifc = getIfcApi()
      const modelID = await ifc.openModel(buffer)
      const metadata = await ifc.readMetadata(modelID)
      setStage({ kind: 'loaded', filename: file.name, modelID, metadata })

      // If the file is already georeferenced, seed params + EPSG from it
      // so the footprint + download flow work immediately without the user
      // having to click "Compute".
      if (metadata.existingGeoref) {
        const existingEpsg = parseEpsgCode(metadata.existingGeoref.targetCrsName)
        if (existingEpsg != null) {
          // Register the CRS def with proj4 BEFORE seeding params. The
          // footprintLngLat useMemo calls transformProjectedToWgs84
          // synchronously — if the def isn't registered yet it would throw
          // and the footprint would silently fail to project.
          await lookupCrs(existingEpsg)
          setEpsgCode(String(existingEpsg))
        }
        setParams(metadata.existingGeoref.helmert)
      }

      // Derive map reference + extract footprint in parallel. Both are
      // independent best-effort enrichments — failures are logged and the
      // app stays usable without them.
      const [ref, hull] = await Promise.all([
        deriveMapReference(metadata).catch((e) => {
          console.warn('deriveMapReference failed', e)
          return null
        }),
        ifc.extractFootprint(modelID).catch((e) => {
          console.warn('extractFootprint failed', e)
          return null
        }),
      ])
      setMapReference(ref)
      setFootprintLocal(hull)
    } catch (e) {
      setStage({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  async function handleSolve(req: SolveRequest) {
    if (stage.kind !== 'loaded') return
    setBusy(true)
    try {
      const epsg = parseInt(epsgCode, 10)
      if (Number.isNaN(epsg)) throw new Error('EPSG code must be a number')

      const crsResult = await lookupCrs(epsg)
      if (crsResult.isErr()) {
        throw new Error(`CRS lookup failed: ${crsResult.error.kind}`)
      }

      const { metadata } = stage
      const unitMetres = unitToMetres(metadata.lengthUnit)
      if (unitMetres.isErr()) {
        throw new Error(`Unknown IFC length unit: ${metadata.lengthUnit}`)
      }
      const trueNorthRotation = metadata.trueNorth
        ? Math.atan2(metadata.trueNorth.ordinate, metadata.trueNorth.abscissa)
        : 0

      // Assemble the SurveySource. The IfcSite point pair is built here
      // (not in the panel) because it requires projecting lat/lon through
      // proj4, which we keep out of the UI layer.
      let source: SurveySource
      if (req.mode === 'ignore-existing') {
        source = { kind: 'ignore-existing', userPoints: req.userPoints }
      } else {
        if (!metadata.siteReference || !metadata.localOrigin) {
          throw new Error('No IfcSite reference available for this mode')
        }
        const projected = transformWgs84ToProjected(
          epsg,
          metadata.siteReference.longitude,
          metadata.siteReference.latitude,
          metadata.siteReference.elevation,
        )
        const ifcSitePoint: PointPair = {
          local: metadata.localOrigin,
          target: projected,
        }
        source =
          req.mode === 'use-existing'
            ? { kind: 'use-existing', ifcSitePoint }
            : {
                kind: 'add-to-existing',
                ifcSitePoint,
                userPoints: req.userPoints,
              }
      }

      const solved = solveHelmert(buildPointList(source), {
        unitScale: unitMetres.value,
        trueNorthRotation,
      })
      if (solved.isErr()) {
        throw new Error(`Helmert solver failed: ${solved.error.kind}`)
      }
      setParams(solved.value)
    } catch (e) {
      setStage({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleWriteAndDownload() {
    if (stage.kind !== 'loaded' || !params) return
    setBusy(true)
    try {
      const ifc = getIfcApi()
      await ifc.writeMapConversion(stage.modelID, parseInt(epsgCode, 10), params)
      const buffer = await ifc.saveModel(stage.modelID)
      // Cast through unknown to satisfy TS lib variance for BlobPart
      const blob = new Blob([buffer as unknown as ArrayBuffer], {
        type: 'application/octet-stream',
      })
      if (downloadUrl) URL.revokeObjectURL(downloadUrl)
      setDownloadUrl(URL.createObjectURL(blob))
    } catch (e) {
      setStage({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
    }
  }

  // ----- render -----

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Header
        filename={stage.kind === 'loaded' ? stage.filename : null}
        onFile={handleFile}
      />

      {stage.kind === 'loaded' ? (
        <>
          <div className="flex min-h-0 flex-1">
            <aside className="w-96 shrink-0 space-y-4 overflow-y-auto border-r border-slate-200 bg-white p-4">
              <MetadataView metadata={stage.metadata} />
              <TargetCrsSection
                epsgCode={epsgCode}
                onChange={setEpsgCode}
              />
              <SurveyPointsPanel
                key={stage.filename}
                metadata={stage.metadata}
                level={detectLogeoref(stage.metadata)}
                onSolve={handleSolve}
                busy={busy}
              />
              {params && (
                <HelmertParamsSection
                  filename={stage.filename}
                  params={params}
                  onChange={setParams}
                  onWrite={handleWriteAndDownload}
                  busy={busy}
                  downloadUrl={downloadUrl}
                />
              )}
            </aside>
            <section className="min-w-0 flex-1">
              <MapView
                referencePoint={mapReference}
                footprint={footprintLngLat}
              />
            </section>
          </div>
          <ResidualsStrip params={params} />
        </>
      ) : (
        <IdleBody stage={stage} onFile={handleFile} />
      )}
    </div>
  )
}

// ----- header -----

function Header({
  filename,
  onFile,
}: {
  filename: string | null
  onFile: (f: File) => void
}) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          IFC Georeferencer
        </h1>
        {filename && (
          <p className="text-xs text-slate-500">{filename}</p>
        )}
      </div>
      <label
        htmlFor="ifc-file-header"
        className="cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
      >
        {filename ? 'Load another file' : 'Load file'}
        <input
          id="ifc-file-header"
          type="file"
          accept=".ifc"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
          }}
        />
      </label>
    </header>
  )
}

// ----- idle / loading / error body -----

function IdleBody({
  stage,
  onFile,
}: {
  stage: Stage
  onFile: (f: File) => void
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-4">
        <BigDrop onFile={onFile} />
        {stage.kind === 'loading' && (
          <p className="text-center text-slate-500">
            Reading {stage.filename}…
          </p>
        )}
        {stage.kind === 'error' && (
          <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
            {stage.message}
          </div>
        )}
        <p className="text-center text-sm text-slate-500">
          Browser-based georeferencing for IFC files. Nothing leaves your
          browser.
        </p>
      </div>
    </div>
  )
}

function BigDrop({ onFile }: { onFile: (f: File) => void }) {
  return (
    <label
      htmlFor="ifc-file-drop"
      className="block cursor-pointer rounded-lg border-2 border-dashed border-slate-300 bg-white p-12 text-center text-slate-500 hover:border-slate-400"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      Drop an .ifc file here, or click to choose
      <input
        id="ifc-file-drop"
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
    </label>
  )
}

// ----- sidebar sections -----

function MetadataView({ metadata }: { metadata: IfcMetadata }) {
  const level = detectLogeoref(metadata)
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold text-slate-900">File metadata</h2>
      <Row
        label="LoGeoRef level"
        value={logeorefLabel(level)}
        title={logeorefDescription(level)}
      />
      <Row label="Schema" value={metadata.schema} />
      <Row label="Length unit" value={metadata.lengthUnit} />
      <Row
        label="IfcSite reference"
        value={
          metadata.siteReference
            ? `${metadata.siteReference.latitude.toFixed(6)}, ${metadata.siteReference.longitude.toFixed(6)} @ ${metadata.siteReference.elevation}m`
            : '—'
        }
      />
      <Row
        label="Local origin"
        value={
          metadata.localOrigin
            ? `(${metadata.localOrigin.x}, ${metadata.localOrigin.y}, ${metadata.localOrigin.z})`
            : '—'
        }
      />
      <Row
        label="True north"
        value={
          metadata.trueNorth
            ? `abscissa=${metadata.trueNorth.abscissa}, ordinate=${metadata.trueNorth.ordinate}`
            : '—'
        }
      />
      {metadata.existingGeoref ? (
        <ExistingGeorefBlock georef={metadata.existingGeoref} />
      ) : (
        <Row label="Existing georef" value="—" />
      )}
    </section>
  )
}

/**
 * Detailed view of IfcMapConversion + IfcProjectedCRS as read from the file.
 * Shows the full parameter set so the user can sanity-check what's already
 * in the file before deciding to accept or overwrite it.
 */
function ExistingGeorefBlock({
  georef,
}: {
  georef: { targetCrsName: string; helmert: HelmertParams }
}) {
  const { helmert } = georef
  const xAxisAbscissa = Math.cos(helmert.rotation)
  const xAxisOrdinate = Math.sin(helmert.rotation)
  return (
    <div className="space-y-1 rounded border border-slate-100 bg-slate-50 p-3">
      <div className="text-slate-600">Existing georef</div>
      <Row label="Target CRS" value={georef.targetCrsName || '(unnamed)'} />
      <Row label="Eastings" value={`${helmert.easting}`} />
      <Row label="Northings" value={`${helmert.northing}`} />
      <Row label="OrthogonalHeight" value={`${helmert.height}`} />
      <Row label="Scale" value={`${helmert.scale}`} />
      <Row label="XAxisAbscissa" value={xAxisAbscissa.toString()} />
      <Row label="XAxisOrdinate" value={xAxisOrdinate.toString()} />
      <Row
        label="Rotation"
        value={`${helmert.rotation.toFixed(6)} rad (${((helmert.rotation * 180) / Math.PI).toFixed(4)}°)`}
      />
    </div>
  )
}

function TargetCrsSection({
  epsgCode,
  onChange,
}: {
  epsgCode: string
  onChange: (v: string) => void
}) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Target CRS</h2>
      <label className="flex items-center gap-3 text-sm">
        <span className="text-slate-700">EPSG code</span>
        <input
          type="text"
          value={epsgCode}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </label>
    </section>
  )
}

function HelmertParamsSection({
  filename,
  params,
  onChange,
  onWrite,
  busy,
  downloadUrl,
}: {
  filename: string
  params: HelmertParams
  onChange: (p: HelmertParams) => void
  onWrite: () => void
  busy: boolean
  downloadUrl: string | null
}) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">
        Helmert parameters
      </h2>
      <ParamsEditor key={filename} params={params} onChange={onChange} />
      <button
        type="button"
        onClick={onWrite}
        disabled={busy}
        className="w-full rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        Write IfcMapConversion & build download
      </button>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`georeferenced-${filename}`}
          className="block rounded border border-emerald-700 px-4 py-2 text-center text-sm text-emerald-700"
        >
          Download IFC
        </a>
      )}
    </section>
  )
}

/**
 * Editable Helmert parameters. Each field has a local string draft so the
 * user can type partial values ("1.", "-", "1e-3") without React stomping
 * them between keystrokes. Valid parses are committed immediately to
 * `onChange`, which flows straight into the footprint projection via the
 * `footprintLngLat` memo — the map updates in real time as you type.
 *
 * Rotation is edited in degrees (more intuitive) and stored in radians.
 *
 * The parent passes `key={filename}` so a new file load remounts this
 * component and resets the drafts — avoids a prop-sync effect.
 */
function ParamsEditor({
  params,
  onChange,
}: {
  params: HelmertParams
  onChange: (params: HelmertParams) => void
}) {
  const [drafts, setDrafts] = useState({
    easting: String(params.easting),
    northing: String(params.northing),
    height: String(params.height),
    scale: String(params.scale),
    rotationDeg: ((params.rotation * 180) / Math.PI).toString(),
  })

  const commit = (key: keyof typeof drafts, raw: string) => {
    setDrafts((d) => ({ ...d, [key]: raw }))
    const n = parseFloat(raw)
    if (!Number.isFinite(n)) return
    if (key === 'rotationDeg') {
      onChange({ ...params, rotation: (n * Math.PI) / 180 })
    } else {
      onChange({ ...params, [key]: n })
    }
  }

  return (
    <dl className="grid grid-cols-[max-content_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
      <dt className="text-slate-600">Eastings</dt>
      <dd>
        <input
          type="text"
          inputMode="decimal"
          value={drafts.easting}
          onChange={(e) => commit('easting', e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </dd>
      <span className="text-xs text-slate-500">m</span>

      <dt className="text-slate-600">Northings</dt>
      <dd>
        <input
          type="text"
          inputMode="decimal"
          value={drafts.northing}
          onChange={(e) => commit('northing', e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </dd>
      <span className="text-xs text-slate-500">m</span>

      <dt className="text-slate-600">OrthogonalHeight</dt>
      <dd>
        <input
          type="text"
          inputMode="decimal"
          value={drafts.height}
          onChange={(e) => commit('height', e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </dd>
      <span className="text-xs text-slate-500">m</span>

      <dt className="text-slate-600">Scale</dt>
      <dd>
        <input
          type="text"
          inputMode="decimal"
          value={drafts.scale}
          onChange={(e) => commit('scale', e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </dd>
      <span className="text-xs text-slate-500" />

      <dt className="text-slate-600">Rotation</dt>
      <dd>
        <input
          type="text"
          inputMode="decimal"
          value={drafts.rotationDeg}
          onChange={(e) => commit('rotationDeg', e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
        />
      </dd>
      <span className="text-xs text-slate-500">°</span>
    </dl>
  )
}

// ----- bottom strip: residuals / diagnostics -----

function ResidualsStrip({ params }: { params: HelmertParams | null }) {
  return (
    <footer className="h-32 shrink-0 overflow-y-auto border-t border-slate-200 bg-white px-6 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Residuals & diagnostics
      </h3>
      {params ? (
        <p className="mt-2 text-sm text-slate-500">
          Per-point residuals will appear here once the solver runs against
          surveyed points. (Not implemented yet.)
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">
          No parameters yet. Choose a survey mode and solve to see residuals.
        </p>
      )}
    </footer>
  )
}

// ----- shared bits -----

function Row({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div className="flex justify-between gap-4" title={title}>
      <span className="text-slate-600">{label}</span>
      <span className="font-mono text-slate-900">{value}</span>
    </div>
  )
}

/**
 * Derive a WGS84 lat/lon for the map marker.
 *
 * 1. If the IfcSite has RefLatitude/RefLongitude, use that directly.
 * 2. Otherwise, if the file already has IfcMapConversion + a local origin,
 *    apply the existing Helmert forward to the local origin to get its
 *    coordinate in the target CRS, then reverse-project to WGS84.
 * 3. Otherwise, return null.
 */
async function deriveMapReference(
  metadata: IfcMetadata,
): Promise<{ latitude: number; longitude: number } | null> {
  if (metadata.siteReference) {
    return {
      latitude: metadata.siteReference.latitude,
      longitude: metadata.siteReference.longitude,
    }
  }
  if (!metadata.existingGeoref || !metadata.localOrigin) return null

  const epsg = parseEpsgCode(metadata.existingGeoref.targetCrsName)
  if (epsg == null) return null

  // Register the CRS with proj4 so the reverse transform works.
  const lookup = await lookupCrs(epsg)
  if (lookup.isErr()) return null

  const projected = applyHelmert(metadata.localOrigin, metadata.existingGeoref.helmert)
  return transformProjectedToWgs84(epsg, projected.x, projected.y)
}
