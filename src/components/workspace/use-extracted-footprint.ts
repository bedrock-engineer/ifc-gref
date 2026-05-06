import { useEffect, useState } from "react";
import { getIfc } from "../../ifc-api";
import { emitLog } from "../../lib/log";

/**
 * Fire `extractFootprint()` once per Workspace mount. Workspace is keyed
 * by filename in the parent, so a new file gets a fresh extraction.
 *
 * Returned in IFC local coordinates — the projection through the active
 * Helmert + CRS happens at the consumer (MapView), since lng/lat is a
 * map-presentational concern.
 */
export function useExtractedFootprint(): Array<{ x: number; y: number }> | null {
  const [footprint, setFootprint] = useState<Array<{
    x: number;
    y: number;
  }> | null>(null);

  useEffect(function extract() {
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
  }, []);

  return footprint;
}
