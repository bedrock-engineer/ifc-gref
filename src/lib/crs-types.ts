/**
 * Shared types for the CRS modules. The runtime entry points live in
 * `crs-manifest.ts` (fetch + lookup), `crs-options.ts` (combobox helpers),
 * `crs-transform.ts` (proj4 wrappers), and `crs-view-target.ts`.
 */

export type CrsError =
  | { kind: "fetch-failed"; code: number; cause: unknown }
  | { kind: "manifest-invalid"; cause: unknown }
  | { kind: "not-found"; code: number }
  | { kind: "invalid-definition"; code: number }
  | { kind: "geographic-not-supported"; code: number };

/**
 * Why a per-CRS override (grid load) failed. Per docs/crs-datum-grids.md,
 * not every kind is worth retrying — `not-found` and `parse-failed`
 * indicate permanent problems we can't recover from at runtime.
 */
export type OverrideError =
  | { kind: "grid-fetch-network"; cause: unknown }
  | { kind: "grid-fetch-not-found"; status: number }
  | { kind: "grid-import-failed"; cause: unknown }
  | { kind: "grid-parse-failed"; cause: unknown };

export function isRetryableOverrideError(error: OverrideError): boolean {
  return (
    error.kind === "grid-fetch-network" || error.kind === "grid-import-failed"
  );
}

/**
 * Per-CRS accuracy status carried on the resolved CrsDef.
 *
 * `trusted-default` — no override needed (UTM, ETRS89-based, Web Mercator).
 *   proj4js's stock proj4 string is exact for these.
 * `trusted-override` — manifest's override applied successfully.
 *   Either `via: "grid"` (binary loaded via proj4.nadgrid) or
 *   `via: "towgs84"` (corrected parameters substituted at build time).
 * `degraded-override-failed` — manifest declared an override, but the
 *   grid load failed. Display continues with reduced accuracy; save is
 *   blocked at the IfcFacade boundary; the CRS card shows a Retry button
 *   if the underlying error is retryable.
 */
export type AccuracyStatus =
  | { kind: "trusted-default" }
  | { kind: "trusted-override"; note: string; via: "grid" | "towgs84" }
  | { kind: "degraded-override-failed"; note: string; reason: OverrideError };

/**
 * Manifest-side description of a binary grid file the runtime needs to
 * load before `proj4.defs(...)` is called for the corresponding CRS. The
 * `key` matches `+nadgrids=<key>` in the (already-baked-correct) proj4
 * string the manifest carries.
 */
export interface GridSpec {
  key: string;
  filename: string;
  format: "geotiff";
}

/**
 * WGS84 bounding box in the `[north, west, south, east]` order used by
 * epsg.io / epsg-index (and our generated manifest). The odd axis order is
 * kept as the storage format; consumers that need `[w,s,e,n]` (MapLibre) do
 * the swap at use.
 */
export type CrsBbox = [number, number, number, number];

export type CrsKind = "projected" | "compound";

export interface CrsDef {
  code: number;
  kind: CrsKind;
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
  /**
   * Per-CRS accuracy classification. See AccuracyStatus and the
   * `crs-datum-grids.md` plan for details. The save flow gates on this:
   * `kind === "degraded-override-failed"` blocks IfcMapConversion writes.
   */
  accuracy: AccuracyStatus;
}

/**
 * Render-side view of a CRS lookup. Workspace derives this from the raw
 * EPSG input + the last settled lookup and threads it through Sidebar into
 * TargetCrsCard, so the card can show name/area directly from `def` without
 * doing its own lookup. `kind: "invalid-code"` covers non-numeric user
 * input; `"error"` covers successful fetches that returned not-found or
 * an unparseable definition.
 *
 * `resolving.phase` separates the cheap path ("lookup" — manifest hit,
 * proj4.defs registration) from the slow path ("grid" — fetching a
 * datum-shift GeoTIFF off cdn.proj.org, can be MBs). The card surfaces
 * the grid phase explicitly so the user knows why save is gated and why
 * the map can't accurately place the model yet.
 */
export type CrsLookupState =
  | { kind: "resolving"; code: number; phase: "lookup" | "grid" }
  | { kind: "invalid-code" }
  | { kind: "ready"; def: CrsDef }
  | { kind: "error"; code: number; errorKind: CrsError["kind"] };

/**
 * UI-shaped view of a manifest entry — what the combobox needs to render
 * a row. No proj4 string (that lives in the registered CrsDef once a code
 * is committed); no bbox (the auto-zoom path uses CrsDef instead).
 */
export interface CrsOption {
  code: number;
  kind: CrsKind;
  name: string;
  areaOfUse: string | null;
}

/**
 * UI-shaped view of a vertical CRS entry. Vertical CRSs are referenced
 * by the IfcProjectedCRS.VerticalDatum field (a free-form IfcIdentifier
 * label) and don't have a proj4 string — proj4js can't transform between
 * vertical datums anyway. The picker is essentially a typeahead over EPSG
 * vertical-CRS names.
 */
export interface VerticalDatumOption {
  code: number;
  name: string;
  areaOfUse: string | null;
}
