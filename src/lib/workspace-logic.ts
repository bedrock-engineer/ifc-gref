/**
 * Pure logic called from the Workspace component. These helpers own all
 * the proj4 / Helmert assembly that the UI layer used to do inline, so
 * workspace.tsx is left with state + JSX wiring.
 */

import { ResultAsync, err, errAsync, ok, okAsync, type Result } from "neverthrow";
import {
  type CrsDef,
  type CrsError,
  type TransformError,
  lookupCrs,
  parseEpsgCode,
  transformProjectedToWgs84,
  transformWgs84ToProjected,
} from "./crs";
import {
  type HelmertParams,
  type PointPair,
  type SolveRequest,
  type SurveySource,
} from "./helmert";
import type { ExistingGeoref, IfcMetadata } from "../worker/ifc";

/**
 * Where a value in the sidebar came from. Displayed as a badge on each
 * card. "derived" is used for per-field badges (e.g. rotation from
 * TrueNorth) independent of the anchor kind.
 */
export type Provenance =
  | "file"
  | "derived"
  | "map"
  | "manual"
  | "survey"
  | "default";

/**
 * Anchor couples Helmert params with the provenance of where they came
 * from, so the two can never drift apart. The kind strings line up with
 * `Provenance` on purpose — a manual/map/survey/file anchor maps 1:1 to
 * the badge shown in the sidebar.
 */
export type Anchor =
  | { kind: "default" }
  | { kind: "file"; params: HelmertParams }
  | { kind: "manual"; params: HelmertParams }
  | { kind: "map"; params: HelmertParams }
  | { kind: "survey"; params: HelmertParams };

export function anchorParams(anchor: Anchor): HelmertParams | null {
  return anchor.kind === "default" ? null : anchor.params;
}

/**
 * Provenance for the anchor badge. When no anchor is set but
 * `effectiveParameters` was seeded from IfcSite lat/lon, we surface that
 * as "file" — the user is looking at a value derived from file contents,
 * not a placeholder.
 */
export function anchorProvenance(
  anchor: Anchor,
  hasEffectiveParameters: boolean,
): Provenance {
  if (anchor.kind === "default") {
    return hasEffectiveParameters ? "file" : "default";
  }
  return anchor.kind;
}

/**
 * Actions are scoped to anchor transitions — where the structural
 * coupling between params and provenance lives. Orthogonal UI flags
 * (busy, pickingAnchor, downloadUrl, epsgCode) stay as plain useState
 * in the component.
 *
 * `paramsReplaced` covers both rotation/scale tweaks and CRS-swap
 * reprojections: both "just update numbers" while preserving where the
 * anchor originally came from.
 */
export type AnchorAction =
  | { type: "edited"; params: HelmertParams }
  | { type: "resetToFile" }
  | { type: "picked"; params: HelmertParams }
  | { type: "solved"; params: HelmertParams }
  | { type: "paramsReplaced"; params: HelmertParams };

export function initialAnchor(metadata: IfcMetadata): Anchor {
  return metadata.existingGeoref
    ? { kind: "file", params: metadata.existingGeoref.helmert }
    : { kind: "default" };
}

/**
 * Reducer factory that closes over `existing` so `resetToFile` can pull
 * the file-provided Helmert without the caller having to thread it
 * through the action payload. Re-invoked each render — `useReducer`
 * picks up the latest closure for the next dispatch, so this stays in
 * sync with the current metadata.
 */
export function makeAnchorReducer(existing: ExistingGeoref | null) {
  return function anchorReducer(state: Anchor, action: AnchorAction): Anchor {
    switch (action.type) {
      case "edited": {
        return { kind: "manual", params: action.params };
      }
      case "resetToFile": {
        if (!existing) {
          return state;
        }
        return { kind: "file", params: existing.helmert };
      }
      case "picked": {
        return { kind: "map", params: action.params };
      }
      case "solved": {
        return { kind: "survey", params: action.params };
      }
      case "paramsReplaced": {
        if (state.kind === "default") {
          return state;
        }
        return { ...state, params: action.params };
      }
    }
  };
}

/**
 * Seed the target-CRS input from whatever the file told us:
 *   1. A fully solved IfcMapConversion → use its TargetCRS.
 *   2. A Revit-style placeholder that still named a CRS → use the hint.
 *   3. Nothing → empty string, user picks from the combobox.
 */
export function initialEpsgFromMetadata(metadata: IfcMetadata): string {
  if (metadata.existingGeoref) {
    const code = parseEpsgCode(metadata.existingGeoref.targetCrsName);
    if (code != null) {
      return String(code);
    }
  }
  if (metadata.targetCrsHint) {
    const code = parseEpsgCode(metadata.targetCrsHint);
    if (code != null) {
      return String(code);
    }
  }
  return "";
}

/** Convert the IFC TrueNorth direction ratios to a rotation in radians. */
export function trueNorthRotation(metadata: IfcMetadata): number {
  return metadata.trueNorth
    ? Math.atan2(metadata.trueNorth.ordinate, metadata.trueNorth.abscissa)
    : 0;
}

/**
 * Files with IfcSite RefLat/RefLon but no IfcMapConversion carry enough
 * info to place the model geographically. Project lat/lon through the
 * active CRS (scale 1, rotation = TrueNorth) to get a seed Helmert so 3D
 * renders and the anchor card shows something editable.
 */
export function deriveEffectiveParameters(
  parameters: HelmertParams | null,
  activeCrs: CrsDef | null,
  metadata: IfcMetadata,
): HelmertParams | null {
  if (parameters !== null) {
    return parameters;
  }
  if (!metadata.siteReference || !activeCrs) {
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
    scale: 1,
    rotation: trueNorthRotation(metadata),
    easting: projected.value.x,
    northing: projected.value.y,
    height: metadata.siteReference.elevation,
  };
}

/**
 * When the user swaps the target CRS, keep the anchor's *geographic*
 * position fixed: round-trip (E,N) through lat/lon so the pin on the map
 * doesn't jump. Rotation and height are preserved — grid convergence
 * between projections is typically <1° and most swaps share a vertical
 * datum.
 */
export type ReprojectError =
  | TransformError
  | { kind: "lookup-failed"; cause: CrsError };

/**
 * Round-trip the anchor's planar position through WGS84 lat/lon so it
 * lands at the same geographic point in the new CRS. Owns the proj4
 * registration step — both source and target codes are looked up before
 * the transform runs, so the caller doesn't need to pre-register.
 */
export function reprojectAnchorOnCrsChange(arguments_: {
  parameters: HelmertParams;
  previousEpsg: number;
  nextEpsg: number;
}): ResultAsync<HelmertParams, ReprojectError> {
  const { parameters, previousEpsg, nextEpsg } = arguments_;
  return ResultAsync.combine([lookupCrs(previousEpsg), lookupCrs(nextEpsg)])
    .mapErr<ReprojectError>((cause) => ({ kind: "lookup-failed", cause }))
    .andThen(([previousDef, nextDef]) => {
      const ll = transformProjectedToWgs84(
        previousDef,
        parameters.easting,
        parameters.northing,
      );
      if (ll.isErr()) {
        return errAsync<HelmertParams, ReprojectError>(ll.error);
      }
      const projected = transformWgs84ToProjected({
        def: nextDef,
        longitude: ll.value.longitude,
        latitude: ll.value.latitude,
        elevation: parameters.height,
      });
      if (projected.isErr()) {
        return errAsync<HelmertParams, ReprojectError>(projected.error);
      }
      return okAsync<HelmertParams, ReprojectError>({
        ...parameters,
        easting: projected.value.x,
        northing: projected.value.y,
      });
    });
}

export type SurveySourceError =
  | { kind: "no-site-ref"; message: string }
  | { kind: "projection-failed"; message: string };

/**
 * Assemble the SurveySource for the solver. The IfcSite point pair is
 * materialised here because it requires projecting lat/lon through proj4 —
 * which we keep out of the UI layer.
 */
export function buildSurveySource(arguments_: {
  request: SolveRequest;
  metadata: IfcMetadata;
  activeCrs: CrsDef;
}): Result<SurveySource, SurveySourceError> {
  const { request, metadata, activeCrs } = arguments_;
  if (request.mode === "ignore-existing") {
    return ok({ kind: "ignore-existing", userPoints: request.userPoints });
  }
  if (!metadata.siteReference || !metadata.localOrigin) {
    return err({
      kind: "no-site-ref",
      message: "No IfcSite reference available for this mode",
    });
  }
  const projected = transformWgs84ToProjected({
    def: activeCrs,
    longitude: metadata.siteReference.longitude,
    latitude: metadata.siteReference.latitude,
    elevation: metadata.siteReference.elevation,
  });
  if (projected.isErr()) {
    return err({
      kind: "projection-failed",
      message: `Projection failed: ${String(projected.error.cause)}`,
    });
  }
  const ifcSitePoint: PointPair = {
    local: metadata.localOrigin,
    target: projected.value,
  };
  if (request.mode === "use-existing") {
    return ok({ kind: "use-existing", ifcSitePoint });
  }
  return ok({
    kind: "add-to-existing",
    ifcSitePoint,
    userPoints: request.userPoints,
  });
}

/**
 * Convert a map-picked WGS84 point into a HelmertParams: project through
 * the active CRS and either patch the existing anchor's E/N/H or seed a
 * fresh one (scale=1, rotation=TrueNorth) when the user hasn't solved yet.
 */
export function applyPickedAnchor(arguments_: {
  point: { longitude: number; latitude: number };
  metadata: IfcMetadata;
  activeCrs: CrsDef;
  base: HelmertParams | null;
}): Result<HelmertParams, TransformError> {
  const { point, metadata, activeCrs, base } = arguments_;
  const projected = transformWgs84ToProjected({
    def: activeCrs,
    longitude: point.longitude,
    latitude: point.latitude,
    elevation: 0,
  });
  if (projected.isErr()) {
    return err(projected.error);
  }
  if (base) {
    return ok({
      ...base,
      easting: projected.value.x,
      northing: projected.value.y,
    });
  }
  return ok({
    scale: 1,
    rotation: trueNorthRotation(metadata),
    easting: projected.value.x,
    northing: projected.value.y,
    height: 0,
  });
}
