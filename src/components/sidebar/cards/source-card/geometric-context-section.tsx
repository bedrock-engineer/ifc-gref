import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import {
  directionRatiosToBearing,
  directionRatiosToDegrees,
} from "#state/workspace";
import type {
  RawAxis2Placement,
  RawGeometricRepresentationContext,
} from "#modules/ifc/worker";
import { Row } from "./row";

function trimZeros(n: number, maxDecimals: number): string {
  return Number.parseFloat(n.toFixed(maxDecimals)).toString();
}

interface GeometricContextSectionProps {
  raw: RawGeometricRepresentationContext | null;
}

/**
 * Verbatim IfcGeometricRepresentationContext disclosure. Parallels the
 * IfcSite / IfcProjectedCRS / IfcMapConversion sections. The WCS rows
 * are the load-bearing piece — non-identity WorldCoordinateSystem
 * silently shifts/rotates the model before IfcMapConversion is applied,
 * and the disclosure is the only place a user can see it.
 */
export function GeometricContextSection({ raw }: GeometricContextSectionProps) {
  if (raw == null) {
    return (
      <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
        <Row label="IfcGeometricRepresentationContext" value="Not present" />
      </div>
    );
  }

  return (
    <Disclosure>
      <Heading level={3}>
        <Button
          slot="trigger"
          className="group flex w-full items-center gap-2 rounded text-left text-xs font-semibold text-slate-700 outline-none transition-colors duration-150 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          <span className="transition-transform group-aria-expanded:rotate-90">
            ▸
          </span>
          <span className="flex-1">{raw.entityName}</span>
        </Button>
      </Heading>

      <DisclosurePanel>
        <dl className="mt-2 space-y-1 border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
          <Row label="ContextIdentifier" value={raw.contextIdentifier ?? "—"} />
          <Row label="ContextType" value={raw.contextType ?? "—"} />
          <Row
            label="CoordinateSpaceDimension"
            value={raw.coordinateSpaceDimension ?? "—"}
          />
          <Row
            label="Precision"
            value={
              raw.precision == null ? "—" : `${trimZeros(raw.precision, 9)} m`
            }
          />
          <WcsRows wcs={raw.worldCoordinateSystem} />
          <TrueNorthRows tn={raw.trueNorth} />
        </dl>
      </DisclosurePanel>
    </Disclosure>
  );
}

interface WcsRowsProps {
  wcs: RawAxis2Placement | null;
}

function WcsRows({ wcs }: WcsRowsProps) {
  if (!wcs) {
    return <Row label="WorldCoordinateSystem" value="—" />;
  }
  return (
    <>
      <Row
        label="WCS · Location"
        value={
          wcs.location == null
            ? "—"
            : `(${trimZeros(wcs.location.x, 3)}, ${trimZeros(wcs.location.y, 3)}, ${trimZeros(wcs.location.z, 3)}) m`
        }
      />
      <Row label="WCS · Axis" value={formatDirection(wcs.axis)} />
      <Row
        label="WCS · RefDirection"
        value={formatDirection(wcs.refDirection)}
      />
    </>
  );
}

function formatDirection(d: [number, number, number] | null): string {
  if (!d) {
    return "—";
  }
  return `(${trimZeros(d[0], 6)}, ${trimZeros(d[1], 6)}, ${trimZeros(d[2], 6)})`;
}

interface TrueNorthRowsProps {
  tn: { abscissa: number; ordinate: number } | null;
}

function TrueNorthRows({ tn }: TrueNorthRowsProps) {
  if (!tn) {
    return <Row label="TrueNorth" value="—" />;
  }
  const degrees = directionRatiosToDegrees(tn.abscissa, tn.ordinate);
  const bearing = directionRatiosToBearing(tn.abscissa, tn.ordinate);
  return (
    <>
      <Row label="TrueNorth · Abscissa" value={trimZeros(tn.abscissa, 6)} />
      <Row label="TrueNorth · Ordinate" value={trimZeros(tn.ordinate, 6)} />
      <Row label="↳ Rotation" value={`${trimZeros(degrees, 4)}°`} />
      <Row label="↳ Bearing" value={`${trimZeros(bearing, 4)}°`} />
    </>
  );
}
