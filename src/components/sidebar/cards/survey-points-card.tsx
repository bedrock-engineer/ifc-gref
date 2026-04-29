import { useReducer, useState } from "react";
import { Button as AriaButton, Label, RadioGroup } from "react-aria-components";
import { Button } from "../../button";
import { RadioButton } from "../../radio-button";
import type { CrsDef } from "../../../lib/crs";
import type {
  HelmertParams,
  PointPair,
  SolveRequest,
  SurveyMode,
} from "../../../lib/helmert";
import type { ParsedPointRow } from "../../../lib/survey-point-paste";
import type { IfcMetadata } from "../../../worker/ifc";
import { NumberField } from "../number-field";
import { PasteSurveyPointsButton } from "../paste-survey-points-button";
import { ResidualsTable } from "../residuals-table";

// Flask parity: the survey table showed `Source CRS (IFC) [{{ ifcunit }}]` and
// `Target CRS (MAP) [{{ mapunit }}]` so users knew which unit each column took.
// IFC unit names come through uppercase ("MILLIMETRE"); the target CRS unit is
// derived from metresPerUnit (proj4 does not always populate a `units` string).
function ifcUnitLabel(name: string): string {
  return name.toLowerCase();
}

function crsUnitLabel(crs: CrsDef | null): string {
  if (!crs) {
    return "unknown";
  }
  const m = crs.metresPerUnit;
  if (m === 1) {
    return "metre";
  }
  if (m === 0.001) {
    return "millimetre";
  }
  if (m === 0.01) {
    return "centimetre";
  }
  if (m === 0.3048) {
    return "foot";
  }
  if (Math.abs(m - 1200 / 3937) < 1e-12) {
    return "US survey foot";
  }
  if (m === 0.0254) {
    return "inch";
  }
  if (m === 0.9144) {
    return "yard";
  }
  return `${m} m`;
}

// Map the unit names to the sanctioned `Intl.NumberFormat` "simple unit"
// identifiers so react-aria can render *and* announce the unit on each input.
// Anything Intl doesn't recognise (e.g. US survey foot, nautical mile) returns
// null and we fall back to a bare numeric format — the header strip still
// names the unit for sighted users.
function ifcIntlUnit(name: string): string | null {
  switch (name.toUpperCase()) {
    case "METRE":
    case "METER": {
      return "meter";
    }
    case "MILLIMETRE":
    case "MILLIMETER": {
      return "millimeter";
    }
    case "CENTIMETRE":
    case "CENTIMETER": {
      return "centimeter";
    }
    case "FOOT": {
      return "foot";
    }
    case "INCH": {
      return "inch";
    }
    case "YARD": {
      return "yard";
    }
    case "MILE": {
      return "mile";
    }
    default: {
      return null;
    }
  }
}

function crsUnitShort(crs: CrsDef | null): string {
  if (!crs) {
    return "u";
  }
  const m = crs.metresPerUnit;
  if (m === 1) {
    return "m";
  }
  if (m === 0.001) {
    return "mm";
  }
  if (m === 0.01) {
    return "cm";
  }
  if (m === 0.3048 || Math.abs(m - 1200 / 3937) < 1e-12) {
    return "ft";
  }
  if (m === 0.0254) {
    return "in";
  }
  if (m === 0.9144) {
    return "yd";
  }
  return "u";
}

function crsIntlUnit(crs: CrsDef | null): string | null {
  if (!crs) {
    return null;
  }
  const m = crs.metresPerUnit;
  if (m === 1) {
    return "meter";
  }
  if (m === 0.001) {
    return "millimeter";
  }
  if (m === 0.01) {
    return "centimeter";
  }
  if (m === 0.3048) {
    return "foot";
  }
  if (m === 0.0254) {
    return "inch";
  }
  if (m === 0.9144) {
    return "yard";
  }
  return null;
}

function numberFieldFormat(intlUnit: string | null): Intl.NumberFormatOptions {
  return intlUnit
    ? {
        style: "unit",
        unit: intlUnit,
        unitDisplay: "short",
        maximumFractionDigits: 3,
      }
    : { maximumFractionDigits: 3 };
}

interface PointDraft {
  id: string;
  localX: number | null;
  localY: number | null;
  localZ: number | null;
  targetX: number | null;
  targetY: number | null;
  targetZ: number | null;
}

let nextPointId = 0;
const emptyPoint = (): PointDraft => ({
  id: `p${++nextPointId}`,
  localX: null,
  localY: null,
  localZ: null,
  targetX: null,
  targetY: null,
  targetZ: null,
});

function isEmpty(p: PointDraft): boolean {
  return (
    p.localX === null &&
    p.localY === null &&
    p.localZ === null &&
    p.targetX === null &&
    p.targetY === null &&
    p.targetZ === null
  );
}

function toPointPair(p: PointDraft): PointPair | null {
  const values = [
    p.localX,
    p.localY,
    p.localZ,
    p.targetX,
    p.targetY,
    p.targetZ,
  ];
  if (values.some((v) => v === null || !Number.isFinite(v))) {
    return null;
  }
  const [lx, ly, lz, tx, ty, tz] = values as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    local: { x: lx, y: ly, z: lz },
    target: { x: tx, y: ty, z: tz },
  };
}

function pointsReducer(
  state: Array<PointDraft>,
  action:
    | { type: "update"; index: number; key: keyof PointDraft; value: number }
    | { type: "add" }
    | { type: "remove"; index: number }
    | { type: "replaceAll"; rows: Array<ParsedPointRow> },
): Array<PointDraft> {
  switch (action.type) {
    case "update": {
      return state.map((p, index) =>
        index === action.index ? { ...p, [action.key]: action.value } : p,
      );
    }
    case "add": {
      return [...state, emptyPoint()];
    }
    case "remove": {
      return state.length > 1
        ? state.filter((_, index) => index !== action.index)
        : state;
    }
    case "replaceAll": {
      return action.rows.map((row) => ({
        id: `p${++nextPointId}`,
        localX: row.localX,
        localY: row.localY,
        localZ: row.localZ,
        targetX: row.targetX,
        targetY: row.targetY,
        targetZ: row.targetZ,
      }));
    }
  }
}

interface SurveyPointsCardProps {
  metadata: IfcMetadata;
  activeCrs: CrsDef | null;
  busy: boolean;
  onSolve: (request: SolveRequest) => void;
  /** Points + params from the most recent least-squares fit, for the residual
   *  chart. Null when no fit has run or the fit used the single-point
   *  fallback (no residuals to plot). */
  lastFitPoints: Array<PointPair> | null;
  currentParams: HelmertParams | null;
}

export function SurveyPointsCard({
  metadata,
  activeCrs,
  busy,
  onSolve,
  lastFitPoints,
  currentParams,
}: SurveyPointsCardProps) {
  const hasSite = Boolean(metadata.siteReference && metadata.localOrigin);
  const [mode, setMode] = useState<SurveyMode>(
    hasSite ? "use-existing" : "ignore-existing",
  );

  const [points, dispatch] = useReducer(pointsReducer, [emptyPoint()]);

  const nonEmpty = points.filter((p) => !isEmpty(p));
  const parsed = nonEmpty.map((p) => toPointPair(p));
  const valid = parsed.filter((p): p is PointPair => p !== null);
  const allNonEmptyValid = parsed.every((p) => p !== null);

  const minPoints =
    // prettier-ignore
    mode === "use-existing" ? 0 : (mode === "add-to-existing" ? 1 : 2);

  let blockedReason: string | null = null;

  if ((mode === "use-existing" || mode === "add-to-existing") && !hasSite) {
    blockedReason = "File has no IfcSite reference for this mode.";
  } else if (!allNonEmptyValid) {
    blockedReason = "One or more points have empty or non-numeric fields.";
  } else if (valid.length < minPoints) {
    blockedReason =
      mode === "add-to-existing"
        ? "Need at least 1 surveyed point in addition to the IfcSite reference."
        : "Need at least 2 surveyed points.";
  }

  const canSolve = blockedReason === null && !busy;

  function handleComputeTransform() {
    if (!canSolve) {
      return;
    }
    onSolve({ mode, userPoints: valid });
  }

  return (
    <div className="space-y-3">
      <RadioGroup
        value={mode}
        onChange={(value) => {
          setMode(value as SurveyMode);
        }}
        className="flex flex-col gap-1"
      >
        <Label className="text-xs text-slate-600">Source</Label>

        <ModeOption
          value="use-existing"
          label="IfcSite reference only"
          hint="LoGeoRef 20 → 50. No extra points."
          disabled={!hasSite}
        />

        <ModeOption
          value="add-to-existing"
          label="IfcSite reference + survey points"
          hint="Refine with ≥1 additional point."
          disabled={!hasSite}
        />
        
        <ModeOption
          value="ignore-existing"
          label="Survey points only"
          hint="Ignore IfcSite, fit to ≥2 points."
        />
      </RadioGroup>

      {mode !== "use-existing" && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
            <span>
              <span className="font-medium text-slate-700">Engineering</span>{" "}
              (IFC) [{ifcUnitLabel(metadata.lengthUnit)}]
            </span>

            <span className="text-slate-400" aria-hidden="true">
              →
            </span>

            <span>
              <span className="font-medium text-slate-700">Projected</span>{" "}
              ({activeCrs ? `EPSG:${activeCrs.code}` : "CRS"}) [
              {crsUnitLabel(activeCrs)}]
            </span>
          </div>

          {points.map((point, index) => (
            <PointMiniCard
              key={point.id}
              index={index}
              point={point}
              engineeringFormat={numberFieldFormat(
                ifcIntlUnit(metadata.lengthUnit),
              )}
              projectedFormat={numberFieldFormat(crsIntlUnit(activeCrs))}
              canRemove={points.length > 1}
              onField={(key, value) => {
                dispatch({ type: "update", index, key, value });
              }}
              onRemove={() => {
                dispatch({ type: "remove", index });
              }}
            />
          ))}

          <div className="flex items-stretch gap-2">
            <Button
              variant="secondary"
              size="sm"
              onPress={() => {
                dispatch({ type: "add" });
              }}
              className="flex-1"
            >
              + Add point
            </Button>
            <PasteSurveyPointsButton
              currentPointCount={points.length}
              onReplace={(rows) => {
                dispatch({ type: "replaceAll", rows });
              }}
            />
          </div>
        </div>
      )}

      {blockedReason && (
        <p className="text-xs text-amber-700">{blockedReason}</p>
      )}

      <Button
        variant="primary"
        size="md"
        onPress={handleComputeTransform}
        isDisabled={!canSolve}
        className="w-full"
      >
        Compute transform
      </Button>

      {lastFitPoints && currentParams && (
        <ResidualsTable
          points={lastFitPoints}
          params={currentParams}
          crsUnitShort={crsUnitShort(activeCrs)}
        />
      )}
    </div>
  );
}

interface ModeOptionProps {
  value: SurveyMode;
  label: string;
  hint: string;
  disabled?: boolean;
}

function ModeOption({ value, label, hint, disabled }: ModeOptionProps) {
  return (
    <RadioButton
      value={value}
      isDisabled={disabled}
      className="flex items-start gap-2 rounded border border-slate-200 p-2 text-xs data-selected:border-slate-900 data-selected:bg-slate-50"
      indicatorClassName="mt-0.5"
    >
      <span>
        <span className="block font-medium text-slate-900">{label}</span>
        <span className="block text-slate-500">{hint}</span>
      </span>
    </RadioButton>
  );
}

interface PointMiniCardProps {
  index: number;
  point: PointDraft;
  engineeringFormat: Intl.NumberFormatOptions;
  projectedFormat: Intl.NumberFormatOptions;
  canRemove: boolean;
  onField: (key: keyof PointDraft, value: number) => void;
  onRemove: () => void;
}

function PointMiniCard({
  index,
  point,
  engineeringFormat,
  projectedFormat,
  canRemove,
  onField,
  onRemove,
}: PointMiniCardProps) {
  return (
    <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Point {index + 1}
        </span>
        {canRemove && (
          <AriaButton
            onPress={onRemove}
            aria-label={`Remove point ${index + 1}`}
            className="rounded px-1 text-slate-400 outline-none hover:text-red-600 focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            ×
          </AriaButton>
        )}
      </div>
      <div className="grid grid-cols-[5.5rem_1fr_1fr_1fr] items-center gap-y-1.5 gap-x-1 text-xs text-slate-500">
        <span />
        <span className="pl-2 font-mono">X</span>

        <span className="pl-2 font-mono">Y</span>
        
        <span className="pl-2 font-mono">Z</span>
        
        <span>Engineering</span>
        
        <NumberField
          ariaLabel={`Point ${index + 1} engineering X`}
          value={point.localX}
          formatOptions={engineeringFormat}
          hideSteppers
          onChange={(v) => {
            onField("localX", v);
          }}
        />

        <NumberField
          ariaLabel={`Point ${index + 1} engineering Y`}
          value={point.localY}
          formatOptions={engineeringFormat}
          hideSteppers
          onChange={(v) => {
            onField("localY", v);
          }}
        />

        <NumberField
          ariaLabel={`Point ${index + 1} engineering Z`}
          value={point.localZ}
          formatOptions={engineeringFormat}
          hideSteppers
          onChange={(v) => {
            onField("localZ", v);
          }}
        />

        <span>Projected</span>
        
        <NumberField
          ariaLabel={`Point ${index + 1} projected X`}
          value={point.targetX}
          formatOptions={projectedFormat}
          hideSteppers
          onChange={(v) => {
            onField("targetX", v);
          }}
        />

        <NumberField
          ariaLabel={`Point ${index + 1} projected Y`}
          value={point.targetY}
          formatOptions={projectedFormat}
          hideSteppers
          onChange={(v) => {
            onField("targetY", v);
          }}
        />
        
        <NumberField
          ariaLabel={`Point ${index + 1} projected Z`}
          value={point.targetZ}
          formatOptions={projectedFormat}
          hideSteppers
          onChange={(v) => {
            onField("targetZ", v);
          }}
        />
      </div>
    </div>
  );
}
