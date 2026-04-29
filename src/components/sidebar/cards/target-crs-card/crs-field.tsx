import { useMemo, type KeyboardEvent } from "react";
import {
  Button,
  ComboBox,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { filterCrsOptions, type CrsOption } from "../../../../lib/crs";
import { useCrsCommit } from "./use-crs-commit";
import { useCrsManifest } from "./use-crs-manifest";

/**
 * Visual grouping is achieved with `isDisabled` "header rows" inside a flat
 * ListBox rather than `<ListBoxSection>` — see adobe/react-spectrum#9405
 * (RA's nested CollectionNode tree + React 19.2 DevTools = field locks up
 * on edit). The docs guarantee disabled items "cannot be selected, focused,
 * or otherwise interacted with," so they read as labels.
 */
type FlatRow =
  | { kind: "header"; id: "header-compound" | "header-horizontal"; title: string }
  | (CrsOption & { id: number });

/**
 * Curated dropdown shortlist when the input is empty. Compounds lead per
 * the IFC 4.3 spec preference for 3D contexts.
 */
const FEATURED_CODES: ReadonlyArray<number> = [
  7415, //  Amersfoort / RD New + NAP height (NL, compound)
  5555, //  ETRS89 / UTM zone 32N + DHHN92 height (DE, compound)
  5972, //  ETRS89 / UTM zone 32N + NN2000 height (NO, compound)
  28_992, // Amersfoort / RD New (NL, horizontal only)
  3857, //  WGS 84 / Pseudo-Mercator (web maps)
];

/**
 * Cap rendered suggestions. The full manifest is 6.5k entries; the filter
 * exits early at MAX_RESULTS so a hot-typed prefix doesn't walk the whole
 * list. 50 is plenty — users narrow further by typing more digits / a name.
 */
const MAX_RESULTS = 50;

interface CrsFieldProps {
  /** Seed for the input on mount. Subsequent prop changes are ignored —
   * the field owns its input state for its lifetime. File loads remount
   * the entire Workspace (via `key={fileName}`), which gives this field a
   * fresh mount with the new initial code. */
  initialCode: string;
  /** Fires when the user commits a new EPSG code (Enter / blur / dropdown
   * select). Numeric-validated locally before propagating. */
  onCommit: (code: string) => void;
}

/**
 * Self-contained EPSG-code combobox. Owns the local input + commit flow
 * (via `useCrsCommit`) and reads the manifest snapshot directly.
 */
export function CrsField({ initialCode, onCommit }: CrsFieldProps) {
  const { input, syntaxError, onInputChange, onCommit: handleCommit, onSelect } =
    useCrsCommit(initialCode, onCommit);

  const { compound, projected, featured } = useCrsManifest(FEATURED_CODES);
  const manifestEmpty = compound.length === 0 && projected.length === 0;

  const { rows, truncated } = useMemo(() => {
    const compoundResult = filterCrsOptions(
      input,
      compound,
      featured.compound,
      MAX_RESULTS,
    );
    const projectedResult = filterCrsOptions(
      input,
      projected,
      featured.projected,
      MAX_RESULTS,
    );
    const flat: Array<FlatRow> = [];
    if (compoundResult.items.length > 0) {
      flat.push({
        kind: "header",
        id: "header-compound",
        title: "Compound (recommended for 3D)",
      });
      for (const item of compoundResult.items) {
        flat.push({ ...item, id: item.code });
      }
    }
    if (projectedResult.items.length > 0) {
      flat.push({
        kind: "header",
        id: "header-horizontal",
        title: "Horizontal only",
      });
      for (const item of projectedResult.items) {
        flat.push({ ...item, id: item.code });
      }
    }
    return {
      rows: flat,
      truncated: compoundResult.truncated || projectedResult.truncated,
    };
  }, [input, compound, projected, featured]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCommit(input);
    }
  }

  return (
    <>
      <ComboBox
        inputValue={input}
        onInputChange={onInputChange}
        onChange={onSelect}
        allowsCustomValue
        menuTrigger="focus"
        // We filter externally (filterCrsOptions: name + area-of-use). Without
        // this, RA's default filter compares the typed input against each item's
        // `textValue` (which is the EPSG code as a string), so typing "Amersfoort"
        // would hide every item.
        defaultFilter={() => true}
        className="flex flex-col gap-1"
      >
        <Label className="text-xs text-slate-600">EPSG code</Label>

        <Group className="flex items-center rounded border border-slate-300 bg-white focus-within:border-slate-500">
          <Input
            placeholder="e.g. 7415, 28992 or RD New"
            className="w-full min-w-0 bg-transparent px-2 py-1 font-mono text-sm outline-none"
            onBlur={() => {
              handleCommit(input);
            }}
            onKeyDown={handleKeyDown}
          />

          <Button
            aria-label="Show suggestions"
            className="border-l border-slate-200 px-2 py-1 text-xs text-slate-500 outline-none hover:bg-slate-100 focus-visible:bg-slate-100"
          >
            ▾
          </Button>
        </Group>

        <Popover className="w-(--trigger-width) rounded border border-slate-200 bg-white shadow-md">
          <ListBox<FlatRow>
            className="max-h-64 overflow-auto outline-none"
            items={rows}
            renderEmptyState={() => (
              <div className="px-2 py-1.5 text-xs text-slate-400">
                {manifestEmpty ? "Loading CRS index…" : "No matches."}
              </div>
            )}
          >
            {renderRow}
          </ListBox>
          {truncated && (
            <div className="border-t border-slate-100 px-2 py-1 text-[11px] text-slate-500">
              Showing first {MAX_RESULTS} matches, keep typing to refine.
            </div>
          )}
        </Popover>
      </ComboBox>

      {syntaxError && <p className="text-xs text-amber-700">{syntaxError}</p>}
    </>
  );
}

function renderRow(row: FlatRow) {
  if (row.kind === "header") {
    return (
      <ListBoxItem
        id={row.id}
        textValue={row.title}
        isDisabled
        className="cursor-default select-none bg-slate-50 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"
      >
        {row.title}
      </ListBoxItem>
    );
  }
  return (
    <ListBoxItem
      id={row.id}
      textValue={String(row.code)}
      className="cursor-pointer px-2 py-1.5 text-xs outline-none data-focused:bg-slate-100 data-selected:bg-slate-100"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-slate-900">EPSG:{row.code}</span>

        <span className="truncate text-slate-700">{row.name}</span>
      </div>

      <div className="truncate text-slate-500">{row.areaOfUse ?? " "}</div>
    </ListBoxItem>
  );
}
