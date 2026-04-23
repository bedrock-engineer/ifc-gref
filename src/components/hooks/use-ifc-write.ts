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
    setBusy(true);

    try {
      const ifc = getIfc();

      const siteReference = deriveSiteReference(activeCrs, parameters);

      await ifc.writeMapConversion(activeCrs.code, parameters, siteReference);

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
    activeCrs.code,
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
