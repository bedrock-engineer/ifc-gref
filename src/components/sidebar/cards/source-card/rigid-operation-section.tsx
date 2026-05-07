import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import type { RawRigidOperation } from "#modules/ifc/worker";
import { Row } from "./row";

function trimZeros(n: number, maxDecimals: number): string {
  return Number.parseFloat(n.toFixed(maxDecimals)).toString();
}

interface RigidOperationSectionProps {
  raw: RawRigidOperation | null;
}

/**
 * IFC 4.3 IfcRigidOperation — translation-only sibling of IfcMapConversion.
 * Read-only display: when present, the file carries a CoordinateOperation
 * that the editor isn't using (the editor still drives writes through
 * IfcMapConversion). Section is hidden entirely when no IfcRigidOperation
 * is in the file, so we don't pad the sidebar with a "Not present" row for
 * an entity most files won't have.
 */
export function RigidOperationSection({ raw }: RigidOperationSectionProps) {
  if (raw == null) {
    return null;
  }

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
          <span className="flex-1">IfcRigidOperation</span>
        </Button>
      </Heading>

      <DisclosurePanel>
        <dl className="mt-2 space-y-1 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
          <Row
            label="FirstCoordinate"
            value={trimZeros(raw.firstCoordinate, 3)}
          />
          <Row
            label="SecondCoordinate"
            value={trimZeros(raw.secondCoordinate, 3)}
          />
          <Row
            label="Height"
            value={raw.height == null ? "—" : trimZeros(raw.height, 3)}
          />
          <Row label="TargetCRS" value={raw.targetCrsName ?? "—"} />
        </dl>
      </DisclosurePanel>
    </Disclosure>
  );
}
