import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { type RefObject, useEffect, useRef } from "react";
import { deriveCrsViewTarget, type CrsDef } from "../../../lib/crs";

/**
 * Aim the camera at the CRS's area of use when the loaded file has only a
 * target-CRS hint — no solved parameters, no IfcSite reference, no prior
 * georef. Covers the Revit-placeholder case (Snowdon Towers): the file names
 * EPSG:2272 (PA State Plane) but its IfcMapConversion is all zeros, so
 * nothing else in the app has any reason to move the map off the default NL
 * view. Without this nudge the user stares at the Netherlands while typing
 * survey points for a Pennsylvania building.
 *
 * Once the user has an anchor (picked, solved, or from file) the
 * footprint/anchor hooks own the camera; this hook bails out in that case so
 * it never fights them. Each CRS code zooms at most once per mount.
 */
export function useCrsAutoZoom(
  mapRef: RefObject<MlMap | null>,
  activeCrs: CrsDef | null,
  hasAnchor: boolean,
): void {
  const lastCodeRef = useRef<number | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeCrs || hasAnchor) {
      return;
    }
    if (lastCodeRef.current === activeCrs.code) {
      return;
    }
    const target = deriveCrsViewTarget(activeCrs);
    if (!target) {
      return;
    }
    lastCodeRef.current = activeCrs.code;
    if (target.kind === "bounds") {
      // MapLibre wants [[w,s],[e,n]] — opposite of our [n,w,s,e] storage.
      const bounds = new maplibregl.LngLatBounds(
        [target.west, target.south],
        [target.east, target.north],
      );
      map.fitBounds(bounds, { padding: 40, duration: 800, maxZoom: 12 });
    } else {
      map.flyTo({
        center: [target.longitude, target.latitude],
        zoom: 10,
        duration: 800,
      });
    }
  }, [mapRef, activeCrs, hasAnchor]);
}
