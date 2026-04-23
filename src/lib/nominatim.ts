import { z } from "zod";
import { ResultAsync, errAsync, okAsync } from "neverthrow";

/**
 * Nominatim — OpenStreetMap's global geocoder. Free, public, CORS-friendly.
 * Docs: https://nominatim.org/release-docs/develop/api/Search/
 *
 * /search returns coordinates inline, so lookup() resolves from an
 * in-memory cache populated by suggest(). That keeps the call shape
 * compatible with pdok.ts so the search control can dispatch uniformly.
 */

const SEARCH_URL = "https://nominatim.openstreetmap.org/search";

export type NominatimError =
  | { kind: "fetch-failed"; cause: unknown }
  | { kind: "parse-failed"; cause: unknown }
  | { kind: "aborted" }
  | { kind: "no-results" };

const SearchItemSchema = z.object({
  place_id: z.number(),
  display_name: z.string(),
  lat: z.string(),
  lon: z.string(),
});

const SearchResponseSchema = z.array(SearchItemSchema);

export interface NominatimSuggestion {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
}

export interface NominatimPlace {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
}

const resultCache = new Map<string, NominatimSuggestion>();

export function suggest(
  query: string,
  signal?: AbortSignal,
): ResultAsync<Array<NominatimSuggestion>, NominatimError> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "8");
  url.searchParams.set("addressdetails", "0");

  return fetchJson(url, signal).andThen((raw) => {
    const parsed = SearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return errAsync<Array<NominatimSuggestion>, NominatimError>({
        kind: "parse-failed",
        cause: parsed.error,
      });
    }
    const suggestions: Array<NominatimSuggestion> = [];
    for (const item of parsed.data) {
      const longitude = Number.parseFloat(item.lon);
      const latitude = Number.parseFloat(item.lat);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        continue;
      }
      const suggestion: NominatimSuggestion = {
        id: String(item.place_id),
        label: item.display_name,
        longitude,
        latitude,
      };
      resultCache.set(suggestion.id, suggestion);
      suggestions.push(suggestion);
    }
    return okAsync<Array<NominatimSuggestion>, NominatimError>(suggestions);
  });
}

export function lookup(
  id: string,
  _signal?: AbortSignal,
): ResultAsync<NominatimPlace, NominatimError> {
  const cached = resultCache.get(id);
  if (!cached) {
    return errAsync<NominatimPlace, NominatimError>({ kind: "no-results" });
  }
  return okAsync<NominatimPlace, NominatimError>({
    id: cached.id,
    name: cached.label,
    longitude: cached.longitude,
    latitude: cached.latitude,
  });
}

function fetchJson(
  url: URL,
  signal?: AbortSignal,
): ResultAsync<unknown, NominatimError> {
  return ResultAsync.fromPromise(
    fetch(url, { signal, headers: { Accept: "application/json" } }).then(
      (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<unknown>;
      },
    ),
    (cause): NominatimError => {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        return { kind: "aborted" };
      }
      return { kind: "fetch-failed", cause };
    },
  );
}
