import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
  OverlayArrow,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { TargetIcon } from "@radix-ui/react-icons";
import type { RawPostalAddress, RawSite } from "#modules/ifc/worker";
import { Row } from "./row";

function trimZeros(n: number, maxDecimals: number): string {
  return Number.parseFloat(n.toFixed(maxDecimals)).toString();
}

interface SiteSectionProps {
  raw: RawSite | null;
  /**
   * True when the file's IfcSite RefLat/RefLon falls outside the active
   * CRS area of use. Renders an inline warning under the lat/lon rows so
   * the user sees the discrepancy without leaving the disclosure.
   */
  outsideBbox: boolean;
  /** EPSG code of the active CRS, used in the outside-bbox tooltip. */
  activeCrsCode: number | null;
  /**
   * Project length unit applied to `raw.refElevation` for display. The
   * worker reads RefElevation in metres-canonical (× ifcMetresPerUnit);
   * we divide back out here so the source-card row shows the on-disk
   * value in its spec-bound unit (`IfcSite.RefElevation` is always in
   * project length unit, not MapUnit — IfcSite predates MapConversion).
   */
  projectLengthUnitShort: string;
  projectMetresPerUnit: number;
  /**
   * Fly the map camera to the IfcSite RefLat/RefLon. Surfaced as a
   * "Zoom to IfcSite" button so users can locate a site reference that
   * sits far from the MapConversion / model. The site's RefLat/RefLon are
   * WGS84 per the IFC spec, so this works even when the value is outside
   * the active CRS area of use (the case the button most exists for).
   */
  onZoomToSite: (site: { lat: number; lon: number }) => void;
}

/**
 * Verbatim IfcSite disclosure — parallels the IfcProjectedCRS /
 * IfcMapConversion / IfcRigidOperation sections. Always-shown core is
 * the three IfcRoot-inherited identity fields plus the IfcSite-specific
 * RefLat/RefLon/RefElev triple; everything else renders only when
 * populated so files without an address or LandTitleNumber don't carry
 * empty "—" rows.
 */
export function SiteSection({
  raw,
  outsideBbox,
  activeCrsCode,
  projectLengthUnitShort,
  projectMetresPerUnit,
  onZoomToSite,
}: SiteSectionProps) {
  if (raw == null) {
    return (
      <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
        <Row label="IfcSite" value="Not present" />
      </div>
    );
  }

  // Pulled out of the rows so the zoom button can both gate on presence and
  // pass narrowed numbers into its press handler (const narrowing flows into
  // the closure; reading raw.refLatitude there would re-widen to number|null).
  const lat = raw.refLatitude;
  const lon = raw.refLongitude;

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
          <span className="flex-1">{raw.entityName}</span>
        </Button>
      </Heading>

      <DisclosurePanel>
        <dl className="mt-2 space-y-1 border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
          {/* <Row label="GlobalId" value={raw.globalId ?? "—"} /> */}
          <Row label="Name" value={raw.name ?? "—"} />
          {raw.longName != null && <Row label="LongName" value={raw.longName} />}
          {raw.description != null && (
            <Row label="Description" value={raw.description} wrap />
          )}
          {raw.objectType != null && (
            <Row label="ObjectType" value={raw.objectType} />
          )}
          <Row
            label="RefLatitude"
            value={
              raw.refLatitude == null ? "—" : `${raw.refLatitude.toFixed(6)}°`
            }
          />
          <Row
            label="RefLongitude"
            value={
              raw.refLongitude == null ? "—" : `${raw.refLongitude.toFixed(6)}°`
            }
          />
          <Row
            label="RefElevation"
            value={
              raw.refElevation == null
                ? "—"
                : `${trimZeros(raw.refElevation / projectMetresPerUnit, 3)} ${projectLengthUnitShort}`
            }
          />
          {outsideBbox
            && raw.refLatitude != null
            && raw.refLongitude != null && (
            <p className="text-rose-700">
              <span aria-hidden="true" className="mr-1">
                ⚠
              </span>
              {activeCrsCode === null
                ? "Outside the active CRS area of use; not shown on map."
                : `Outside EPSG:${activeCrsCode} area of use; not shown on map.`}
            </p>
          )}
          {raw.landTitleNumber != null && (
            <Row label="LandTitleNumber" value={raw.landTitleNumber} />
          )}
          {raw.address != null && <AddressRows address={raw.address} />}
        </dl>

        {lat != null && lon != null && (
          <TooltipTrigger delay={300}>
            <Button
              aria-label="Zoom to IfcSite"
              onPress={() => {
                onZoomToSite({ lat, lon });
              }}
              className="mt-2 flex h-6 w-6 cursor-pointer border border-slate-300 items-center justify-center rounded text-slate-500 outline-none transition-colors duration-150 data-focus-visible:ring-2 data-focus-visible:ring-slate-500 data-hovered:bg-slate-200 data-hovered:text-slate-700"
            >
              <TargetIcon />
            </Button>
            <Tooltip
              placement="top"
              className="max-w-xs rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-md data-entering:animate-in data-entering:fade-in data-exiting:animate-out data-exiting:fade-out"
            >
              <OverlayArrow>
                <svg
                  width={8}
                  height={8}
                  viewBox="0 0 8 8"
                  className="fill-slate-900"
                >
                  <path d="M0 0 L4 4 L8 0" />
                </svg>
              </OverlayArrow>
              Zoom to IfcSite on the map
            </Tooltip>
          </TooltipTrigger>
        )}
      </DisclosurePanel>
    </Disclosure>
  );
}

interface AddressRowsProps {
  address: RawPostalAddress;
}

function AddressRows({ address }: AddressRowsProps) {
  return (
    <>
      {address.purpose != null && (
        <Row label="Address · Purpose" value={address.purpose} />
      )}
      {address.userDefinedPurpose != null && (
        <Row
          label="Address · UserDefinedPurpose"
          value={address.userDefinedPurpose}
        />
      )}
      {address.description != null && (
        <Row label="Address · Description" value={address.description} wrap />
      )}
      {address.internalLocation != null && (
        <Row label="Address · InternalLocation" value={address.internalLocation} />
      )}
      {address.addressLines != null && (
        <Row
          label="Address · Lines"
          value={address.addressLines.join(", ")}
          wrap
        />
      )}
      {address.postalBox != null && (
        <Row label="Address · PostalBox" value={address.postalBox} />
      )}
      {address.town != null && <Row label="Address · Town" value={address.town} />}
      {address.region != null && (
        <Row label="Address · Region" value={address.region} />
      )}
      {address.postalCode != null && (
        <Row label="Address · PostalCode" value={address.postalCode} />
      )}
      {address.country != null && (
        <Row label="Address · Country" value={address.country} />
      )}
    </>
  );
}
