import { type KeyboardEvent, useMemo, useState } from "react";
import {
  Button,
  ComboBox,
  Group,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  ListLayout,
  Popover,
  Virtualizer,
  type Key,
} from "react-aria-components";
import {
  filterVerticalDatumOptions,
  type VerticalDatumOption,
} from "../../../../lib/crs";
import { useManifestSnapshot } from "./use-crs-manifest";

interface VerticalDatumPickerProps {
  /** Seed for the input on mount. Subsequent prop changes are ignored —
   * the picker owns its input state for its lifetime. File loads remount
   * the entire Workspace (via `key={fileName}`), which gives this picker a
   * fresh mount with the new initial value. */
  initialValue: string | null;
  /** Fires when the user commits a value (Enter / blur / dropdown select).
   * Empty/whitespace-only input becomes null. */
  onCommit: (value: string | null) => void;
  fromFile: boolean;
}

/**
 * Sibling field for the projected-only path: the user picks a vertical
 * datum that gets written into IfcProjectedCRS.VerticalDatum. Spec says
 * this is required for spec-compliant 3D georef when the horizontal Name
 * doesn't already encode it (i.e. non-compound). The card hides this
 * picker entirely when the horizontal choice is compound or unresolved.
 *
 * Writes whatever string the user commits — picked option resolves to
 * `EPSG:<code>` (the spec-recommended form), freetext is preserved
 * verbatim to support legacy short labels like "NAP" or "DHHN2016".
 * Empty input means "leave VerticalDatum unset".
 */
export function VerticalDatumPicker({
  initialValue,
  onCommit,
  fromFile,
}: VerticalDatumPickerProps) {
  const allOptions = useManifestSnapshot().vertical;
  const [input, setInput] = useState(() => initialValue ?? "");

  const items = useMemo(
    () => filterVerticalDatumOptions(input, allOptions),
    [input, allOptions],
  );

  function commitValue(next: string) {
    const trimmed = next.trim();
    onCommit(trimmed.length === 0 ? null : trimmed);
  }

  function handleSelect(key: Key | null) {
    if (key === null) {
      return;
    }
    const code = Number(key);
    const option = allOptions.find((o) => o.code === code);
    if (!option) {
      return;
    }
    const epsgValue = `EPSG:${option.code}`;
    setInput(epsgValue);
    onCommit(epsgValue);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitValue(input);
    }
  }

  const isMissing =
    initialValue === null || initialValue.trim().length === 0;

  return (
    <div className="mt-3 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-slate-600">
          Vertical datum (required for 3D)
        </Label>
        
        {fromFile && (
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            from file
          </span>
        )}
      </div>

      {isMissing && (
        <p className="text-[11px] text-amber-700">
          Horizontal CRS alone is ambiguous in 3D contexts. Pick a vertical
          datum, or switch to a compound CRS (e.g. EPSG:7415).
        </p>
      )}

      <ComboBox
        inputValue={input}
        onInputChange={setInput}
        onChange={handleSelect}
        allowsCustomValue
        menuTrigger="input"
        // We filter externally (filterVerticalDatumOptions: name + code +
        // area-of-use). Without this, RA's default filter compares the typed
        // input against each item's `textValue` (which is `EPSG:<code>`), so
        // typing "NAP" would hide every item.
        defaultFilter={() => true}
        className="flex flex-col gap-1"
      >
        <Group className="flex items-center rounded border border-slate-300 bg-white focus-within:border-slate-500">
          <Input
            placeholder="e.g. EPSG:5709 or NAP"
            className="w-full min-w-0 bg-transparent px-2 py-1 font-mono text-sm outline-none"
            onBlur={() => {
              commitValue(input);
            }}
            onKeyDown={handleKeyDown}
          />

          <Button
            aria-label="Show vertical datum suggestions"
            className="border-l border-slate-200 px-2 py-1 text-xs text-slate-500 outline-none hover:bg-slate-100 focus-visible:bg-slate-100"
          >
            ▾
          </Button>
        </Group>

        <Popover className="w-(--trigger-width) rounded border border-slate-200 bg-white shadow-md">
          <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 52 }}>
            <ListBox<VerticalDatumOption>
              className="max-h-64 outline-none"
              items={items}
              renderEmptyState={() => (
                <div className="px-2 py-1.5 text-xs text-slate-400">
                  {allOptions.length === 0
                    ? "Loading vertical-datum index…"
                    : "No matches."}
                </div>
              )}
            >
              {(item) => (
                <ListBoxItem
                  id={item.code}
                  textValue={`EPSG:${item.code}`}
                  className="cursor-pointer px-2 py-1.5 text-xs outline-none data-focused:bg-slate-100 data-selected:bg-slate-100"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-slate-900">
                      EPSG:{item.code}
                    </span>
                    <span className="truncate text-slate-700">{item.name}</span>
                  </div>

                  <div className="truncate text-slate-500">
                    {item.areaOfUse ?? " "}
                  </div>
                </ListBoxItem>
              )}
            </ListBox>
          </Virtualizer>
        </Popover>
      </ComboBox>
    </div>
  );
}
