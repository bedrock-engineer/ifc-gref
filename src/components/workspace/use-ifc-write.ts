import { useTransition } from "react";
import { type CrsDef } from "#modules/crs";
import { formatBytes } from "../../lib/format";
import type { HelmertParams } from "#modules/helmert/solve";
import { emitLog } from "../../lib/log";
import { getIfc } from "../../ifc-api";
import { writeMapConversionToWorker } from "./write-map-conversion";

interface UseIfcWriteOptions {
  filename: string;
  parameters: HelmertParams | null;
  activeCrs: CrsDef | null;
  verticalDatum: string | null;
  onError: (message: string) => void;
}

/**
 * Owns the IFC-write lifecycle: writing IfcMapConversion, packaging the
 * updated model as a blob, and triggering the browser download in a single
 * step. The object URL is created and revoked inside one transition — no
 * intermediate state is exposed, since the user-facing flow is one click.
 */
export function useIfcWrite({
  filename,
  parameters,
  activeCrs,
  verticalDatum,
  onError,
}: UseIfcWriteOptions) {
  const [busy, startWriteTransition] = useTransition();

  function write() {
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

    // Missing VerticalDatum on a horizontal-only projected CRS is an
    // interpretive ambiguity, not wrong numbers — the SaveCard surfaces a
    // warning and lets the user proceed deliberately. The worker handles
    // null/empty verticalDatum (`georef/ifc4.ts:405`).

    startWriteTransition(async () => {
      try {
        const ifc = getIfc();

        await writeMapConversionToWorker({
          ifc,
          parameters,
          activeCrs,
          verticalDatum,
        });

        const blob = await ifc.save();

        triggerDownload(blob, `ifc-georeferencer-${filename}`);

        emitLog({
          message: `Saved georeferenced model (${formatBytes(blob.size)}, EPSG:${activeCrs.code})`,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        onError(`Write failed: ${errorMessage}`);
      }
    });
  }

  return { busy, write };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Defer revoke so Safari has time to start the download (Chrome/Firefox
  // are fine immediately, but the spec doesn't guarantee it).
  setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
}
