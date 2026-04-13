import { ok, err, type Result } from 'neverthrow'
import { levenbergMarquardt } from 'ml-levenberg-marquardt'
import type {
  HelmertParams,
  HelmertError,
  PointPair,
  SurveySource,
} from './types'

/**
 * 5-parameter Helmert transformation solver.
 *
 * Mirrors the math from the Flask app's `equations` function (app.py:460-477):
 *
 *     X' = S·cos(θ)·X − S·sin(θ)·Y + E
 *     Y' = S·sin(θ)·X + S·cos(θ)·Y + N
 *     Z' = S·Z + H
 *
 * Five unknowns: scale (S), rotation (θ), easting (E), northing (N), height (H).
 * Each point pair contributes 3 equations. With ≥2 point pairs the system is
 * overdetermined and we use Levenberg-Marquardt to minimize residuals.
 *
 * With exactly 1 point pair the system is under-determined for 5 unknowns,
 * so we fall back to deriving scale from the unit conversion ratio and
 * rotation from the IFC TrueNorth direction (mirroring the Flask app's
 * single-point branch in calculate()).
 */

export type SolverContext = {
  /** Scale fallback when there are not enough points to fit S (typically the unit conversion ratio in metres) */
  unitScale: number
  /** Rotation fallback when there are not enough points (typically derived from IfcGeometricRepresentationContext.TrueNorth) */
  trueNorthRotation: number
}

/**
 * Forward Helmert transform: maps a local IFC coordinate to its projected
 * CRS coordinate using a given set of parameters. Mirrors the equations
 * from app.py:460-477 (with no residual subtraction).
 */
export function applyHelmert(
  local: { x: number; y: number; z: number },
  params: HelmertParams,
): { x: number; y: number; z: number } {
  const cos = Math.cos(params.rotation)
  const sin = Math.sin(params.rotation)
  return {
    x: params.scale * cos * local.x - params.scale * sin * local.y + params.easting,
    y: params.scale * sin * local.x + params.scale * cos * local.y + params.northing,
    z: params.scale * local.z + params.height,
  }
}

export function buildPointList(source: SurveySource): PointPair[] {
  switch (source.kind) {
    case 'use-existing':
      return [source.ifcSitePoint]
    case 'add-to-existing':
      return [source.ifcSitePoint, ...source.userPoints]
    case 'ignore-existing':
      return source.userPoints
  }
}

/**
 * Unified solver entry point. Branches on point count, not on survey mode.
 */
export function solveHelmert(
  points: PointPair[],
  context: SolverContext,
): Result<HelmertParams, HelmertError> {
  if (points.length === 0) {
    return err({ kind: 'no-points' })
  }
  if (points.length === 1) {
    return ok(solveSinglePointFallback(points[0], context))
  }
  return solveLeastSquares(points, context)
}

function solveSinglePointFallback(
  point: PointPair,
  context: SolverContext,
): HelmertParams {
  const { unitScale: S, trueNorthRotation: theta } = context
  const A = Math.cos(theta)
  const B = Math.sin(theta)
  return {
    scale: S,
    rotation: theta,
    easting: point.target.x - A * point.local.x * S + B * point.local.y * S,
    northing: point.target.y - B * point.local.x * S - A * point.local.y * S,
    height: point.target.z - point.local.z * S,
  }
}

/**
 * Levenberg-Marquardt least squares fit over the 5 Helmert parameters.
 *
 * ml-levenberg-marquardt is curve-fitting shaped: it minimizes a single
 * scalar `f(params)(x)` against a y-array. We encode our 3-equations-per-point
 * residual problem onto that interface by indexing each scalar equation with
 * `index = i*3 + k`, where `k ∈ {0, 1, 2}` selects X', Y', or Z'.
 */
function solveLeastSquares(
  points: PointPair[],
  context: SolverContext,
): Result<HelmertParams, HelmertError> {
  const xData: number[] = []
  const yData: number[] = []
  for (let i = 0; i < points.length; i++) {
    const t = points[i].target
    xData.push(i * 3, i * 3 + 1, i * 3 + 2)
    yData.push(t.x, t.y, t.z)
  }

  // Use the single-point fallback as the initial guess (anchored on point 0).
  const initial = solveSinglePointFallback(points[0], context)

  const model = (params: number[]) => (x: number) => {
    const [S, theta, E, N, H] = params
    const i = Math.floor(x / 3)
    const k = x % 3
    const local = points[i].local
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    if (k === 0) return S * cos * local.x - S * sin * local.y + E
    if (k === 1) return S * sin * local.x + S * cos * local.y + N
    return S * local.z + H
  }

  let result
  try {
    result = levenbergMarquardt({ x: xData, y: yData }, model, {
      initialValues: [
        initial.scale,
        initial.rotation,
        initial.easting,
        initial.northing,
        initial.height,
      ],
      maxIterations: 200,
      damping: 1e-2,
      gradientDifference: 1e-6,
    })
  } catch (_e) {
    return err({ kind: 'solver-diverged' })
  }

  const [scale, rotation, easting, northing, height] = result.parameterValues
  if (
    ![scale, rotation, easting, northing, height].every((v) => Number.isFinite(v))
  ) {
    return err({ kind: 'solver-diverged' })
  }
  return ok({ scale, rotation, easting, northing, height })
}
