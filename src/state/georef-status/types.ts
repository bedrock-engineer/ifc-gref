import type { LngLat } from "#modules/crs";
import type { OverrideError } from "#modules/crs/types";
import type { HelmertParams, XYZ } from "#modules/helmert/solve";
import type { Provenance } from "#state/workspace";

export interface MapReferences {
  /** WGS84 image of local (0,0,0) under the current Helmert. */
  mapConversion: LngLat | null;
  /** IfcSite RefLat/RefLon, when present and within the active CRS bbox. */
  siteReference: LngLat | null;
  /** True when IfcSite ref exists, an active CRS exists, and the value
   * falls outside the CRS area of use. */
  siteOutsideBbox: boolean;
}

/**
 * Everything the 2D map overlays + camera framing care about, in WGS84.
 * Derived in Workspace and threaded through MapView as a single prop so
 * the framing imperative API can take a snapshot synchronously when an
 * event handler computes "the next" signals from new params.
 */
export interface MapOverlaySignals {
  /** Footprint convex hull as a closed ring of WGS84 lng/lat. */
  footprint: Array<[number, number]> | null;
  /** Live IfcMapConversion-derived anchor — moves with edited Helmert params. */
  mapConversion: LngLat | null;
  /** IfcSite RefLat/RefLon (already filtered for outside-bbox cases). */
  siteReference: LngLat | null;
}

/**
 * One thing the tool noticed about the current (file × CRS × anchor)
 * state.
 *
 * Findings split by *cause*:
 *   - File-scoped (`unknown-length-unit`, `baked-projected-origin`) are
 *     pure file-load consequences. They never re-fire and are emitted at
 *     the file-load boundary (`worker/metadata.ts` for unit;
 *     `app.tsx::handleFile` for baked-origin), not from a render-time
 *     effect.
 *   - CRS-scoped (`site-outside-crs`, `helmert-outside-crs`,
 *     `grid-degraded`) can transition when the user picks a different
 *     CRS. They flow through `GeorefView.findings` and are deduplicated
 *     by `${kind}:${crsCode}` so the log doesn't repeat per slider edit
 *     or CRS round-trip.
 */
export type Finding =
  | { kind: "unknown-length-unit"; unit: string }
  | { kind: "baked-projected-origin"; origin: XYZ }
  | {
      kind: "site-outside-crs";
      site: LngLat;
      crsCode: number;
      areaOfUse: string | null;
      /** When false, the IfcSite seed was the only fallback the app could
       * try — message guidance shifts toward "pick a different CRS / use
       * survey points" rather than just "not shown on map". */
      hasExistingGeoref: boolean;
    }
  | {
      kind: "helmert-outside-crs";
      source: "existing-georef" | "anchor-params";
      crsCode: number;
      areaOfUse: string | null;
    }
  | { kind: "grid-degraded"; crsCode: number; reason: OverrideError };

/**
 * Stable identifier for a finding, used to dedupe log emissions.
 * File-scoped kinds use `kind` alone (they can't repeat). CRS-scoped
 * kinds include `crsCode` so picking a *different* failing CRS re-emits,
 * but toggling away and back doesn't.
 */
export function findingKey(finding: Finding): string {
  switch (finding.kind) {
    case "unknown-length-unit":
    case "baked-projected-origin": {
      return finding.kind;
    }
    case "site-outside-crs":
    case "helmert-outside-crs":
    case "grid-degraded": {
      return `${finding.kind}:${finding.crsCode}`;
    }
  }
}

/**
 * The wide view of "what's the world right now": effective Helmert,
 * provenance for the badge, WGS84 anchors for the map, the baked-origin
 * value (used for both pickBlockedReason and to suppress
 * helmert-outside-crs), and the list of currently-true CRS-scoped
 * findings. Pure derivation — wrap in `useMemo` at the call site.
 */
export interface GeorefView {
  effectiveParameters: HelmertParams | null;
  provenance: Provenance;
  references: MapReferences;
  bakedProjectedOrigin: XYZ | null;
  findings: ReadonlyArray<Finding>;
}
