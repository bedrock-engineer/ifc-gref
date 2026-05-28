import type { PredictedWriteEntity } from "#state/workspace";
import { DownloadIcon } from "@radix-ui/react-icons";
import { Button } from "../../input/button";
import type { ReactNode } from "react";

interface SaveCardProps {
  busy: boolean;
  canWrite: boolean;
  /**
   * If non-null, save is blocked for a reason worth telling the user
   * about (most importantly: an override-bearing CRS's grid failed to load
   * — saving now would bake a ~170 m–wrong IfcMapConversion. See
   * docs/crs-datum-grids.md). Shown as a small red notice above the
   * disabled button.
   */
  blockedReason?: string | null;
  /**
   * Non-blocking advisory shown above an enabled button — for cases
   * where the file will save successfully but a recipient may
   * misinterpret it (e.g. missing VerticalDatum on a projected CRS).
   * Suppressed when `blockedReason` is set, since the block message
   * subsumes it.
   */
  warning?: string | null;
  /**
   * Live prediction of which entity the writer will emit, derived from
   * the current params + original file state. Hidden when null (no anchor
   * yet, or save is blocked for a reason that subsumes the indicator).
   * Updates as the user edits rotation/scale — flips between
   * IfcRigidOperation and IfcMapConversion when the params cross the
   * pure-translation threshold.
   */
  predictedWriteEntity?: PredictedWriteEntity | null;
  onWrite: () => void;
}

/**
 * Pinned action strip at the bottom of the sidebar. Lives outside the scroll
 * region so the download action is always reachable when the sidebar content
 * overflows. Writes the predicted entity and triggers the browser download.
 */
export function SaveCard({
  busy,
  canWrite,
  blockedReason,
  warning,
  predictedWriteEntity,
  onWrite,
}: SaveCardProps) {
  let blockedMessage: ReactNode | null = null;

  if (blockedReason) {
    blockedMessage = (
      <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
        {blockedReason}
      </p>
    );
  } else if (warning) {
    blockedMessage = (
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {warning}
      </p>
    );
  }

  return (
    <div className="space-y-2 border-t border-slate-200 bg-white p-4">
      {blockedMessage}

      {predictedWriteEntity && !blockedReason && (
        <p className="text-xs text-slate-500">
          Will write:{" "}
          <span className="font-medium text-slate-700">
            {predictedWriteEntity.entityName}
          </span>
          {predictedWriteEntity.note && (
            <span className="text-slate-400">
              {" "}
              ({predictedWriteEntity.note})
            </span>
          )}
          {predictedWriteEntity.sideEffects.map((effect) => (
            <span key={effect} className="text-slate-400">
              {" "}
              · {effect}
            </span>
          ))}
        </p>
      )}
      <Button
        variant="primary"
        size="md"
        onPress={onWrite}
        isDisabled={!canWrite || busy}
        className="w-full"
      >
        {busy ? (
          <>
            Preparing download…
            <span
              aria-hidden
              className="size-3 animate-spin rounded-full border-2 border-white/30 border-t-white"
            />
          </>
        ) : (
          <>
            <DownloadIcon />
            Download georeferenced IFC
          </>
        )}
      </Button>
    </div>
  );
}
