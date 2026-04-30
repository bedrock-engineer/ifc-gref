import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import type {
  MapConversionStatus,
  RawMapConversion,
} from "../../../../worker/ifc";
import { Row } from "./row";

function trimZeros(n: number, maxDecimals: number): string {
  return Number.parseFloat(n.toFixed(maxDecimals)).toString();
}

interface MapConversionSectionProps {
  raw: RawMapConversion | null;
  status: MapConversionStatus;
}

export function MapConversionSection({
  raw,
  status,
}: MapConversionSectionProps) {
  if (status === "absent" || raw == null) {
    return (
      <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
        <Row label="IfcMapConversion" value="Not present" />
      </div>
    );
  }

  const rotationDeg =
    (Math.atan2(raw.xAxisOrdinate, raw.xAxisAbscissa) * 180) / Math.PI;

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
          <span className="flex-1">IfcMapConversion</span>
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
          <Row label="Eastings" value={trimZeros(raw.eastings, 3)} />
          <Row label="Northings" value={trimZeros(raw.northings, 3)} />
          <Row
            label="OrthogonalHeight"
            value={trimZeros(raw.orthogonalHeight, 3)}
          />
          <Row label="Scale" value={trimZeros(raw.scale, 6)} />
          <Row label="XAxisAbscissa" value={trimZeros(raw.xAxisAbscissa, 6)} />
          <Row label="XAxisOrdinate" value={trimZeros(raw.xAxisOrdinate, 6)} />
          <Row label="↳ Rotation" value={`${trimZeros(rotationDeg, 4)}°`} />
        </dl>
      </DisclosurePanel>
    </Disclosure>
  );
}
