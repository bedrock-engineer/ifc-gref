import {
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { useStickyState } from "../hooks/use-sticky-state";
import { createPortal } from "react-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import { type CrsDef } from "#modules/crs";
import type { MapOverlaySignals } from "#state/georef-status/types";
import type { HelmertParams, PointPair } from "#modules/helmert/solve";
import { LayersPanel } from "./map/controls/layers-panel";
import { SearchBox } from "./map/controls/search-box";
import { ViewToggle, type ViewMode } from "./map/controls/view-toggle";
import { ZoomToModel } from "./map/controls/zoom-to-model";
import {
  useAnchorPicker,
  type PickedAnchor,
} from "./map/hooks/use-anchor-picker";
import { computeAxesGeometry, useAxesLayer } from "./map/hooks/use-axes-layer";
import { useCrsAutoZoom } from "./map/hooks/use-crs-auto-zoom";
import { frameCamera, useMapOverlays } from "./map/hooks/use-map-overlays";
import { useMapInit } from "./map/hooks/use-map-init";
import { useMapLayers } from "./map/hooks/use-map-layers";
import { useResidualsLayer } from "./map/hooks/use-residuals-layer";
import { useThreeDLayer } from "./map/hooks/use-three-d-layer";
import {
  type CustomBasemap,
  CustomBasemapsSchema,
  CUSTOM_BASEMAPS_STORAGE_KEY,
} from "./map/layers/custom-basemap";
import {
  DEFAULT_BASEMAP_ID,
  INITIAL_OVERLAYS,
  type BasemapId,
  type OverlayId,
} from "./map/layers/registry";
import { useMapScope } from "./map/controls/use-scope";

function deriveThreeDDisabled(
  parameters: HelmertParams | null,
  activeCrs: CrsDef | null,
): string | null {
  if (parameters === null) {
    return "Set a target CRS and solve / pick an anchor to enable 3D.";
  }
  if (activeCrs === null) {
    return "Waiting for target CRS to resolve…";
  }
  return null;
}

/**
 * Imperative API exposed via `ref`. Workspace calls these from event
 * handlers (solve, pick, reset, reproject, sidecar apply) — keeping
 * camera framing event-shaped instead of an effect that watches state
 * and recovers "did the user just do something" via provenance bails.
 *
 * `frameToContent` is a no-op when 3D is the active view; 3D's own
 * `applyAnchor.flyTo` already follows the anchor on every params change.
 */
export interface MapViewHandle {
  frameToContent: (signals: MapOverlaySignals) => void;
}

function useCustomBasemaps() {
  const [customBasemaps, setCustomBasemaps] = useStickyState<
    Array<CustomBasemap>
  >(CUSTOM_BASEMAPS_STORAGE_KEY, [], { schema: CustomBasemapsSchema });

  function handleAddCustomBasemap(b: CustomBasemap) {
    setCustomBasemaps((previous) => [...previous, b]);
    setBasemap(b.id);
  }

  function handleRemoveCustomBasemap(id: string) {
    setCustomBasemaps((previous) => previous.filter((b) => b.id !== id));
    setBasemap((current) => (current === id ? DEFAULT_BASEMAP_ID : current));
  }

  return { customBasemaps, handleAddCustomBasemap, handleRemoveCustomBasemap };
}

export interface MapViewProps {
  /** Helmert params — used to anchor the 3D model on the globe. */
  parameters: HelmertParams | null;
  /**
   * Resolved target CRS. Null while Workspace is still fetching the CRS
   * definition — children skip transforms until it's ready. Because this
   * is a CrsDef (not a raw code string), holding it implies proj4js has
   * the definition registered.
   */
  activeCrs: CrsDef | null;
  /**
   * 2D map overlay signals — markers, footprint hull, and the camera
   * framing target. Derived in Workspace so the imperative
   * `frameToContent` API can also be called with synchronously-computed
   * "next" signals from new params (without waiting for React to
   * commit the dispatch that would re-derive them).
   */
  overlaySignals: MapOverlaySignals;
  /** True while the sidebar is awaiting a map click to set the anchor. */
  isPickingAnchor: boolean;
  /** Fires once per click while `isPickingAnchor` is true. */
  onAnchorPicked: (point: PickedAnchor) => void;
  /** Fires when the user presses Escape while picking. */
  onCancelPickAnchor: () => void;
  /** Point pairs from the most recent least-squares fit; drives the
   *  fitted-dot overlay. Null when no fit has run. */
  residualsPoints: Array<PointPair> | null;
  /** Imperative handle for parent-driven framing. */
  ref?: Ref<MapViewHandle>;
}

/**
 * Thin composition of map hooks: `useMapInit` owns the map instance + the
 * 2D/3D and Layers controls; the other hooks react to prop / UI-state
 * changes. All map-specific state (reference marker, footprint hull,
 * basemap / overlays) lives here so that parent re-renders triggered by
 * Helmert param edits don't require re-threading map data through props.
 */
export function MapView({
  parameters,
  activeCrs,
  overlaySignals,
  isPickingAnchor,
  onAnchorPicked,
  onCancelPickAnchor,
  residualsPoints,
  ref,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewMode>("2d");
  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP_ID);
  const [overlays, setOverlays] =
    useState<Record<OverlayId, boolean>>(INITIAL_OVERLAYS);

  const { mapRef, portals } = useMapInit(containerRef);

  const scope = useMapScope(mapRef);

  const { customBasemaps, handleAddCustomBasemap, handleRemoveCustomBasemap } =
    useCustomBasemaps();

  // Gate the 3D toggle: without solved Helmert params + a resolved CRS the
  // 3D layer would render a blank view, so surface the reason in the button
  // tooltip and ignore clicks. If the user is already on 3D when one of
  // these is lost, fall back to an *effective* 2D without mutating stored
  // view — so that if params come back they re-enter 3D automatically.
  const threeDDisabledReason = deriveThreeDDisabled(parameters, activeCrs);
  const effectiveView: ViewMode = threeDDisabledReason === null ? view : "2d";

  // "Anchor" = anything the overlay hook can frame to. We use the *filtered*
  // siteReference (null when outside the active CRS bbox) so an out-of-bbox
  // IfcSite doesn't suppress the CRS-area auto-zoom — there'd be nothing on
  // the map to look at otherwise.
  const hasAnchor = parameters != null || overlaySignals.siteReference != null;
  const axesGeometry = useMemo(
    () => computeAxesGeometry(parameters, activeCrs),
    [parameters, activeCrs],
  );
  useCrsAutoZoom(mapRef, activeCrs, hasAnchor);
  useMapOverlays(mapRef, overlaySignals);

  // Imperative camera framing — driven by Workspace event handlers
  // (solve, pick, reset, reproject, sidecar apply) plus its own
  // first-appearance and footprint-promotion effects. 3D bails because
  // `applyAnchor.flyTo` already moves the camera on every params change.
  useImperativeHandle(
    ref,
    () => ({
      frameToContent(signals) {
        if (effectiveView !== "2d") {
          return;
        }
        const map = mapRef.current;
        if (!map) {
          return;
        }
        frameCamera(map, signals, { duration: 600 });
      },
    }),
    [effectiveView, mapRef],
  );

  useAxesLayer(mapRef, axesGeometry);
  useResidualsLayer(mapRef, residualsPoints, parameters, activeCrs);
  useThreeDLayer(mapRef, {
    view: effectiveView,
    parameters,
    activeCrs,
  });
  useMapLayers(mapRef, { basemap, overlays, customBasemaps });
  useAnchorPicker(mapRef, isPickingAnchor, onAnchorPicked, onCancelPickAnchor);

  return (
    <>
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
      {portals && (
        <>
          {createPortal(
            <ViewToggle
              view={effectiveView}
              disabledReason={threeDDisabledReason}
              onChange={(next) => {
                setView(next);
                // 3D's `applyAnchor.flyTo` may have moved the camera while
                // 2D was hidden; reframe to current overlays on return.
                if (next === "2d") {
                  const map = mapRef.current;
                  if (map) {
                    frameCamera(map, overlaySignals, { duration: 600 });
                  }
                }
              }}
            />,
            portals.viewToggle,
          )}

          {createPortal(
            <LayersPanel
              basemap={basemap}
              overlays={overlays}
              customBasemaps={customBasemaps}
              scope={scope}
              onBasemapChange={setBasemap}
              onOverlaysChange={setOverlays}
              onAddCustomBasemap={handleAddCustomBasemap}
              onRemoveCustomBasemap={handleRemoveCustomBasemap}
            />,
            portals.layers,
          )}

          {createPortal(<SearchBox mapRef={mapRef} />, portals.search)}

          {createPortal(
            <ZoomToModel
              isDisabled={
                overlaySignals.footprint === null &&
                overlaySignals.mapConversion === null &&
                overlaySignals.siteReference === null
              }
              onPress={() => {
                const map = mapRef.current;
                if (!map) {
                  return;
                }
                frameCamera(map, overlaySignals, { duration: 600 });
              }}
            />,
            portals.zoomToModel,
          )}
        </>
      )}
    </>
  );
}
