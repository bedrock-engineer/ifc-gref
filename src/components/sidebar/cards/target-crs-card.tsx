import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
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
} from "react-aria-components";
import {
  filterCrsOptions,
  getCrsOptions,
  prefetchCrsManifest,
  type CrsLookupState,
  type CrsOption,
} from "../../../lib/crs";
import { useCrsCommit } from "../../hooks/use-crs-commit";
import { Card } from "../card";
import { ProvenanceBadge, type Provenance } from "../provenance-badge";

interface TargetCrsCardProps {
  epsgCode: string;
  crsState: CrsLookupState;
  onChange: (code: string) => void;
  fromFile: boolean;
}

/**
 * Shown in the combobox dropdown when the input is empty — a tiny curated
 * set of common projected CRS so users don't stare at a blank list. All
 * other matches come from filtering the full manifest.
 */
const FEATURED_CODES: ReadonlyArray<number> = [
  28_992, // Amersfoort / RD New (NL)
  3857, //  WGS 84 / Pseudo-Mercator (web maps)
  32_631, // WGS 84 / UTM zone 31N (NL offshore, BE, NW-Europe)
  32_632, // WGS 84 / UTM zone 32N (DE, CH, IT N)
  2272, //  NAD83 / Pennsylvania South (ft)
];

/**
 * Subscribe to manifest options. Returns [] until the manifest has loaded;
 * triggers `prefetchCrsManifest` if it hasn't been called yet so the card
 * works standalone even if the app-mount prefetch hasn't been wired.
 */
function useCrsOptions(): Array<CrsOption> {
  const [options, setOptions] = useState<Array<CrsOption>>(() => getCrsOptions());

  useEffect(() => {
    if (options.length > 0) {
      return;
    }
    let cancelled = false;
    void prefetchCrsManifest().then(() => {
      if (!cancelled) {
        setOptions(getCrsOptions());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [options.length]);

  return options;
}

export function TargetCrsCard({
  epsgCode,
  crsState,
  onChange,
  fromFile,
}: TargetCrsCardProps) {
  const { input, status, committedManually, onInputChange, onCommit, onSelect } =
    useCrsCommit(epsgCode, onChange);
  const allOptions = useCrsOptions();

  const featuredOptions = useMemo<Array<CrsOption>>(() => {
    if (allOptions.length === 0) {
      return [];
    }
    const byCode = new Map(allOptions.map((o) => [o.code, o]));
    const featured: Array<CrsOption> = [];
    for (const code of FEATURED_CODES) {
      const option = byCode.get(code);
      if (option) {
        featured.push(option);
      }
    }
    return featured;
  }, [allOptions]);

  const items = useMemo(
    () => filterCrsOptions(input, allOptions, featuredOptions),
    [input, allOptions, featuredOptions],
  );

  let provenance: Provenance = "default";
  if (committedManually) {
    provenance = "manual";
  } else if (fromFile) {
    provenance = "file";
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(input);
    }
  }

  return (
    <Card
      title="Target CRS"
      headerAside={<ProvenanceBadge provenance={provenance} />}
    >
      <ComboBox
        inputValue={input}
        onInputChange={onInputChange}
        onChange={onSelect}
        items={items}
        allowsCustomValue
        menuTrigger="focus"
        className="flex flex-col gap-1"
      >
        <Label className="text-xs text-slate-600">EPSG code</Label>
        <Group className="flex items-center rounded border border-slate-300 bg-white focus-within:border-slate-500">
          <Input
            placeholder="e.g. 28992 or “RD New”"
            className="w-full min-w-0 bg-transparent px-2 py-1 font-mono text-sm outline-none"
            onBlur={() => {
              onCommit(input);
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
          <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 44 }}>
            <ListBox<CrsOption>
              className="max-h-64 outline-none"
              renderEmptyState={() => (
                <div className="px-2 py-1.5 text-xs text-slate-400">
                  {allOptions.length === 0
                    ? "Loading CRS index…"
                    : "No matches."}
                </div>
              )}
            >
              {(item) => (
                <ListBoxItem
                  id={item.code}
                  textValue={String(item.code)}
                  className="cursor-pointer px-2 py-1.5 text-xs outline-none data-focused:bg-slate-100 data-selected:bg-slate-100"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-slate-900">
                      EPSG:{item.code}
                    </span>
                    <span className="truncate text-slate-700">{item.name}</span>
                  </div>
                  <div className="truncate text-slate-500">
                    {item.areaOfUse ?? "\u00A0"}
                  </div>
                </ListBoxItem>
              )}
            </ListBox>
          </Virtualizer>
        </Popover>
      </ComboBox>
      {status.kind === "checking" && (
        <p className="text-xs text-slate-500">Checking EPSG:{status.code}…</p>
      )}
      {status.kind === "rejected" && (
        <p className="text-xs text-amber-700">{status.message}</p>
      )}
      {status.kind !== "checking" && <LookupDisplay state={crsState} />}
    </Card>
  );
}

interface LookupDisplayProps {
  state: CrsLookupState;
}

/**
 * Renders the resolved CRS name/area (or a loading/error placeholder)
 * directly off the state Workspace already computed — no second lookup.
 */
function LookupDisplay({ state }: LookupDisplayProps) {
  if (state.kind === "invalid-code") {
    return <p className="text-xs text-slate-400">Enter an EPSG code.</p>;
  }
  if (state.kind === "resolving") {
    return (
      <p className="text-xs text-slate-500">Looking up EPSG:{state.code}…</p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className="text-xs text-red-700">
        EPSG:{state.code} — {state.errorKind.replaceAll("-", " ")}
      </p>
    );
  }
  const { def } = state;
  return (
    <div className="space-y-1 rounded border border-slate-100 bg-slate-50 p-2 text-xs">
      <div className="font-medium text-slate-900">{def.name}</div>
      {def.areaOfUse && <div className="text-slate-600">{def.areaOfUse}</div>}
    </div>
  );
}
