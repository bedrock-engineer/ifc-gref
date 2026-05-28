import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import type { RawProjectedCrs } from "#modules/ifc/worker";
import { Row } from "./row";

interface ProjectedCrsSectionProps {
  raw: RawProjectedCrs | null;
  /**
   * Entity name to render when `raw` is null. When `raw` is non-null the
   * heading uses `raw.entityName` directly.
   */
  absentEntityName: string;
  /**
   * Label shown in the MapUnit row when `raw.mapUnit` is null. Lets the
   * parent disambiguate IFC4 (where the reader defaults to METRE) from
   * IFC2X3 ePset (which has no MapUnit concept). Defaults to "—".
   */
  absentMapUnitLabel?: string;
}

export function ProjectedCrsSection({
  raw,
  absentEntityName,
  absentMapUnitLabel = "—",
}: ProjectedCrsSectionProps) {
  if (!raw || isEmpty(raw)) {
    return (
      <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
        <Row label={absentEntityName} value="Not present" />
      </div>
    );
  }

  return (
    <Disclosure defaultExpanded>
      <Heading level={3}>
        <Button
          slot="trigger"
          className="group flex w-full items-center gap-2 rounded text-left text-xs font-semibold text-slate-700 outline-none transition-colors duration-150 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          <span className="transition-transform group-aria-expanded:rotate-90">
            ▸
          </span>
          {raw.entityName}
        </Button>
      </Heading>

      <DisclosurePanel>
        <dl className="mt-2 space-y-1 border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
          {/* Always-shown core: Name + the two fields that say what
              "OrthogonalHeight = 0" and the E/N units actually mean. */}
          <Row label="Name" value={raw.name ?? "—"} />
          <Row label="VerticalDatum" value={raw.verticalDatum ?? "—"} />
          <Row label="MapUnit" value={raw.mapUnit ?? absentMapUnitLabel} />
          {/* The remaining four are interesting exactly when populated and
              are redundant with the EPSG code otherwise — render only if
              present so EPSG-tagged files don't carry four "—" rows. */}
          {raw.description != null && (
            <Row label="Description" value={raw.description} wrap />
          )}
          {raw.geodeticDatum != null && (
            <Row label="GeodeticDatum" value={raw.geodeticDatum} />
          )}
          {raw.mapProjection != null && (
            <Row label="MapProjection" value={raw.mapProjection} />
          )}
          {raw.mapZone != null && <Row label="MapZone" value={raw.mapZone} />}
        </dl>
      </DisclosurePanel>
    </Disclosure>
  );
}

function isEmpty(raw: RawProjectedCrs): boolean {
  return (
    raw.name == null &&
    raw.description == null &&
    raw.geodeticDatum == null &&
    raw.verticalDatum == null &&
    raw.mapProjection == null &&
    raw.mapZone == null &&
    raw.mapUnit == null
  );
}
