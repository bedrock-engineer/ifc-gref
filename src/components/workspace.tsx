import {
  Activity,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { projectLocalToWgs84 } from "#modules/crs";
import { type HelmertParams } from "#modules/helmert/solve";
import { emitLog } from "../lib/log";
import {
  buildSidecar,
  localOriginsEqual,
  parseSidecar,
  sidecarFilenameFor,
  sidecarToParams,
  type SidecarError,
} from "../lib/ifcgref-sidecar";
import { unitToMetres } from "#modules/units/convert";
import {
  anchorParams,
  anchorProvenance,
  deriveEffectiveParameters,
  detectBakedProjectedOrigin,
  initialAnchor,
  makeAnchorReducer,
} from "#state/workspace";
import type { IfcMetadata } from "#modules/ifc/worker";
import { deriveMapReferences } from "./map/derive-references";
import { MapView } from "./map-view";
import { AnchorCard } from "./sidebar/cards/anchor-card";
import { RotationCard } from "./sidebar/cards/rotation-card";
import { SaveCard } from "./sidebar/cards/save-card";
import { SourceCard } from "./sidebar/cards/source-card";
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

  function reportError(message: string) {
    emitLog({ level: "error", message });
    onError(message);
  }

  const { epsgCode, crsState, activeCrs, changeEpsg, replaceEpsg } =
    useTargetCrs({
      metadata,
      currentParams: anchorParams(anchor),
      onReproject: (params) => {
        dispatchAnchor({ type: "paramsReplaced", params });
      },
      onError: reportError,
    });

  // Vertical datum is independent of the horizontal CRS lookup. IFC
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
    const wgs84 = projectLocalToWgs84(
      origin,
      rawEffectiveParameters,
      activeCrs,
    );
    return wgs84.isOk() ? rawEffectiveParameters : null;
  }, [rawEffectiveParameters, activeCrs, metadata.localOrigin]);

  const effectiveAnchorProvenance = anchorProvenance(
    anchor,
    effectiveHelmertParameters !== null,
  );

  const references = useMemo(
    () => deriveMapReferences(metadata, effectiveHelmertParameters, activeCrs),
    [metadata, effectiveHelmertParameters, activeCrs],
  );

  // The map silently drops the marker (the value is unusable as a
  // projected anchor); the log entry plus the inline sidebar badge make
  // sure the user finds out.
  const previousSiteOutsideBboxRef = useRef(false);
  useEffect(
    function warnOnceIfSiteOutsideCrsBbox() {
      const site = metadata.siteReference;
      if (
        references.siteOutsideBbox &&
        !previousSiteOutsideBboxRef.current &&
        site
      ) {
        const where = activeCrs ? `EPSG:${activeCrs.code}` : "the active CRS";
        emitLog({
          level: "warn",
          message: `IfcSite RefLat/RefLon (${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}) is outside ${where} area of use — not shown on map.`,
        });
      }
      previousSiteOutsideBboxRef.current = references.siteOutsideBbox;
    },
    [references.siteOutsideBbox, metadata.siteReference, activeCrs],
  );

  const { solve, lastFitPoints } = useHelmertSolve({
    metadata,
    activeCrs,
    onSolved: (params) => {
      dispatchAnchor({ type: "solved", params });
    },
    onError: reportError,
  });

  const { busy, write } = useIfcWrite({
    filename,
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

  // The worker has already applied a 1.0 fallback at the metadata read
  // boundary, so downstream values may be off by the unit factor — surface
  // it so users can spot it in the file-status card and param readouts.
  const unitResult = unitToMetres(metadata.lengthUnit);
  useEffect(
    function warnIfLengthUnitUnknown() {
      if (unitResult.isErr()) {
        emitLog({
          level: "warn",
          message: `Unknown IFC length unit '${unitResult.error.name}' — treated as metres at the worker boundary; numeric values may be off by the unit factor`,
        });
      }
    },
    [unitResult],
  );

  // The buildingSMART guide §3.3 explicitly warns against baking projected
  // coords into IfcSite.ObjectPlacement instead of using IfcMapConversion.
  // Pick-on-map and the bbox sanity gate both fail in this case because
  // the local origin is metres-far from the geometry; tell the user *why*
  // so they can re-author the file rather than fight the UI.
  const bakedProjectedOrigin = detectBakedProjectedOrigin(metadata);
  useEffect(
    function warnIfProjectedOriginBakedIntoSite() {
      if (!bakedProjectedOrigin) {
        return;
      }
      const { x, y, z } = bakedProjectedOrigin;
      emitLog({
        level: "warn",
        message:
          `IfcSite.ObjectPlacement at (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(1)}) ` +
          `looks like baked-in projected coordinates. Per buildingSMART's ` +
          `"User Guide for Geo-referencing in IFC" §3.3, the offset belongs ` +
          `in IfcMapConversion (IFC4) or ePSet_MapConversion (IFC2X3), not ` +
          `in IfcSite.ObjectPlacement.`,
      });
    },
    [bakedProjectedOrigin],
  );

  // Two failure modes: IfcSite reference outside the CRS area of use, or
  // a placeholder IfcMapConversion that lands geometry at the projected
  // CRS's false origin. Skipped when we already warned about baked-in
  // coords above (that's the underlying cause and the message would be
  // misleading).
  useEffect(
    function warnIfHelmertOutsideAreaOfUse() {
      if (bakedProjectedOrigin) {
        return;
      }
      const isOutsideOfCrs =
        activeCrs &&
        rawEffectiveParameters !== null &&
        effectiveHelmertParameters === null;

      if (isOutsideOfCrs) {
        const source = metadata.existingGeoref
          ? "Existing IfcMapConversion"
          : "Anchor parameters";
        emitLog({
          level: "warn",
          message:
            `${source} places geometry outside the area of ` +
            `use for EPSG:${activeCrs.code}` +
            (activeCrs.areaOfUse ? ` (${activeCrs.areaOfUse})` : "") +
            ` — likely a placeholder transform. Use the Survey points tab ` +
            `to anchor manually, or switch CRS.`,
        });
      } else if (
        activeCrs &&
        metadata.siteReference &&
        !metadata.existingGeoref &&
        effectiveHelmertParameters === null
      ) {
        // Fell through to siteReference seed but it was rejected.
        const { latitude, longitude } = metadata.siteReference;
        emitLog({
          level: "warn",
          message:
            `IfcSite reference (${longitude.toFixed(4)}°E, ${latitude.toFixed(4)}°N) ` +
            `is outside the area of use for EPSG:${activeCrs.code}` +
            (activeCrs.areaOfUse ? ` (${activeCrs.areaOfUse})` : "") +
            ". Pick a different CRS, or use the Survey points tab to enter " +
            "a known point manually.",
        });
      }
    },
    [
      activeCrs,
      metadata.siteReference,
      metadata.existingGeoref,
      rawEffectiveParameters,
      effectiveHelmertParameters,
      bakedProjectedOrigin,
    ],
  );

  function handleDownloadSidecar() {
    if (!effectiveHelmertParameters || !activeCrs) {
      return;
    }
    const sidecar = buildSidecar({
      filename,
      schema: metadata.schema,
      localOrigin: metadata.localOrigin,
      activeCrs,
      verticalDatum,
      parameters: effectiveHelmertParameters,
    });
    const json = JSON.stringify(sidecar, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sidecarFilenameFor(filename);
    anchor.click();
    URL.revokeObjectURL(url);
    emitLog({
      message:
        `Exported .ifcgref.json sidecar (EPSG:${activeCrs.code}` +
        (verticalDatum ? `, vertical=${verticalDatum}` : "") +
        ")",
    });
  }

  async function handleApplySidecar(file: File) {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      reportError(`Couldn't read sidecar file: ${String(error)}`);
      return;
    }
    const parsed = parseSidecar(text);
    if (parsed.isErr()) {
      reportError(sidecarErrorMessage(parsed.error));
      return;
    }
    const sidecar = parsed.value;
    const params = sidecarToParams(sidecar);
    const originsMatch = localOriginsEqual(
      sidecar.source.localOrigin,
      metadata.localOrigin,
    );
    replaceEpsg(String(sidecar.projectedCrs.epsg));
    setVerticalDatum(sidecar.projectedCrs.verticalDatum);
    dispatchAnchor({ type: "edited", params });
    emitLog({
      level: originsMatch ? "info" : "warn",
      message:
        `Applied .ifcgref.json from "${sidecar.source.filename}" ` +
        `(EPSG:${sidecar.projectedCrs.epsg}, exported ${sidecar.exportedAt})` +
        (originsMatch
          ? ""
          : " — source localOrigin differs from this file; verify placement"),
    });
  }

  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar
        saveCard={
          <SaveCard
            busy={busy}
            canWrite={
              effectiveHelmertParameters !== null &&
              activeCrs?.accuracy.kind !== "degraded-override-failed"
            }
            blockedReason={
              activeCrs?.accuracy.kind === "degraded-override-failed"
                ? `Save blocked: precision grid for EPSG:${activeCrs.code} failed to load. Retry from the CRS card.`
                : null
            }
            onWrite={write}
          />
        }
      >
        <SourceCard
          filename={filename}
          metadata={metadata}
          siteOutsideBbox={references.siteOutsideBbox}
          activeCrsCode={activeCrs?.code ?? null}
        />

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
          onApplySidecar={(file) => {
            void handleApplySidecar(file);
          }}
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
                      bakedProjectedOrigin
                        ? "Pick disabled: this file bakes projected coordinates into IfcSite.ObjectPlacement instead of using IfcMapConversion (see diagnostics). Re-author the file with a small local origin to enable picking."
                        : !activeCrs
                          ? "Set a target CRS before picking an anchor."
                          : activeCrs.accuracy.kind ===
                              "degraded-override-failed"
                            ? "Pick disabled: precision grid for this CRS isn't loaded — clicking would record a ~170 m–wrong survey point. Retry from the CRS card."
                            : null
                    }
                    canDownloadSidecar={
                      effectiveHelmertParameters !== null && activeCrs !== null
                    }
                    onEdit={(params) => {
                      dispatchAnchor({ type: "edited", params });
                    }}
                    onStartPick={startPickAnchor}
                    onCancelPick={cancelPickAnchor}
                    onResetToFile={() => {
                      dispatchAnchor({ type: "resetToFile" });
                    }}
                    onDownloadSidecar={handleDownloadSidecar}
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
          provenance={effectiveAnchorProvenance}
          onParametersChange={(params: HelmertParams) => {
            dispatchAnchor({ type: "edited", params });
          }}
          metadata={metadata}
        />
      </Sidebar>

      <section className="min-w-0 flex-1">
        <MapView
          parameters={effectiveHelmertParameters}
          activeCrs={activeCrs}
          references={references}
          isPickingAnchor={isPickingAnchor}
          onAnchorPicked={handleAnchorPicked}
          onCancelPickAnchor={cancelPickAnchor}
          residualsPoints={lastFitPoints}
          anchorProvenance={effectiveAnchorProvenance}
        />
      </section>
    </div>
  );
}

function sidecarErrorMessage(error: SidecarError): string {
  switch (error.kind) {
    case "invalid-json": {
      return "Sidecar file isn't valid JSON.";
    }
    case "wrong-app": {
      return `Sidecar was written by "${error.got}", not ifcgref — refusing to apply.`;
    }
    case "unsupported-version": {
      return `Sidecar formatVersion ${String(error.got)} isn't supported by this build of ifcgref.`;
    }
    case "schema-mismatch": {
      return "Sidecar JSON shape doesn't match the expected schema.";
    }
  }
}
