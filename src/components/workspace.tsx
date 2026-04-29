import { Activity, useEffect, useMemo, useReducer, useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { transformProjectedToWgs84 } from "../lib/crs";
import { applyHelmert, type HelmertParams } from "../lib/helmert";
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
import { MapView } from "./map-view";
import { AnchorCard } from "./sidebar/cards/anchor-card";
import { FileStatusCard } from "./sidebar/cards/file-status-card";
import { RotationCard } from "./sidebar/cards/rotation-card";
import { SaveCard } from "./sidebar/cards/save-card";
import { SurveyPointsCard } from "./sidebar/cards/survey-points-card";
import { TargetCrsCard } from "./sidebar/cards/target-crs-card";
import { Sidebar } from "./sidebar/sidebar";
import { useAnchorPick } from "./workspace/use-anchor-pick";
import { useHelmertSolve } from "./workspace/use-helmert-solve";
import { useIfcWrite } from "./workspace/use-ifc-write";
import { useTargetCrs } from "./workspace/use-target-crs";

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
  console.log("Workspace", { anchor });

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

  // Vertical datum is independent of the horizontal CRS lookup — IFC
  // stores it as a free-form IfcIdentifier, not an EPSG code, so it lives
  // here as a plain string. Initialised from the file's existing hint.
  const [verticalDatum, setVerticalDatum] = useState<string | null>(
    metadata.verticalDatumHint,
  );

  // `anchor` holds the user/solver-owned params; `rawEffectiveParameters`
  // falls back to a seed derived from IfcSite lat/lon when no anchor is
  // set yet, so downstream consumers always have something to render.
  const rawEffectiveParameters = deriveEffectiveParameters(
    anchorParams(anchor),
    activeCrs,
    metadata,
  );

  // Sanity-gate: validate that applying the helmert to localOrigin lands
  // inside the active CRS's bbox. Files with placeholder IfcMapConversion
  // values that slipped past the worker classifier (e.g. (E,N)=(0,0) plus
  // a TrueNorth-baked rotation, or non-zero values that combine with
  // localOrigin to produce projected coords near the CRS false-origin)
  // would otherwise fire a proj4js "Failed to find a grid shift table"
  // warning per footprint vertex / mesh point. One memoised pre-check
  // here costs at most one warning per (params, CRS) change and hides
  // the rest. See docs/crs-datum-grids.md.
  const effectiveHelmertParameters = useMemo<HelmertParams | null>(() => {
    if (!rawEffectiveParameters || !activeCrs) {
      return rawEffectiveParameters;
    }
    const origin = metadata.localOrigin ?? { x: 0, y: 0, z: 0 };
    const projected = applyHelmert(origin, rawEffectiveParameters);
    const wgs84 = transformProjectedToWgs84(
      activeCrs,
      projected.x,
      projected.y,
    );
    if (wgs84.isErr()) {
      return null;
    }
    return rawEffectiveParameters;
  }, [rawEffectiveParameters, activeCrs, metadata.localOrigin]);

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
    verticalDatum,
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

  // Surface unknown length units once at file load. The worker has already
  // applied a 1.0 fallback at the metadata read boundary, so downstream
  // values may be off by the unit factor — surface it so users can spot it
  // in the file-status card and the param-card readouts.
  const unitResult = unitToMetres(metadata.lengthUnit);
  useEffect(() => {
    if (unitResult.isErr()) {
      emitLog({
        level: "warn",
        message: `Unknown IFC length unit '${unitResult.error.name}' — treated as metres at the worker boundary; numeric values may be off by the unit factor`,
      });
    }
  }, [unitResult]);

  // Surface a useful log when we couldn't derive sensible Helmert params
  // — either the IfcSite reference is outside the CRS area of use, or the
  // file's IfcMapConversion is a placeholder that lands geometry at the
  // projected CRS's false origin. Without this log, the anchor card just
  // stays empty and the user has no idea why their file doesn't auto-place.
  // Fires once per (file, CRS) combination via React's effect deps.
  useEffect(() => {
    if (
      activeCrs
      && rawEffectiveParameters !== null
      && effectiveHelmertParameters === null
    ) {
      // Helmert was non-null but didn't land in the CRS bbox — placeholder.
      emitLog({
        level: "warn",
        message:
          `Existing IfcMapConversion places geometry outside the area of `
          + `use for EPSG:${activeCrs.code}`
          + (activeCrs.areaOfUse ? ` (${activeCrs.areaOfUse})` : "")
          + ` — likely a placeholder transform. Use the Survey points tab `
          + `to anchor manually, or switch CRS.`,
      });
    } else if (
      activeCrs
      && metadata.siteReference
      && !metadata.existingGeoref
      && effectiveHelmertParameters === null
    ) {
      // Fell through to siteReference seed but it was rejected.
      const { latitude, longitude } = metadata.siteReference;
      emitLog({
        level: "warn",
        message:
          `IfcSite reference (${longitude.toFixed(4)}°E, ${latitude.toFixed(4)}°N) `
          + `is outside the area of use for EPSG:${activeCrs.code}`
          + (activeCrs.areaOfUse ? ` (${activeCrs.areaOfUse})` : "")
          + ". Pick a different CRS, or use the Survey points tab to enter "
          + "a known point manually.",
      });
    }
  }, [
    activeCrs,
    metadata.siteReference,
    metadata.existingGeoref,
    rawEffectiveParameters,
    effectiveHelmertParameters,
  ]);

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar
        saveCard={
          <SaveCard
            filename={filename}
            busy={busy}
            canWrite={
              effectiveHelmertParameters !== null
              && (activeCrs?.accuracy.kind !== "degraded-override-failed")
            }
            blockedReason={
              activeCrs?.accuracy.kind === "degraded-override-failed"
                ? `Save blocked: precision grid for EPSG:${activeCrs.code} failed to load. Retry from the CRS card.`
                : null
            }
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
          verticalDatum={verticalDatum}
          onVerticalDatumChange={setVerticalDatum}
          verticalDatumFromFile={metadata.verticalDatumHint !== null}
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
                    pickBlockedReason={
                      activeCrs?.accuracy.kind === "degraded-override-failed"
                        ? "Pick disabled: precision grid for this CRS isn't loaded — clicking would record a ~170 m–wrong survey point. Retry from the CRS card."
                        : null
                    }
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
          isPickingAnchor={isPickingAnchor}
          onAnchorPicked={handleAnchorPicked}
          onCancelPickAnchor={cancelPickAnchor}
          residualsPoints={lastFitPoints}
        />
      </section>
    </div>
  );
}
