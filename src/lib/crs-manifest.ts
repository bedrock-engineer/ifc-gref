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
import type {
  AccuracyStatus,
  CrsBbox,
  CrsDef,
  CrsError,
  CrsKind,
  CrsLookupState,
  CrsOption,
  GridSpec,
  OverrideError,
  VerticalDatumOption,
} from "./crs-types";
import { isRetryableOverrideError } from "./crs-types";

// Type-only import: erased at compile time, so geotiff.js stays out of
// the main bundle. The runtime `import("geotiff")` below is what actually
// pulls in the chunk.
import type { fromArrayBuffer as GeoTIFFFromArrayBuffer } from "geotiff";
type GeoTIFFInstance = Awaited<ReturnType<typeof GeoTIFFFromArrayBuffer>>;

/**
 * App-level CRS store. The build script (scripts/build-crs-manifest.mjs)
 * emits a partitioned, sorted artifact — `public/crs-index.json` — with
 * three top-level arrays: `compound`, `projected`, `vertical`. Everything
 * filtered, sorted, area-trimmed, code-coerced offline. This module fetches
 * once, validates with Zod, and exposes:
 *
 *   - `subscribeManifest` / `getManifestSnapshot` — UI-shaped view, plugged
 *     into React via `useSyncExternalStore`.
 *   - `lookupCrs(code)` — registers the proj4 def with proj4js and caches
 *     the resolved `CrsDef`.
 *
 * Per the IFC 4.3 spec, a 3D georeferenced model "shall be a compound
 * coordinate reference system" — i.e., IfcProjectedCRS.Name should be a
 * compound EPSG code. proj4js only uses the horizontal component of a
 * compound; the vertical part round-trips through the IFC file as part
 * of the EPSG code.
 */

const GridSpecSchema = z.object({
  key: z.string(),
  filename: z.string(),
  format: z.literal("geotiff"),
});

const HorizontalEntrySchema = z.object({
  code: z.number(),
  name: z.string(),
  proj4: z.string(),
  area: z.string().nullable(),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .nullable(),
  // Override metadata baked in at build time. See
  // docs/crs-datum-grids.md and scripts/build-crs-manifest.mjs.
  accuracyNote: z.string().nullable().optional(),
  grid: GridSpecSchema.nullable().optional(),
});

const VerticalEntrySchema = z.object({
  code: z.number(),
  name: z.string(),
  area: z.string().nullable(),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .nullable(),
});

const IndexFileSchema = z.object({
  compound: z.array(HorizontalEntrySchema),
  projected: z.array(HorizontalEntrySchema),
  vertical: z.array(VerticalEntrySchema),
});

interface RegisteredEntry {
  kind: CrsKind;
  name: string;
  proj4: string;
  area: string | null;
  bbox: CrsBbox | null;
  /** User-facing badge from CRS_OVERRIDES. null if no override applies. */
  accuracyNote: string | null;
  /** Binary grid the runtime must load before proj4.defs(). null if no grid. */
  grid: GridSpec | null;
}

const cache = new Map<number, CrsDef>();

/**
 * Subscribable snapshot. Replaced atomically when the fetch settles.
 * The reference is stable until then, so `useSyncExternalStore` works.
 *
 * `compound`/`projected`/`vertical` are pre-sorted in the build artifact;
 * `byCode` indexes both compound and projected for O(1) lookups (featured
 * shortlist, manual code resolution by UI helpers).
 */
export interface ManifestSnapshot {
  compound: ReadonlyArray<CrsOption>;
  projected: ReadonlyArray<CrsOption>;
  vertical: ReadonlyArray<VerticalDatumOption>;
  byCode: ReadonlyMap<number, CrsOption>;
}

const EMPTY_BY_CODE: ReadonlyMap<number, CrsOption> = new Map();
const EMPTY_SNAPSHOT: ManifestSnapshot = Object.freeze({
  compound: [],
  projected: [],
  vertical: [],
  byCode: EMPTY_BY_CODE,
});

let snapshot: ManifestSnapshot = EMPTY_SNAPSHOT;
const subscribers = new Set<() => void>();

/**
 * Internal index of horizontal entries (compound + projected) keyed by
 * code, including the proj4 string. Used by `lookupCrs`. The UI snapshot
 * doesn't carry proj4 strings — they live here until a code is registered
 * with proj4js, then the resolved `CrsDef` is cached.
 */
let registeredEntries = new Map<number, RegisteredEntry>();

function publishSnapshot(next: ManifestSnapshot): void {
  snapshot = next;
  for (const subscriber of subscribers) {
    subscriber();
  }
}

export function subscribeManifest(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function getManifestSnapshot(): ManifestSnapshot {
  return snapshot;
}

let manifestPromise: Promise<Result<void, CrsError>> | null = null;

async function fetchManifest(): Promise<Result<void, CrsError>> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}crs-index.json`);
    if (!response.ok) {
      return err({
        kind: "fetch-failed",
        code: 0,
        cause: new Error(`HTTP ${response.status}`),
      });
    }
    const rawJson: unknown = await response.json();
    const parsed = IndexFileSchema.safeParse(rawJson);
    if (!parsed.success) {
      return err({ kind: "manifest-invalid", cause: parsed.error });
    }
    buildSnapshot(parsed.data);
    emitLog({
      message: `Loaded CRS index (${parsed.data.compound.length} compound + ${parsed.data.projected.length} projected + ${parsed.data.vertical.length} vertical)`,
    });
    return ok();
  } catch (error) {
    return err({ kind: "fetch-failed", code: 0, cause: error });
  }
}

function buildSnapshot(data: z.infer<typeof IndexFileSchema>): void {
  const compoundOptions: Array<CrsOption> = [];
  const projectedOptions: Array<CrsOption> = [];
  const byCode = new Map<number, CrsOption>();
  const entries = new Map<number, RegisteredEntry>();

  for (const entry of data.compound) {
    const option: CrsOption = {
      code: entry.code,
      kind: "compound",
      name: entry.name,
      areaOfUse: entry.area,
    };
    compoundOptions.push(option);
    byCode.set(entry.code, option);
    entries.set(entry.code, {
      kind: "compound",
      name: entry.name,
      proj4: entry.proj4,
      area: entry.area,
      bbox: entry.bbox,
      accuracyNote: entry.accuracyNote ?? null,
      grid: entry.grid ?? null,
    });
  }
  for (const entry of data.projected) {
    const option: CrsOption = {
      code: entry.code,
      kind: "projected",
      name: entry.name,
      areaOfUse: entry.area,
    };
    projectedOptions.push(option);
    byCode.set(entry.code, option);
    entries.set(entry.code, {
      kind: "projected",
      name: entry.name,
      proj4: entry.proj4,
      area: entry.area,
      bbox: entry.bbox,
      accuracyNote: entry.accuracyNote ?? null,
      grid: entry.grid ?? null,
    });
  }

  const verticalOptions: Array<VerticalDatumOption> = data.vertical.map(
    (entry) => ({
      code: entry.code,
      name: entry.name,
      areaOfUse: entry.area,
    }),
  );

  registeredEntries = entries;
  publishSnapshot({
    compound: compoundOptions,
    projected: projectedOptions,
    vertical: verticalOptions,
    byCode,
  });
}

function loadManifest(): Promise<Result<void, CrsError>> {
  if (manifestPromise) {
    return manifestPromise;
  }
  manifestPromise = fetchManifest();
  return manifestPromise;
}

/**
 * Kick off the manifest fetch. Safe to call multiple times — the promise
 * is memoised. Intended for app mount.
 */
export async function prefetchCrsManifest(): Promise<void> {
  await loadManifest();
}

// In-flight de-dup: concurrent lookupCrs(code) calls share the same
// ResultAsync so registerAndCache runs at most once per code.
const inflight = new Map<number, ResultAsync<CrsDef, CrsError>>();

/**
 * Per-code resolution state. Populated synchronously by `lookupCrs`
 * (resolving on entry, ready/error after the async chain settles) and
 * exposed via `subscribeResolution` / `getResolutionState` so the React
 * layer can plug in via `useSyncExternalStore`. References are stable
 * within a single status — once a code is "ready", repeated reads return
 * the same `CrsLookupState` object. Transitions are
 * resolving(lookup) → resolving(grid) (only when the entry has a grid)
 * → ready/error.
 */
const resolutionStates = new Map<number, CrsLookupState>();
const resolutionSubscribers = new Map<number, Set<() => void>>();

function setResolutionState(code: number, state: CrsLookupState): void {
  resolutionStates.set(code, state);
  const subs = resolutionSubscribers.get(code);
  if (!subs) {return;}
  for (const subscriber of subs) {
    subscriber();
  }
}

export function getResolutionState(code: number): CrsLookupState | null {
  return resolutionStates.get(code) ?? null;
}

export function subscribeResolution(
  code: number,
  listener: () => void,
): () => void {
  let subs = resolutionSubscribers.get(code);
  if (!subs) {
    subs = new Set();
    resolutionSubscribers.set(code, subs);
  }
  subs.add(listener);
  return () => {
    const set = resolutionSubscribers.get(code);
    if (!set) {return;}
    set.delete(listener);
    if (set.size === 0) {
      resolutionSubscribers.delete(code);
    }
  };
}

export function lookupCrs(code: number): ResultAsync<CrsDef, CrsError> {
  const cached = cache.get(code);
  if (cached) {
    return okAsync(cached);
  }
  const pending = inflight.get(code);
  if (pending) {
    return pending;
  }
  // Populate the resolution-state map synchronously so subscribers see
  // "resolving" before the first await; otherwise getResolutionState
  // would return null for the brief window between this call and the
  // first .then() firing. registerAndCache transitions to phase "grid"
  // before kicking off the (potentially slow) GeoTIFF download.
  setResolutionState(code, { kind: "resolving", code, phase: "lookup" });
  const promise: ResultAsync<CrsDef, CrsError> = ResultAsync.fromSafePromise(
    loadManifest(),
  ).andThen((result) => {
    if (result.isErr()) {
      return errAsync<CrsDef, CrsError>(result.error);
    }
    const entry = registeredEntries.get(code);
    if (!entry) {
      return errAsync<CrsDef, CrsError>({ kind: "not-found", code });
    }
    return registerAndCache(code, entry);
  });
  // Mirror the chain's outcome into the resolution-state map. .match
  // returns a fresh Promise that observes the chain's settled value
  // without disturbing it, so the original `promise` we cache in
  // `inflight` is unaffected.
  void promise.match(
    (def) => {
      setResolutionState(code, { kind: "ready", def });
    },
    (error) => {
      emitLog({
        level: "error",
        message: `CRS lookup failed (EPSG:${code}): ${error.kind}`,
      });
      setResolutionState(code, {
        kind: "error",
        code,
        errorKind: error.kind,
      });
    },
  );
  inflight.set(code, promise);
  return promise;
}

function registerAndCache(
  code: number,
  entry: RegisteredEntry,
): ResultAsync<CrsDef, CrsError> {
  const trimmed = entry.proj4.trim();
  if (trimmed.length === 0) {
    return errAsync<CrsDef, CrsError>({ kind: "not-found", code });
  }
  // Reject geographic (lat/lon) CRSs — IfcMapConversion needs projected
  // coordinates in metric-like units. The build script already filters
  // geographic-horizontal compounds out, but a user can still type such
  // a code manually, or one can come from an older IFC file.
  if (/\+proj=longlat\b/.test(trimmed)) {
    return errAsync<CrsDef, CrsError>({
      kind: "geographic-not-supported",
      code,
    });
  }

  // If this entry needs a grid, load it before calling proj4.defs(...).
  // On failure we still register the def — proj4js falls back to whatever
  // it can do with the unloaded +nadgrids reference, transforms run with
  // reduced accuracy, display layer keeps working, save is gated. See
  // docs/crs-datum-grids.md for the full design.
  let gridResult: ResultAsync<Result<void, OverrideError>, never>;
  if (entry.grid) {
    // Surface the grid phase synchronously — already-loaded grids resolve
    // in the same microtask, so this transition is harmless when there's
    // nothing to wait for. Subscribers (TargetCrsCard) render
    // "Loading precision grid…" while the GeoTIFF is fetched + parsed.
    setResolutionState(code, { kind: "resolving", code, phase: "grid" });
    gridResult = ResultAsync.fromSafePromise(loadGrid(entry.grid));
  } else {
    gridResult = ResultAsync.fromSafePromise(Promise.resolve(ok()));
  }

  return gridResult.andThen((gridLoadResult) => {
    try {
      proj4.defs(`EPSG:${code}`, trimmed);
    } catch {
      return errAsync<CrsDef, CrsError>({ kind: "invalid-definition", code });
    }
    const accuracy = deriveAccuracy(entry, gridLoadResult);
    const def: CrsDef = {
      code,
      kind: entry.kind,
      proj4: trimmed,
      name: entry.name,
      areaOfUse: entry.area,
      bbox: entry.bbox,
      metresPerUnit: readMetresPerUnit(`EPSG:${code}`),
      accuracy,
    };
    cache.set(code, def);
    if (accuracy.kind === "degraded-override-failed") {
      emitLog({
        level: "warn",
        message: `Resolved CRS EPSG:${code} (${entry.name}) — degraded: ${accuracy.reason.kind}`,
      });
    } else {
      emitLog({ message: `Resolved CRS EPSG:${code} (${entry.name})` });
    }
    return okAsync(def);
  });
}

function deriveAccuracy(
  entry: RegisteredEntry,
  gridLoad: Result<void, OverrideError>,
): AccuracyStatus {
  if (entry.grid) {
    if (gridLoad.isErr()) {
      return {
        kind: "degraded-override-failed",
        note: entry.accuracyNote ?? "Grid not loaded",
        reason: gridLoad.error,
      };
    }
    return {
      kind: "trusted-override",
      note: entry.accuracyNote ?? "Grid loaded",
      via: "grid",
    };
  }
  if (entry.accuracyNote) {
    return {
      kind: "trusted-override",
      note: entry.accuracyNote,
      via: "towgs84",
    };
  }
  return { kind: "trusted-default" };
}

/**
 * Read the metres-per-map-unit factor off a proj4 registration. proj4.js
 * already parses `+units=` through its built-in table (ft, us-ft, …) and
 * honours `+to_meter=` as an override, populating `to_meter` on the
 * ProjectionDefinition. A projected CRS with neither defaults to metres,
 * so we fall through to 1.
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

/* ------------------------------------------------------------------------ */
/* Grid loading                                                             */
/* ------------------------------------------------------------------------ */
/* Plain CRSs need no setup beyond proj4.defs(...). Grid-distorted CRSs    */
/* (RD New, BD72, …) need their NTv2/GeoTIFF datum-shift grid registered    */
/* with proj4js BEFORE proj4.defs(...) is called, otherwise proj4js falls   */
/* back to whatever the +towgs84 (if any) provides — which is exactly the   */
/* ~170 m–wrong path this whole module exists to avoid. See                 */
/* docs/crs-datum-grids.md for the design.                                  */

const CDN_BASE = "https://cdn.proj.org";

const loadedGrids = new Set<string>();
const inflightGrids = new Map<
  string,
  Promise<Result<void, OverrideError>>
>();

/**
 * Load a binary datum-shift grid into proj4js by key. Idempotent: a second
 * call for an already-loaded key resolves Ok immediately. Concurrent calls
 * for the same key share the same in-flight Promise. Auto-retries once on
 * a retryable failure (network or chunk-import); permanent failures
 * (404, parse error) return immediately.
 */
async function loadGrid(spec: GridSpec): Promise<Result<void, OverrideError>> {
  if (loadedGrids.has(spec.key)) {return ok();}
  const inflight = inflightGrids.get(spec.key);
  if (inflight) {return inflight;}

  const promise = (async (): Promise<Result<void, OverrideError>> => {
    let result = await attemptLoadGrid(spec);
    if (result.isErr() && isRetryableOverrideError(result.error)) {
      result = await attemptLoadGrid(spec);
    }
    if (result.isOk()) {
      loadedGrids.add(spec.key);
      emitLog({
        message: `Loaded ${spec.filename} → +nadgrids=${spec.key}`,
      });
    }
    return result;
  })();

  inflightGrids.set(spec.key, promise);
  void promise.finally(() => {
    inflightGrids.delete(spec.key);
  });
  return promise;
}

async function attemptLoadGrid(
  spec: GridSpec,
): Promise<Result<void, OverrideError>> {
  const url = `${CDN_BASE}/${spec.filename}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    return err({ kind: "grid-fetch-network", cause: error });
  }
  if (response.status === 404) {
    return err({ kind: "grid-fetch-not-found", status: 404 });
  }
  if (!response.ok) {
    return err({
      kind: "grid-fetch-network",
      cause: new Error(`HTTP ${response.status}`),
    });
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    return err({ kind: "grid-fetch-network", cause: error });
  }

  // GeoTIFF path. The .gsb (NTv2) path would just call proj4.nadgrid(key,
  // arrayBuffer) directly — kept out of v1 since none of our overrides
  // need it. Discriminator is on spec.format if/when we add it.
  let fromArrayBuffer: typeof GeoTIFFFromArrayBuffer;
  try {
    ({ fromArrayBuffer } = await import("geotiff"));
  } catch (error) {
    return err({ kind: "grid-import-failed", cause: error });
  }

  let tiff: GeoTIFFInstance;
  try {
    tiff = await fromArrayBuffer(buffer);
  } catch (error) {
    return err({ kind: "grid-parse-failed", cause: error });
  }

  try {
    // proj4.nadgrid is typed for the C-PROJ-canonical GeoTIFF interface,
    // which is broader than what proj4js's reader actually consumes. The
    // adapter shape is structurally sufficient, so cast at the call site.
    // Verified empirically against pyproj for NL/BE — see verify:crs.
    const grid = proj4.nadgrid(
      spec.key,
      adaptForProj4(tiff) as unknown as Parameters<typeof proj4.nadgrid>[1],
    );
    // proj4js returns either a synchronous nadgrid (NTv2 path) or one
    // with a `ready` promise (GeoTIFF path). For TIFFs we always need to
    // await `ready`, but defensively check in case the API shifts.
    const maybeReady = (grid as { ready?: Promise<unknown> } | undefined)
      ?.ready;
    if (maybeReady && typeof maybeReady.then === "function") {
      await maybeReady;
    }
  } catch (error) {
    return err({ kind: "grid-parse-failed", cause: error });
  }

  return ok();
}

/**
 * Bridge geotiff.js v3's API to what proj4js's nadgrid GeoTIFF code path
 * expects. v3 stores TIFF tags by number in `actualizedFields`; proj4js
 * reads `image.fileDirectory.ModelPixelScale[0..1]`. Synthesise that one
 * field from `image.getResolution()`. Pre-bind methods so `this` survives
 * the Proxy. Verified to ~10 cm accuracy across NL/BE.
 */
interface GeoTIFFLike {
  getImageCount(): Promise<number> | number;
  getImage(index: number): Promise<unknown>;
}

function adaptForProj4(tiff: GeoTIFFInstance): GeoTIFFLike {
  return {
    getImageCount: () => tiff.getImageCount(),
    getImage: async (index: number) => {
      const img = await tiff.getImage(index);
      const [scaleX = 0, scaleY = 0] = img.getResolution();
      return new Proxy(img, {
        get(target, property) {
          if (property === "fileDirectory") {
            return {
              ModelPixelScale: [Math.abs(scaleX), Math.abs(scaleY), 0],
            };
          }
          const v = (target as unknown as Record<string | symbol, unknown>)[
            property as string
          ];
          return typeof v === "function"
            ? (v as (...arguments_: Array<unknown>) => unknown).bind(target)
            : v;
        },
      });
    },
  };
}

/**
 * Manual retry for the "Retry" button on the CRS card. Evicts the cache
 * and any stale inflight entry for this code, then re-runs lookupCrs. The
 * grid loader's per-key dedup handles concurrent retries cleanly. Caller
 * may ignore the returned ResultAsync — the resolution-state subscriber
 * already drives UI updates.
 */
export function retryCrsOverride(code: number): ResultAsync<CrsDef, CrsError> {
  cache.delete(code);
  inflight.delete(code);
  // Don't clear loadedGrids — if the previous attempt succeeded for the
  // grid but failed somewhere else, we want to keep using the loaded grid.
  // We DO clear inflightGrids if it has a leftover failed entry for the
  // grid we'd retry, in case the .finally cleanup hasn't fired yet.
  return lookupCrs(code);
}
