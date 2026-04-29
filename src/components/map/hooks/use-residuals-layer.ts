import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import { type CrsDef, transformProjectedToWgs84 } from "../../../lib/crs";
import {
  applyHelmert,
  type HelmertParams,
  type PointPair,
} from "../../../lib/helmert";
import { RESIDUAL_FIT_COLOR, RESIDUALS_FIT_LAYER_ID, RESIDUALS_SOURCE_ID } from "../style";

/**
 * Draws a teal dot at each control point's *fitted* position — where the
 * Helmert transform places it after solving. Lets the user visually verify
 * that the dots land on the real-world features (corner pins, lot
 * monuments) in the aerial basemap. Each dot is paired with a small
 * number badge (HTML marker) matching the row index in the residuals
 * table, so dots on the map can be traced back to the input points.
 * Residual magnitudes are shown numerically in the sidebar table; no
 * on-map exaggeration.
 */
export function useResidualsLayer(
  mapRef: RefObject<MlMap | null>,
  points: Array<PointPair> | null,
  params: HelmertParams | null,
  activeCrs: CrsDef | null,
): void {
  const markersRef = useRef<Array<Marker>>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const data = buildFeatureCollection(points, params, activeCrs);

    const apply = () => {
      syncResidualSource(map, data);
      syncNumberMarkers(map, markersRef, data);
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    // `isStyleLoaded()` can stay false for long stretches when terrain
    // or tiles are mid-fetch, and `styledata` events during that window
    // keep reporting `false`. `idle` fires once the map has fully
    // settled — a strong guarantee that addSource/addLayer will succeed.
    const onIdle = () => {
      map.off("idle", onIdle);
      apply();
    };
    map.on("idle", onIdle);
    return () => {
      map.off("idle", onIdle);
    };
  }, [mapRef, points, params, activeCrs]);

  useEffect(() => {
    const ref = markersRef;
    return () => {
      for (const marker of ref.current) {
        marker.remove();
      }
      ref.current = [];
    };
  }, []);
}

type LonLat = [lon: number, lat: number];

interface ResidualFeatureProperties {
  pointIndex: number;
  magnitudeXY: number;
}

function buildFeatureCollection(
  points: Array<PointPair> | null,
  params: HelmertParams | null,
  activeCrs: CrsDef | null,
): GeoJSON.FeatureCollection<
  GeoJSON.Point,
  ResidualFeatureProperties
> | null {
  if (!points || points.length === 0 || !params || !activeCrs) {
    return null;
  }

  const features: Array<
    GeoJSON.Feature<GeoJSON.Point, ResidualFeatureProperties>
  > = [];

  for (const [index, point] of points.entries()) {
    const fittedCrs = applyHelmert(point.local, params);
    const dx = point.target.x - fittedCrs.x;
    const dy = point.target.y - fittedCrs.y;
    const magnitudeXY = Math.hypot(dx, dy);

    const fittedWgs = transformProjectedToWgs84(
      activeCrs,
      fittedCrs.x,
      fittedCrs.y,
    );

    if (fittedWgs.isErr()) {
      continue;
    }

    const fittedLngLat: LonLat = [
      fittedWgs.value.longitude,
      fittedWgs.value.latitude,
    ];

    features.push({
      type: "Feature",
      properties: { pointIndex: index, magnitudeXY },
      geometry: { type: "Point", coordinates: fittedLngLat },
    });
  }

  return { type: "FeatureCollection", features };
}

function syncResidualSource(
  map: MlMap,
  data: GeoJSON.FeatureCollection<
    GeoJSON.Point,
    ResidualFeatureProperties
  > | null,
): void {
  const existing = map.getSource<maplibregl.GeoJSONSource>(RESIDUALS_SOURCE_ID);

  if (!data) {
    if (map.getLayer(RESIDUALS_FIT_LAYER_ID)) {
      map.removeLayer(RESIDUALS_FIT_LAYER_ID);
    }
    if (existing) {
      map.removeSource(RESIDUALS_SOURCE_ID);
    }
    return;
  }

  if (existing) {
    existing.setData(data);
    return;
  }

  map.addSource(RESIDUALS_SOURCE_ID, { type: "geojson", data });

  map.addLayer({
    id: RESIDUALS_FIT_LAYER_ID,
    type: "circle",
    source: RESIDUALS_SOURCE_ID,
    paint: {
      "circle-radius": 4,
      "circle-color": RESIDUAL_FIT_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });
}

function syncNumberMarkers(
  map: MlMap,
  markersRef: RefObject<Array<Marker>>,
  data: GeoJSON.FeatureCollection<
    GeoJSON.Point,
    ResidualFeatureProperties
  > | null,
): void {
  const markers = markersRef.current;
  const features = data?.features ?? [];

  while (markers.length > features.length) {
    markers.pop()?.remove();
  }

  for (const [index, feature] of features.entries()) {
    const [lng, lat] = feature.geometry.coordinates;
    if (lng === undefined || lat === undefined) {
      continue;
    }
    const lngLat: LonLat = [lng, lat];
    const label = `${feature.properties.pointIndex + 1}`;
    const existing = markers[index];

    if (existing) {
      const element = existing.getElement();
      if (element.textContent !== label) {
        element.textContent = label;
      }
      existing.setLngLat(lngLat);
      continue;
    }

    markers.push(createNumberMarker(map, label, lngLat));
  }
}

function createNumberMarker(
  map: MlMap,
  label: string,
  lngLat: LonLat,
): Marker {
  const element = document.createElement("div");
  element.textContent = label;
  element.style.cssText = [
    "font: 600 10px/1 system-ui, sans-serif",
    `color: ${RESIDUAL_FIT_COLOR}`,
    "background: rgba(255,255,255,0.95)",
    "padding: 2px 5px",
    "border-radius: 10px",
    `border: 1px solid ${RESIDUAL_FIT_COLOR}`,
    "box-shadow: 0 1px 2px rgba(0,0,0,0.15)",
    "pointer-events: none",
    "white-space: nowrap",
  ].join(";");

  return new maplibregl.Marker({ element, offset: [10, -10] })
    .setLngLat(lngLat)
    .addTo(map);
}
