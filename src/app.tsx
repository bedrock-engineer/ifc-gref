import { useEffect, useState } from "react";
import { DiagnosticsPanel } from "./components/diagnostics-panel";
import { Header } from "./components/header";
import { IdleBody } from "./components/idle-body";
import { Workspace } from "./components/workspace";
import { getIfc } from "./ifc-api";
import { prefetchCrsManifest } from "./lib/crs";
import { formatBytes } from "./lib/format";
import { emitLog } from "./lib/log";
import type { IfcMetadata } from "./worker/ifc";

export type Stage =
  | { kind: "idle" }
  | {
      kind: "loading";
      filename: string;
      status: string;
      fraction: number | null;
    }
  | { kind: "loaded"; filename: string; metadata: IfcMetadata }
  | { kind: "error"; message: string };

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  console.log("App", { stage });
  // Race the ~500 KB CRS manifest fetch against the first WASM load / IFC
  // parse so `lookupCrs` is hot by the time the user drops a file.
  useEffect(() => {
    void prefetchCrsManifest();
  }, []);

  async function handleFile(file: File) {
    setStage({
      kind: "loading",
      filename: file.name,
      status: "Reading file…",
      fraction: null,
    });

    emitLog({
      message: `Reading file: ${file.name} (${formatBytes(file.size)})`,
    });

    try {
      const ifc = getIfc();

      setStage({
        kind: "loading",
        filename: file.name,
        status: "Parsing IFC model…",
        fraction: 0,
      });

      await ifc.open(file, (fraction) => {
        setStage((previous) =>
          previous.kind === "loading" &&
          previous.filename === file.name &&
          previous.fraction !== null
            ? { ...previous, fraction }
            : previous,
        );
      });

      setStage({
        kind: "loading",
        filename: file.name,
        status: "Extracting metadata…",
        fraction: null,
      });

      const metadata = await ifc.readMetadata();

      if (metadata.existingGeoref) {
        emitLog({
          message: `Existing georeferencing found: ${metadata.existingGeoref.targetCrsName}`,
        });
      } else {
        emitLog({ message: "No existing georeferencing found" });
      }

      setStage({ kind: "loaded", filename: file.name, metadata });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitLog({ level: "error", message: `Failed to load file: ${message}` });
      setStage({ kind: "error", message });
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <Header
        filename={stage.kind === "loaded" ? stage.filename : null}
        onFile={(file) => {
          void handleFile(file);
        }}
      />
      {stage.kind === "loaded" ? (
        <Workspace
          key={stage.filename}
          filename={stage.filename}
          metadata={stage.metadata}
          onError={(message) => {
            setStage({ kind: "error", message });
          }}
        />
      ) : (
        <IdleBody
          stage={stage}
          onFile={(file) => {
            void handleFile(file);
          }}
          onError={(message) => {
            emitLog({ level: "warn", message });
            setStage({ kind: "error", message });
          }}
        />
      )}
      <DiagnosticsPanel />
    </div>
  );
}
