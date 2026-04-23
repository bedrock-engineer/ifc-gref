import { Activity, useEffect, useReducer } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { type HelmertParams } from "../lib/helmert";
import { emitLog } from "../lib/log";
import { unitToMetres } from "../lib/units";
import {
  anchorParams,
  anchorProvenance,
  deriveEffectiveParameters,
  initialAnchor,
  makeAnchorReducer,
} from "../lib/workspace-logic";
import type { IfcMetadata } from "../worker/ifc";
import { useAnchorPick } from "./hooks/use-anchor-pick";
import { useHelmertSolve } from "./hooks/use-helmert-solve";
import { useIfcWrite } from "./hooks/use-ifc-write";
import { useTargetCrs } from "./hooks/use-target-crs";
import { MapView } from "./map-view";
import { AnchorCard } from "./sidebar/cards/anchor-card";
import { FileStatusCard } from "./sidebar/cards/file-status-card";
import { RotationCard } from "./sidebar/cards/rotation-card";
import { SaveCard } from "./sidebar/cards/save-card";
import { SurveyPointsCard } from "./sidebar/cards/survey-points-card";
import { TargetCrsCard } from "./sidebar/cards/target-crs-card";
import { Sidebar } from "./sidebar/sidebar";

export interface WorkspaceProps {
  filename: string;
  metadata: IfcMetadata;
  onError: (message: string) => void;
}

export function Workspace({ filename, metadata, onError }: WorkspaceProps) {
  const [anchor, dispatchAnchor] = useReducer(
    makeAnchorReducer(metadata.existingGeoref),
    metadata,
    initialAnchor,
  );

  function reportError(message: string) {
    emitLog({ level: "error", message });
    onError(message);
  }

  const { epsgCode, crsState, activeCrs, changeEpsg } = useTargetCrs({
    metadata,
    currentParams: anchorParams(anchor),
    onReproject: (params) => {
      dispatchAnchor({ type: "paramsReplaced", params });
    },
    onError: reportError,
  });

  // `anchor` holds the user/solver-owned params; `effectiveParameters`
  // falls back to a seed derived from IfcSite lat/lon when no anchor is
  // set yet, so downstream consumers always have something to render.
  const effectiveHelmertParameters = deriveEffectiveParameters(
    anchorParams(anchor),
    activeCrs,
    metadata,
  );

  const effectiveAnchorProvenance = anchorProvenance(
    anchor,
    effectiveHelmertParameters !== null,
  );

  const {
    busy: solveBusy,
    solve,
    lastFitPoints,
  } = useHelmertSolve({
    metadata,
    activeCrs,
    onSolved: (params) => {
      dispatchAnchor({ type: "solved", params });
    },
    onError: reportError,
  });

  const {
    busy: writeBusy,
    downloadUrl,
    write,
  } = useIfcWrite({
    parameters: effectiveHelmertParameters,
    activeCrs,
    onError: reportError,
  });

  const {
    isPickingAnchor,
    start: startPickAnchor,
    cancel: cancelPickAnchor,
    handlePicked: handleAnchorPicked,
  } = useAnchorPick({
    metadata,
    activeCrs,
    base: effectiveHelmertParameters,
    onPicked: (params) => {
      dispatchAnchor({ type: "picked", params });
    },
    onError: reportError,
  });

  const busy = solveBusy || writeBusy;

  // Metres per IFC length unit, feeds MapLibre's metres-based altitude in
  // the 3D layer. Independent of Helmert.scale (which maps IFC units → CRS
  // map units, possibly feet) and of the target CRS. Fall back to 1 on an
  // unknown unit so 3D still renders, just at the wrong height.
  const unitResult = unitToMetres(metadata.lengthUnit);
  const ifcMetresPerUnit = unitResult.isOk() ? unitResult.value : 1;

  useEffect(() => {
    if (unitResult.isErr()) {
      emitLog({
        level: "warn",
        message: `Unknown IFC length unit '${unitResult.error.name}' — assuming 1 metre per unit for 3D altitude`,
      });
    }
  }, [unitResult]);

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar
        saveCard={
          <SaveCard
            filename={filename}
            busy={busy}
            canWrite={effectiveHelmertParameters !== null}
            downloadUrl={downloadUrl}
            onWrite={() => {
              void write();
            }}
          />
        }
      >
        <FileStatusCard filename={filename} metadata={metadata} />

        <TargetCrsCard
          epsgCode={epsgCode}
          crsState={crsState}
          onChange={(code) => {
            void changeEpsg(code);
          }}
          fromFile={Boolean(metadata.existingGeoref?.targetCrsName)}
        />

        <Tabs defaultSelectedKey="reference" className="space-y-2">
          <TabList
            aria-label="Georeferencing method"
            className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs font-medium"
          >
            <Tab
              id="reference"
              className="cursor-pointer rounded px-3 py-1.5 text-center text-slate-600 outline-none data-focus-visible:ring-2 data-focus-visible:ring-slate-500 data-selected:bg-white data-selected:text-slate-900 data-selected:shadow-sm"
            >
              Reference point
            </Tab>

            <Tab
              id="survey"
              className="cursor-pointer rounded px-3 py-1.5 text-center text-slate-600 outline-none data-focus-visible:ring-2 data-focus-visible:ring-slate-500 data-selected:bg-white data-selected:text-slate-900 data-selected:shadow-sm"
            >
              Survey points
            </Tab>
          </TabList>

          <TabPanel id="reference" shouldForceMount>
            {({ isInert }) => (
              <Activity mode={isInert ? "hidden" : "visible"}>
                <div className="rounded-lg border border-slate-200 bg-white px-2 py-4">
                  <AnchorCard
                    parameters={effectiveHelmertParameters}
                    provenance={effectiveAnchorProvenance}
                    isPicking={isPickingAnchor}
                    canResetToFile={Boolean(metadata.existingGeoref)}
                    onEdit={(params) => {
                      dispatchAnchor({ type: "edited", params });
                    }}
                    onStartPick={startPickAnchor}
                    onCancelPick={cancelPickAnchor}
                    onResetToFile={() => {
                      dispatchAnchor({ type: "resetToFile" });
                    }}
                  />
                </div>
              </Activity>
            )}
          </TabPanel>

          <TabPanel id="survey" shouldForceMount>
            {({ isInert }) => (
              <Activity mode={isInert ? "hidden" : "visible"}>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <SurveyPointsCard
                    metadata={metadata}
                    activeCrs={activeCrs}
                    busy={busy}
                    onSolve={solve}
                    lastFitPoints={lastFitPoints}
                    currentParams={effectiveHelmertParameters}
                  />
                </div>
              </Activity>
            )}
          </TabPanel>
        </Tabs>

        <RotationCard
          parameters={effectiveHelmertParameters}
          onParametersChange={(params: HelmertParams) => {
            dispatchAnchor({ type: "paramsReplaced", params });
          }}
          metadata={metadata}
        />
      </Sidebar>

      <section className="min-w-0 flex-1">
        <MapView
          metadata={metadata}
          parameters={effectiveHelmertParameters}
          activeCrs={activeCrs}
          ifcMetresPerUnit={ifcMetresPerUnit}
          isPickingAnchor={isPickingAnchor}
          onAnchorPicked={handleAnchorPicked}
          onCancelPickAnchor={cancelPickAnchor}
          residualsPoints={lastFitPoints}
        />
      </section>
    </div>
  );
}
