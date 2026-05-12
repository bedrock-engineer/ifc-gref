import { Button } from "../../input/button";

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
  onWrite: () => void;
}

/**
 * Pinned action strip at the bottom of the sidebar. Lives outside the scroll
 * region so the download action is always reachable when the sidebar content
 * overflows. Writes IfcMapConversion and triggers the browser download.
 */
export function SaveCard({
  busy,
  canWrite,
  blockedReason,
  warning,
  onWrite,
}: SaveCardProps) {
  return (
    <div className="space-y-2 border-t border-slate-200 bg-white p-4">
      {blockedReason ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {blockedReason}
        </p>
      ) : warning ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {warning}
        </p>
      ) : null}
      <Button
        variant="primary"
        size="md"
        onPress={onWrite}
        isDisabled={!canWrite || busy}
        className="w-full"
      >
        {busy ? "Preparing download…" : "Download georeferenced IFC"}
      </Button>
    </div>
  );
}
