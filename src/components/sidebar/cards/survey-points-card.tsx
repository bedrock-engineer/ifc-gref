import { type CrsDef } from "#modules/crs";
import type {
  HelmertParams,
  PointPair,
  SolveRequest,
  SurveyMode,
} from "#modules/helmert/solve";
import type { ParsedPointRow } from "#modules/helmert/survey-point-paste";
import type { IfcMetadata } from "#modules/ifc/worker";
import {
  describeCrsUnit,
  describeIfcUnit,
  numberFieldFormatForIntl,
} from "#modules/units/format";
import { projectIfcSite } from "#state/workspace";
import { type ReactNode, useReducer, useState } from "react";
import { Button as AriaButton, Label, RadioGroup } from "react-aria-components";
import { Button } from "../../input/button";
import { RadioButton } from "../../input/radio-button";
import { CardHelpButton } from "../help-popover";
import { NumberField } from "../number-field";
import { PasteSurveyPointsButton } from "../paste-survey-points-button";
import { ResidualsTable } from "../residuals-table";

// Flask parity: the survey table shows `Engineering (IFC) [{{ ifcunit }}]` and
// `Projected (MAP) [{{ mapunit }}]` so users know which unit each column takes.
// Unit display goes through `describeIfcUnit` / `describeCrsUnit` which
// converge on a single descriptor (label / short / Intl ID) per unit — see
// modules/units/format.ts.

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

  const ifcUnit = describeIfcUnit(metadata.lengthUnit);
  const crsUnit = describeCrsUnit(activeCrs);

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

  const showSiteAnchor =
    (mode === "use-existing" || mode === "add-to-existing") && hasSite;
  const showPointsTable = mode !== "use-existing";

  function handleComputeTransform() {
    if (!canSolve) {
      return;
    }
    onSolve({ mode, userPoints: valid });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <CardHelpButton label="Help: Survey points">
          <p>Three ways to derive the georeferencing transform:</p>
          
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong>Encode existing</strong>: convert the file's{" "}
              <code>IfcSite</code>
              reference into an <code>IfcMapConversion</code>. No accuracy gain,
              just upgrades the encoding (LoGeoRef 20 → 50).
            </li>

            <li>
              <strong>Reference + points</strong>: combine the file's{" "}
              <code>IfcSite</code>
              reference with ≥1 surveyed point for a tighter fit.
            </li>

            <li>
              <strong>Points only</strong>: ignore the file's{" "}
              <code>IfcSite</code> reference and fit from ≥2 surveyed pairs.
            </li>
          </ul>

          <p>
            Each row pairs local engineering coordinates (X, Y, Z in IFC units)
            with target coordinates (X′, Y′, Z′ in CRS units). Paste from Excel
            works; column headers indicate the expected units.
          </p>

          <p>
            With ≥2 points the fit absorbs the projection's combined scale
            factor (~0.9999 in RDNew, down to 0.9996 at
            UTM zone edges) into <code>Scale</code>, so you can paste raw
            surveyor coordinates without pre-reducing ground distances to
            grid.
          </p>
        </CardHelpButton>
      </div>

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
          label="Encode existing IfcSite as IfcMapConversion"
          hint="LoGeoRef 20 → 50, no accuracy gain."
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

      {(showSiteAnchor || showPointsTable) && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
            <span>
              <span className="font-medium text-slate-700">Engineering</span>{" "}
              (IFC) [{ifcUnit.label}]
            </span>

            <span className="text-slate-400" aria-hidden="true">
              →
            </span>

            <span>
              <span className="font-medium text-slate-700">Projected</span> (
              {activeCrs ? `EPSG:${activeCrs.code}` : "CRS"}) [{crsUnit.label}]
            </span>
          </div>

          {showSiteAnchor && (
            <IfcSiteAnchorMiniCard
              metadata={metadata}
              activeCrs={activeCrs}
              engineeringFormat={numberFieldFormatForIntl(ifcUnit.intl)}
              projectedFormat={numberFieldFormatForIntl(crsUnit.intl)}
            />
          )}

          {showPointsTable && (
            <>
              {points.map((point, index) => (
                <PointMiniCard
                  key={point.id}
                  index={index}
                  point={point}
                  engineeringFormat={numberFieldFormatForIntl(ifcUnit.intl)}
                  projectedFormat={numberFieldFormatForIntl(crsUnit.intl)}
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
            </>
          )}
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
          crsUnitShort={crsUnit.short}
        />
      )}
    </div>
  );
}

const AXES = ["x", "y", "z"] as const;
type Axis = (typeof AXES)[number];

interface AxesValues {
  x: number | null;
  y: number | null;
  z: number | null;
}

interface PointPairAxesGridProps {
  /** Prefix for aria labels — e.g. "Point 1" → "Point 1 engineering X". */
  ariaPrefix: string;
  engineering: AxesValues;
  projected: AxesValues | null;
  engineeringFormat: Intl.NumberFormatOptions;
  projectedFormat: Intl.NumberFormatOptions;
  isDisabled?: boolean;
  onEngineering?: (axis: Axis, value: number) => void;
  onProjected?: (axis: Axis, value: number) => void;
  /** Rendered in place of the projected NumberFields when `projected` is null. */
  projectedFallback?: ReactNode;
}

/**
 * Shared 4-col grid (label · X · Y · Z) with two rows of NumberFields:
 * Engineering (file frame) and Projected (CRS frame). Both `PointMiniCard`
 * (editable) and `IfcSiteAnchorMiniCard` (locked) render through this so the
 * column widths, gaps, and header row stay in lockstep.
 */
function PointPairAxesGrid({
  ariaPrefix,
  engineering,
  projected,
  engineeringFormat,
  projectedFormat,
  isDisabled,
  onEngineering,
  onProjected,
  projectedFallback,
}: PointPairAxesGridProps) {
  function renderProjectedRow() {
    if (projected) {
      return AXES.map((axis) => (
        <NumberField
          key={`p-${axis}`}
          ariaLabel={`${ariaPrefix} projected ${axis.toUpperCase()}`}
          value={projected[axis]}
          formatOptions={projectedFormat}
          hideSteppers
          isDisabled={isDisabled}
          onChange={(v) => onProjected?.(axis, v)}
        />
      ));
    }
    if (projectedFallback) {
      return <div className="col-span-3">{projectedFallback}</div>;
    }
    return null;
  }

  return (
    <div className="grid grid-cols-[5.5rem_1fr_1fr_1fr] items-center gap-y-1.5 gap-x-1 text-xs text-slate-500">
      <span />
      {AXES.map((axis) => (
        <span key={`h-${axis}`} className="pl-2 font-mono">
          {axis.toUpperCase()}
        </span>
      ))}

      <span>Engineering</span>

      {AXES.map((axis) => (
        <NumberField
          key={`e-${axis}`}
          ariaLabel={`${ariaPrefix} engineering ${axis.toUpperCase()}`}
          value={engineering[axis]}
          formatOptions={engineeringFormat}
          hideSteppers
          isDisabled={isDisabled}
          onChange={(v) => onEngineering?.(axis, v)}
        />
      ))}

      <span>Projected</span>

      {renderProjectedRow()}
    </div>
  );
}

interface IfcSiteAnchorMiniCardProps {
  metadata: IfcMetadata;
  activeCrs: CrsDef | null;
  engineeringFormat: Intl.NumberFormatOptions;
  projectedFormat: Intl.NumberFormatOptions;
}

/**
 * Locked read-only mirror of the implicit point pair contributed by the
 * IfcSite reference in `use-existing` / `add-to-existing` modes — same
 * grid as `PointMiniCard`, all NumberFields disabled. Engineering values
 * shown in file-native units, projected values in CRS-native units, so
 * they match the unit headers shared with the user-input cards.
 */
function IfcSiteAnchorMiniCard({
  metadata,
  activeCrs,
  engineeringFormat,
  projectedFormat,
}: IfcSiteAnchorMiniCardProps) {
  const site = metadata.siteReference;
  const origin = metadata.localOrigin;
  if (!site || !origin) {
    return null;
  }

  // localOrigin is metres (worker boundary 1) — divide back out so the
  // displayed numbers carry the unit in the shared header above. The
  // factor was resolved once by the worker (1 if unit unknown).
  const ifcMetresPerUnit = metadata.metresPerUnit;
  const localX = origin.x / ifcMetresPerUnit;
  const localY = origin.y / ifcMetresPerUnit;
  const localZ = origin.z / ifcMetresPerUnit;

  const projected = activeCrs ? projectIfcSite(metadata, activeCrs) : null;
  // projectIfcSite returns metres (proj4 boundary). Divide by metresPerUnit
  // to land in CRS-native units (matches the projected column unit in the
  // header).
  const crsMetresPerUnit = activeCrs?.metresPerUnit ?? 1;
  const projectedNative: AxesValues | null = projected?.isOk()
    ? {
        x: projected.value.x / crsMetresPerUnit,
        y: projected.value.y / crsMetresPerUnit,
        z: projected.value.z / crsMetresPerUnit,
      }
    : null;

  return (
    <div className="space-y-1.5 border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          IfcSite anchor
        </span>
        <span className="text-[10px] text-slate-400">from file (locked)</span>
      </div>
      <PointPairAxesGrid
        ariaPrefix="IfcSite"
        engineering={{ x: localX, y: localY, z: localZ }}
        projected={projectedNative}
        engineeringFormat={engineeringFormat}
        projectedFormat={projectedFormat}
        isDisabled
        projectedFallback={
          <span className="pl-2 italic text-slate-400">
            {activeCrs ? "Projection unavailable" : "Set target CRS"}
          </span>
        }
      />
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
      className="flex items-start gap-2 rounded border border-slate-200 p-2 text-xs transition-colors duration-150 data-hovered:border-slate-400 data-hovered:bg-slate-50 data-selected:border-slate-900 data-selected:bg-slate-50"
      indicatorClassName="mt-0.5"
    >
      <span>
        <span className="block font-medium text-slate-900">{label}</span>
        <span className="block text-slate-500">{hint}</span>
      </span>
    </RadioButton>
  );
}

const ENGINEERING_KEYS: Record<Axis, keyof PointDraft> = {
  x: "localX",
  y: "localY",
  z: "localZ",
};

const PROJECTED_KEYS: Record<Axis, keyof PointDraft> = {
  x: "targetX",
  y: "targetY",
  z: "targetZ",
};

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
    <div className="space-y-1.5 border border-slate-200 bg-white p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Point {index + 1}
        </span>

        {canRemove && (
          <AriaButton
            onPress={onRemove}
            aria-label={`Remove point ${index + 1}`}
            className="relative flex size-5 items-center justify-center rounded text-base leading-none text-slate-400 outline-none transition-[color,background-color,scale] duration-100 before:absolute before:-top-2 before:-right-2.5 before:bottom-0 before:left-0 before:content-[''] hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-slate-500 data-pressed:scale-[0.96]"
          >
            ×
          </AriaButton>
        )}
      </div>

      <PointPairAxesGrid
        ariaPrefix={`Point ${index + 1}`}
        engineering={{ x: point.localX, y: point.localY, z: point.localZ }}
        projected={{ x: point.targetX, y: point.targetY, z: point.targetZ }}
        engineeringFormat={engineeringFormat}
        projectedFormat={projectedFormat}
        onEngineering={(axis, value) => {
          onField(ENGINEERING_KEYS[axis], value);
        }}
        onProjected={(axis, value) => {
          onField(PROJECTED_KEYS[axis], value);
        }}
      />
    </div>
  );
}
