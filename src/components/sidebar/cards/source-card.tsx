import type { XYZ } from "#modules/helmert/solve";
import { type LoGeoref } from "#modules/ifc/lo-geo-ref";
import type { IfcMetadata } from "#modules/ifc/worker";
import { unitToMetres } from "#modules/units/convert";
import { describeIfcUnit } from "#modules/units/format";
import { Card } from "../card";
import { GeometricContextSection } from "./source-card/geometric-context-section";
import { MapConversionSection } from "./source-card/map-conversion-section";
import { ProjectedCrsSection } from "./source-card/projected-crs-section";
import { RigidOperationSection } from "./source-card/rigid-operation-section";
import { Row } from "./source-card/row";
import { SiteSection } from "./source-card/site-section";
import { SidecarControls } from "./sidecar-controls";

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
  /**
   * When the file's local origin looks like projected coordinates baked
   * into IfcSite.ObjectPlacement (per `detectBakedProjectedOrigin`), this
   * carries the offending XYZ so the card can flag it inline next to the
   * Local origin row.
   */
  bakedProjectedOrigin: XYZ | null;
  canDownloadSidecar: boolean;
  onDownloadSidecar: () => void;
  onApplySidecar: (file: File) => void;
}

export function SourceCard({
  filename,
  metadata,
  siteOutsideBbox,
  activeCrsCode,
  bakedProjectedOrigin,
  canDownloadSidecar,
  onDownloadSidecar,
  onApplySidecar,
}: SourceCardProps) {
  const level = detectLevelOfGeoref(metadata);
  // Resolve the entity names the source-side UI should display. When the
  // reader found an entity, use its self-reported name. When it didn't,
  // fall back to what the schema would expect — the single place in the
  // UI that maps schema → expected entity name.
  const isEpsetSchema = metadata.schema === "IFC2X3";
  const projectLengthUnit = describeIfcUnit(metadata.lengthUnit);
  // MapConversion E/N/H are on-disk values in MapUnit when present;
  // when MapUnit isn't set, spec fallback is project length unit. ePset
  // (IFC2X3) has no MapUnit concept, also falls back.
  const mapUnitName = metadata.rawProjectedCrs?.mapUnit ?? null;
  const mapUnitShort = mapUnitName
    ? describeIfcUnit(mapUnitName).short
    : projectLengthUnit.short;

  const mapConversionEntity =
    metadata.rawMapConversion?.entityName ??
    (isEpsetSchema ? "ePset_MapConversion" : "IfcMapConversion");

  const projectedCrsEntity =
    metadata.rawProjectedCrs?.entityName ??
    (isEpsetSchema ? "ePset_ProjectedCRS" : "IfcProjectedCRS");

  return (
    <Card title="Source" headerAside={<LevelBadge level={level} />}>
      <dl className="space-y-1 text-sm">
        <Row label="Name" value={filename} />

        <Row label="Schema" value={metadata.schema} />

        <Row
          label="Length unit"
          value={<LengthUnitValue name={metadata.lengthUnit} />}
        />

        <Row
          label="Local origin"
          value={formatLocalOrigin(metadata.localOrigin)}
        />
      </dl>

      {bakedProjectedOrigin && (
        <BakedProjectedOriginNotice origin={bakedProjectedOrigin} />
      )}

      <p className="text-xs text-slate-500">
        {loGeorefDescription(level, mapConversionEntity)}
      </p>

      {isEpsetSchema && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          IFC2x3 has no native <code>IfcMapConversion</code> or{" "}
          <code>IfcProjectedCRS</code> entity. Georeferencing is encoded as
          property sets on <code>IfcSite</code> by the OSArch convention (
          <code>ePset_MapConversion</code>, <code>ePset_ProjectedCRS</code>) —
          readable by tools that look for these psets, but not part of the IFC
          spec.
        </p>
      )}

      <div className="space-y-2">
        <SiteSection
          raw={metadata.rawSite}
          outsideBbox={siteOutsideBbox}
          activeCrsCode={activeCrsCode}
          projectLengthUnitShort={projectLengthUnit.short}
          projectMetresPerUnit={metadata.metresPerUnit}
        />
        
        <GeometricContextSection
          raw={metadata.rawGeometricRepresentationContext}
        />
        
        <ProjectedCrsSection
          raw={metadata.rawProjectedCrs}
          absentEntityName={projectedCrsEntity}
        />

        <MapConversionSection
          raw={metadata.rawMapConversion}
          status={metadata.mapConversionStatus}
          absentEntityName={mapConversionEntity}
          mapUnitShort={mapUnitShort}
        />
        <RigidOperationSection raw={metadata.rawRigidOperation} />
      </div>

      <SidecarControls
        canDownload={canDownloadSidecar}
        onDownload={onDownloadSidecar}
        onApply={onApplySidecar}
      />
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

function loGeorefDescription(
  level: LoGeoref,
  conversionEntity: string,
): string {
  switch (level) {
    case "le10": {
      return `No IfcSite reference and no ${conversionEntity}. File has no usable geo information.`;
    }
    case "l20": {
      return `IfcSite RefLatitude/RefLongitude present, but no ${conversionEntity}.`;
    }
    case "l50": {
      return `${conversionEntity} present, file is georeferenced.`;
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

function LengthUnitValue({ name }: { name: string }) {
  if (unitToMetres(name).isOk()) {
    return <>{name}</>;
  }
  return (
    <span
      className="text-rose-700"
      title={`Unrecognised IFC length unit '${name}' — treated as metres at the worker boundary; numeric values may be off by the unit factor.`}
    >
      <span aria-hidden="true" className="mr-1">
        ⚠
      </span>
      {name}
    </span>
  );
}

function formatLocalOrigin(origin: IfcMetadata["localOrigin"]): string {
  if (!origin) {
    return "—";
  }
  return `(${origin.x}, ${origin.y}, ${origin.z})`;
}

interface BakedProjectedOriginNoticeProps {
  origin: XYZ;
}

function BakedProjectedOriginNotice({
  origin,
}: BakedProjectedOriginNoticeProps) {
  return (
    <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      The local origin shown above —{" "}
      <code>
        ({origin.x.toFixed(2)}, {origin.y.toFixed(2)}, {origin.z.toFixed(2)}) m
      </code>{" "}
      — looks like projected coordinates baked into{" "}
      <code>IfcSite.ObjectPlacement</code>. Per the{" "}
      <a
        href="https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcrepresentationresource/lexical/ifcmapconversion.htm"
        className="underline"
        target="_blank"
        rel="noreferrer"
      >
        IFC4 spec
      </a>{" "}
      this offset belongs in <code>IfcMapConversion</code> — the entity that
      transforms the local engineering coordinate system into the map
      coordinate reference system.
    </p>
  );
}
