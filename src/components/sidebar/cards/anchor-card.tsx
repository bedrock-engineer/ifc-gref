import { Button } from "../../button";
import type { HelmertParams } from "../../../lib/helmert";
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
  onEdit: (next: HelmertParams) => void;
  onStartPick: () => void;
  onCancelPick: () => void;
  onResetToFile: () => void;
}

export function AnchorCard({
  parameters,
  provenance,
  isPicking,
  canResetToFile,
  pickBlockedReason,
  onEdit,
  onStartPick,
  onCancelPick,
  onResetToFile,
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
      <div className="flex items-center justify-end">
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
