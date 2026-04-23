import { useEffect, useState } from "react";
import {
  type CrsLookupState,
  lookupCrs,
} from "../../lib/crs";
import { emitLog } from "../../lib/log";

/**
 * The resolved branches of `CrsLookupState`. We only *store* these — the
 * "resolving" and "invalid-code" branches are derived at render time from
 * (epsgCode, resolved) so the effect fires setState at most once per lookup.
 */
type ResolvedCrs = Extract<CrsLookupState, { kind: "ready" | "error" }>;

/**
 * Single source of truth for the active target CRS. Given the user-typed
 * EPSG code, returns a CrsLookupState that the UI can pattern-match on:
 *   - "invalid-code"  — code doesn't parse as a number
 *   - "resolving"     — lookup is in flight (also covers stale resolved values)
 *   - "ready"         — CrsDef registered with proj4 and ready to transform
 *   - "error"         — lookup failed (404, invalid proj4, network)
 *
 * This replaces a race where the map could reproject through an
 * unregistered code and silently render nothing.
 */
export function useCrsResolution(epsgCode: string): CrsLookupState {
  const [resolved, setResolved] = useState<ResolvedCrs | null>(null);

  useEffect(() => {
    const code = Number.parseInt(epsgCode, 10);
    if (!Number.isFinite(code)) {
      return;
    }
    let cancelled = false;
    void lookupCrs(code).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.isErr()) {
        emitLog({
          level: "error",
          message: `CRS lookup failed (EPSG:${code}): ${result.error.kind}`,
        });
        setResolved({ kind: "error", code, errorKind: result.error.kind });
        return;
      }
      setResolved({ kind: "ready", def: result.value });
    });
    return () => {
      cancelled = true;
    };
  }, [epsgCode]);

  return deriveCrsState(epsgCode, resolved);
}

function deriveCrsState(
  epsgCode: string,
  resolved: ResolvedCrs | null,
): CrsLookupState {
  const code = Number.parseInt(epsgCode, 10);
  if (!Number.isFinite(code)) {
    return { kind: "invalid-code" };
  }
  if (resolved) {
    const resolvedCode =
      resolved.kind === "ready" ? resolved.def.code : resolved.code;
    if (resolvedCode === code) {
      return resolved;
    }
  }
  return { kind: "resolving", code };
}
