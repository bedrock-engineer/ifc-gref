import { useState } from "react";
import type { CrsDef } from "#modules/crs";
import {
  type HelmertError,
  type HelmertParams,
  type PointPair,
  type SolveRequest,
  buildPointList,
  computeResiduals,
  solveHelmertJoint,
  solveHelmertSplit,
  summarizeResiduals,
} from "#modules/helmert/solve";
import { emitLog } from "../../lib/log";
import { unitToMetres } from "#modules/units/convert";
import {
  buildSurveySource,
  trueNorthRotation,
} from "#state/workspace";
import type { IfcMetadata } from "#modules/ifc/worker";

interface UseHelmertSolveOptions {
  metadata: IfcMetadata;
  activeCrs: CrsDef | null;
  onSolved: (params: HelmertParams) => void;
  onError: (message: string) => void;
}

/**
 * Runs the Helmert least-squares solver against the user's survey points
 * (plus optional IfcSite reference). The solver runs on the main thread
 * synchronously — there's no async boundary, so no in-flight flag is
 * exposed. If the solver ever moves to a worker, reintroduce one here.
 */
export function useHelmertSolve({
  metadata,
  activeCrs,
  onSolved,
  onError,
}: UseHelmertSolveOptions) {
  // The point pairs from the most recent successful least-squares fit, kept
  // so the residual chart can render alongside the current parameters. Null
  // for single-point fallback solves (no residuals to visualise).
  const [lastFitPoints, setLastFitPoints] = useState<Array<PointPair> | null>(
    null,
  );

  function solve(request: SolveRequest) {
    if (!activeCrs) {
      onError("Set a target CRS before solving.");
      return;
    }
    const unitMetres = unitToMetres(metadata.lengthUnit);

    if (unitMetres.isErr()) {
      onError(`Unknown IFC length unit: ${unitMetres.error.name}`);
      return;
    }

    // Survey-points-card collects local in IFC native units (mm/ft/...)
    // and target in CRS native units (m/ft/...) — the headers in that card
    // declare it. Solver canonical is metres (see modules/helmert/solve.ts), so
    // convert at this entry once. metadata.localOrigin and the IfcSite
    // target inside buildSurveySource are already metres (worker boundary
    // and proj4 boundary handle those).
    const ifcMetresPerUnit = unitMetres.value;
    const crsMetresPerUnit = activeCrs.metresPerUnit;
    const convertedRequest: SolveRequest = {
      mode: request.mode,
      userPoints: request.userPoints.map((p) => ({
        local: {
          x: p.local.x * ifcMetresPerUnit,
          y: p.local.y * ifcMetresPerUnit,
          z: p.local.z * ifcMetresPerUnit,
        },
        target: {
          x: p.target.x * crsMetresPerUnit,
          y: p.target.y * crsMetresPerUnit,
          z: p.target.z * crsMetresPerUnit,
        },
      })),
    };

    const source = buildSurveySource({
      request: convertedRequest,
      metadata,
      activeCrs,
    });
    if (source.isErr()) {
      onError(source.error.message);
      return;
    }

    const points = buildPointList(source.value);
    // Schema dispatch: IFC 4.3 can faithfully encode the split fit via
    // IfcMapConversionScaled, so we use it there. Pre-4.3 schemas only carry
    // one isotropic Scale, so we use the joint fit whose (S, H) is co-optimal
    // for the model the file actually encodes — no round-trip drift.
    // See `docs/helmert-scale-handling.md`.
    const solver =
      metadata.schema === "IFC4X3" ? solveHelmertSplit : solveHelmertJoint;
    const solved = solver(points, {
      trueNorthRotation: trueNorthRotation(metadata.trueNorth),
    });

    if (solved.isErr()) {
      onError(helmertErrorMessage(solved.error.kind));
      return;
    }

    const p = solved.value;
    const summary =
      points.length >= 2 ? summarizeResiduals(computeResiduals(points, p)) : null;
    const scaleStr =
      p.xScale === p.yScale && p.yScale === p.zScale
        ? `scale=${p.xScale.toFixed(6)}`
        : `xScale=${p.xScale.toFixed(6)}, yScale=${p.yScale.toFixed(6)}, zScale=${p.zScale.toFixed(6)}`;
    emitLog({
      message:
        `Solved Helmert (${request.mode}): E=${p.easting.toFixed(3)}, N=${p.northing.toFixed(3)}, h=${p.height.toFixed(3)}, rot=${p.rotation.toFixed(4)} rad, ${scaleStr}` +
        (summary
          ? `, RMSE XY=${summary.rmsXY.toFixed(3)}, RMSE Z=${summary.rmsZ.toFixed(3)}`
          : ""),
    });
    setLastFitPoints(points.length >= 2 ? points : null);
    onSolved(p);
  }

  return { solve, lastFitPoints };
}

function helmertErrorMessage(kind: HelmertError["kind"]): string {
  switch (kind) {
    case "no-points": {
      return "No survey points provided.";
    }
    case "collinear-points": {
      return "Survey points are coincident or all on a line in XY. Provide points spread in two horizontal directions.";
    }
    case "solver-diverged": {
      return "Solver did not converge — check your survey points for typos or wildly off values.";
    }
  }
}
