import { Button } from "react-aria-components";

interface SaveCardProps {
  filename: string;
  busy: boolean;
  canWrite: boolean;
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
  downloadUrl,
  onWrite,
}: SaveCardProps) {
  return (
    <div className="space-y-2 border-t border-slate-200 bg-white p-4">
      <Button
        onPress={onWrite}
        isDisabled={!canWrite || busy}
        className="w-full rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white outline-none hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"
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
