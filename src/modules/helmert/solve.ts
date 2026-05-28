import { ok, err, type Result } from "neverthrow";
import { levenbergMarquardt } from "ml-levenberg-marquardt";
import { z } from "zod";

/**
 * # Unit policy
 *
 * `HelmertParams` and every `XYZ` consumed/produced by `applyHelmert` and
 * `solveHelmertJoint`/`solveHelmertSplit` are in **metres**. The codebase
 * normalises at two boundaries:
 *
 * 1. **Worker read boundary** (`worker/ifc/metadata.ts`) — every
 *    IfcLengthMeasure-typed value (Eastings/Northings/OrthogonalHeight,
 *    IfcSite.RefElevation, ObjectPlacement.Location coords) is multiplied
 *    by `ifcMetresPerUnit` once.
 * 2. **proj4 boundary** (`modules/crs/transform.ts`) — metres ↔ CRS-native
 *    units (×`crsMetresPerUnit` / ÷). Identity for metric CRS.
 *
 * As a consequence, `xScale`, `yScale`, and `zScale` are **dimensionless**
 * real Helmert scale factors, typically 1.0.
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
  /** Projected CRS coordinates */
  target: XYZ;
}

export interface HelmertParams {
  /**
   * Per-axis scale factors. Three independent fields to faithfully
   * represent IFC 4.3's `IfcMapConversionScaled` (which carries `Scale`
   * plus `FactorX`, `FactorY`, `FactorZ` — effective per-axis scale is the
   * product). Pre-4.3 schemas only carry one isotropic Scale; on read all
   * three end up equal. Our fitters always produce `xScale === yScale`
   * (no horizontal anisotropy from a conformal projection); `xScale ≠
   * yScale` only enters via reading a non-conformal file authored elsewhere.
   *
   * `solveHelmertJoint` sets all three equal (used on pre-4.3, where a single
   * isotropic Scale is what the schema can carry). `solveHelmertSplit` sets
   * `xScale = yScale` from the horizontal LM and `zScale = 1` (used on 4.3,
   * where `IfcMapConversionScaled` can faithfully encode the asymmetry).
   */
  xScale: number;
  yScale: number;
  zScale: number;
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
 * Two solver entry points, picked by the caller based on what the file's
 * schema can faithfully encode:
 *
 * - **`solveHelmertJoint`** (used on pre-4.3): joint isotropic L-M fit
 *   over `(S, θ, E, N, H)` with `Z' = S·z + H`. Sets all three scale
 *   axes equal. The chosen `(S, H)` is co-optimal for the model the
 *   single-Scale schema actually encodes — no round-trip drift.
 *
 * - **`solveHelmertSplit`** (used on IFC 4.3): horizontal-only L-M fit
 *   over `(S, θ, E, N)` with `Z' = z + H`, `H = mean(t.z − z)` closed-form.
 *   Sets `xScale = yScale = horizontal S`, `zScale = 1`. Geodesically
 *   correct: horizontal CSF doesn't pollute Z. Faithfully encodable on 4.3
 *   via `IfcMapConversionScaled`.
 *
 * Background on why the two: `S` exists to absorb the projected CRS's
 * combined scale factor — a horizontal-only effect (projections distort
 * XY metres but leave vertical metres alone). A joint fit lets Z residuals
 * tug on `S` in proportion to `Z² / (X² + Y² + Z²)` per point, biasing the
 * horizontal scale toward 1 away from the true CSF. The Flask app
 * (`app.py:460-477`) and most peer tools do the joint fit; on pre-4.3 we
 * do too, because the round-trip-drift cost of the split (sub-cm Z bias
 * per `(S − 1) · z`) outweighs the unbiased-S gain (~4 ppm = sub-mm at
 * building footprint scale) on schemas that can only carry one isotropic
 * Scale. On 4.3 the schema can carry the asymmetry, so we use the split
 * and the trade flips.
 *
 * With exactly 1 point pair both branches fall back to a closed-form
 * single-point solver: `S = 1`, θ from the IFC TrueNorth direction,
 * translation derived directly. See `docs/helmert-scale-handling.md` for
 * the full design rationale.
 */

export interface SolverContext {
  /** Rotation fallback when there are not enough points (typically derived from IfcGeometricRepresentationContext.TrueNorth) */
  trueNorthRotation: number;
}

/**
 * Forward Helmert transform: maps a local IFC coordinate to its projected
 * CRS coordinate using a given set of parameters.
 *
 * Per IFC 4.3 spec for `IfcMapConversionScaled`: rotate first, then scale
 * each axis independently. With `xScale === yScale` the formula reduces
 * to the classical isotropic IFC4 Helmert (`X' = S·cos·x − S·sin·y + E`,
 * etc.); the per-axis form is a strict generalisation.
 */
export function applyHelmert(local: XYZ, parameters: HelmertParams): XYZ {
  const cos = Math.cos(parameters.rotation);
  const sin = Math.sin(parameters.rotation);
  return {
    x: parameters.xScale * (cos * local.x - sin * local.y) + parameters.easting,
    y:
      parameters.yScale * (sin * local.x + cos * local.y) + parameters.northing,
    z: parameters.zScale * local.z + parameters.height,
  };
}

/**
 * True when `parameters` represent a pure translation — zero rotation, unit
 * scales on every axis — within a tight floating-point tolerance. Drives
 * the IFC 4.3 `IfcRigidOperation` preserve-on-save path: the worker
 * dispatcher only preserves the entity type when this predicate holds, and
 * the save-card "Will write" indicator uses the same predicate to predict
 * the writer's choice.
 *
 * Tolerances are noise thresholds (1e-9), not user-meaningful precision —
 * any deliberate edit (a single drag in the rotation card, any non-1
 * scale entered manually) crosses them by many orders of magnitude.
 */
const ROTATION_EPSILON = 1e-9;
const SCALE_EPSILON = 1e-9;

export function isPureTranslation(parameters: HelmertParams): boolean {
  return (
    Math.abs(parameters.rotation) < ROTATION_EPSILON &&
    Math.abs(parameters.xScale - 1) < SCALE_EPSILON &&
    Math.abs(parameters.yScale - 1) < SCALE_EPSILON &&
    Math.abs(parameters.zScale - 1) < SCALE_EPSILON
  );
}

/**
 * Per-point misfit between a target and where the current Helmert
 * transform maps the local point. `magnitudeXY` is precomputed because
 * every consumer wants it (worst-point ranking, table sort, map labels).
 */
export interface Residual {
  dx: number;
  dy: number;
  dz: number;
  magnitudeXY: number;
}

export interface ResidualSummary {
  rmsXY: number;
  rmsZ: number;
  /** Index into the input residual array — matches the point's position. */
  worstIndex: number;
  worstMagnitudeXY: number;
}

/**
 * Per-point residuals against the *current* params (not the fitted ones).
 * Recomputed on every render so the table/chart stay meaningful when the
 * user nudges the anchor or rotation after a solve.
 */
export function computeResiduals(
  points: Array<PointPair>,
  params: HelmertParams,
): Array<Residual> {
  return points.map((p) => {
    const predicted = applyHelmert(p.local, params);
    const dx = p.target.x - predicted.x;
    const dy = p.target.y - predicted.y;
    const dz = p.target.z - predicted.z;
    return { dx, dy, dz, magnitudeXY: Math.hypot(dx, dy) };
  });
}

/**
 * Aggregate stats over a list of residuals. Returns `null` for an empty
 * list — RMSE of zero points is undefined, and the alternative (NaN
 * leaking into UI) is worse. Callers that already gate on length can
 * narrow with `if (!summary) return ...`.
 */
export function summarizeResiduals(
  residuals: Array<Residual>,
): ResidualSummary | null {
  if (residuals.length === 0) {
    return null;
  }

  let sumSqXY = 0;
  let sumSqZ = 0;
  let worstIndex = 0;
  let worstMagnitudeXY = -1;

  for (const [index, r] of residuals.entries()) {
    sumSqXY += r.dx * r.dx + r.dy * r.dy;
    sumSqZ += r.dz * r.dz;
    if (r.magnitudeXY > worstMagnitudeXY) {
      worstMagnitudeXY = r.magnitudeXY;
      worstIndex = index;
    }
  }

  return {
    rmsXY: Math.sqrt(sumSqXY / residuals.length),
    rmsZ: Math.sqrt(sumSqZ / residuals.length),
    worstIndex,
    worstMagnitudeXY,
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
 * Joint isotropic 5-parameter L-M fit. Used on schemas that can only carry
 * one Scale field (IFC4 / 4 ADD2 / 2X3). Sets `xScale = yScale = zScale =
 * fitted S`. The chosen `(S, H)` is co-optimal for `Z' = S·z + H` — the
 * model the file actually encodes — so save → re-read has no drift.
 */
export function solveHelmertJoint(
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

  if (isXyRankDeficient([first, ...rest])) {
    return err({ kind: "collinear-points" });
  }

  return solveLeastSquaresJoint([first, ...rest], context);
}

/**
 * Split fit: horizontal-only 4-parameter L-M for `(S, θ, E, N)` plus
 * closed-form `H = mean(t.z − z)` for vertical. Used on IFC 4.3, where
 * `IfcMapConversionScaled` can carry the asymmetry (`xScale = yScale =
 * fitted horizontal S`, `zScale = 1`). Geodesically clean: the projection's
 * combined scale factor (a horizontal-only effect) doesn't pollute Z.
 */
export function solveHelmertSplit(
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

  if (isXyRankDeficient([first, ...rest])) {
    return err({ kind: "collinear-points" });
  }

  return solveLeastSquaresSplit([first, ...rest], context);
}

/**
 * True when the local XY layout has rank < 2 — points coincident or all on
 * a line. The 5-parameter Helmert can technically still find a unique fit
 * when target-line-direction is determined by the local-line-direction, but
 * rank-deficient inputs almost always mean user error (typo, copy-paste
 * mishap, or a misread that all points are at one survey marker). We refuse
 * rather than silently produce a fit whose perpendicular component is
 * driven by floating-point noise.
 *
 * Detection: closed-form eigenvalues of the 2×2 covariance matrix of
 * centred local XY. Rank-deficient ⇔ smaller eigenvalue is negligible
 * relative to the larger.
 */
function isXyRankDeficient(points: Array<PointPair>): boolean {
  let sumX = 0;
  let sumY = 0;

  for (const p of points) {
    sumX += p.local.x;
    sumY += p.local.y;
  }

  const cx = sumX / points.length;
  const cy = sumY / points.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  for (const p of points) {
    const dx = p.local.x - cx;
    const dy = p.local.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const trace = sxx + syy;

  if (trace === 0) {
    // All points coincident in XY.
    return true;
  }

  const det = sxx * syy - sxy * sxy;
  // Eigenvalues of [[sxx, sxy], [sxy, syy]] are (trace ± √(trace² − 4det))/2.
  // Smaller-to-larger ratio = (trace − √disc) / (trace + √disc). Below 1e−6
  // means the smaller axis is six orders of magnitude tighter than the
  // larger — effectively a line.
  const disc = Math.max(0, trace * trace - 4 * det);
  const sqrtDisc = Math.sqrt(disc);
  const eigMin = (trace - sqrtDisc) / 2;
  const eigMax = (trace + sqrtDisc) / 2;

  return eigMin / eigMax < 1e-6;
}

/**
 * Single-point closed-form Helmert: identity scale, rotation = TrueNorth,
 * translation derived directly so the one (local, target) pair is fit
 * exactly. Used both as the inner fallback by the multi-point solvers
 * and as the canonical seed-construction primitive — file-load seeding
 * (IfcSite) and map-click anchoring both call this with a synthetic
 * `(local, target)` pair so the algebra lives in one place.
 */
export function solveSinglePointFallback(
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
    xScale: S,
    yScale: S,
    zScale: S,
    rotation: theta,
    easting: point.target.x - A * point.local.x * S + B * point.local.y * S,
    northing: point.target.y - B * point.local.x * S - A * point.local.y * S,
    height: point.target.z - point.local.z * S,
  };
}

/**
 * `levenbergMarquardt` returns `parameterValues: number[]` — typed as
 * possibly sparse and unbounded. Zod tuples check arity, definedness, and
 * finiteness in one safeParse, bridged to neverthrow below.
 */
const number = z.number();
const HorizontalParametersSchema = z.tuple([number, number, number, number]);
const JointParametersSchema = z.tuple([number, number, number, number, number]);

/**
 * Joint isotropic 5-parameter L-M fit: `(S, θ, E, N, H)` over
 * `Z' = S·z + H`. ml-levenberg-marquardt is curve-fitting shaped (one
 * scalar `f(params)(x)` against a y-array), so we index each scalar
 * equation with `index = i*3 + k`, `k ∈ {0, 1, 2}` selecting X', Y', Z'.
 */
function solveLeastSquaresJoint(
  points: readonly [PointPair, ...Array<PointPair>],
  context: SolverContext,
): Result<HelmertParams, HelmertError> {
  const xData: Array<number> = [];
  const yData: Array<number> = [];

  for (const [index, point] of points.entries()) {
    const t = point.target;
    xData.push(index * 3, index * 3 + 1, index * 3 + 2);
    yData.push(t.x, t.y, t.z);
  }

  const initial = solveSinglePointFallback(points[0], context);

  const model = (parameters: Array<number>) => (x: number) => {
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
      return S * (cos * local.x - sin * local.y) + E;
    }
    if (k === 1) {
      return S * (sin * local.x + cos * local.y) + N;
    }
    return S * local.z + H;
  };

  let result;
  try {
    result = levenbergMarquardt({ x: xData, y: yData }, model, {
      initialValues: [
        initial.xScale,
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

  const parsed = JointParametersSchema.safeParse(result.parameterValues);
  if (!parsed.success) {
    return err({ kind: "solver-diverged" });
  }
  const [scale, rotation, easting, northing, height] = parsed.data;
  return ok({
    xScale: scale,
    yScale: scale,
    zScale: scale,
    rotation,
    easting,
    northing,
    height,
  });
}

/**
 * Split fit: 4-parameter horizontal L-M for `(S, θ, E, N)`, then closed-form
 * `H = mean(t.z − z)` for vertical. Encoded indices: `index = i*2 + k`,
 * `k ∈ {0, 1}` selecting X' or Y'.
 */
function solveLeastSquaresSplit(
  points: readonly [PointPair, ...Array<PointPair>],
  context: SolverContext,
): Result<HelmertParams, HelmertError> {
  const xData: Array<number> = [];
  const yData: Array<number> = [];

  for (const [index, point] of points.entries()) {
    const t = point.target;
    xData.push(index * 2, index * 2 + 1);
    yData.push(t.x, t.y);
  }

  const initial = solveSinglePointFallback(points[0], context);

  const model = (parameters: Array<number>) => (x: number) => {
    const [S = Number.NaN, theta = Number.NaN, E = Number.NaN, N = Number.NaN] =
      parameters;
    const index = Math.floor(x / 2);
    const k = x % 2;
    const point = points[index];
    if (!point) {
      return Number.NaN;
    }
    const { local } = point;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    if (k === 0) {
      return S * (cos * local.x - sin * local.y) + E;
    }
    return S * (sin * local.x + cos * local.y) + N;
  };

  let result;
  try {
    result = levenbergMarquardt({ x: xData, y: yData }, model, {
      initialValues: [
        initial.xScale,
        initial.rotation,
        initial.easting,
        initial.northing,
      ],
      maxIterations: 200,
      damping: 1e-2,
      gradientDifference: 1e-6,
    });
  } catch {
    return err({ kind: "solver-diverged" });
  }

  const parsed = HorizontalParametersSchema.safeParse(result.parameterValues);
  if (!parsed.success) {
    return err({ kind: "solver-diverged" });
  }
  const [horizontalScale, rotation, easting, northing] = parsed.data;

  // Closed-form vertical fit: argmin_H Σ(t.z − l.z − H)² = mean(t.z − l.z).
  // Independent of S and θ because Z' = z + H has neither.
  let sumDz = 0;
  for (const point of points) {
    sumDz += point.target.z - point.local.z;
  }
  const height = sumDz / points.length;

  return ok({
    xScale: horizontalScale,
    yScale: horizontalScale,
    zScale: 1,
    rotation,
    easting,
    northing,
    height,
  });
}
