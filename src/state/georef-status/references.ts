import { type CrsDef, type LngLat, projectLocalToWgs84 } from "#modules/crs";
import type { HelmertParams } from "#modules/helmert/solve";
import type { IfcMetadata } from "#modules/ifc/worker";
import type { MapReferences } from "./types";

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
    longitude >= west - slack &&
    longitude <= east + slack &&
    latitude >= south - slack &&
    latitude <= north + slack
  );
}

/**
 * WGS84 anchors for the map: where the IFC origin lands under the current
 * Helmert (`mapConversion`), and the IfcSite RefLat/RefLon if present and
 * inside the active CRS bbox (`siteReference`). Pure helper called from
 * the view derivation *and* event handlers (which build "next" references
 * from a freshly-edited Helmert before dispatching).
 */
export function deriveMapReferences(
  metadata: IfcMetadata,
  parameters: HelmertParams | null,
  activeCrs: CrsDef | null,
): MapReferences {
  const mapConversion =
    parameters && activeCrs ? deriveMapConversion(parameters, activeCrs) : null;

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
