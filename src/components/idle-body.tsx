import {
  Button,
  DropZone,
  FileTrigger,
  Label,
  ProgressBar,
  Text,
} from "react-aria-components";
import type { Stage } from "../app";

export interface IdleBodyProps {
  stage: Exclude<Stage, { kind: "loaded" }>;
  onFile: (file: File) => void;
  onError: (message: string) => void;
}

const DEMO_FILENAME = "MiniBIM-3.1-DO_01_VORM.ifc";
const DEMO_URL = `${import.meta.env.BASE_URL}demo/${DEMO_FILENAME}`;

export function IdleBody({ stage, onFile, onError }: IdleBodyProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-4">
        {stage.kind === "loading" ? (
          <LoadingIndicator status={stage.status} fraction={stage.fraction} />
        ) : (
          <FileDropZone onFile={onFile} onError={onError} />
        )}

        {stage.kind === "error" && (
          <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
            {stage.message}
          </div>
        )}

        <p className="text-center text-sm text-slate-500">
          Browser-based georeferencing for IFC files. Nothing leaves your
          browser.
        </p>
      </div>
    </div>
  );
}

interface FileDropZoneProps {
  onFile: (file: File) => void;
  onError: (message: string) => void;
}

function isIfcFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".ifc");
}

function FileDropZone({ onFile, onError }: FileDropZoneProps) {
  return (
    <DropZone
      onDrop={(event) => {
        const fileItems = event.items.filter((entry) => entry.kind === "file");
        if (fileItems.length === 0) {
          onError("Drop an .ifc file — that wasn't a file.");
          return;
        }
        // Take the first file; ignore extras silently (common to drag a folder
        // or multi-select — we only georef one model at a time).
        const first = fileItems[0];
        if (first?.kind !== "file") {
          return;
        }
        void first.getFile().then((file) => {
          if (!isIfcFilename(file.name)) {
            onError(`"${file.name}" is not an .ifc file.`);
            return;
          }
          onFile(file);
        });
      }}
      className={({ isDropTarget, isFocusVisible }) =>
        [
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-12 text-center outline-none",
          isDropTarget
            ? "border-blue-400 bg-blue-50 text-blue-600"
            : "border-slate-300 bg-white text-slate-500 hover:border-slate-400",
          isFocusVisible && "ring-2 ring-blue-500 ring-offset-2",
        ]
          .filter(Boolean)
          .join(" ")
      }
    >
      <Text slot="label">Drop an .ifc file here</Text>
      <FileTrigger
        acceptedFileTypes={[".ifc"]}
        onSelect={(files) => {
          const f = files?.[0];
          if (!f) {
            return;
          }
          // The OS picker already filters by acceptedFileTypes, but Safari
          // and some Linux file managers ignore the extension hint, so
          // double-check here for parity with the drop path.
          if (!isIfcFilename(f.name)) {
            onError(`"${f.name}" is not an .ifc file.`);
            return;
          }
          onFile(f);
        }}
      >
        <Button className="cursor-pointer text-blue-600 underline hover:text-blue-800">
          or choose a file
        </Button>
      </FileTrigger>

      <Button
        onPress={() => {
          void loadDemoFile().then(
            (file) => {
              onFile(file);
            },
            (error: unknown) => {
              const message =
                error instanceof Error ? error.message : String(error);
              onError(`Could not load demo file: ${message}`);
            },
          );
        }}
        className="mt-2 text-xs text-slate-400 cursor-pointer underline hover:text-slate-600"
      >
        Try the MiniBIM demo
      </Button>
    </DropZone>
  );
}

async function loadDemoFile(): Promise<File> {
  const response = await fetch(DEMO_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }
  const blob = await response.blob();
  return new File([blob], DEMO_FILENAME, { type: "application/octet-stream" });
}

interface LoadingIndicatorProps {
  status: string;
  fraction: number | null;
}

function LoadingIndicator({ status, fraction }: LoadingIndicatorProps) {
  if (fraction === null) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-slate-200 bg-white p-12">
        <div className="size-8 animate-spin rounded-full border-3 border-slate-200 border-t-blue-500" />
        <p className="text-slate-500">{status}</p>
      </div>
    );
  }

  const percent = Math.round(fraction * 100);

  return (
    <ProgressBar
      value={percent}
      className="flex flex-col gap-2 rounded-lg border-2 border-slate-200 bg-white p-12"
    >
      <div className="flex items-baseline justify-between">
        <Label className="text-slate-600">{status}</Label>
        <span className="text-sm tabular-nums text-slate-500">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-500 transition-[width] duration-150 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </ProgressBar>
  );
}
