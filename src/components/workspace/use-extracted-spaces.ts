import { useEffect, useState } from "react";
import type { SpaceExtract } from "#modules/ifc/worker";
import { getIfc } from "../../ifc-api";
import { emitLog } from "../../lib/log";

/**
 * Fire `extractSpaces()` once per Workspace mount and again on `epoch`
 * bumps, mirroring `useExtractedFootprint`. Returned in IFC local
 * metres — projection through the active Helmert + CRS happens in
 * `deriveOverlaySignals`.
 *
 * Returns `null` while pending and `[]` for files without IfcSpace.
 */
export function useExtractedSpaces(
  epoch = 0,
): ReadonlyArray<SpaceExtract> | null {
  const [spaces, setSpaces] = useState<ReadonlyArray<SpaceExtract> | null>(
    null,
  );

  useEffect(
    function extract() {
      const token = { cancelled: false };
      void getIfc()
        .extractSpaces()
        .catch((error: unknown) => {
          emitLog({
            level: "error",
            message: `Space extraction failed: ${error instanceof Error ? error.message : String(error)}`,
          });
          return [] as Array<SpaceExtract>;
        })
        .then((result) => {
          if (!token.cancelled) {
            setSpaces(result);
          }
        });
      return () => {
        token.cancelled = true;
      };
    },
    [epoch],
  );

  return spaces;
}
