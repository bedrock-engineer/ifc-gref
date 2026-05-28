import { useEffect, useState } from "react";
import { getIfc } from "../../ifc-api";
import { emitLog } from "../../lib/log";

/**
 * Fire `extractFootprint()` once per Workspace mount, and again every
 * time `epoch` changes — bumped by the parent after an in-place worker
 * mutation that invalidates extracted geometry (e.g. site-placement
 * zero). Workspace is keyed by filename, so a new file remounts and
 * starts fresh.
 *
 * Returned in IFC local coordinates — the projection through the active
 * Helmert + CRS happens at the consumer (MapView), since lng/lat is a
 * map-presentational concern.
 */
export function useExtractedFootprint(
  epoch = 0,
): Array<{ x: number; y: number }> | null {
  const [footprint, setFootprint] = useState<Array<{
    x: number;
    y: number;
  }> | null>(null);

  useEffect(
    function extract() {
      const token = { cancelled: false };
      void getIfc()
        .extractFootprint()
        .catch((error: unknown) => {
          emitLog({
            level: "error",
            message: `Footprint extraction failed: ${error instanceof Error ? error.message : String(error)}`,
          });
          return null;
        })
        .then((hull) => {
          if (!token.cancelled) {
            setFootprint(hull);
          }
        });
      return () => {
        token.cancelled = true;
      };
    },
    [epoch],
  );

  return footprint;
}
