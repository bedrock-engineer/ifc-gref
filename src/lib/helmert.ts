import { ok, err, type Result } from "neverthrow";
import { levenbergMarquardt } from "ml-levenberg-marquardt";
import { z } from "zod";

/**
 * # Unit policy
 *
 * `HelmertParams` and every `XYZ` consumed/produced by `applyHelmert` and
 * `solveHelmert` are in **metres**. The codebase normalises at two
 * boundaries:
 *
 * 1. **Worker read boundary** (`worker/ifc/metadata.ts`) — every
 *    IfcLengthMeasure-typed value (Eastings/Northings/OrthogonalHeight,
 *    IfcSite.RefElevation, ObjectPlacement.Location coords) is multiplied
 *    by `ifcMetresPerUnit` once.
 * 2. **proj4 boundary** (`lib/crs-transform.ts`) — metres ↔ CRS-native
 *    units (×`crsMetresPerUnit` / ÷). Identity for metric CRS.
 *
 * As a consequence, `parameters.scale` is a **dimensionless** real Helmert
 * scale factor — typically 1.0. It is *not* a unit-conversion ratio.
 * `applyHelmert(local_metres, params_metres) → output_metres`.
 */

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export interface PointPair {
  /** Local IFC coordinates */
  local: XYZ;
  target: XYZ;
}

export interface HelmertParams {
  /** Scale factor (S) */
  scale: number;
  /** Rotation around Z in radians (θ) */
  rotation: number;
  /** Easting translation (E) */
  easting: number;
  /** Northing translation (N) */
  northing: number;
  /** Vertical translation / OrthogonalHeight (H) */
  height: number;
}

export type SurveySource =
  | { kind: "use-existing"; ifcSitePoint: PointPair }
  | {
      kind: "add-to-existing";
      ifcSitePoint: PointPair;
      userPoints: Array<PointPair>;
    }
  | { kind: "ignore-existing"; userPoints: Array<PointPair> };

export type SurveyMode = SurveySource["kind"];

/** UI-facing solve request: the mode plus whatever user-entered points the
 * panel collected. The IfcSite point pair is materialised downstream (it
 * requires projecting lat/lon through proj4, which we keep out of the UI). */
export interface SolveRequest {
  mode: SurveyMode;
  userPoints: Array<PointPair>;
}

export type HelmertError =
  | { kind: "no-points" }
  | { kind: "collinear-points" }
  | { kind: "solver-diverged" };

/**
 * The solver returns `parameterValues: number[]` — typed as possibly sparse
 * and unbounded. We expect exactly 5 finite numbers (S, θ, E, N, H). Zod
 * gives us one safeParse that checks arity, definedness, and finiteness in
 * one shot, bridged to neverthrow below.
 */
const number = z.number();
const SolverParametersSchema = z.tuple([
  number,
  number,
  number,
  number,
  number,
]);

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

export interface SolverContext {
  /** Rotation fallback when there are not enough points (typically derived from IfcGeometricRepresentationContext.TrueNorth) */
  trueNorthRotation: number;
}

/**
 * Forward Helmert transform: maps a local IFC coordinate to its projected
 * CRS coordinate using a given set of parameters. Mirrors the equations
 * from app.py:460-477 (with no residual subtraction).
 */
export function applyHelmert(local: XYZ, parameters: HelmertParams): XYZ {
  const cos = Math.cos(parameters.rotation);
  const sin = Math.sin(parameters.rotation);
  return {
    x:
      parameters.scale * cos * local.x -
      parameters.scale * sin * local.y +
      parameters.easting,
    y:
      parameters.scale * sin * local.x +
      parameters.scale * cos * local.y +
      parameters.northing,
    z: parameters.scale * local.z + parameters.height,
  };
}

export function buildPointList(source: SurveySource): Array<PointPair> {
  switch (source.kind) {
    case "use-existing": {
      return [source.ifcSitePoint];
    }
    case "add-to-existing": {
      return [source.ifcSitePoint, ...source.userPoints];
    }
    case "ignore-existing": {
      return source.userPoints;
    }
  }
}

/**
 * Unified solver entry point. Branches on point count, not on survey mode.
 */
export function solveHelmert(
  points: Array<PointPair>,
  context: SolverContext,
): Result<HelmertParams, HelmertError> {
  const [first, ...rest] = points;
  if (!first) {
    return err({ kind: "no-points" });
  }
  if (rest.length === 0) {
    return ok(solveSinglePointFallback(first, context));
  }
  return solveLeastSquares([first, ...rest], context, first);
}

function solveSinglePointFallback(
  point: PointPair,
  context: SolverContext,
): HelmertParams {
  // Single-point branch can't fit a real scale factor — both local and
  // target are already in metres post-normalisation, so identity scale is
  // the natural choice. Multi-point fits will refine if needed.
  const S = 1;
  const theta = context.trueNorthRotation;
  const A = Math.cos(theta);
  const B = Math.sin(theta);
  return {
    scale: S,
    rotation: theta,
    easting: point.target.x - A * point.local.x * S + B * point.local.y * S,
    northing: point.target.y - B * point.local.x * S - A * point.local.y * S,
    height: point.target.z - point.local.z * S,
  };
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
  points: Array<PointPair>,
  context: SolverContext,
  anchor: PointPair,
): Result<HelmertParams, HelmertError> {
  const xData: Array<number> = [];
  const yData: Array<number> = [];
  for (const [index, point] of points.entries()) {
    const t = point.target;
    xData.push(index * 3, index * 3 + 1, index * 3 + 2);
    yData.push(t.x, t.y, t.z);
  }

  // Use the single-point fallback as the initial guess (anchored on point 0).
  const initial = solveSinglePointFallback(anchor, context);

  const model = (parameters: Array<number>) => (x: number) => {
    // L-M always calls this with the 5 parameters and indices from xData, so
    // the defaults are unreachable — they exist only to satisfy
    // noUncheckedIndexedAccess without a runtime guard.
    const [
      S = Number.NaN,
      theta = Number.NaN,
      E = Number.NaN,
      N = Number.NaN,
      H = Number.NaN,
    ] = parameters;
    const index = Math.floor(x / 3);
    const k = x % 3;
    const point = points[index];
    if (!point) {
      return Number.NaN;
    }
    const { local } = point;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    if (k === 0) {
      return S * cos * local.x - S * sin * local.y + E;
    }
    if (k === 1) {
      return S * sin * local.x + S * cos * local.y + N;
    }
    return S * local.z + H;
  };

  let result;
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
    });
  } catch {
    return err({ kind: "solver-diverged" });
  }

  const parsed = SolverParametersSchema.safeParse(result.parameterValues);
  if (!parsed.success) {
    return err({ kind: "solver-diverged" });
  }
  const [scale, rotation, easting, northing, height] = parsed.data;
  return ok({ scale, rotation, easting, northing, height });
}
