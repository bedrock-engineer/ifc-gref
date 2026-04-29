import { type Map as MlMap } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import { getIfc } from "../../../ifc-api";
import type { CrsDef } from "../../../lib/crs";
import type { HelmertParams } from "../../../lib/helmert";
import type { IfcFacade } from "../../../lib/ifc-facade";
import { emitLog } from "../../../lib/log";
import type { ThreeDLayer } from "../../three-d-layer";
import { applyAnchor } from "../apply-anchor";
import type { ViewMode } from "../controls/view-toggle";

interface ThreeDState {
  view: ViewMode;
  parameters: HelmertParams | null;
  activeCrs: CrsDef | null;
}

interface MeshOrigin {
  x: number;
  y: number;
  z: number;
}
type Meshes = Awaited<ReturnType<IfcFacade["extractMeshes"]>>;

/**
 * 3D layer lifecycle: add the Three.js IFC layer when view === "3d",
 * anchor it (and re-anchor on param/CRS changes), tear it down when
 * leaving 3D. Three.js is dynamically imported so it stays out of the
 * initial bundle.
 */
export function useThreeDLayer(
  mapRef: RefObject<MlMap | null>,
  { view, parameters, activeCrs }: ThreeDState,
): void {
  const threeDRef = useRef<ThreeDLayer | null>(null);
  const meshOriginRef = useRef<MeshOrigin | null>(null);
  // Cache meshes so toggling back to 3D doesn't re-fetch. The ref resets
  // naturally when Workspace remounts on file change (key={filename}).
  const meshCacheRef = useRef<Promise<Meshes> | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (view !== "3d") {
      teardown(map, threeDRef, meshOriginRef);
      return;
    }

    // MapView disables the 3D toggle when these are missing, so reaching
    // 3D without them is only possible in a transient render — no-op.
    if (!parameters || !activeCrs) {
      return;
    }

    let cancelled = false;
    setup(map, {
      parameters,
      activeCrs,
      threeDRef,
      meshOriginRef,
      meshCacheRef,
      isCancelled: () => cancelled,
    }).catch((error: unknown) => {
      emitLog({
        level: "error",
        message: `3D layer setup failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [mapRef, view, parameters, activeCrs]);
}

function teardown(
  map: MlMap,
  threeDRef: RefObject<ThreeDLayer | null>,
  meshOriginRef: RefObject<MeshOrigin | null>,
): void {
  map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
  const threeD = threeDRef.current;
  if (!threeD) {
    return;
  }
  if (map.getLayer(threeD.layer.id)) {
    map.removeLayer(threeD.layer.id);
  }
  threeD.dispose();
  threeDRef.current = null;
  meshOriginRef.current = null;
}

async function setup(
  map: MlMap,
  context: {
    parameters: HelmertParams;
    activeCrs: CrsDef;
    threeDRef: RefObject<ThreeDLayer | null>;
    meshOriginRef: RefObject<MeshOrigin | null>;
    meshCacheRef: RefObject<Promise<Meshes> | null>;
    isCancelled: () => boolean;
  },
): Promise<void> {
  // Lazy-load three.js + our threeDLayer module. Vite code-splits this.
  const { createThreeDLayer } = await import("../../three-d-layer");
  if (context.isCancelled()) {
    return;
  }

  // Fetch (or reuse cached) meshes from the facade.
  const cached = context.meshCacheRef.current;
  const promise = cached ?? getIfc().extractMeshes();
  context.meshCacheRef.current = promise;
  const meshes = await promise;
  if (context.isCancelled()) {
    return;
  }

  // Create the layer once per 3D session; param changes only re-anchor.
  if (!context.threeDRef.current) {
    const layer = createThreeDLayer();
    context.threeDRef.current = layer;
    context.meshOriginRef.current = layer.setMeshes(meshes);
    if (!map.getLayer(layer.layer.id)) {
      map.addLayer(layer.layer);
    }
  }

  const meshOrigin = context.meshOriginRef.current;
  if (!meshOrigin) {
    emitLog({
      level: "warn",
      message: "No mesh geometry available — nothing to anchor in 3D view.",
    });
    return;
  }
  applyAnchor(
    context.threeDRef.current,
    context.parameters,
    context.activeCrs,
    map,
    meshOrigin,
  );
}
