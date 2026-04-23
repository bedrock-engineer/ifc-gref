import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import {
  detectLevelOfGeoref,
  loGeorefDescription,
  loGeorefLabel,
  type LoGeoref,
} from "../../../lib/lo-geo-ref";
import type { ExistingGeoref, IfcMetadata } from "../../../worker/ifc";
import { Card } from "../card";

interface FileStatusCardProps {
  filename: string;
  metadata: IfcMetadata;
}

export function FileStatusCard({ filename, metadata }: FileStatusCardProps) {
  const level = detectLevelOfGeoref(metadata);
  return (
    <Card title="File">
      <dl className="space-y-1 text-sm">
        <Row label="Name" value={filename} />

        <Row label="Schema" value={metadata.schema} />

        <Row label="Length unit" value={metadata.lengthUnit} />

        {metadata.siteReference && (
          <SiteReferenceRow reference={metadata.siteReference} />
        )}
      </dl>

      <LevelBadge level={level} />

      <p className="text-xs mt-1 text-slate-500">{loGeorefDescription(level)}</p>

      <Disclosure>
        <Heading level={3}>
          <Button
            slot="trigger"
            className="group flex w-full items-center gap-1 rounded text-left text-xs font-medium text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            <span className="transition-transform group-aria-expanded:rotate-90">
              ▸
            </span>
            Details
          </Button>
        </Heading>

        <DisclosurePanel>
          <div className="mt-2 space-y-2 rounded border border-slate-100 bg-slate-50 p-3 text-xs">
            <Row
              label="Local origin"
              value={formatLocalOrigin(metadata.localOrigin)}
            />

            <Row
              label="TrueNorth"
              value={formatTrueNorth(metadata.trueNorth)}
            />

            {metadata.existingGeoref ? (
              <ExistingGeorefDetail georef={metadata.existingGeoref} />
            ) : (
              <Row label="Existing MapConversion" value="—" />
            )}
          </div>
        </DisclosurePanel>
      </Disclosure>
    </Card>
  );
}

const LEVEL_BADGE_COLOUR: Record<LoGeoref, string> = {
  l50: "bg-emerald-100 text-emerald-800",
  l20: "bg-sky-100 text-sky-800",
  le10: "bg-slate-100 text-slate-600",
};

interface LevelBadgeProps {
  level: LoGeoref;
}

function LevelBadge({ level }: LevelBadgeProps) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_BADGE_COLOUR[level]}`}
    >
      {loGeorefLabel(level)}
    </span>
  );
}

interface ExistingGeorefDetailProps {
  georef: ExistingGeoref;
}

function ExistingGeorefDetail({ georef }: ExistingGeorefDetailProps) {
  const { helmert } = georef;

  const { easting, northing, height, scale, rotation } = helmert;

  return (
    <div className="space-y-1 border-t border-slate-200 pt-2">
      <Row label="Target CRS" value={georef.targetCrsName || "(unnamed)"} />
      
      <Row label="Eastings" value={easting.toFixed(6)} />

      <Row label="Northings" value={northing.toFixed(6)} />

      <Row label="OrthogonalHeight" value={height.toFixed(6)} />

      <Row label="Scale" value={scale.toFixed(6)} />

      <Row label="Rotation" value={formatRotation(rotation)} />
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
}

function Row({ label, value }: RowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      
      <dd className="truncate font-mono text-slate-900">{value}</dd>
    </div>
  );
}

interface SiteReferenceRowProps {
  reference: NonNullable<IfcMetadata["siteReference"]>;
}

function SiteReferenceRow({ reference }: SiteReferenceRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-600">IfcSite reference</dt>

      <dd className="font-mono text-xs text-slate-900">
        {reference.latitude.toFixed(6)}°, {reference.longitude.toFixed(6)}°
        <span className="text-slate-500"> · {reference.elevation}m</span>
      </dd>
    </div>
  );
}

function formatLocalOrigin(origin: IfcMetadata["localOrigin"]): string {
  if (!origin) {
    return "—";
  }

  return `(${origin.x.toFixed(6)}, ${origin.y.toFixed(6)}, ${origin.z.toFixed(6)})`;
}

function formatTrueNorth(tn: IfcMetadata["trueNorth"]): string {
  if (!tn) {
    return "—";
  }

  const degrees = (Math.atan2(tn.ordinate, tn.abscissa) * 180) / Math.PI;
  
  return `${tn.abscissa.toFixed(4)}, ${tn.ordinate.toFixed(4)} (${degrees.toFixed(2)}°)`;
}

function formatRotation(rotation: number): string {
  const degrees = (rotation * 180) / Math.PI;

  return `${rotation.toFixed(6)} rad (${degrees.toFixed(4)}°)`;
}
