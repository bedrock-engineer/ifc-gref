import { projectLocalToWgs84, type CrsDef, type LngLat } from "#modules/crs";
import type { HelmertParams } from "#modules/helmert/solve";
import type { IfcMetadata } from "#modules/ifc/worker";

export interface MapReferences {
  /**
   * IfcMapConversion-derived anchor in WGS84. Defined as the WGS84 image of
   * local (0,0,0) under the *current* Helmert — that's exactly what
   * IfcMapConversion stores (Eastings, Northings, OrthogonalHeight) and
   * what the axes overlay anchors at. Tracks live `parameters`, so edits
   * to E/N/H/rotation move the marker in real time.
   */
  mapConversion: LngLat | null;
  /**
   * IfcSite RefLat/RefLon, when present and within the active CRS's area of
   * use (or when no CRS has been resolved yet — IfcSite is intrinsically
   * WGS84 and doesn't need one to render). Null when the file has no
   * IfcSite reference, or when the value is outside the CRS bbox.
   */
  siteReference: LngLat | null;
  /**
   * True when IfcSite RefLat/RefLon is present *and* an active CRS exists
   * *and* the value falls outside the CRS area of use (loose check, 0.5°
   * slack). The map skips rendering the IfcSite marker; the sidebar
   * surfaces a warning instead.
   */
  siteOutsideBbox: boolean;
}

/**
 * Derive both IfcMapConversion and IfcSite anchors from the current state.
 * Pure — no Result, no error union; callers consume the struct directly and
 * each field is independently nullable.
 */
export function deriveMapReferences(
  metadata: IfcMetadata,
  parameters: HelmertParams | null,
  activeCrs: CrsDef | null,
): MapReferences {
  // Anchor at local (0,0,0), not at metadata.localOrigin. The
  // IfcMapConversion entity describes where (0,0,0) lands in the
  // projected CRS; using IfcSite's offset would point at IfcSite's
  // projected location instead, which is what the legacy single-marker
  // code did and is wrong for a marker explicitly labelled
  // "IfcMapConversion".
  const mapConversion =
    parameters && activeCrs
      ? deriveMapConversion(parameters, activeCrs)
      : null;

  const site = metadata.siteReference;
  if (!site) {
    return { mapConversion, siteReference: null, siteOutsideBbox: false };
  }

  // Without a CRS we can't bbox-check, so show IfcSite as-is. The bbox
  // sanity gate runs once the user picks a CRS — at which point the marker
  // either survives or is replaced by the sidebar warning.
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
    longitude >= west - slack
    && longitude <= east + slack
    && latitude >= south - slack
    && latitude <= north + slack
  );
}
