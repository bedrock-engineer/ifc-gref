import type { IControl, Map as MlMap } from "maplibre-gl";

/**
 * Generic MapLibre IControl that hands back a stable DOM element so a
 * React subtree can render into it via `createPortal`. The class is
 * deliberately dumb — no state, no event handling of its own. All
 * behaviour lives in the React tree; this exists purely because
 * MapLibre's IControl contract demands an HTMLElement.
 *
 * MapLibre's pointer interactions (pan, zoom, double-click-to-zoom,
 * scroll-wheel) fire on the map canvas. When the portal hosts an
 * interactive widget we don't want those gestures to leak through, so
 * `stopEvents: true` (default) installs a small set of
 * stop-propagation listeners on the element.
 */
export interface PortalControlOptions {
  /** Space-separated class string applied to the root element. */
  className?: string;
  /** Stop pointer/wheel events bubbling to the map. Default: true. */
  stopEvents?: boolean;
}

export class PortalControl implements IControl {
  readonly element: HTMLDivElement;

  constructor(options: PortalControlOptions = {}) {
    const element = document.createElement("div");
    element.className = options.className ?? "maplibregl-ctrl";
    if (options.stopEvents !== false) {
      const swallow = (event: Event) => {
        event.stopPropagation();
      };
      element.addEventListener("mousedown", swallow);
      element.addEventListener("pointerdown", swallow);
      element.addEventListener("dblclick", swallow);
      element.addEventListener("wheel", swallow);
    }
    this.element = element;
  }

  onAdd(_map: MlMap): HTMLElement {
    return this.element;
  }

  onRemove(): void {
    this.element.remove();
  }
}
