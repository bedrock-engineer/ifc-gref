import { useState } from "react";
import type { HelmertParams } from "../../../lib/helmert";
import type { IfcMetadata } from "../../../worker/ifc";
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

  function setScale(value: number) {
    if (!parameters) {
      return;
    }
    setEdited(true);
    onParametersChange({ ...parameters, scale: value });
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

        <NumberField
          label="Scale"
          value={parameters?.scale ?? null}
          onChange={setScale}
          isDisabled={!hasParams}
          step={0.0001}
          formatOptions={{ maximumFractionDigits: 6 }}
        />
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
