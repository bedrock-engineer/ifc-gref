import { useState } from "react";
import type { CrsDef } from "../../lib/crs";
import {
  type HelmertParams,
  type PointPair,
  type SolveRequest,
  buildPointList,
  solveHelmert,
} from "../../lib/helmert";
import { emitLog } from "../../lib/log";
import { unitToMetres } from "../../lib/units";
import {
  buildSurveySource,
  trueNorthRotation,
} from "../../lib/workspace-logic";
import type { IfcMetadata } from "../../worker/ifc";

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
    // declare it. Solver canonical is metres (see lib/helmert.ts), so
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
    const solved = solveHelmert(points, {
      trueNorthRotation: trueNorthRotation(metadata),
    });

    if (solved.isErr()) {
      onError(`Helmert solver failed: ${solved.error.kind}`);
      return;
    }

    const p = solved.value;
    emitLog({
      message: `Solved Helmert (${request.mode}): E=${p.easting.toFixed(3)}, N=${p.northing.toFixed(3)}, h=${p.height.toFixed(3)}, rot=${p.rotation.toFixed(4)} rad, scale=${p.scale.toFixed(6)}`,
    });
    setLastFitPoints(points.length >= 2 ? points : null);
    onSolved(p);
  }

  return { solve, lastFitPoints };
}
