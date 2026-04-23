import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { type RefObject, useEffect, useRef, useState } from "react";
import { PortalControl } from "../controls/portal-control";
import { STYLE } from "../style";

export interface MapPortals {
  viewToggle: HTMLDivElement;
  layers: HTMLDivElement;
  search: HTMLDivElement;
  zoomToModel: HTMLDivElement;
}

export interface MapInitResult {
  mapRef: RefObject<MlMap | null>;
  /**
   * Null until the map has mounted. Once set, each field is a stable
   * DOM node the caller renders into via `createPortal`. Cleared on
   * unmount so `createPortal` disappears from the React tree before
   * the nodes are removed.
   */
  portals: MapPortals | null;
}

/**
 * Initialize the MapLibre map and mount three `PortalControl`
 * instances — one per interactive control position. The React tree
 * renders into those portal elements so controls can be built with
 * `react-aria-components` and normal React data flow instead of
 * hand-rolled IControl classes.
 */
export function useMapInit(
  containerRef: RefObject<HTMLDivElement | null>,
): MapInitResult {
  const mapRef = useRef<MlMap | null>(null);
  const [portals, setPortals] = useState<MapPortals | null>(null);

  useEffect(
    function createMaplibreMap() {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const map = new maplibregl.Map({
        container,
        style: STYLE,
        center: [5.291, 52.132],
        zoom: 6,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(
        new maplibregl.ScaleControl({ unit: "metric" }),
        "bottom-left",
      );

      const zoomToModel = new PortalControl();
      const viewToggle = new PortalControl();
      const layers = new PortalControl();
      const search = new PortalControl();

      map.addControl(zoomToModel, "top-right");
      map.addControl(viewToggle, "top-right");
      map.addControl(search, "top-left");
      map.addControl(layers, "top-right");

      mapRef.current = map;

      // eslint-disable-next-line @eslint-react/set-state-in-effect
      setPortals({
        viewToggle: viewToggle.element,
        layers: layers.element,
        search: search.element,
        zoomToModel: zoomToModel.element,
      });

      return () => {
        setPortals(null);
        map.remove();
        mapRef.current = null;
      };
    },
    [containerRef],
  );

  return { mapRef, portals };
}
