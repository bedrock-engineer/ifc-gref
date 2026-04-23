import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { type RefObject, useRef, useState } from "react";
import {
  ComboBox,
  Group,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  type Key,
} from "react-aria-components";
import { emitLog } from "../../../lib/log";
import { ACCENT_COLOR } from "../style";
import { lookupPlace, useAddressSuggest, type Suggestion } from "./use-search";
import { useMapScope } from "./use-scope";

interface SearchBoxProps {
  mapRef: RefObject<MlMap | null>;
}

/**
 * Address / place search rendered into the map via `PortalControl`.
 * Dispatches to PDOK Locatieserver when the map is centred in the NL
 * bbox (best-in-class for Dutch addresses) and falls back to Nominatim
 * (OSM) worldwide. The selected place gets a teal marker and the
 * camera flies to it; the badge inside the input shows which provider
 * is active.
 */
export function SearchBox({ mapRef }: SearchBoxProps) {
  const scope = useMapScope(mapRef);
  const [query, setQuery] = useState("");
  const { suggestions, loading } = useAddressSuggest(query, scope);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  async function handleSelect(key: Key | null) {
    if (key === null) {
      return;
    }
    const id = String(key);
    const picked = suggestions.find((s) => s.id === id);
    if (picked) {
      setQuery(picked.label);
    }

    lookupAbortRef.current?.abort();
    const abort = new AbortController();
    lookupAbortRef.current = abort;

    const place = await lookupPlace(id, scope, abort.signal);
    if (!place) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      return;
    }
    placeMarker(map, markerRef, place.longitude, place.latitude);
    flyTo(map, place.longitude, place.latitude);
    emitLog({ message: `Flew to "${place.name}"` });
  }

  return (
    <div className="min-w-65 rounded bg-white px-2 py-1.5 shadow-[0_0_0_2px_rgba(0,0,0,0.1)]">
      <ComboBox
        items={suggestions}
        inputValue={query}
        onInputChange={setQuery}
        onChange={(key) => {
          void handleSelect(key);
        }}
        allowsCustomValue
        menuTrigger="input"
        aria-label="Search address, place, or postcode"
      >
        <Group className="relative flex items-center rounded border border-slate-300 focus-within:border-slate-500">
          <Input
            type="search"
            placeholder="Search address, place, or postcode…"
            autoComplete="off"
            spellCheck={false}
            className="w-full min-w-0 rounded bg-transparent py-1 pr-14 pl-2 text-xs text-slate-900 outline-none"
          />
          <ScopeBadge scope={scope} loading={loading} />
        </Group>
        <Popover className="w-(--trigger-width) rounded bg-white shadow-lg">
          <ListBox<Suggestion>
            className="max-h-64 overflow-auto text-xs text-slate-900 outline-none"
            renderEmptyState={() => (
              <div className="px-2.5 py-1.5 text-slate-400">
                {emptyStateMessage(query, loading)}
              </div>
            )}
          >
            {(item) => (
              <ListBoxItem
                id={item.id}
                textValue={item.label}
                className="cursor-pointer border-b border-slate-100 px-2.5 py-1.5 outline-none data-focused:bg-teal-50 data-selected:bg-teal-50"
              >
                {item.label}
              </ListBoxItem>
            )}
          </ListBox>
        </Popover>
      </ComboBox>
    </div>
  );
}

function emptyStateMessage(query: string, loading: boolean): string {
  if (query.trim().length < 2) {
    return "Type to search…";
  }
  return loading ? "Searching…" : "No matches.";
}

interface ScopeBadgeProps {
  scope: "nl" | "world";
  loading: boolean;
}

function ScopeBadge({ scope, loading }: ScopeBadgeProps) {
  const label = scope === "nl" ? "NL" : "World";
  const tooltip =
    scope === "nl"
      ? "Searching Dutch addresses via PDOK Locatieserver"
      : "Searching worldwide via Nominatim (OpenStreetMap)";
  return (
    <span
      aria-live="polite"
      title={tooltip}
      className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase"
    >
      {loading ? "…" : label}
    </span>
  );
}

function placeMarker(
  map: MlMap,
  markerRef: RefObject<maplibregl.Marker | null>,
  longitude: number,
  latitude: number,
): void {
  if (markerRef.current) {
    markerRef.current.setLngLat([longitude, latitude]);
    return;
  }
  markerRef.current = new maplibregl.Marker({ color: ACCENT_COLOR })
    .setLngLat([longitude, latitude])
    .addTo(map);
}

function flyTo(map: MlMap, longitude: number, latitude: number): void {
  map.flyTo({
    center: [longitude, latitude],
    zoom: Math.max(map.getZoom(), 14),
    // Cap duration — flyTo otherwise scales with zoom delta, which
    // made jumps from country-level (zoom 6) to street-level drag on.
    duration: 1400,
    curve: 1.2,
  });
}
