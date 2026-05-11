import type { LngLat } from "#modules/crs";
import maplibregl, { type Marker, type Map as MlMap } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";

import { isValidLatLon } from "#lib/validators";
import type { MapOverlaySignals } from "#state/georef-status/types";
import {
  ACCENT_COLOR,
  FOOTPRINT_FILL_LAYER_ID,
  FOOTPRINT_LINE_LAYER_ID,
  FOOTPRINT_SOURCE_ID,
} from "../style";
import { runWhenMapReady } from "./run-when-map-ready";

const MARKER_FG = "#111";

/**
 * 2D overlays driven by the model's live georef state:
 * - footprint convex-hull polygon
 * - one marker per available reference source (IfcMapConversion, IfcSite),
 *   each with its own glyph and a persistent small-font label
 *
 * Camera framing is owned by Workspace via the imperative `frameToContent`
 * API on MapView — driven by event handlers (solve, pick, reset, reproject,
 * sidecar) plus two data-arrival effects (first-appearance, footprint
 * promotion).
 */
export function useMapOverlays(
  mapRef: RefObject<MlMap | null>,
  signals: MapOverlaySignals,
): void {
  const mapConversionMarkerRef = useRef<Marker | null>(null);
  const siteMarkerRef = useRef<Marker | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    return runWhenMapReady(map, () => {
      syncMarker(
        map,
        mapConversionMarkerRef,
        signals.mapConversion,
        "mapConversion",
      );
      syncMarker(map, siteMarkerRef, signals.siteReference, "siteReference");
      syncFootprint(map, signals.footprint);
    });
  }, [mapRef, signals]);

  // Tear down markers on unmount. Sources/layers live on the map and are
  // disposed via map.remove() in useMapInit's cleanup.
  useEffect(() => {
    const mc = mapConversionMarkerRef;
    const site = siteMarkerRef;
    return () => {
      mc.current?.remove();
      mc.current = null;
      site.current?.remove();
      site.current = null;
    };
  }, []);
}

function syncMarker(
  map: MlMap,
  markerRef: RefObject<Marker | null>,
  point: LngLat | null,
  source: "mapConversion" | "siteReference",
): void {
  if (point) {
    const lngLat: [number, number] = [point.longitude, point.latitude];
    if (markerRef.current) {
      markerRef.current.setLngLat(lngLat);
    } else {
      markerRef.current = new maplibregl.Marker({
        element: createMarkerElement(source),
        // Anchor at the icon's centre. The label is absolute-positioned
        // outside the layout box, so it doesn't shift the anchor.
        anchor: "center",
      })
        .setLngLat(lngLat)
        .addTo(map);
    }
  } else if (markerRef.current) {
    markerRef.current.remove();
    markerRef.current = null;
  }
}

/**
 * Build the marker DOM: a 20×20 wrapper containing the SVG glyph, with a
 * small absolutely-positioned label hanging below. Absolute positioning
 * keeps the label out of the wrapper's layout box, so MapLibre's `center`
 * anchor lands the geo coordinate on the glyph centre regardless of label
 * width.
 */
function createMarkerElement(
  source: "mapConversion" | "siteReference",
): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.width = "20px";
  wrapper.style.height = "20px";
  wrapper.style.pointerEvents = "none";

  wrapper.append(createGlyph(source));

  const label = document.createElement("span");
  label.textContent =
    source === "mapConversion" ? "IfcMapConversion" : "IfcSite";
  label.style.position = "absolute";
  label.style.top = "100%";
  label.style.left = "50%";
  label.style.transform = "translate(-50%, 4px)";
  label.style.fontSize = "10px";
  label.style.lineHeight = "1";
  label.style.fontWeight = "500";
  label.style.color = MARKER_FG;
  label.style.whiteSpace = "nowrap";
  // White halo for legibility against busy basemaps — stronger than a soft
  // shadow because the labels sit over satellite/aerial imagery, not just
  // the toned-down BRT.
  label.style.textShadow = [
    "-1px -1px 0 #fff",
    "1px -1px 0 #fff",
    "-1px 1px 0 #fff",
    "1px 1px 0 #fff",
    "0 0 3px #fff",
  ].join(", ");
  wrapper.append(label);

  return wrapper;
}

function createGlyph(source: "mapConversion" | "siteReference"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");

  if (source === "mapConversion") {
    // Surveyor's crosshair — the geo coordinate sits at the intersection.
    for (const [x1, y1, x2, y2] of [
      [3, 10, 17, 10],
      [10, 3, 10, 17],
    ] as const) {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", MARKER_FG);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-linecap", "round");
      svg.append(line);
    }
  } else {
    // Hollow circle — approximate location.
    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("cx", "10");
    ring.setAttribute("cy", "10");
    ring.setAttribute("r", "6");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", MARKER_FG);
    ring.setAttribute("stroke-width", "1.75");
    svg.append(ring);
  }

  return svg;
}

function syncFootprint(
  map: MlMap,
  footprint: Array<[number, number]> | null,
): void {
  const hasFootprint = footprint != null && footprint.length >= 3;
  const existing = map.getSource<maplibregl.GeoJSONSource>(FOOTPRINT_SOURCE_ID);

  if (hasFootprint) {
    const ring = [...footprint];
    const first = ring[0];
    const last = ring.at(-1);
    if (first && last) {
      const [fx, fy] = first;
      const [lx, ly] = last;
      if (fx !== lx || fy !== ly) {
        ring.push([fx, fy]);
      }
    }
    const data: GeoJSON.Feature<GeoJSON.Polygon> = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    };

    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(FOOTPRINT_SOURCE_ID, { type: "geojson", data });
      map.addLayer({
        id: FOOTPRINT_FILL_LAYER_ID,
        type: "fill",
        source: FOOTPRINT_SOURCE_ID,
        paint: { "fill-color": ACCENT_COLOR, "fill-opacity": 0.2 },
      });
      map.addLayer({
        id: FOOTPRINT_LINE_LAYER_ID,
        type: "line",
        source: FOOTPRINT_SOURCE_ID,
        paint: { "line-color": ACCENT_COLOR, "line-width": 2 },
      });
    }
  } else if (existing) {
    if (map.getLayer(FOOTPRINT_FILL_LAYER_ID)) {
      map.removeLayer(FOOTPRINT_FILL_LAYER_ID);
    }
    if (map.getLayer(FOOTPRINT_LINE_LAYER_ID)) {
      map.removeLayer(FOOTPRINT_LINE_LAYER_ID);
    }
    map.removeSource(FOOTPRINT_SOURCE_ID);
  }
}

/**
 * Imperatively frame the camera to the highest-authority signal available.
 * Used on first appearance and by the "zoom to model" button.
 *
 * `duration: 0` (default) is instant — fits the on-load case. The button
 * passes a non-zero duration to animate.
 */
export function frameCamera(
  map: MlMap,
  signals: MapOverlaySignals,
  options: { duration?: number } = {},
): void {
  const duration = options.duration ?? 0;
  const validFootprint =
    signals.footprint?.filter(([lat, lon]) => isValidLatLon({ lat, lon })) ??
    [];

  if (validFootprint.length >= 3) {
    const seed = validFootprint[0];
    if (!seed) {
      return;
    }
    const bounds = new maplibregl.LngLatBounds(seed, seed);
    for (const point of validFootprint) {
      bounds.extend(point);
    }
    map.fitBounds(bounds, { padding: 40, duration, maxZoom: 19 });
    return;
  }

  // Single-point fallbacks: prefer the precise (MapConversion) anchor when
  // present, otherwise the IfcSite reference.
  const single = signals.mapConversion ?? signals.siteReference;
  if (
    single &&
    isValidLatLon({ lat: single.latitude, lon: single.longitude })
  ) {
    const center: [number, number] = [single.longitude, single.latitude];
    if (duration === 0) {
      map.jumpTo({ center, zoom: 17 });
    } else {
      map.flyTo({ center, zoom: 17, duration });
    }
  }
}
