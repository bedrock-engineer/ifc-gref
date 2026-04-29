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
): void {
  // Both meshOrigin (web-ifc auto-converts to metres) and parameters
  // (canonical metres — see lib/helmert.ts) are in metres, so applyHelmert
  // can be called directly. Output is metres in the CRS frame; the proj4
  // boundary converts to CRS-native units internally.
  const projected = applyHelmert(meshOrigin, parameters);
  const result = transformProjectedToWgs84(
    activeCrs,
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
  // MapLibre's MercatorCoordinate altitude is absolute (above the
  // ellipsoid, NOT relative to terrain), and our basemap renders with
  // Mapterhorn terrain on — so the camera target follows terrain
  // elevation. For an elevated site (e.g. Madrid ~650m), passing
  // altitude=meshOrigin.z (≈1.5m) puts the model below the terrain mesh
  // and the depth test culls it.
  //
  // When the file carries OrthogonalHeight (parameters.height ≠ 0) we
  // trust it as the absolute height in the target CRS's vertical datum.
  // When it doesn't (IfcSite-only mode), fall back to a Mapterhorn
  // sample at the anchor — for *render altitude only*, never written
  // back into parameters.height. Vertical datums vary across Mapterhorn
  // sources, so this isn't authoritative for georeferencing accuracy,
  // but it's enough to land the model on terrain visually so the user
  // can verify horizontal placement; they can then refine
  // OrthogonalHeight by hand in the anchor card.
  const baseAltitude =
    parameters.height === 0
      ? (map.queryTerrainElevation([ll.longitude, ll.latitude]) ?? 0)
      : parameters.height;
  const absoluteAltitude = baseAltitude + meshOrigin.z;
  layer.update(
    { lng: ll.longitude, lat: ll.latitude, altitude: absoluteAltitude },
    parameters,
  );
  map.flyTo({
    center: [ll.longitude, ll.latitude],
    zoom: Math.max(map.getZoom(), 17),
    pitch: 60,
    duration: 500,
  });
  const altitudeSource = parameters.height === 0 ? "terrain" : "OrthogonalHeight";
  emitLog({
    message: `3D model anchored at ${ll.longitude.toFixed(6)}, ${ll.latitude.toFixed(6)} (alt=${absoluteAltitude.toFixed(2)}m via ${altitudeSource}, scale=${parameters.scale.toFixed(4)}, rot=${parameters.rotation.toFixed(4)} rad, meshOrigin=(${meshOrigin.x.toFixed(2)}, ${meshOrigin.y.toFixed(2)}, ${meshOrigin.z.toFixed(2)}))`,
  });
}
