import { type LoGeoref } from "#modules/ifc/lo-geo-ref";
import { directionRatiosToDegrees } from "#state/workspace";
import type { IfcMetadata } from "#modules/ifc/worker";
import { Card } from "../card";
import { MapConversionSection } from "./source-card/map-conversion-section";
import { ProjectedCrsSection } from "./source-card/projected-crs-section";
import { RigidOperationSection } from "./source-card/rigid-operation-section";
import { Row } from "./source-card/row";

interface SourceCardProps {
  filename: string;
  metadata: IfcMetadata;
  /**
   * True when the file's IfcSite RefLat/RefLon falls outside the active
   * CRS area of use. The map skips the marker; this card flags the value
   * inline so the user notices the discrepancy.
   */
  siteOutsideBbox: boolean;
  /** EPSG code of the active CRS, used in the outside-bbox tooltip. */
  activeCrsCode: number | null;
}

export function SourceCard({
  filename,
  metadata,
  siteOutsideBbox,
  activeCrsCode,
}: SourceCardProps) {
  const level = detectLevelOfGeoref(metadata);

  return (
    <Card title="Source" headerAside={<LevelBadge level={level} />}>
      <dl className="space-y-1 text-sm">
        <Row label="Name" value={filename} />
        
        <Row label="Schema" value={metadata.schema} />
        
        <Row label="Length unit" value={metadata.lengthUnit} />
        
        <Row
          label="IfcSite reference"
          value={
            <SiteReferenceValue
              ref={metadata.siteReference}
              outsideBbox={siteOutsideBbox}
              activeCrsCode={activeCrsCode}
            />
          }
        />

        <Row
          label="Local origin"
          value={formatLocalOrigin(metadata.localOrigin)}
        />

        <Row
          label="TrueNorth"
          wrap
          value={<TrueNorthValue tn={metadata.trueNorth} />}
        />
      </dl>

      <p className="text-xs text-slate-500">{loGeorefDescription(level)}</p>

      <div className="space-y-2">
        <ProjectedCrsSection raw={metadata.rawProjectedCrs} />
        <MapConversionSection
          raw={metadata.rawMapConversion}
          status={metadata.mapConversionStatus}
        />
        <RigidOperationSection raw={metadata.rawRigidOperation} />
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

interface SiteReferenceValueProps {
  ref: IfcMetadata["siteReference"];
  outsideBbox: boolean;
  activeCrsCode: number | null;
}

function SiteReferenceValue({
  ref,
  outsideBbox,
  activeCrsCode,
}: SiteReferenceValueProps) {
  if (!ref) {
    return <>Not present</>;
  }
  const text = `${ref.latitude.toFixed(6)}°, ${ref.longitude.toFixed(6)}° · ${ref.elevation}m`;
  if (!outsideBbox) {
    return <>{text}</>;
  }
  const tooltip =
    activeCrsCode === null
      ? "Outside the active CRS area of use; not used on map."
      : `Outside EPSG:${activeCrsCode} area of use; not used on map.`;
  return (
    <span className="text-rose-700" title={tooltip}>
      <span aria-hidden="true" className="mr-1">
        ⚠
      </span>
      {text}
    </span>
  );
}

function formatLocalOrigin(origin: IfcMetadata["localOrigin"]): string {
  if (!origin) {
    return "—";
  }
  return `(${origin.x}, ${origin.y}, ${origin.z})`;
}

function TrueNorthValue({ tn }: { tn: IfcMetadata["trueNorth"] }) {
  if (!tn) {
    return <>—</>;
  }
  const degrees = directionRatiosToDegrees(tn.abscissa, tn.ordinate);
  return (
    <>
      <span className="block">{degrees.toFixed(2)}°</span>
      <span className="block text-xs">abscissa {tn.abscissa.toFixed(4)}</span>
      <span className="block text-xs">ordinate {tn.ordinate.toFixed(4)}</span>
    </>
  );
}
