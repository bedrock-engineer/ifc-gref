import { z } from "zod";
import { ResultAsync, errAsync, okAsync } from "neverthrow";

/**
 * PDOK Locatieserver v3_1 — Dutch geocoding service (addresses, places,
 * postcodes, streets, municipalities). Free, public, CORS-friendly.
 * Docs: https://www.pdok.nl/introductie/-/article/pdok-locatieserver-1
 *
 * Two-step flow:
 *   suggest(q)   -> lightweight ranked matches (id + display name)
 *   lookup(id)   -> full record including centroide_ll (WKT POINT in WGS84)
 */

const SUGGEST_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest";
const LOOKUP_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup";

export type PdokError =
  | { kind: "fetch-failed"; cause: unknown }
  | { kind: "parse-failed"; cause: unknown }
  | { kind: "aborted" }
  | { kind: "no-results" };

const SuggestDocumentSchema = z.object({
  id: z.string(),
  weergavenaam: z.string(),
  type: z.string(),
});

const SuggestResponseSchema = z.object({
  response: z.object({
    docs: z.array(SuggestDocumentSchema),
  }),
});

export type SuggestDocument = z.infer<typeof SuggestDocumentSchema>;

const LookupDocumentSchema = z.object({
  id: z.string(),
  weergavenaam: z.string(),
  centroide_ll: z.string(),
});

const LookupResponseSchema = z.object({
  response: z.object({
    docs: z.array(LookupDocumentSchema),
  }),
});

export interface PdokPlace {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
}

export function suggest(
  query: string,
  signal?: AbortSignal,
): ResultAsync<Array<SuggestDocument>, PdokError> {
  const url = new URL(SUGGEST_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("rows", "8");
  
  return fetchJson(url, signal).andThen((raw) => {
    const parsed = SuggestResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return errAsync<Array<SuggestDocument>, PdokError>({
        kind: "parse-failed",
        cause: parsed.error,
      });
    }
    return okAsync<Array<SuggestDocument>, PdokError>(parsed.data.response.docs);
  });
}

export function lookup(
  id: string,
  signal?: AbortSignal,
): ResultAsync<PdokPlace, PdokError> {
  const url = new URL(LOOKUP_URL);
  url.searchParams.set("id", id);
  url.searchParams.set("fl", "id,weergavenaam,centroide_ll");

  return fetchJson(url, signal).andThen((raw) => {
    const parsed = LookupResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return errAsync<PdokPlace, PdokError>({
        kind: "parse-failed",
        cause: parsed.error,
      });
    }
    const [document_] = parsed.data.response.docs;
    if (!document_) {
      return errAsync<PdokPlace, PdokError>({ kind: "no-results" });
    }

    const point = parseWktPoint(document_.centroide_ll);
    if (!point) {
      return errAsync<PdokPlace, PdokError>({
        kind: "parse-failed",
        cause: `bad WKT: ${document_.centroide_ll}`,
      });
    }

    return okAsync<PdokPlace, PdokError>({
      id: document_.id,
      name: document_.weergavenaam,
      longitude: point.longitude,
      latitude: point.latitude,
    });
  });
}

function fetchJson(
  url: URL,
  signal?: AbortSignal,
): ResultAsync<unknown, PdokError> {
  return ResultAsync.fromPromise(
    fetch(url, { signal }).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json() as Promise<unknown>;
    }),
    (cause): PdokError => {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        return { kind: "aborted" };
      }
      return { kind: "fetch-failed", cause };
    },
  );
}

function parseWktPoint(
  wkt: string,
): { longitude: number; latitude: number } | null {
  const match = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/.exec(
    wkt,
  );
  if (!match) {
    return null;
  }
  const [, lonString, latString] = match;
  if (lonString === undefined || latString === undefined) {
    return null;
  }
  const longitude = Number.parseFloat(lonString);
  const latitude = Number.parseFloat(latString);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  return { longitude, latitude };
}
