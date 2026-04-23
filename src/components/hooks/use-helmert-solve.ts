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
 * (plus optional IfcSite reference). Owns the in-flight "busy" flag; the
 * caller unions it with other busy flags for the UI.
 */
export function useHelmertSolve({
  metadata,
  activeCrs,
  onSolved,
  onError,
}: UseHelmertSolveOptions) {
  const [busy, setBusy] = useState(false);
  // The point pairs from the most recent successful least-squares fit, kept
  // so the residual chart can render alongside the current parameters. Null
  // for single-point fallback solves (no residuals to visualise).
  const [lastFitPoints, setLastFitPoints] = useState<Array<PointPair> | null>(
    null,
  );

  function solve(request: SolveRequest) {
    setBusy(true);

    try {
      if (!activeCrs) {
        onError("Set a target CRS before solving.");
        return;
      }
      const unitMetres = unitToMetres(metadata.lengthUnit);

      if (unitMetres.isErr()) {
        onError(`Unknown IFC length unit: ${unitMetres.error.name}`);
        return;
      }

      const source = buildSurveySource({ request, metadata, activeCrs });
      if (source.isErr()) {
        onError(source.error.message);
        return;
      }

      // Helmert scale maps IFC project length unit → target CRS map unit
      // (IFC spec, IfcMapConversion.Scale). For metric CRS this equals
      // `ifcMetres`; for foot-based CRS like EPSG:2272 it's
      // `ifcMetres / crsMetresPerUnit`, which for a foot IFC + foot CRS
      // correctly comes out to 1.0 rather than 0.3048.
      const unitScale = unitMetres.value / activeCrs.metresPerUnit;
      const points = buildPointList(source.value);
      const solved = solveHelmert(points, {
        unitScale,
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
    } finally {
      setBusy(false);
    }
  }

  return { busy, solve, lastFitPoints };
}
