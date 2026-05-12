import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
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
}: SiteSectionProps) {
  if (raw == null) {
    return (
      <div className="border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
        <Row label="IfcSite" value="Not present" />
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
