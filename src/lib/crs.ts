import proj4 from "proj4";
import {
  ResultAsync,
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
} from "neverthrow";
import { z } from "zod";
import { emitLog } from "./log";
import type { XYZ } from "./helmert";

export type CrsError =
  | { kind: "fetch-failed"; code: number; cause: unknown }
  | { kind: "manifest-invalid"; cause: unknown }
  | { kind: "not-found"; code: number }
  | { kind: "invalid-definition"; code: number };

export interface TransformError {
  kind: "transform-failed";
  cause: unknown;
}

/**
 * proj4js wrapper. All projected/compound CRS definitions come from
 * `/crs-index.json`, a build-time manifest of EPSG ProjectedCRS +
 * CompoundCRS entries generated from epsg-index (see
 * scripts/build-crs-manifest.mjs). The manifest is fetched once per
 * session (≈500 KB gzipped) — either eagerly via `prefetchCrsManifest`
 * at app mount, or lazily on the first `lookupCrs` miss.
 *
 * proj4js accepts ProjectedCRS and CompoundCRS definitions; the manifest
 * is pre-filtered to those kinds at build time.
 */

/**
 * WGS84 bounding box in the `[north, west, south, east]` order used by
 * epsg.io / epsg-index (and our generated manifest). The odd axis order is
 * kept as the storage format; consumers that need `[w,s,e,n]` (MapLibre) do
 * the swap at use.
 */
export type CrsBbox = [number, number, number, number];

export interface CrsDef {
  code: number;
  proj4: string;
  name: string;
  /** Geographic area the CRS is valid for, e.g. "Netherlands - onshore". */
  areaOfUse: string | null;
  /**
   * WGS84 bbox of the area of use, `[n, w, s, e]`. Used to auto-zoom the map
   * when a file has a CRS hint but no georeferencing yet.
   */
  bbox: CrsBbox | null;
  /**
   * Size of one CRS map unit in metres. 1 for metric CRS, 0.3048 for
   * international-foot, 1200/3937 for US survey foot, etc. Parsed from the
   * proj4 definition's `+to_meter=` or `+units=` at registration.
   *
   * Per IFC spec, IfcMapConversion.Scale is the ratio of the IFC project's
   * length unit to the ProjectedCRS map unit — *not* to metres. A metric
   * IFC against a US-foot CRS needs Scale ≈ 3.2808. Without this field the
   * solver seed collapsed the two distinct unit systems into one.
   */
  metresPerUnit: number;
}

/**
 * Read the metres-per-map-unit factor off a proj4 registration. proj4.js
 * already parses `+units=` through its built-in table (lib/constants/units.js
 * covers ft, us-ft, us-ch, ind-ft, …) and honours `+to_meter=` as an
 * override, populating `to_meter` on the ProjectionDefinition. A projected
 * CRS with neither defaults to metres in proj, so we fall through to 1.
 *
 * Must be called AFTER `proj4.defs(name, def)` has registered the CRS.
 */
function readMetresPerUnit(epsgKey: string): number {
  const def = proj4.defs(epsgKey) as { to_meter?: number } | undefined;
  const toMeter = def?.to_meter;
  if (typeof toMeter === "number" && Number.isFinite(toMeter) && toMeter > 0) {
    return toMeter;
  }
  return 1;
}

// epsg-index carries some ProjectedCRS entries without a proj4 string
// (kind=CRS-PROJCRS but `proj4: null`). They're unusable for projection, so
// accept null here and drop them when building the map.
const ManifestEntrySchema = z.object({
  name: z.string(),
  proj4: z.string().nullable(),
  area: z.string().nullable(),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .nullable(),
});

const ManifestSchema = z.record(z.string(), ManifestEntrySchema);

interface ManifestEntry {
  name: string;
  proj4: string;
  area: string | null;
  bbox: CrsBbox | null;
}

const cache = new Map<number, CrsDef>();

/**
 * Resolved manifest map, kept in a module-level slot so that
 * `getCrsOptions` can read it synchronously once the fetch has settled.
 * Null until the manifest has loaded successfully.
 */
let manifestMap: Map<number, ManifestEntry> | null = null;

let manifestPromise: Promise<
  Result<Map<number, ManifestEntry>, CrsError>
> | null = null;

async function fetchManifest() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}crs-index.json`);

    if (!response.ok) {
      return err<Map<number, ManifestEntry>, CrsError>({
        kind: "fetch-failed",
        code: 0,
        cause: new Error(`HTTP ${response.status}`),
      });
    }

    const rawJson: unknown = await response.json();
    const parsed = ManifestSchema.safeParse(rawJson);
    if (!parsed.success) {
      return err<Map<number, ManifestEntry>, CrsError>({
        kind: "manifest-invalid",
        cause: parsed.error,
      });
    }

    const map = new Map<number, ManifestEntry>();
    for (const [key, entry] of Object.entries(parsed.data)) {
      const code = Number(key);
      if (!Number.isFinite(code) || entry.proj4 === null) {
        continue;
      }
      const trimmedArea = entry.area?.trim();
      map.set(code, {
        name: entry.name,
        proj4: entry.proj4,
        area: trimmedArea && trimmedArea.length > 0 ? trimmedArea : null,
        bbox: entry.bbox,
      });
    }
    manifestMap = map;
    emitLog({ message: `Loaded CRS index (${map.size} entries)` });
    
    return ok<Map<number, ManifestEntry>, CrsError>(map);
  } catch (error) {
    return err<Map<number, ManifestEntry>, CrsError>({
      kind: "fetch-failed",
      code: 0,
      cause: error,
    });
  }
}

function loadManifest(): Promise<Result<Map<number, ManifestEntry>, CrsError>> {
  if (manifestPromise) {
    return manifestPromise;
  }

  manifestPromise = fetchManifest();

  return manifestPromise;
}

/**
 * Kick off the manifest fetch. Safe to call multiple times — the underlying
 * promise is memoised. Intended for app mount, where it races the WASM
 * load + IFC parse so the first real `lookupCrs` call is already hot.
 */
export async function prefetchCrsManifest(): Promise<void> {
  await loadManifest();
}

// In-flight de-dup: concurrent lookupCrs(code) calls share the same
// ResultAsync so registerAndCache runs at most once per code. Without this,
// the first caller races with any follow-up callers before `cache` is
// populated — e.g. the Workspace effect, the sidebar's Suspense read, and
// StrictMode's double-invocation each call lookupCrs(2272) in parallel and
// all three independently register + log.
const inflight = new Map<number, ResultAsync<CrsDef, CrsError>>();

export function lookupCrs(code: number): ResultAsync<CrsDef, CrsError> {
  const cached = cache.get(code);
  if (cached) {
    return okAsync(cached);
  }

  const pending = inflight.get(code);
  if (pending) {
    return pending;
  }

  const promise: ResultAsync<CrsDef, CrsError> = ResultAsync.fromSafePromise(
    loadManifest(),
  ).andThen((result) => {
    if (result.isErr()) {
      return errAsync<CrsDef, CrsError>(result.error);
    }
    const entry = result.value.get(code);
    if (!entry) {
      return errAsync<CrsDef, CrsError>({ kind: "not-found", code });
    }
    return registerAndCache(
      code,
      entry.proj4,
      entry.name,
      entry.area,
      entry.bbox,
    );
  });

  inflight.set(code, promise);
  return promise;
}

function registerAndCache(
  code: number,
  proj4Def: string,
  name: string,
  areaOfUse: string | null,
  bbox: CrsBbox | null,
): ResultAsync<CrsDef, CrsError> {
  const trimmed = proj4Def.trim();

  if (trimmed.length === 0) {
    return errAsync<CrsDef, CrsError>({ kind: "not-found", code });
  }

  try {
    proj4.defs(`EPSG:${code}`, trimmed);
  } catch {
    return errAsync<CrsDef, CrsError>({ kind: "invalid-definition", code });
  }

  const def: CrsDef = {
    code,
    proj4: trimmed,
    name,
    areaOfUse,
    bbox,
    metresPerUnit: readMetresPerUnit(`EPSG:${code}`),
  };
  cache.set(code, def);
  emitLog({ message: `Resolved CRS EPSG:${code} (${name})` });
  return okAsync(def);
}

export interface CrsOption {
  code: number;
  name: string;
  areaOfUse: string | null;
}

/**
 * Render-side view of a CRS lookup. Workspace derives this from the raw
 * EPSG input + the last settled lookup and threads it through Sidebar into
 * TargetCrsCard, so the card can show name/area directly from `def` without
 * doing its own lookup. `kind: "invalid-code"` covers non-numeric user
 * input; `"error"` covers successful fetches that returned not-found or
 * an unparseable definition.
 */
export type CrsLookupState =
  | { kind: "resolving"; code: number }
  | { kind: "invalid-code" }
  | { kind: "ready"; def: CrsDef }
  | { kind: "error"; code: number; errorKind: CrsError["kind"] };

/**
 * All projected/compound CRS entries from the manifest, exposed to UI
 * (currently the target-CRS combobox). Returns `[]` until the manifest
 * has finished loading — callers should re-read after
 * `prefetchCrsManifest()` resolves.
 */
export function getCrsOptions(): Array<CrsOption> {
  if (!manifestMap) {
    return [];
  }
  const options: Array<CrsOption> = [];
  for (const [code, entry] of manifestMap) {
    options.push({ code, name: entry.name, areaOfUse: entry.area });
  }
  options.sort((a, b) => a.code - b.code);
  return options;
}

interface TransformWgs84ToProjected {
  code: number;
  longitude: number;
  latitude: number;
  elevation: number;
}

export function transformWgs84ToProjected({
  code,
  longitude,
  latitude,
  elevation,
}: TransformWgs84ToProjected): Result<XYZ, TransformError> {
  try {
    const [x, y] = proj4("EPSG:4326", `EPSG:${code}`, [longitude, latitude]);
    return ok({ x, y, z: elevation });
  } catch (error) {
    return err({ kind: "transform-failed", cause: error });
  }
}

/**
 * Reverse: projected CRS -> WGS84 lat/lon. The CRS must have been registered
 * first via lookupCrs (this is enforced by threading a CrsDef through the UI
 * rather than a raw code string).
 */
export function transformProjectedToWgs84(
  code: number,
  x: number,
  y: number,
): Result<{ longitude: number; latitude: number }, TransformError> {
  try {
    const [longitude, latitude] = proj4(`EPSG:${code}`, "EPSG:4326", [x, y]);
    return ok({ longitude, latitude });
  } catch (error) {
    return err({ kind: "transform-failed", cause: error });
  }
}

/**
 * A best-guess place to aim the map camera for a CRS when the file has no
 * georeferencing yet. `bounds` is the CRS's area-of-use rectangle (fit the
 * camera to it); `center` is the projection's natural origin, used only when
 * a bbox isn't available.
 */
export type CrsViewTarget =
  | { kind: "bounds"; west: number; south: number; east: number; north: number }
  | { kind: "center"; longitude: number; latitude: number };

/**
 * Pick a WGS84 target to centre the map on for this CRS. Prefers the bbox
 * (covers the whole area of use), falls back to the projection's natural
 * origin `+lat_0`/`+lon_0` pulled off proj4's parsed definition (stored in
 * radians, hence the conversion). Returns null for degenerate origins like
 * Pseudo-Mercator's (0, 0) where auto-zooming would send the camera to the
 * Gulf of Guinea.
 */
export function deriveCrsViewTarget(def: CrsDef): CrsViewTarget | null {
  if (def.bbox) {
    const [north, west, south, east] = def.bbox;
    return { kind: "bounds", west, south, east, north };
  }
  const parsed = proj4.defs(`EPSG:${def.code}`) as
    | { lat0?: number; long0?: number }
    | undefined;
  const lat0 = parsed?.lat0;
  const long0 = parsed?.long0;
  if (typeof lat0 !== "number" || typeof long0 !== "number") {
    return null;
  }
  if (lat0 === 0 && long0 === 0) {
    return null;
  }
  const toDeg = 180 / Math.PI;
  return { kind: "center", longitude: long0 * toDeg, latitude: lat0 * toDeg };
}

/**
 * Combobox filter: empty input → `featured` shortlist, all-digit input →
 * prefix-match on code, anything else → case-insensitive substring match
 * on name.
 */
export function filterCrsOptions(
  input: string,
  all: ReadonlyArray<CrsOption>,
  featured: ReadonlyArray<CrsOption>,
): Array<CrsOption> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return [...featured];
  }
  if (/^\d+$/.test(trimmed)) {
    return all.filter((option) => String(option.code).startsWith(trimmed));
  }
  const lower = trimmed.toLowerCase();
  return all.filter((option) => option.name.toLowerCase().includes(lower));
}

/**
 * Pulls the numeric EPSG code out of strings like "EPSG:28992", "epsg:4326",
 * or just "28992". Returns null if no integer is found.
 */
export function parseEpsgCode(name: string | null | undefined): number | null {
  if (!name) {
    return null;
  }
  const captured = /(\d+)/.exec(name)?.[1];
  if (captured === undefined) {
    return null;
  }
  const n = Number.parseInt(captured, 10);
  return Number.isFinite(n) ? n : null;
}
