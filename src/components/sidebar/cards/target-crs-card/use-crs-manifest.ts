import { useMemo, useSyncExternalStore } from "react";
import {
  type CrsOption,
  type ManifestSnapshot,
  getManifestSnapshot,
  subscribeManifest,
} from "../../../../lib/crs";

/**
 * Subscribe to the app-level CRS manifest store. Bridges the non-React
 * data source in `crs-manifest.ts` to React via `useSyncExternalStore`
 * so any subscriber re-renders the moment the manifest finishes loading.
 * The store itself is loaded eagerly from `app.tsx` via
 * `prefetchCrsManifest()`; this hook only reads.
 */
export function useManifestSnapshot(): ManifestSnapshot {
  return useSyncExternalStore(
    subscribeManifest,
    getManifestSnapshot,
    getManifestSnapshot,
  );
}

export interface FeaturedSplit {
  compound: ReadonlyArray<CrsOption>;
  projected: ReadonlyArray<CrsOption>;
}

export interface CrsManifest extends ManifestSnapshot {
  /** Resolved `featuredCodes` partitioned by kind (skips unknowns). Matches
   * the manifest's `compound`/`projected` split so the combobox can run a
   * single filter call per section. */
  featured: FeaturedSplit;
}

/**
 * Convenience wrapper around `useManifestSnapshot` that also resolves a
 * caller-supplied list of "featured" EPSG codes against the loaded
 * manifest, so the dropdown shows real names + areas, not bare numbers.
 */
export function useCrsManifest(
  featuredCodes: ReadonlyArray<number>,
): CrsManifest {
  const snapshot = useManifestSnapshot();

  const featured = useMemo<FeaturedSplit>(() => {
    const compound: Array<CrsOption> = [];
    const projected: Array<CrsOption> = [];
    for (const code of featuredCodes) {
      const option = snapshot.byCode.get(code);
      if (!option) continue;
      if (option.kind === "compound") {
        compound.push(option);
      } else {
        projected.push(option);
      }
    }
    return { compound, projected };
  }, [snapshot.byCode, featuredCodes]);

  return { ...snapshot, featured };
}
