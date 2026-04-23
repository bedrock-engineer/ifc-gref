import { Checkbox, Label, RadioGroup } from "react-aria-components";
import { RadioButton } from "../../radio-button";
import {
  BASEMAPS,
  OVERLAYS,
  type BasemapId,
  type OverlayId,
} from "../layers/registry";
import type { LayerRegion } from "../layers/types";
import type { MapScope } from "./use-scope";

interface LayersPanelProps {
  basemap: BasemapId;
  overlays: Record<OverlayId, boolean>;
  /** Current geographic scope of the map (tracks `useMapMapScope`). */
  scope: MapScope;
  onBasemapChange: (id: BasemapId) => void;
  onOverlaysChange: (next: Record<OverlayId, boolean>) => void;
}

const HEADING =
  "text-[11px] font-semibold uppercase tracking-wider text-slate-500";
// Layout-only classes; focus/disabled/cursor live in the shared RadioButton
// and are mirrored here on the Checkbox row so both rows look the same.
const ROW = "flex items-center gap-1.5 py-0.5";
const CHECKBOX_ROW =
  "group flex cursor-pointer items-center gap-1.5 py-0.5 outline-none data-focus-visible:ring-2 data-focus-visible:ring-slate-500 data-disabled:cursor-not-allowed data-disabled:opacity-50";

const NL_ONLY_TITLE = "Only available in the Netherlands";

// A layer is unreachable from the current viewport when it has no data
// where the map is looking. We only disable picker rows the user *could*
// toggle — an already-selected NL layer stays enabled so the user can
// always switch away (otherwise they'd be stuck with an undismissable
// overlay until they pan back to NL).
function isOutOfMapScope(region: LayerRegion, scope: MapScope): boolean {
  return region === "nl" && scope === "world";
}

/**
 * Rendered into the map via `PortalControl`. Basemaps + overlays come
 * straight from the layer registry — to add a new one, edit
 * `map/layers/registry.ts`, not this component.
 */
export function LayersPanel({
  basemap,
  overlays,
  scope,
  onBasemapChange,
  onOverlaysChange,
}: LayersPanelProps) {
  return (
    <div className="min-w-[140px] space-y-1.5 rounded bg-white p-2.5 text-xs text-slate-900 shadow-[0_0_0_2px_rgba(0,0,0,0.1)]">
      <RadioGroup
        value={basemap}
        onChange={onBasemapChange}
        className="flex flex-col"
      >
        <Label className={HEADING}>Basemap</Label>
        {BASEMAPS.map((b) => {
          const outOfMapScope = isOutOfMapScope(b.region, scope);
          const isActive = b.id === basemap;
          return (
            <RadioButton
              key={b.id}
              value={b.id}
              isDisabled={outOfMapScope && !isActive}
              className={ROW}
            >
              <span title={outOfMapScope ? NL_ONLY_TITLE : undefined}>
                {b.label}
              </span>
            </RadioButton>
          );
        })}
      </RadioGroup>
      {OVERLAYS.length > 0 && (
        <div className="flex flex-col pt-1">
          <span className={HEADING}>Overlays</span>
          {OVERLAYS.map((o) => {
            const checked = Boolean(overlays[o.id]);
            const outOfMapScope = isOutOfMapScope(o.region, scope);
            return (
              <Checkbox
                key={o.id}
                isSelected={checked}
                isDisabled={outOfMapScope && !checked}
                onChange={(isSelected) => {
                  onOverlaysChange({ ...overlays, [o.id]: isSelected });
                }}
                className={CHECKBOX_ROW}
              >
                <span className="flex size-3 items-center justify-center rounded-sm border border-slate-400 group-data-selected:border-slate-900 group-data-selected:bg-slate-900">
                  <svg
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                    className="hidden size-2.5 text-white group-data-selected:block"
                  >
                    <path
                      d="M2 5.2 L4.2 7.4 L8 3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span title={outOfMapScope ? NL_ONLY_TITLE : undefined}>
                  {o.label}
                </span>
              </Checkbox>
            );
          })}
        </div>
      )}
    </div>
  );
}
