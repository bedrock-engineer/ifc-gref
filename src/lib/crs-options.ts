import type { CrsOption, VerticalDatumOption } from "./crs-types";

/**
 * Combobox filter for the target-CRS picker. Empty input → `featured`
 * shortlist, all-digit input → prefix-match on code, anything else →
 * case-insensitive substring match on name OR area-of-use (so e.g.
 * "Amsterdam" finds CRSs whose area-of-use covers it, even when the
 * CRS name itself is "Amersfoort / RD New"). Walks `all` once per call
 * but exits early when `maxResults` is reached.
 *
 * Returns matches in the order of `all` (compound-first); the combobox
 * partitions the result into sections.
 */
export function filterCrsOptions(
  input: string,
  all: ReadonlyArray<CrsOption>,
  featured: ReadonlyArray<CrsOption>,
  maxResults: number,
): { items: Array<CrsOption>; truncated: boolean } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { items: featured.slice(), truncated: false };
  }

  const matches = makeCrsMatcher(trimmed);
  const items: Array<CrsOption> = [];
  let truncated = false;
  for (const option of all) {
    if (!matches(option)) {
      continue;
    }
    if (items.length >= maxResults) {
      truncated = true;
      break;
    }
    items.push(option);
  }
  return { items, truncated };
}

function makeCrsMatcher(trimmed: string): (option: CrsOption) => boolean {
  if (/^\d+$/.test(trimmed)) {
    return (option) => String(option.code).startsWith(trimmed);
  }
  const lower = trimmed.toLowerCase();
  return (option) =>
    option.name.toLowerCase().includes(lower) ||
    (option.areaOfUse?.toLowerCase().includes(lower) ?? false);
}

/**
 * Combobox filter for the vertical-datum picker. Empty input → entire
 * list, all-digit input → prefix-match on code, anything else →
 * case-insensitive substring match across name, EPSG code, and area.
 */
export function filterVerticalDatumOptions(
  input: string,
  all: ReadonlyArray<VerticalDatumOption>,
): Array<VerticalDatumOption> {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return all.slice();
  }
  if (/^\d+$/.test(trimmed)) {
    return all.filter((option) => String(option.code).startsWith(trimmed));
  }
  const lower = trimmed.toLowerCase();
  return all.filter(
    (option) =>
      option.name.toLowerCase().includes(lower) ||
      `epsg:${option.code}`.includes(lower) ||
      (option.areaOfUse?.toLowerCase().includes(lower) ?? false),
  );
}
