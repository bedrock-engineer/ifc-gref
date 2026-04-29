import { useCallback, useSyncExternalStore } from "react";
import {
  type CrsLookupState,
  getResolutionState,
  lookupCrs,
  subscribeResolution,
} from "../../../../lib/crs";

const INVALID_CODE: CrsLookupState = { kind: "invalid-code" };
const NO_OP_UNSUBSCRIBE = () => {};

/**
 * Per-code resolution state, plugged into the app-level CRS store via
 * `useSyncExternalStore`. The store itself (in `crs-manifest.ts`) tracks
 * resolution status per EPSG code and notifies subscribers when state
 * transitions; this hook just bridges to React.
 *
 * The "invalid-code" branch is purely UI: when the user types non-numeric
 * input, we don't dispatch to the store at all — the lib only tracks
 * codes that are or have been actively looked up.
 */
export function useCrsResolution(epsgCode: string): CrsLookupState {
  const code = Number.parseInt(epsgCode, 10);
  const isValid = Number.isFinite(code);

  // Render-phase trigger: lookupCrs is memoised (cache + inflight), so
  // repeated calls for the same code are no-ops. The first call populates
  // the resolution-state map synchronously, which means getSnapshot below
  // returns a stable lib-owned ref on the very first render — no extra
  // re-render after mount just to transition off a fallback.
  if (isValid) {
    void lookupCrs(code);
  }

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!isValid) return NO_OP_UNSUBSCRIBE;
      return subscribeResolution(code, listener);
    },
    [code, isValid],
  );

  const getSnapshot = useCallback((): CrsLookupState => {
    if (!isValid) return INVALID_CODE;
    // lookupCrs above guarantees a state exists for valid codes; the
    // INVALID_CODE fallback is unreachable but kept for type narrowing.
    return getResolutionState(code) ?? INVALID_CODE;
  }, [code, isValid]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
