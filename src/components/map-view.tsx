import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import { getIfc } from "../ifc-api";
import { transformProjectedToWgs84, type CrsDef } from "../lib/crs";
import { applyHelmert } from "../lib/helmert";
import { emitLog } from "../lib/log";
import { deriveMapReference } from "../lib/map-reference";
import type { HelmertParams, PointPair } from "../lib/helmert";
import type { IfcMetadata } from "../worker/ifc";
import { LayersPanel } from "./map/controls/layers-panel";
import { SearchBox } from "./map/controls/search-box";
import { ViewToggle, type ViewMode } from "./map/controls/view-toggle";
import { ZoomToModel } from "./map/controls/zoom-to-model";
import {
  useAnchorPicker,
  type PickedAnchor,
} from "./map/hooks/use-anchor-picker";
import {
  computeAxesGeometry,
  useAxesLayer,
} from "./map/hooks/use-axes-layer";
import { useCrsAutoZoom } from "./map/hooks/use-crs-auto-zoom";
import {
  frameCamera,
  useFootprintLayer,
} from "./map/hooks/use-footprint-layer";
import { useMapInit } from "./map/hooks/use-map-init";
import { useMapLayers } from "./map/hooks/use-map-layers";
import { useResidualsLayer } from "./map/hooks/use-residuals-layer";
import { useThreeDLayer } from "./map/hooks/use-three-d-layer";
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

export interface MapViewProps {
  /** Metadata of the loaded model — used to derive the map marker. */
  metadata: IfcMetadata;
  /** Helmert params — used to anchor the 3D model on the globe. */
  parameters: HelmertParams | null;
  /**
   * Resolved target CRS. Null while Workspace is still fetching the CRS
   * definition — children skip transforms until it's ready. Because this
   * is a CrsDef (not a raw code string), holding it implies proj4js has
   * the definition registered.
   */
  activeCrs: CrsDef | null;
  /** True while the sidebar is awaiting a map click to set the anchor. */
  isPickingAnchor: boolean;
  /** Fires once per click while `isPickingAnchor` is true. */
  onAnchorPicked: (point: PickedAnchor) => void;
  /** Fires when the user presses Escape while picking. */
  onCancelPickAnchor: () => void;
  /** Point pairs from the most recent least-squares fit; drives the
   *  fitted-dot overlay. Null when no fit has run. */
  residualsPoints: Array<PointPair> | null;
}

/**
 * Thin composition of map hooks: `useMapInit` owns the map instance + the
 * 2D/3D and Layers controls; the other hooks react to prop / UI-state
 * changes. All map-specific state (reference marker, footprint hull,
 * basemap / overlays) lives here so that parent re-renders triggered by
 * Helmert param edits don't require re-threading map data through props.
 */
export function MapView({
  metadata,
  parameters,
  activeCrs,
  isPickingAnchor,
  onAnchorPicked,
  onCancelPickAnchor,
  residualsPoints,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewMode>("2d");
  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP_ID);
  const [overlays, setOverlays] =
    useState<Record<OverlayId, boolean>>(INITIAL_OVERLAYS);

  const referencePoint = useMemo(() => {
    const result = deriveMapReference(metadata, activeCrs);

    return result.isOk() ? result.value : null;
  }, [metadata, activeCrs]);

  const [footprintLocal, setFootprintLocal] = useState<Array<{
    x: number;
    y: number;
  }> | null>(null);

  useEffect(function extractFootprint() {
    const token = { cancelled: false };
    void getIfc()
      .extractFootprint()
      .catch((error: unknown) => {
        emitLog({
          level: "error",
          message: `Footprint extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return null;
      })
      .then((hull) => {
        if (!token.cancelled) {
          setFootprintLocal(hull);
        }
      });
    return () => {
      token.cancelled = true;
    };
  }, []);

  // Project the local-coordinate footprint into WGS84 lng/lat for the map.
  // The forward Helmert + proj4 transform is cheap (≤ a few hundred hull
  // vertices), so we don't memoise the inner work — useMemo just keeps the
  // array identity stable across unrelated re-renders so the footprint
  // layer effect doesn't refire.
  const footprintLngLat = useMemo<Array<[number, number]> | null>(() => {
    if (!footprintLocal || !parameters || !activeCrs) {
      return null;
    }
    const projected: Array<[number, number]> = [];
    for (const p of footprintLocal) {
      const world = applyHelmert({ x: p.x, y: p.y, z: 0 }, parameters);

      const ll = transformProjectedToWgs84(activeCrs, world.x, world.y);

      if (ll.isErr()) {
        continue;
      }

      projected.push([ll.value.longitude, ll.value.latitude]);
    }
    return projected.length >= 3 ? projected : null;
  }, [footprintLocal, parameters, activeCrs]);

  const { mapRef, portals } = useMapInit(containerRef);
  
  const scope = useMapScope(mapRef);

  // Gate the 3D toggle: without solved Helmert params + a resolved CRS the
  // 3D layer would render a blank view, so surface the reason in the button
  // tooltip and ignore clicks. If the user is already on 3D when one of
  // these is lost, fall back to an *effective* 2D without mutating stored
  // view — so that if params come back they re-enter 3D automatically.
  const threeDDisabledReason = deriveThreeDDisabled(parameters, activeCrs);
  const effectiveView: ViewMode =
    threeDDisabledReason === null ? view : "2d";

  // "Anchor" here = anything that already tells the map where to point —
  // solved Helmert params, or an IfcSite lat/lon (the footprint hook flies to
  // those via `referencePoint`). When present, let those hooks own the
  // camera; otherwise fall back to the CRS's area of use.
  const hasAnchor = parameters != null || metadata.siteReference != null;
  const axesGeometry = useMemo(
    () => computeAxesGeometry(parameters, activeCrs),
    [parameters, activeCrs],
  );
  useCrsAutoZoom(mapRef, activeCrs, hasAnchor);
  useFootprintLayer(mapRef, referencePoint, footprintLngLat);
  useAxesLayer(mapRef, axesGeometry);
  useResidualsLayer(mapRef, residualsPoints, parameters, activeCrs);
  useThreeDLayer(mapRef, {
    view: effectiveView,
    parameters,
    activeCrs,
  });
  useMapLayers(mapRef, { basemap, overlays });
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
              onChange={setView}
            />,
            portals.viewToggle,
          )}
          {createPortal(
            <LayersPanel
              basemap={basemap}
              overlays={overlays}
              scope={scope}
              onBasemapChange={setBasemap}
              onOverlaysChange={setOverlays}
            />,
            portals.layers,
          )}
          {createPortal(<SearchBox mapRef={mapRef} />, portals.search)}
          {createPortal(
            <ZoomToModel
              isDisabled={
                footprintLngLat === null && referencePoint === null
              }
              onPress={() => {
                const map = mapRef.current;
                if (!map) {
                  return;
                }
                frameCamera(map, referencePoint, footprintLngLat, {
                  duration: 600,
                });
              }}
            />,
            portals.zoomToModel,
          )}
        </>
      )}
    </>
  );
}
