import { Button } from "../../button";

interface SaveCardProps {
  filename: string;
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
  downloadUrl: string | null;
  onWrite: () => void;
}

/**
 * Pinned action strip at the bottom of the sidebar. Lives outside the scroll
 * region so "Write & download" is always reachable when the sidebar content
 * overflows.
 */
export function SaveCard({
  filename,
  busy,
  canWrite,
  blockedReason,
  downloadUrl,
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
        Write IfcMapConversion & build download
      </Button>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`georeferenced-${filename}`}
          className="block rounded border border-emerald-700 px-3 py-2 text-center text-sm font-medium text-emerald-700 hover:bg-emerald-50"
        >
          Download georeferenced IFC
        </a>
      )}
    </div>
  );
}
