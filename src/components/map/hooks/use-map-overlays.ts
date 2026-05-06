import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import type { LngLat } from "#modules/crs";
import {
  ACCENT_COLOR,
  FOOTPRINT_FILL_LAYER_ID,
  FOOTPRINT_LINE_LAYER_ID,
  FOOTPRINT_SOURCE_ID,
} from "../style";

// High-contrast black for the marker glyph + label. Accent teal disappears
// on busy basemaps (satellite especially); the label's white text-shadow
// gives it just enough lift to read.
const MARKER_FG = "#111";

export interface MapOverlaySignals {
  /** Footprint convex hull as a closed ring of WGS84 lng/lat. */
  footprint: Array<[number, number]> | null;
  /** Live IfcMapConversion-derived anchor — moves with edited Helmert params. */
  mapConversion: LngLat | null;
  /** IfcSite RefLat/RefLon (already filtered for outside-bbox cases). */
  siteReference: LngLat | null;
}

type Source = "footprint" | "mapConversion" | "siteReference";

// Authority ranking — used to decide whether a newly-available signal
// outranks whatever we last framed the camera to. Footprint is most
// reliable (it's the building's actual extent, computed via the live
// Helmert + proj4); IfcMapConversion is the precise projected anchor;
// IfcSite RefLat/RefLon is the legacy/approximate fallback.
const SOURCE_RANK: Record<Source, number> = {
  footprint: 3,
  mapConversion: 2,
  siteReference: 1,
};

/**
 * 2D overlays driven by the model's live georef state:
 * - footprint convex-hull polygon
 * - one marker per available reference source (IfcMapConversion, IfcSite),
 *   each with its own glyph and a persistent small-font label
 * - camera framing that promotes from IfcSite → IfcMapConversion → footprint
 *   as more authoritative signals materialise
 */
export function useMapOverlays(
  mapRef: RefObject<MlMap | null>,
  signals: MapOverlaySignals,
): void {
  const mapConversionMarkerRef = useRef<Marker | null>(null);
  const siteMarkerRef = useRef<Marker | null>(null);
  // Tracks the highest-authority source we've already framed the camera
  // to. Reframing is gated on rank comparison — equal-rank updates (e.g.
  // live edits to mapConversion's lat/lon while we're already framed at
  // mapConversion level) are deliberately ignored, otherwise the camera
  // would chase every keystroke.
  const lastFramedRef = useRef<Source | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const apply = () => {
      syncMarker(
        map,
        mapConversionMarkerRef,
        signals.mapConversion,
        "mapConversion",
      );
      syncMarker(
        map,
        siteMarkerRef,
        signals.siteReference,
        "siteReference",
      );
      syncFootprint(map, signals.footprint);
      maybeFrame(map, signals, lastFramedRef);
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      void map.once("load", apply);
    }
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
  label.textContent = source === "mapConversion" ? "IfcMapConversion" : "IfcSite";
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
  const existing = map.getSource<maplibregl.GeoJSONSource>(
    FOOTPRINT_SOURCE_ID,
  );

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

function bestSource(signals: MapOverlaySignals): Source | null {
  if (signals.footprint != null && signals.footprint.length >= 3) {
    return "footprint";
  }
  if (signals.mapConversion) {
    return "mapConversion";
  }
  if (signals.siteReference) {
    return "siteReference";
  }
  return null;
}

function maybeFrame(
  map: MlMap,
  signals: MapOverlaySignals,
  lastFramedRef: RefObject<Source | null>,
): void {
  const current = bestSource(signals);

  // No content at all (e.g. file unloaded) — reset so the next load frames
  // from rank zero.
  if (current === null) {
    lastFramedRef.current = null;
    return;
  }

  const lastRank = lastFramedRef.current
    ? SOURCE_RANK[lastFramedRef.current]
    : 0;
  const currentRank = SOURCE_RANK[current];

  // Reframe only on authority promotion. Equal-rank updates (live param
  // edits while already framed at the same level) are intentional no-ops.
  if (currentRank > lastRank) {
    frameCamera(map, signals);
    lastFramedRef.current = current;
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
    signals.footprint?.filter((point) => isValidLngLat(point)) ?? [];

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
  if (single && isValidLngLat([single.longitude, single.latitude])) {
    const center: [number, number] = [single.longitude, single.latitude];
    if (duration === 0) {
      map.jumpTo({ center, zoom: 17 });
    } else {
      map.flyTo({ center, zoom: 17, duration });
    }
  }
}

function isValidLngLat([lng, lat]: [number, number]): boolean {
  return (
    Number.isFinite(lng) && Number.isFinite(lat) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}
