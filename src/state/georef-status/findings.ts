import {
  type CrsDef,
  type LngLat,
  projectLocalToWgs84,
  transformWgs84ToProjected,
} from "#modules/crs";
import { type HelmertParams, type XYZ } from "#modules/helmert/solve";
import type { IfcMetadata } from "#modules/ifc/worker";
import { unitToMetres } from "#modules/units/convert";
import {
  anchorParams,
  anchorProvenance,
  trueNorthRotation,
  type Anchor,
} from "#state/workspace";
import type {
  Finding,
  GeorefView,
  MapOverlaySignals,
  MapReferences,
} from "./types";

/** ~10 km. Sites larger than this on a side are unusual; UTM/RD/state-plane
 *  coords are typically 100k–10M, so a "local origin" of that magnitude is
 *  almost certainly baked-in projected coordinates. */
const BAKED_PROJECTED_THRESHOLD_M = 10_000;

/** Per buildingSMART "User Guide for Geo-referencing in IFC" §3.3,
 *  Important Note 5 — projected coords don't belong in
 *  IfcSite.ObjectPlacement. We can't usefully georeference such files. */
function detectBakedProjectedOrigin(metadata: IfcMetadata): XYZ | null {
  if (metadata.existingGeoref) {
    return null;
  }
  const origin = metadata.localOrigin;
  if (!origin) {
    return null;
  }
  if (Math.hypot(origin.x, origin.y) < BAKED_PROJECTED_THRESHOLD_M) {
    return null;
  }
  return origin;
}

/**
 * Files with IfcSite RefLat/RefLon but no IfcMapConversion carry enough
 * info to place the model. Project lat/lon through the active CRS (scale
 * 1, rotation = TrueNorth) to get a seed Helmert.
 */
function deriveSeededParameters(
  metadata: IfcMetadata,
  activeCrs: CrsDef,
): HelmertParams | null {
  if (!metadata.siteReference) {
    return null;
  }
  const projected = transformWgs84ToProjected({
    def: activeCrs,
    longitude: metadata.siteReference.longitude,
    latitude: metadata.siteReference.latitude,
    elevation: metadata.siteReference.elevation,
  });
  if (projected.isErr()) {
    return null;
  }
  return {
    xScale: 1,
    yScale: 1,
    zScale: 1,
    rotation: trueNorthRotation(metadata.trueNorth),
    easting: projected.value.x,
    northing: projected.value.y,
    height: metadata.siteReference.elevation,
  };
}

/**
 * Sanity-gate: applying the helmert to localOrigin must land inside the
 * active CRS's bbox. Without this, files with placeholder
 * IfcMapConversion values (e.g. (E,N)=(0,0) plus TrueNorth-baked
 * rotation, or non-zero values that combine with localOrigin to land
 * near the CRS false-origin) fire a proj4js "Failed to find a grid shift
 * table" warning per footprint vertex. One pre-check costs at most one
 * warning per (params, CRS) change and hides the rest. See
 * docs/crs-datum-grids.md.
 */
function computeEffectiveParameters(arguments_: {
  rawParameters: HelmertParams | null;
  activeCrs: CrsDef | null;
  localOrigin: XYZ | null;
}): HelmertParams | null {
  const { rawParameters, activeCrs, localOrigin } = arguments_;
  if (!rawParameters) {
    return null;
  }
  if (!activeCrs) {
    return rawParameters;
  }
  return helmertProjectsInsideCrs(rawParameters, activeCrs, localOrigin)
    ? rawParameters
    : null;
}

function helmertProjectsInsideCrs(
  parameters: HelmertParams,
  activeCrs: CrsDef,
  localOrigin: XYZ | null,
): boolean {
  return projectLocalToWgs84(
    localOrigin ?? { x: 0, y: 0, z: 0 },
    parameters,
    activeCrs,
  ).isOk();
}

function isWithinBboxLoose(
  longitude: number,
  latitude: number,
  def: CrsDef,
): boolean {
  if (!def.bbox) {
    return true;
  }
  const [north, west, south, east] = def.bbox;
  const slack = 0.5;
  return (
    longitude >= west - slack &&
    longitude <= east + slack &&
    latitude >= south - slack &&
    latitude <= north + slack
  );
}

function deriveMapConversion(
  parameters: HelmertParams,
  activeCrs: CrsDef,
): LngLat | null {
  const result = projectLocalToWgs84(
    { x: 0, y: 0, z: 0 },
    parameters,
    activeCrs,
  );
  return result.isOk() ? result.value : null;
}

export function deriveMapReferences(
  metadata: IfcMetadata,
  parameters: HelmertParams | null,
  activeCrs: CrsDef | null,
): MapReferences {
  const mapConversion =
    parameters && activeCrs
      ? deriveMapConversion(parameters, activeCrs)
      : null;

  const site = metadata.siteReference;
  if (!site) {
    return { mapConversion, siteReference: null, siteOutsideBbox: false };
  }
  if (!activeCrs) {
    return {
      mapConversion,
      siteReference: { latitude: site.latitude, longitude: site.longitude },
      siteOutsideBbox: false,
    };
  }
  if (!isWithinBboxLoose(site.longitude, site.latitude, activeCrs)) {
    return { mapConversion, siteReference: null, siteOutsideBbox: true };
  }
  return {
    mapConversion,
    siteReference: { latitude: site.latitude, longitude: site.longitude },
    siteOutsideBbox: false,
  };
}

/**
 * Project the IFC-local footprint hull through the active Helmert + CRS
 * to WGS84 lng/lat, and combine with the already-derived references into
 * the full overlay-signals struct used by the map.
 *
 * Pure — used both at render time (Workspace memoizes it) and at event
 * time (handlers compute "next" signals from new params before
 * dispatching, so the imperative frame call doesn't have to wait for
 * React to commit the state update).
 */
export function deriveOverlaySignals(arguments_: {
  references: MapReferences;
  effectiveParameters: HelmertParams | null;
  activeCrs: CrsDef | null;
  footprintLocal: ReadonlyArray<{ x: number; y: number }> | null;
}): MapOverlaySignals {
  const { references, effectiveParameters, activeCrs, footprintLocal } =
    arguments_;
  let footprint: Array<[number, number]> | null = null;
  if (footprintLocal && effectiveParameters && activeCrs) {
    const projected: Array<[number, number]> = [];
    for (const point of footprintLocal) {
      const ll = projectLocalToWgs84(
        { x: point.x, y: point.y, z: 0 },
        effectiveParameters,
        activeCrs,
      );
      if (ll.isOk()) {
        projected.push([ll.value.longitude, ll.value.latitude]);
      }
    }
    if (projected.length >= 3) {
      footprint = projected;
    }
  }
  return {
    footprint,
    mapConversion: references.mapConversion,
    siteReference: references.siteReference,
  };
}

/**
 * File-load findings — pure consequences of opening this file. Never
 * change within a Workspace lifetime. Callers emit them once at the
 * file-load event; they don't appear in `GeorefView.findings`.
 *
 * `unknown-length-unit` is included for Finding-union completeness, but
 * the worker emits it directly at the unit-fallback boundary in
 * `worker/metadata.ts`. App-side callers should emit only
 * `baked-projected-origin` from this list.
 */
export function computeFileFindings(metadata: IfcMetadata): Array<Finding> {
  const findings: Array<Finding> = [];
  const unit = unitToMetres(metadata.lengthUnit);
  if (unit.isErr()) {
    findings.push({ kind: "unknown-length-unit", unit: unit.error.name });
  }
  const baked = detectBakedProjectedOrigin(metadata);
  if (baked) {
    findings.push({ kind: "baked-projected-origin", origin: baked });
  }
  return findings;
}

/**
 * Derive the full view from `(metadata, activeCrs, anchor)`. Pure — wrap
 * in `useMemo` at the call site. CRS-scoped findings appear in
 * `findings`; file-scoped findings are emitted upstream.
 */
export function deriveGeorefView(arguments_: {
  metadata: IfcMetadata;
  activeCrs: CrsDef | null;
  anchor: Anchor;
}): GeorefView {
  const { metadata, activeCrs, anchor } = arguments_;

  // Anchor params override the IfcSite seed; only fall back to the seed
  // when there's no anchor. The seed needs an active CRS to project; the
  // anchor doesn't.
  const rawParameters =
    anchorParams(anchor) ??
    (activeCrs ? deriveSeededParameters(metadata, activeCrs) : null);

  const effectiveParameters = computeEffectiveParameters({
    rawParameters,
    activeCrs,
    localOrigin: metadata.localOrigin,
  });

  const provenance = anchorProvenance(anchor, effectiveParameters !== null);
  const references = deriveMapReferences(
    metadata,
    effectiveParameters,
    activeCrs,
  );
  const bakedProjectedOrigin = detectBakedProjectedOrigin(metadata);

  const findings: Array<Finding> = [];
  if (activeCrs) {
    if (activeCrs.accuracy.kind === "degraded-override-failed") {
      findings.push({
        kind: "grid-degraded",
        crsCode: activeCrs.code,
        reason: activeCrs.accuracy.reason,
      });
    }
    if (references.siteOutsideBbox && metadata.siteReference) {
      findings.push({
        kind: "site-outside-crs",
        site: {
          latitude: metadata.siteReference.latitude,
          longitude: metadata.siteReference.longitude,
        },
        crsCode: activeCrs.code,
        areaOfUse: activeCrs.areaOfUse ?? null,
        hasExistingGeoref: metadata.existingGeoref !== null,
      });
    }
    // Suppressed when baked-origin already explains the underlying cause:
    // the bbox mismatch is a downstream symptom and the message would
    // misdirect the user away from the real fix.
    if (
      !bakedProjectedOrigin &&
      rawParameters !== null &&
      effectiveParameters === null
    ) {
      findings.push({
        kind: "helmert-outside-crs",
        source: metadata.existingGeoref ? "existing-georef" : "anchor-params",
        crsCode: activeCrs.code,
        areaOfUse: activeCrs.areaOfUse ?? null,
      });
    }
  }

  return {
    effectiveParameters,
    provenance,
    references,
    bakedProjectedOrigin,
    findings,
  };
}
