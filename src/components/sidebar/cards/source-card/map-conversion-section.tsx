import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import { directionRatiosToDegrees } from "#state/workspace";
import type {
  MapConversionStatus,
  RawMapConversion,
} from "#modules/ifc/worker";
import { Row } from "./row";

function trimZeros(n: number, maxDecimals: number): string {
  return Number.parseFloat(n.toFixed(maxDecimals)).toString();
}

interface MapConversionSectionProps {
  raw: RawMapConversion | null;
  status: MapConversionStatus;
  /**
   * Entity name to render when `raw` is null (the reader had nothing to
   * label). When `raw` is non-null the heading uses `raw.entityName`
   * directly — the reader is authoritative for present data.
   */
  absentEntityName: string;
  /**
   * Short symbol for the MapUnit governing `raw.eastings/northings/
   * orthogonalHeight`. Computed by the parent: file's
   * `IfcProjectedCRS.MapUnit` when set, project length unit otherwise
   * (the IFC spec fallback). The raw values are verbatim on-disk numbers
   * (no read-side conversion applied), so the suffix just labels them.
   */
  mapUnitShort: string;
}

export function MapConversionSection({
  raw,
  status,
  absentEntityName,
  mapUnitShort,
}: MapConversionSectionProps) {
  if (status === "absent" || raw == null) {
    return (
      <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
        <Row label={absentEntityName} value="Not present" />
      </div>
    );
  }

  const rotationDeg = directionRatiosToDegrees(
    raw.xAxisAbscissa,
    raw.xAxisOrdinate,
  );

  // FactorX/Y/Z rows are rendered exactly when the source entity is IFC
  // 4.3's IfcMapConversionScaled subtype; null on plain IfcMapConversion
  // or ePset_MapConversion.
  const isScaled = raw.factorX != null;

  return (
    <Disclosure defaultExpanded>
      <Heading level={3}>
        <Button
          slot="trigger"
          className="group flex w-full items-center gap-2 rounded text-left text-xs font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          <span className="transition-transform group-aria-expanded:rotate-90">
            ▸
          </span>
          <span className="flex-1">{raw.entityName}</span>
          {status === "placeholder" && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              placeholder — ignored
            </span>
          )}
        </Button>
      </Heading>

      <DisclosurePanel>
        <dl className="mt-2 space-y-1 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
          {/* E/N/H: cap at 3 decimals (mm precision); scale and the trig
              pair keep 6 because a rotation of 0.5° already lives in the
              5th decimal of cos/sin. trimZeros drops trailing zeros so 0
              renders as "0", not "0.000000". */}
          <Row
            label="Eastings"
            value={`${trimZeros(raw.eastings, 3)} ${mapUnitShort}`}
          />
          <Row
            label="Northings"
            value={`${trimZeros(raw.northings, 3)} ${mapUnitShort}`}
          />
          <Row
            label="OrthogonalHeight"
            value={`${trimZeros(raw.orthogonalHeight, 3)} ${mapUnitShort}`}
          />
          <Row label="Scale" value={trimZeros(raw.scale, 6)} />
          <Row label="XAxisAbscissa" value={trimZeros(raw.xAxisAbscissa, 6)} />
          <Row label="XAxisOrdinate" value={trimZeros(raw.xAxisOrdinate, 6)} />
          <Row label="↳ Rotation" value={`${trimZeros(rotationDeg, 4)}°`} />
          {isScaled && raw.factorX != null && raw.factorY != null && raw.factorZ != null && (
            <>
              <Row label="FactorX" value={trimZeros(raw.factorX, 6)} />
              <Row label="FactorY" value={trimZeros(raw.factorY, 6)} />
              <Row label="FactorZ" value={trimZeros(raw.factorZ, 6)} />
              <Row
                label="↳ Effective xScale"
                value={trimZeros(raw.scale * raw.factorX, 6)}
              />
              <Row
                label="↳ Effective yScale"
                value={trimZeros(raw.scale * raw.factorY, 6)}
              />
              <Row
                label="↳ Effective zScale"
                value={trimZeros(raw.scale * raw.factorZ, 6)}
              />
            </>
          )}
        </dl>
      </DisclosurePanel>
    </Disclosure>
  );
}
