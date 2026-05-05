import { useState } from "react";
import type { HelmertParams } from "#modules/helmert/solve";
import type { IfcMetadata } from "#modules/ifc/worker";
import { Card } from "../card";
import { NumberField } from "../number-field";
import { ProvenanceBadge, type Provenance } from "../provenance-badge";

function computeProvenance(
  edited: boolean,
  fromFile: boolean,
  derived: boolean,
): Provenance {
  if (edited) {
    return "manual";
  }
  if (fromFile) {
    return "file";
  }
  if (derived) {
    return "derived";
  }
  return "default";
}

interface RotationCardProps {
  parameters: HelmertParams | null;
  onParametersChange: (next: HelmertParams) => void;
  metadata: IfcMetadata;
}

export function RotationCard({
  parameters,
  onParametersChange,
  metadata,
}: RotationCardProps) {
  const [edited, setEdited] = useState(false);
  const hasParams = parameters !== null;
  const fromFile = Boolean(metadata.existingGeoref);
  const hasTrueNorth = Boolean(metadata.trueNorth);
  const provenance = computeProvenance(
    edited,
    fromFile,
    hasTrueNorth && hasParams,
  );

  const angleDegrees = parameters
    ? (parameters.rotation * 180) / Math.PI
    : null;
  const abscissa = parameters ? Math.cos(parameters.rotation) : null;
  const ordinate = parameters ? Math.sin(parameters.rotation) : null;

  function setAngleDegrees(value: number) {
    if (!parameters) {
      return;
    }
    setEdited(true);
    onParametersChange({
      ...parameters,
      rotation: (value * Math.PI) / 180,
    });
  }

  // Pre-4.3 schemas only carry one isotropic Scale; show one numberfield.
  // IFC 4.3 carries per-axis factors via IfcMapConversionScaled; show two
  // numberfields ("Horizontal scale" + "Vertical scale"). The pre-4.3
  // fitter (solveHelmertJoint) sets all three equal anyway, so the choice
  // of UI here matches what the file can carry.
  const isIfc43 = metadata.schema === "IFC4X3";

  // True when reading a 4.3 file authored elsewhere with non-conformal XY
  // scaling. We can't represent xScale ≠ yScale through our two-field UI
  // without lying about which axis is which, so we lock the horizontal
  // field and surface the asymmetry as a read-only note. The user has to
  // edit the file in another tool to change it.
  const hasAsymmetricXY =
    parameters !== null && parameters.xScale !== parameters.yScale;

  function setIsotropicScale(value: number) {
    if (!parameters) {
      return;
    }
    setEdited(true);
    onParametersChange({
      ...parameters,
      xScale: value,
      yScale: value,
      zScale: value,
    });
  }

  function setHorizontalScale(value: number) {
    if (!parameters) {
      return;
    }
    setEdited(true);
    onParametersChange({
      ...parameters,
      xScale: value,
      yScale: value,
    });
  }

  function setVerticalScale(value: number) {
    if (!parameters) {
      return;
    }
    setEdited(true);
    onParametersChange({
      ...parameters,
      zScale: value,
    });
  }

  return (
    <Card
      title="Rotation & scale"
      headerAside={<ProvenanceBadge provenance={provenance} />}
    >
      <div className="space-y-2">
        <NumberField
          label="Rotation"
          value={angleDegrees}
          onChange={setAngleDegrees}
          isDisabled={!hasParams}
          step={0.01}
          formatOptions={{
            style: "unit",
            unit: "degree",
            maximumFractionDigits: 6,
          }}
          description={
            abscissa === null || ordinate === null
              ? null
              : `↳ XAxisAbscissa ${abscissa.toFixed(6)} · XAxisOrdinate ${ordinate.toFixed(6)}`
          }
        />

        {isIfc43 ? (
          <>
            <NumberField
              label="Horizontal scale"
              value={parameters?.xScale ?? null}
              onChange={setHorizontalScale}
              isDisabled={!hasParams || hasAsymmetricXY}
              step={0.0001}
              formatOptions={{ maximumFractionDigits: 6 }}
              description={
                hasAsymmetricXY && parameters
                  ? `↳ X ${parameters.xScale.toFixed(6)} · Y ${parameters.yScale.toFixed(6)} (file-authored anisotropy; not editable here)`
                  : null
              }
            />
            <NumberField
              label="Vertical scale"
              value={parameters?.zScale ?? null}
              onChange={setVerticalScale}
              isDisabled={!hasParams}
              step={0.0001}
              formatOptions={{ maximumFractionDigits: 6 }}
            />
          </>
        ) : (
          <NumberField
            label="Scale"
            value={parameters?.xScale ?? null}
            onChange={setIsotropicScale}
            isDisabled={!hasParams}
            step={0.0001}
            formatOptions={{ maximumFractionDigits: 6 }}
          />
        )}
      </div>

      {!hasTrueNorth && !fromFile && (
        <p className="text-xs italic text-slate-500">
          No TrueNorth in file — assuming grid-aligned. Add survey points or
          edit if the model is rotated.
        </p>
      )}
    </Card>
  );
}
