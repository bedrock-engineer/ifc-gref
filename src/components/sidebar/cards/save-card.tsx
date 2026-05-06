import { Button } from "../../button";

interface SaveCardProps {
  busy: boolean;
  canWrite: boolean;
  /**
   * If non-null, save is blocked for a reason worth telling the user
   * about (most importantly: an override-bearing CRS's grid failed to load
   * — saving now would bake a ~170 m–wrong IfcMapConversion. See
   * docs/crs-datum-grids.md). Shown as a small notice above the disabled
   * button.
   */
  blockedReason?: string | null;
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
  onWrite,
}: SaveCardProps) {
  return (
    <div className="space-y-2 border-t border-slate-200 bg-white p-4">
      {blockedReason && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {blockedReason}
        </p>
      )}
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
