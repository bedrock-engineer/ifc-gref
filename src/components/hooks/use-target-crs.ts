import { useState } from "react";
import { type CrsDef, lookupCrs } from "../../lib/crs";
import type { HelmertParams } from "../../lib/helmert";
import { emitLog } from "../../lib/log";
import {
  initialEpsgFromMetadata,
  reprojectAnchorOnCrsChange,
} from "../../lib/workspace-logic";
import type { IfcMetadata } from "../../worker/ifc";
import { useCrsResolution } from "./use-crs-resolution";

interface UseTargetCrsOptions {
  metadata: IfcMetadata;
  /** Current anchor params if any — used to decide whether an EPSG swap
   * should round-trip the anchor through lat/lon. */
  currentParams: HelmertParams | null;
  onReproject: (params: HelmertParams) => void;
  onError: (message: string) => void;
}

/**
 * Owns the target-CRS input state: the typed EPSG code, the async
 * resolution of that code via proj4 / epsg.io, and the "swap CRS while
 * preserving the anchor's geographic position" workflow.
 */
export function useTargetCrs({
  metadata,
  currentParams,
  onReproject,
  onError,
}: UseTargetCrsOptions) {
  const [epsgCode, setEpsgCode] = useState(() =>
    initialEpsgFromMetadata(metadata),
  );
  const crsState = useCrsResolution(epsgCode);
  const activeCrs: CrsDef | null =
    crsState.kind === "ready" ? crsState.def : null;

  async function changeEpsg(nextCode: string) {
    const nextEpsg = Number.parseInt(nextCode, 10);
    if (
      !currentParams ||
      !activeCrs ||
      !Number.isFinite(nextEpsg) ||
      nextEpsg === activeCrs.code
    ) {
      setEpsgCode(nextCode);
      return;
    }

    const previousEpsg = activeCrs.code;
    // Pre-register the new CRS so reprojectAnchorOnCrsChange's second leg
    // can succeed.
    const lookup = await lookupCrs(nextEpsg);

    if (lookup.isErr()) {
      setEpsgCode(nextCode);
      onError(`CRS lookup failed for EPSG:${nextEpsg} (${lookup.error.kind})`);
      return;
    }

    const reprojected = reprojectAnchorOnCrsChange({
      parameters: currentParams,
      previousEpsg,
      nextEpsg,
    });

    setEpsgCode(nextCode);

    if (reprojected.isErr()) {
      onError(`Re-projection failed: ${String(reprojected.error.cause)}`);
      return;
    }
    onReproject(reprojected.value);
    emitLog({
      message: `Re-projected anchor from EPSG:${previousEpsg} to EPSG:${nextEpsg}`,
    });
  }

  return { epsgCode, crsState, activeCrs, changeEpsg };
}
