import { type LoGeoref } from "../../../lib/lo-geo-ref";
import type { IfcMetadata } from "../../../worker/ifc";
import { Card } from "../card";
import { MapConversionSection } from "./source-card/map-conversion-section";
import { ProjectedCrsSection } from "./source-card/projected-crs-section";
import { Row } from "./source-card/row";

interface SourceCardProps {
  filename: string;
  metadata: IfcMetadata;
}

export function SourceCard({ filename, metadata }: SourceCardProps) {
  const level = detectLevelOfGeoref(metadata);

  return (
    <Card title="Source" headerAside={<LevelBadge level={level} />}>
      <dl className="space-y-1 text-sm">
        <Row label="Name" value={filename} />
        <Row label="Schema" value={metadata.schema} />
        <Row label="Length unit" value={metadata.lengthUnit} />
        <Row
          label="IfcSite reference"
          value={formatSiteReference(metadata.siteReference)}
        />
        <Row label="Local origin" value={formatLocalOrigin(metadata.localOrigin)} />
        <Row label="TrueNorth" value={formatTrueNorth(metadata.trueNorth)} />
      </dl>

      <p className="text-xs text-slate-500">{loGeorefDescription(level)}</p>

      <div className="space-y-2">
        <ProjectedCrsSection raw={metadata.rawProjectedCrs} />
        <MapConversionSection
          raw={metadata.rawMapConversion}
          status={metadata.mapConversionStatus}
        />
      </div>
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

function loGeorefLabel(level: LoGeoref) {
  switch (level) {
    case "le10": {
      return "LoGeoRef ≤ 10";
    }
    case "l20": {
      return "LoGeoRef 20–40";
    }
    case "l50": {
      return "LoGeoRef 50";
    }
  }
}

function loGeorefDescription(level: LoGeoref) {
  switch (level) {
    case "le10": {
      return "No IfcSite reference and no IfcMapConversion. File has no usable geo information.";
    }
    case "l20": {
      return "IfcSite RefLatitude/RefLongitude present, but no IfcMapConversion.";
    }
    case "l50": {
      return "IfcMapConversion present, file is fully georeferenced.";
    }
  }
}

function detectLevelOfGeoref(metadata: IfcMetadata): LoGeoref {
  if (metadata.existingGeoref) {
    return "l50";
  }
  if (metadata.siteReference) {
    return "l20";
  }
  return "le10";
}

function formatSiteReference(
  ref: IfcMetadata["siteReference"],
): string {
  if (!ref) {
    return "Not present";
  }
  return `${ref.latitude.toFixed(6)}°, ${ref.longitude.toFixed(6)}° · ${ref.elevation}m`;
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
