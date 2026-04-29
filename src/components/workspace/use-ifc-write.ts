import { useEffect, useState } from "react";
import { type CrsDef, transformProjectedToWgs84 } from "../../lib/crs";
import { formatBytes } from "../../lib/format";
import type { HelmertParams } from "../../lib/helmert";
import { emitLog } from "../../lib/log";
import { getIfc } from "../../ifc-api";
import type { SiteReferenceSync } from "../../worker/ifc";

interface UseIfcWriteOptions {
  parameters: HelmertParams | null;
  activeCrs: CrsDef | null;
  verticalDatum: string | null;
  onError: (message: string) => void;
}

/**
 * Owns the IFC-write lifecycle: writing IfcMapConversion, packaging the
 * updated model as a blob, and managing the download URL (including
 * revoking the old object URL when it's replaced).
 */
export function useIfcWrite({
  parameters,
  activeCrs,
  verticalDatum,
  onError,
}: UseIfcWriteOptions) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return function revokeBlobUrl() {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  async function write() {
    if (!parameters || !activeCrs) {
      onError("Set a target CRS and anchor before saving.");
      return;
    }

    // Defense-in-depth save guard. The CRS card disables the Save button
    // when accuracy is degraded, but the facade must also refuse — so any
    // future code path that reaches write() outside the SaveCard flow can't
    // accidentally produce a ~170 m–wrong file with a "trusted" badge.
    // See docs/crs-datum-grids.md (Q9 / Q11).
    if (activeCrs.accuracy.kind === "degraded-override-failed") {
      onError(
        `Cannot save: precision grid for EPSG:${activeCrs.code} failed to load (${activeCrs.accuracy.reason.kind}). Retry from the CRS card.`,
      );
      return;
    }

    // IFC 4.3 spec for IfcProjectedCRS: VerticalDatum "needs to be
    // provided, if the Name identifier does not unambiguously define the
    // vertical datum and if the coordinate reference system is a 3D
    // reference system." A horizontal-only EPSG (e.g. 28992) is ambiguous
    // — refuse to write a non-compliant 3D file, push the user to either
    // pick a vertical datum or switch to a compound CRS like 7415.
    const verticalDatumMissing =
      verticalDatum === null || verticalDatum.trim().length === 0;
    if (activeCrs.kind === "projected" && verticalDatumMissing) {
      onError(
        "Pick a vertical datum, or switch to a compound CRS (e.g. EPSG:7415).",
      );
      return;
    }

    setBusy(true);

    try {
      const ifc = getIfc();

      const siteReference = deriveSiteReference(activeCrs, parameters);

      // For compound the vertical datum is already encoded in Name, so
      // writing VerticalDatum on top would be redundant (and risks
      // contradicting Name on stale state). For projected we just verified
      // the user supplied one above.
      const datumToWrite =
        activeCrs.kind === "compound" ? null : verticalDatum;

      await ifc.writeMapConversion(
        activeCrs.code,
        datumToWrite,
        parameters,
        siteReference,
      );

      const blob = await ifc.save();

      setDownloadUrl(URL.createObjectURL(blob));

      emitLog({
        message: `Saved georeferenced model (${formatBytes(blob.size)}, EPSG:${activeCrs.code})`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      onError(`Write failed: ${errorMessage}`);
    } finally {
      setBusy(false);
    }
  }

  return { busy, downloadUrl, write };
}

/**
 * Reverse-project (Eastings, Northings) through the target CRS to WGS84
 * so the worker can overwrite IfcSite.RefLatitude/RefLongitude. Returns
 * null if proj4 throws — the MapConversion is still authoritative in that
 * case, so we just skip the sync and log a warning.
 *
 * Elevation is taken directly from OrthogonalHeight; for most projected
 * CRS the vertical component is undefined, and this mirrors the assumption
 * the rest of the app already makes (anchor-card shows height = OrthoH).
 */
function deriveSiteReference(
  activeCrs: CrsDef,
  parameters: HelmertParams,
): SiteReferenceSync | null {
  const wgs84 = transformProjectedToWgs84(
    activeCrs,
    parameters.easting,
    parameters.northing,
  );
  if (wgs84.isErr()) {
    emitLog({
      level: "warn",
      message: `Could not reverse-project anchor for IfcSite sync; skipping.`,
    });
    return null;
  }
  return {
    latitude: wgs84.value.latitude,
    longitude: wgs84.value.longitude,
    elevation: parameters.height,
  };
}
