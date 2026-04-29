import type { HelmertParams } from "../../../lib/helmert";
import { emitLog } from "../../../lib/log";
import { isTrivialHelmert } from "../shared";

export interface ExistingGeoref {
  targetCrsName: string;
  helmert: HelmertParams;
}

export interface GeorefRead {
  existingGeoref: ExistingGeoref | null;
  /**
   * EPSG name harvested from IfcProjectedCRS even when the accompanying
   * IfcMapConversion is a Revit-style placeholder (E=N=H=0, Scale=1,
   * rotation≈0). Such a transform is geometrically meaningless — applying
   * it lands coordinates near the CRS's false origin — so we strip it
   * from `existingGeoref` and surface the intended CRS here. The UI
   * pre-fills the EPSG input from the hint but keeps Helmert params null
   * so the user still has to solve from IfcSite ref or survey points.
   */
  targetCrsHint: string | null;
  /**
   * Vertical datum identifier from IfcProjectedCRS.VerticalDatum (IFC4) or
   * the `VerticalDatum` property on `ePset_ProjectedCRS` (IFC2X3). The
   * IFC 4.3 spec recommends EPSG-namespaced values (e.g. `EPSG:5181` for
   * DHHN92, `EPSG:5709` for NAP), but it's an IfcIdentifier so older files
   * may carry plain short labels like `NAP` or be unset entirely (the
   * common case — the original Flask-based ifcgref never populated this
   * field, and most BIM exporters skip it). The string is round-tripped
   * verbatim; the UI lets users either pick a manifest entry (writes EPSG
   * form) or type a custom label.
   */
  verticalDatumHint: string | null;
}

/**
 * The WGS84 anchor synced onto IfcSite when writing a new MapConversion.
 * Computed on the main thread by reverse-projecting (Eastings, Northings)
 * through the target CRS, so the worker doesn't need proj4.
 */
export interface SiteReferenceSync {
  latitude: number;
  longitude: number;
  elevation: number;
}

/**
 * Shared terminator for both read paths: if the Helmert is Revit's
 * placeholder (zeros + identity), emit a log and keep only the CRS hint;
 * otherwise return it as a real existingGeoref. VerticalDatum is always
 * surfaced as a hint regardless — it lives on IfcProjectedCRS, not on
 * IfcMapConversion, so a placeholder transform doesn't invalidate it.
 */
export function classifyGeorefRead(
  helmert: HelmertParams,
  targetCrsName: string,
  verticalDatum: string | null,
  sourceLabel: string,
): GeorefRead {
  const hint = targetCrsName || null;
  const verticalHint = verticalDatum && verticalDatum.length > 0 ? verticalDatum : null;
  if (isTrivialHelmert(helmert)) {
    emitLog({
      source: "worker",
      message: `${sourceLabel} is a placeholder (zeros/identity) — ignoring transform, keeping ${targetCrsName} as CRS hint`,
    });
    return {
      existingGeoref: null,
      targetCrsHint: hint,
      verticalDatumHint: verticalHint,
    };
  }
  return {
    existingGeoref: { targetCrsName, helmert },
    targetCrsHint: hint,
    verticalDatumHint: verticalHint,
  };
}
