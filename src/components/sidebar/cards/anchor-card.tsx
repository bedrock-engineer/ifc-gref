import {
  OverlayArrow,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { Button } from "../../input/button";
import type { HelmertParams } from "#modules/helmert/solve";
import { NumberField } from "../number-field";
import { ProvenanceBadge, type Provenance } from "../provenance-badge";

interface AnchorCardProps {
  parameters: HelmertParams | null;
  provenance: Provenance;
  isPicking: boolean;
  canResetToFile: boolean;
  /**
   * If non-null, the map-click pick is disabled because committing a
   * WGS84-derived value through degraded transforms would produce a
   * ~170 m–wrong survey point. See docs/crs-datum-grids.md (Q11).
   */
  pickBlockedReason?: string | null;
  /**
   * Disabled until there's a complete IfcMapConversion to export
   * (parameters + active CRS, gated by the workspace).
   */
  canDownloadSidecar: boolean;
  onEdit: (next: HelmertParams) => void;
  onStartPick: () => void;
  onCancelPick: () => void;
  onResetToFile: () => void;
  onDownloadSidecar: () => void;
}

export function AnchorCard({
  parameters,
  provenance,
  isPicking,
  canResetToFile,
  pickBlockedReason,
  canDownloadSidecar,
  onEdit,
  onStartPick,
  onCancelPick,
  onResetToFile,
  onDownloadSidecar,
}: AnchorCardProps) {
  const hasParams = parameters !== null;
  const pickDisabled = pickBlockedReason != null;

  function updateEasting(value: number) {
    if (!parameters) {
      return;
    }
    onEdit({ ...parameters, easting: value });
  }
  function updateNorthing(value: number) {
    if (!parameters) {
      return;
    }
    onEdit({ ...parameters, northing: value });
  }
  function updateHeight(value: number) {
    if (!parameters) {
      return;
    }
    onEdit({ ...parameters, height: value });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <TooltipTrigger delay={300}>
          <Button
            variant="secondary"
            size="sm"
            onPress={onDownloadSidecar}
            isDisabled={!canDownloadSidecar}
            aria-label="Download IfcMapConversion as .ifcgref.json"
            className="!p-1.5 !leading-none"
          >
            <DownloadIcon />
          </Button>

          <Tooltip
            placement="top"
            className="rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-md data-entering:animate-in data-entering:fade-in data-exiting:animate-out data-exiting:fade-out"
          >
            <OverlayArrow>
              <svg
                width={8}
                height={8}
                viewBox="0 0 8 8"
                className="fill-slate-900"
              >
                <path d="M0 0 L4 4 L8 0" />
              </svg>
            </OverlayArrow>
            Download IfcMapConversion info, can be applied to another IFC file in this app
          </Tooltip>
        </TooltipTrigger>

        <ProvenanceBadge provenance={provenance} />
      </div>

      <div className="space-y-2">
        <NumberField
          label="Easting"
          value={parameters?.easting ?? null}
          onChange={updateEasting}
          isDisabled={!hasParams}
          formatOptions={{
            style: "unit",
            unit: "meter",
            unitDisplay: "short",
            maximumFractionDigits: 3,
          }}
        />

        <NumberField
          label="Northing"
          value={parameters?.northing ?? null}
          onChange={updateNorthing}
          isDisabled={!hasParams}
          formatOptions={{
            style: "unit",
            unit: "meter",
            unitDisplay: "short",
            maximumFractionDigits: 3,
          }}
        />

        <NumberField
          label="Orthogonal Height"
          value={parameters?.height ?? null}
          onChange={updateHeight}
          isDisabled={!hasParams}
          step={1}
          formatOptions={{
            style: "unit",
            unit: "meter",
            unitDisplay: "short",
            maximumFractionDigits: 3,
          }}
        />
      </div>

      <div className="flex gap-2">
        {isPicking ? (
          <Button
            variant="warning"
            size="sm"
            onPress={onCancelPick}
            className="flex-1"
          >
            Cancel pick
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onPress={onStartPick}
            isDisabled={pickDisabled}
            className="flex-1"
          >
            Pick on map
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          isDisabled={!canResetToFile || isPicking}
          onPress={onResetToFile}
          className="flex-1"
        >
          Reset to file
        </Button>
      </div>

      {isPicking && (
        <p className="text-xs text-amber-700">
          Click the map to set the anchor. Press Esc to cancel.
        </p>
      )}
      
      {pickBlockedReason && !isPicking && (
        <p className="text-xs text-red-700">{pickBlockedReason}</p>
      )}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v8" />
      <path d="M4 7l4 4 4-4" />
      <path d="M2 13h12" />
    </svg>
  );
}
