import { useState } from "react";
import type { CrsDef } from "#modules/crs";
import type { HelmertParams } from "#modules/helmert/solve";
import { applyPickedAnchor } from "#state/workspace";
import type { IfcMetadata } from "#modules/ifc/worker";
import type { PickedAnchor } from "../map/hooks/use-anchor-picker";

interface UseAnchorPickOptions {
  metadata: IfcMetadata;
  activeCrs: CrsDef | null;
  /** Existing anchor params to patch E/N into, or null to seed fresh. */
  base: HelmertParams | null;
  onPicked: (params: HelmertParams) => void;
  onError: (message: string) => void;
}

/**
 * Owns the "click on the map to place the anchor" flow: the picking-mode
 * flag and the one-shot handler that fires when the map reports a picked
 * point.
 */
export function useAnchorPick({
  metadata,
  activeCrs,
  base,
  onPicked,
  onError,
}: UseAnchorPickOptions) {
  const [isPickingAnchor, setIsPickingAnchor] = useState(false);

  function start() {
    setIsPickingAnchor(true);
  }

  function cancel() {
    setIsPickingAnchor(false);
  }

  function handlePicked(point: PickedAnchor) {
    setIsPickingAnchor(false);

    if (!activeCrs) {
      onError("Set a target CRS before picking an anchor.");
      return;
    }

    const next = applyPickedAnchor({ point, metadata, activeCrs, base });

    if (next.isErr()) {
      onError(`Projection failed: ${String(next.error.cause)}`);
      return;
    }

    onPicked(next.value);
  }

  return { isPickingAnchor, start, cancel, handlePicked };
}
