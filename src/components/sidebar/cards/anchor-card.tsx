import { Button } from "react-aria-components";
import type { HelmertParams } from "../../../lib/helmert";
import { NumberField } from "../number-field";
import { ProvenanceBadge, type Provenance } from "../provenance-badge";

interface AnchorCardProps {
  parameters: HelmertParams | null;
  provenance: Provenance;
  isPicking: boolean;
  canResetToFile: boolean;
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
  onEdit,
  onStartPick,
  onCancelPick,
  onResetToFile,
}: AnchorCardProps) {
  const hasParams = parameters !== null;

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
          label="OrthogonalHeight"
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
            onPress={onCancelPick}
            className="flex-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Cancel pick
          </Button>
        ) : (
          <Button
            onPress={onStartPick}
            className="flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50"
          >
            Pick on map
          </Button>
        )}
        <Button
          className="flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50"
          isDisabled={!canResetToFile || isPicking}
          onPress={onResetToFile}
        >
          Reset to file
        </Button>
      </div>
      {isPicking && (
        <p className="text-xs text-amber-700">
          Click the map to set the anchor. Press Esc to cancel.
        </p>
      )}
    </div>
  );
}
