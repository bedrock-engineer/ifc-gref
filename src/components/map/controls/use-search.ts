import { useEffect, useState } from "react";
import { emitLog } from "../../../lib/log";
import * as nominatim from "../../../lib/nominatim";
import * as pdok from "../../../lib/pdok";
import type { MapScope } from "./use-scope";

export interface Suggestion {
  id: string;
  label: string;
}

export interface PlaceResult {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
}

const DEBOUNCE_MS = 220;
const MIN_QUERY_LEN = 2;

interface UseAddressSuggestResult {
  suggestions: Array<Suggestion>;
  loading: boolean;
}

/**
 * Debounced, abortable address suggestion. For queries below
 * `MIN_QUERY_LEN` we skip both the fetch and the state altogether —
 * the render-time short-circuit keeps the dropdown quiet while the
 * user is mid-keystroke. Cleanup aborts any in-flight fetch, which
 * the `"aborted"` error kind suppresses from the log panel.
 */
export function useAddressSuggest(
  query: string,
  scope: MapScope,
): UseAddressSuggestResult {
  const trimmed = query.trim();
  const shouldSearch = trimmed.length >= MIN_QUERY_LEN;
  const [state, setState] = useState<UseAddressSuggestResult>({
    suggestions: [],
    loading: false,
  });

  useEffect(() => {
    if (!shouldSearch) {
      return;
    }
    const abort = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      const promise =
        scope === "nl"
          ? pdok
              .suggest(trimmed, abort.signal)
              .map((docs) =>
                docs.map(
                  (d): Suggestion => ({ id: d.id, label: d.weergavenaam }),
                ),
              )
          : nominatim
              .suggest(trimmed, abort.signal)
              .map((docs) =>
                docs.map((d): Suggestion => ({ id: d.id, label: d.label })),
              );
      void promise.then((result) => {
        if (abort.signal.aborted) {
          return;
        }
        if (result.isErr()) {
          if (result.error.kind !== "aborted") {
            emitLog({
              level: "warn",
              message: `Address search failed: ${result.error.kind}`,
            });
          }
          setState({ suggestions: [], loading: false });
          return;
        }
        setState({ suggestions: result.value, loading: false });
      });
    }, DEBOUNCE_MS);

    return () => {
      globalThis.clearTimeout(timer);
      abort.abort();
    };
  }, [trimmed, scope, shouldSearch]);

  if (!shouldSearch) {
    return { suggestions: [], loading: false };
  }
  return state;
}

/**
 * Resolve a picked suggestion's id to full lat/lon via the matching
 * provider. Returns null on error (already logged) or abort.
 */
export async function lookupPlace(
  id: string,
  scope: MapScope,
  signal: AbortSignal,
): Promise<PlaceResult | null> {
  const result =
    scope === "nl"
      ? await pdok.lookup(id, signal)
      : await nominatim.lookup(id, signal);
  if (signal.aborted) {
    return null;
  }
  if (result.isErr()) {
    if (result.error.kind !== "aborted") {
      emitLog({
        level: "warn",
        message: `Address lookup failed: ${result.error.kind}`,
      });
    }
    return null;
  }
  return result.value;
}
