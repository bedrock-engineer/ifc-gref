import type { Map as MlMap } from "maplibre-gl";
import { transformProjectedToWgs84, type CrsDef } from "../../lib/crs";
import { applyHelmert } from "../../lib/helmert";
import type { HelmertParams, XYZ } from "../../lib/helmert";
import { emitLog } from "../../lib/log";
import type { ThreeDLayer } from "../three-d-layer";

/**
 * Project the mesh centroid through the Helmert transform + proj4 to get the
 * WGS84 anchor, then push it into the 3D layer. Anchoring at the centroid
 * (rather than the IFC local origin) is load-bearing: Dutch AEC exports often
 * bake RD coordinates into the local frame, so local (0,0,0) can project to
 * somewhere hundreds of km from the actual building.
 *
 * Also flies the camera to the anchor — on the initial placement the 2D
 * `fitBounds` can leave the map far from where the 3D model will render.
 */
export function applyAnchor(
  layer: ThreeDLayer,
  parameters: HelmertParams,
  activeCrs: CrsDef,
  map: MlMap,
  meshOrigin: XYZ,
  ifcMetresPerUnit: number,
): void {
  const projected = applyHelmert(meshOrigin, parameters);
  const result = transformProjectedToWgs84(
    activeCrs.code,
    projected.x,
    projected.y,
  );
  if (result.isErr()) {
    emitLog({
      level: "error",
      message: `Anchor placement failed: ${
        result.error.cause instanceof Error
          ? result.error.cause.message
          : String(result.error.cause)
      }`,
    });
    return;
  }
  const ll = result.value;
  // Altitude we hand to the 3D layer is in METRES relative to the basemap
  // surface, not sea level. MapLibre's camera at zoom 17+ sits only ~100m
  // above the ground in world-space, so feeding it the absolute
  // OrthogonalHeight (e.g. 293m for Luxembourg) puts the model behind the
  // near plane. The Helmert height component fixes *horizontal* placement
  // via the XY projection; vertically we just want the mesh centroid's
  // offset above the IFC z=0 plane, converted from IFC units to metres —
  // *not* via Helmert.scale, because scale maps IFC units → CRS map units
  // (e.g. US feet) which would feed feet into MapLibre's metres-expecting
  // altitude for a foot-based CRS.
  const relativeAltitude = meshOrigin.z * ifcMetresPerUnit;
  layer.update(
    { lng: ll.longitude, lat: ll.latitude, altitude: relativeAltitude },
    parameters,
  );
  map.flyTo({
    center: [ll.longitude, ll.latitude],
    zoom: Math.max(map.getZoom(), 17),
    pitch: 60,
    duration: 500,
  });
  emitLog({
    message: `3D model anchored at ${ll.longitude.toFixed(6)}, ${ll.latitude.toFixed(6)} (alt=${relativeAltitude.toFixed(2)}m, scale=${parameters.scale.toFixed(4)}, rot=${parameters.rotation.toFixed(4)} rad, meshOrigin=(${meshOrigin.x.toFixed(2)}, ${meshOrigin.y.toFixed(2)}, ${meshOrigin.z.toFixed(2)}))`,
  });
}
