/**
 * Survey points input panel.
 *
 * Mirrors the survey-points step from the Flask app's templates/survey.html
 * + the three-mode flow described in the Geonovum guide (chapter 03,
 * "Methodes van Georeferentie"). The three modes correspond to LoGeoRef
 * upgrade paths:
 *
 *   - use-existing       LoGeoRef 20+ → 50  (IfcSite RefLat/Lon + TrueNorth alone)
 *   - add-to-existing    LoGeoRef 20+ → 60  (IfcSite reference + ≥1 surveyed point)
 *   - ignore-existing    LoGeoRef ≤10 → 50  (≥2 surveyed points, no IfcSite info)
 *
 * The panel is a pure UI component: it owns the row drafts and the mode
 * selection, and emits a `SolveRequest` to the parent on click. The parent
 * is responsible for projecting the IfcSite reference into the target CRS
 * and running the Helmert solver — those concerns require the EPSG code
 * and proj4, which we deliberately keep out of this file.
 */

import { useState } from 'react'
import type { IfcMetadata, PointPair, SurveySource } from '../lib/types'
import type { LogeorefLevel } from '../lib/logeoref'

export type SurveyMode = SurveySource['kind']

export type SolveRequest = {
  mode: SurveyMode
  userPoints: PointPair[]
}

export type SurveyPointsPanelProps = {
  metadata: IfcMetadata
  level: LogeorefLevel
  onSolve: (req: SolveRequest) => void
  busy?: boolean
}

type RowDraft = {
  x: string
  y: string
  z: string
  xp: string
  yp: string
  zp: string
}

const emptyRow = (): RowDraft => ({
  x: '',
  y: '',
  z: '',
  xp: '',
  yp: '',
  zp: '',
})

function parseRow(r: RowDraft): PointPair | null {
  const nums = [r.x, r.y, r.z, r.xp, r.yp, r.zp].map((s) => parseFloat(s))
  if (nums.some((n) => !Number.isFinite(n))) return null
  return {
    local: { x: nums[0], y: nums[1], z: nums[2] },
    target: { x: nums[3], y: nums[4], z: nums[5] },
  }
}

function isEmpty(r: RowDraft): boolean {
  return !r.x && !r.y && !r.z && !r.xp && !r.yp && !r.zp
}

export function SurveyPointsPanel({
  metadata,
  level,
  onSolve,
  busy,
}: SurveyPointsPanelProps) {
  // 'use-existing' and 'add-to-existing' both consume the IfcSite reference,
  // so they require both a lat/lon AND a local origin to combine into a
  // PointPair. Without either we fall back to ignore-existing.
  const hasSite = !!metadata.siteReference && !!metadata.localOrigin
  const initialMode: SurveyMode = hasSite ? 'use-existing' : 'ignore-existing'

  const [mode, setMode] = useState<SurveyMode>(initialMode)
  const [rows, setRows] = useState<RowDraft[]>([emptyRow()])

  const updateRow = (i: number, key: keyof RowDraft, value: string) => {
    setRows((rs) => {
      const next = rs.slice()
      next[i] = { ...next[i], [key]: value }
      return next
    })
  }
  const addRow = () => setRows((rs) => [...rs, emptyRow()])
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))

  // Validation. We treat fully-empty rows as "not yet entered" and ignore
  // them; partially-filled rows count as invalid (they almost certainly
  // mean the user typed half a point and forgot the rest).
  const nonEmpty = rows.filter((r) => !isEmpty(r))
  const parsed = nonEmpty.map(parseRow)
  const validUserPoints = parsed.filter((p): p is PointPair => p !== null)
  const allNonEmptyValid = parsed.every((p) => p !== null)

  const minPoints =
    mode === 'use-existing' ? 0 : mode === 'add-to-existing' ? 1 : 2

  let blockedReason: string | null = null
  if ((mode === 'use-existing' || mode === 'add-to-existing') && !hasSite) {
    blockedReason = 'File has no IfcSite RefLatitude/RefLongitude'
  } else if (!allNonEmptyValid) {
    blockedReason = 'One or more rows have non-numeric values'
  } else if (validUserPoints.length < minPoints) {
    if (mode === 'add-to-existing') {
      blockedReason =
        'Need at least 1 surveyed point in addition to the IfcSite reference'
    } else if (mode === 'ignore-existing') {
      blockedReason =
        'Need at least 2 surveyed points (Geonovum minimum for LoGeoRef ≤10 inputs)'
    }
  }
  const canSolve = blockedReason === null

  const handleSolve = () => {
    if (!canSolve) return
    onSolve({ mode, userPoints: validUserPoints })
  }

  return (
    <details
      className="rounded-lg border border-slate-200"
      open={level !== 'l50'}
    >
      <summary className="cursor-pointer select-none p-4 text-lg font-semibold text-slate-900">
        Survey points
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-4 py-4">
        <ModePicker mode={mode} onChange={setMode} hasSite={hasSite} />

        {mode === 'use-existing' ? (
          <p className="rounded border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
            No surveyed points needed for this mode — the transform will be
            derived from the IfcSite reference and the IfcGeometricRepresentationContext
            TrueNorth direction.
          </p>
        ) : (
          <PointsTable
            rows={rows}
            onUpdate={updateRow}
            onAdd={addRow}
            onRemove={removeRow}
            ifcUnit={metadata.lengthUnit}
          />
        )}

        {blockedReason && (
          <p className="text-sm text-amber-700">{blockedReason}</p>
        )}

        <button
          type="button"
          onClick={handleSolve}
          disabled={!canSolve || !!busy}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Solve Helmert parameters
        </button>
      </div>
    </details>
  )
}

// ----- mode picker -----

type ModeOption = {
  kind: SurveyMode
  label: string
  description: string
  available: boolean
}

function ModePicker({
  mode,
  onChange,
  hasSite,
}: {
  mode: SurveyMode
  onChange: (m: SurveyMode) => void
  hasSite: boolean
}) {
  const options: ModeOption[] = [
    {
      kind: 'use-existing',
      label: 'Use existing reference',
      description: 'LoGeoRef 20 → 50. Derive from IfcSite RefLat/Lon + TrueNorth.',
      available: hasSite,
    },
    {
      kind: 'add-to-existing',
      label: 'Refine with surveyed points',
      description: 'LoGeoRef 20 → 60. IfcSite reference + ≥1 surveyed point.',
      available: hasSite,
    },
    {
      kind: 'ignore-existing',
      label: 'Surveyed points only',
      description: 'LoGeoRef ≤10 → 50. Ignore IfcSite, fit to ≥2 surveyed points.',
      available: true,
    },
  ]

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Survey mode</legend>
      {options.map((opt) => {
        const selected = mode === opt.kind
        const baseClasses = 'flex items-start gap-2 rounded border p-2 text-sm'
        const stateClasses = !opt.available
          ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
          : selected
            ? 'border-slate-900 bg-slate-50 cursor-pointer'
            : 'border-slate-200 cursor-pointer hover:bg-slate-50'
        return (
          <label key={opt.kind} className={`${baseClasses} ${stateClasses}`}>
            <input
              type="radio"
              name="survey-mode"
              value={opt.kind}
              checked={selected}
              disabled={!opt.available}
              onChange={() => onChange(opt.kind)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">{opt.label}</span>
              <span className="block text-xs text-slate-500">
                {opt.description}
              </span>
              {!opt.available && (
                <span className="mt-1 block text-xs italic">
                  Requires IfcSite RefLatitude/RefLongitude
                </span>
              )}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

// ----- points table -----

function PointsTable({
  rows,
  onUpdate,
  onAdd,
  onRemove,
  ifcUnit,
}: {
  rows: RowDraft[]
  onUpdate: (i: number, key: keyof RowDraft, value: string) => void
  onAdd: () => void
  onRemove: (i: number) => void
  ifcUnit: string
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Corresponding coordinates in the IFC local frame (
        <code>{ifcUnit.toLowerCase()}</code>) and the target CRS.
      </p>
      {rows.map((row, i) => (
        <div
          key={i}
          className="space-y-2 rounded border border-slate-200 p-3"
        >
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
            <span>Point {i + 1}</span>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="text-slate-400 hover:text-red-600"
                aria-label={`Remove point ${i + 1}`}
              >
                ×
              </button>
            )}
          </div>
          <PointRowFields row={row} onUpdate={(k, v) => onUpdate(i, k, v)} />
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
      >
        + Add point
      </button>
    </div>
  )
}

function PointRowFields({
  row,
  onUpdate,
}: {
  row: RowDraft
  onUpdate: (key: keyof RowDraft, value: string) => void
}) {
  return (
    <div className="grid grid-cols-[3rem_1fr_1fr_1fr] items-center gap-1.5 text-sm">
      <span className="text-xs text-slate-500">Local</span>
      <NumInput
        value={row.x}
        onChange={(v) => onUpdate('x', v)}
        placeholder="X"
      />
      <NumInput
        value={row.y}
        onChange={(v) => onUpdate('y', v)}
        placeholder="Y"
      />
      <NumInput
        value={row.z}
        onChange={(v) => onUpdate('z', v)}
        placeholder="Z"
      />
      <span className="text-xs text-slate-500">Target</span>
      <NumInput
        value={row.xp}
        onChange={(v) => onUpdate('xp', v)}
        placeholder="X′"
      />
      <NumInput
        value={row.yp}
        onChange={(v) => onUpdate('yp', v)}
        placeholder="Y′"
      />
      <NumInput
        value={row.zp}
        onChange={(v) => onUpdate('zp', v)}
        placeholder="Z′"
      />
    </div>
  )
}

function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
    />
  )
}
