/**
 * Provenance tag for a field or a whole card, per georef-ui-flow.md:
 *   - file       value came from the loaded IFC file as-is
 *   - derived    computed from file contents (lat/lon → E/N, TrueNorth → rotation)
 *   - map        set by map click or address search
 *   - manual     user edited directly
 *   - survey     produced by the Helmert solver from surveyed points
 *   - default    nothing set — showing a sensible placeholder
 */

export { type Provenance } from "../../lib/workspace-logic";
import type { Provenance } from "../../lib/workspace-logic";

const STYLES: Record<Provenance, string> = {
  file: "bg-slate-100 text-slate-700",
  derived: "bg-sky-100 text-sky-800",
  map: "bg-emerald-100 text-emerald-800",
  manual: "bg-amber-100 text-amber-800",
  survey: "bg-violet-100 text-violet-800",
  default: "bg-slate-50 text-slate-500",
};

const LABELS: Record<Provenance, string> = {
  file: "from file",
  derived: "derived",
  map: "from map",
  manual: "manual",
  survey: "survey fit",
  default: "default",
};

interface ProvenanceBadgeProps {
  provenance: Provenance;
}

export function ProvenanceBadge({ provenance }: ProvenanceBadgeProps) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[provenance]}`}
    >
      {LABELS[provenance]}
    </span>
  );
}
