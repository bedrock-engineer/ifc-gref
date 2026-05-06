import { useState } from "react";
import { type CrsDef } from "#modules/crs";
import type { HelmertParams } from "#modules/helmert/solve";
import { emitLog } from "../../lib/log";
import {
  initialEpsgFromMetadata,
  reprojectAnchorOnCrsChange,
} from "#state/workspace";
import type { IfcMetadata } from "#modules/ifc/worker";
import { useCrsResolution } from "../sidebar/cards/target-crs-card/use-crs-resolution";

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
    const result = await reprojectAnchorOnCrsChange({
      parameters: currentParams,
      previousEpsg,
      nextEpsg,
    });
    setEpsgCode(nextCode);

    if (result.isErr()) {
      const { error } = result;
      const detail =
        error.kind === "lookup-failed"
          ? `CRS lookup failed (${error.cause.kind})`
          : String(error.cause);
      onError(
        `Re-projection from EPSG:${previousEpsg} to EPSG:${nextEpsg} failed: ${detail}`,
      );
      return;
    }
    onReproject(result.value);
    emitLog({
      message: `Re-projected anchor from EPSG:${previousEpsg} to EPSG:${nextEpsg}`,
    });
  }

  /**
   * Set the EPSG code directly, bypassing the swap-time reprojection.
   * Used by sidecar import: the sidecar's E/N/H are authoritative for the
   * new CRS, so reprojecting the *old* anchor would discard the values
   * we're about to apply.
   */
  function replaceEpsg(nextCode: string) {
    setEpsgCode(nextCode);
  }

  return { epsgCode, crsState, activeCrs, changeEpsg, replaceEpsg };
}
