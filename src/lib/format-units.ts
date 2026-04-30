import { type CrsDef } from "./crs-types";
import { unitToMetres } from "./units";

export interface UnitDescriptor {
  /** Long form for header strips, e.g. "millimetre". */
  label: string;
  /** Short symbol for tabular values, e.g. "mm". */
  short: string;
  /** Intl.NumberFormat "simple unit" identifier (US spelling), or null if
   *  Intl can't render this unit (e.g. US survey foot, nautical mile). */
  intl: string | null;
}

interface Entry {
  metres: number;
  label: string;
  short: string;
  intl: string | null;
}

// Single source of truth for unit display. Keep entries in sync with
// UNIT_TO_METRES in lib/units.ts — anything `unitToMetres` knows should
// have a descriptor here too, so the IFC-name and CRS-metresPerUnit paths
// converge on the same label/symbol.
const ENTRIES: ReadonlyArray<Entry> = [
  { metres: 1,           label: "metre",          short: "m",  intl: "meter" },
  { metres: 0.001,       label: "millimetre",     short: "mm", intl: "millimeter" },
  { metres: 0.01,        label: "centimetre",     short: "cm", intl: "centimeter" },
  { metres: 0.3048,      label: "foot",           short: "ft", intl: "foot" },
  { metres: 1200 / 3937, label: "US survey foot", short: "ft", intl: null },
  { metres: 0.0254,      label: "inch",           short: "in", intl: "inch" },
  { metres: 0.9144,      label: "yard",           short: "yd", intl: "yard" },
  { metres: 1609.344,    label: "mile",           short: "mi", intl: "mile" },
  { metres: 1852,        label: "nautical mile",  short: "NM", intl: null },
];

const UNKNOWN: UnitDescriptor = { label: "unknown", short: "u", intl: null };

function lookupByMetres(metresPerUnit: number): UnitDescriptor | null {
  const match = ENTRIES.find(
    (entry) => Math.abs(entry.metres - metresPerUnit) < 1e-12,
  );
  if (!match) {
    return null;
  }
  return { label: match.label, short: match.short, intl: match.intl };
}

/**
 * Describe an IFC length unit by name (as read from IfcUnitAssignment, e.g.
 * "MILLIMETRE", "METER"). Falls back to the lowercased name when the unit
 * isn't in the conversion table — at least the user sees the file's own
 * spelling rather than a generic "unknown".
 */
export function describeIfcUnit(name: string): UnitDescriptor {
  const metres = unitToMetres(name);
  if (metres.isErr()) {
    return { label: name.toLowerCase(), short: "u", intl: null };
  }
  return lookupByMetres(metres.value) ?? UNKNOWN;
}

/**
 * Describe a projected CRS's native unit via its metresPerUnit factor.
 * proj4 doesn't always populate a `units` string, so we key on the ratio
 * instead. Falls back to "<m> m" for unrecognised ratios so the header
 * strip still names the unit numerically.
 */
export function describeCrsUnit(crs: CrsDef | null): UnitDescriptor {
  if (!crs) {
    return UNKNOWN;
  }
  const match = lookupByMetres(crs.metresPerUnit);
  if (match) {
    return match;
  }
  return { label: `${crs.metresPerUnit} m`, short: "u", intl: null };
}
