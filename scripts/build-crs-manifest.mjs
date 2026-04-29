// Build the static CRS index shipped with the app.
//
// Reads epsg-index (a frozen snapshot of the EPSG dataset) and emits a
// single partitioned, sorted artifact in public/crs-index.json:
//
//   {
//     "compound":  [...sorted by code, full entries with proj4]
//     "projected": [...sorted by code, full entries with proj4]
//     "vertical":  [...sorted by code, name + area + bbox only]
//   }
//
// Per the IFC 4.3 spec for IfcProjectedCRS, a 3D georeferenced model
// "shall be a compound coordinate reference system" — i.e., Name should
// be a compound EPSG code (e.g. EPSG:7415 = RD New + NAP) when one
// exists, so both the geodetic and the vertical datum are unambiguous.
// proj4js only uses the horizontal component of a compound; the vertical
// part round-trips through the IFC file as part of the EPSG code.
//
// All data finessing (filter, partition, sort, area-trim, code-coerce
// to number) happens here so the runtime just reads a snapshot.
//
// CRS_OVERRIDES — for grid-distorted national CRSs whose epsg-index proj4
// strings give bad accuracy. Applied to matching entries before emit.
// See docs/crs-datum-grids.md for the full rationale and accuracy
// measurements. Adding a new override:
//   1. Edit CRS_OVERRIDES below.
//   2. `npm run build:manifest`.
//   3. `python3 scripts/generate-crs-fixtures.py --crs <code>` to refresh
//      the verification fixture.
//   4. Commit all three files.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const allJsonPath = require.resolve("epsg-index/all.json");
const publicDir = resolve(here, "..", "public");
const outPath = resolve(publicDir, "crs-index.json");

/**
 * Per-CRS overrides. Applied to matching projected/compound entries
 * after the epsg-index pull but before emit. The runtime never sees the
 * pre-override proj4 string for these codes — that's the whole point.
 *
 *   proj4         — full corrected def, used verbatim by proj4.defs() at
 *                    runtime. Pre-baked, no regex surgery.
 *   accuracyNote  — user-facing badge text shown in the CRS card.
 *   grid          — if present, runtime fetches the binary from
 *                    cdn.proj.org and registers it via proj4.nadgrid()
 *                    before proj4.defs(). The +nadgrids=<key> reference
 *                    in `proj4` must match `grid.key`.
 */
const CRS_OVERRIDES = {
  // Netherlands — RD New. epsg-index ships +towgs84 values that are off
  // by ~170 m systematically across NL. The grid (RDNAPTRANS™ 2018)
  // brings it to ~1 cm.
  28992: {
    proj4:
      "+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 " +
      "+k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel " +
      "+nadgrids=rdtrans2018 +units=m +no_defs +type=crs",
    accuracyNote: "<1 cm via GeoTIFF grid (RDNAPTRANS™ 2018)",
    grid: {
      key: "rdtrans2018",
      filename: "nl_nsgi_rdtrans2018.tif",
      format: "geotiff",
    },
  },

  // Netherlands — RD New + NAP compound. Same horizontal proj4 as 28992;
  // the runtime dedups grid loads by `grid.key` so this re-uses the same
  // binary.
  7415: {
    proj4:
      "+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 " +
      "+k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel " +
      "+nadgrids=rdtrans2018 +units=m +no_defs +type=crs",
    accuracyNote: "<1 cm via GeoTIFF grid (RDNAPTRANS™ 2018)",
    grid: {
      key: "rdtrans2018",
      filename: "nl_nsgi_rdtrans2018.tif",
      format: "geotiff",
    },
  },

  // Belgium — Lambert 72 (BD72). epsg-index proj4 string is ~65 m off
  // across BE. NGI grid (BD72 → ETRS89) brings it to ~1 cm.
  31370: {
    proj4:
      "+proj=lcc +lat_0=90 +lon_0=4.36748666666667 " +
      "+lat_1=51.1666672333333 +lat_2=49.8333339 " +
      "+x_0=150000.013 +y_0=5400088.438 +ellps=intl " +
      "+nadgrids=bd72lb72_etrs89lb08 +units=m +no_defs +type=crs",
    accuracyNote: "<1 cm via GeoTIFF grid (BD72 → ETRS89)",
    grid: {
      key: "bd72lb72_etrs89lb08",
      filename: "be_ign_bd72lb72_etrs89lb08.tif",
      format: "geotiff",
    },
  },

  // Luxembourg — Luxembourg 1930 / Gauss. No grid needed: the country is
  // small enough (~2,500 km²) that a single 7-parameter Helmert is exactly
  // sufficient. epsg-index ships values from EPSG operation 1192 — Mol-Badekas
  // translations without the pivot point. Replace with operation 5485
  // (standard Helmert), rotations sign-converted from coordinate-frame to
  // proj4's position-vector convention. Verified to 0 m at every test point
  // against pyproj.
  2169: {
    proj4:
      "+proj=tmerc +lat_0=49.8333333333333 +lon_0=6.16666666666667 " +
      "+k=1 +x_0=80000 +y_0=100000 +ellps=intl " +
      "+towgs84=-189.6806,18.3463,-42.7695,-0.33746,-3.09264,2.53861,0.4598 " +
      "+units=m +no_defs +type=crs",
    accuracyNote: "<1 m via EPSG op 5485 (verified 0 m at fixture points)",
    // No grid — towgs84 fix only.
  },
};

function trimmedOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function applyOverride(entry) {
  const override = CRS_OVERRIDES[entry.code];
  if (!override) return entry;
  return {
    ...entry,
    proj4: override.proj4,
    accuracyNote: override.accuracyNote,
    grid: override.grid ?? null,
  };
}

const raw = JSON.parse(await readFile(allJsonPath, "utf8"));

const compound = [];
const projected = [];
const vertical = [];
let skippedGeographic = 0;

for (const entry of Object.values(raw)) {
  // No proj4 → unusable for horizontal CRS. epsg-index already drops
  // most deprecated entries this way; whatever survives is broadly in
  // active use somewhere.
  if (entry.kind === "CRS-PROJCRS") {
    if (!entry.proj4) continue;
    projected.push(applyOverride({
      code: Number(entry.code),
      name: entry.name,
      proj4: entry.proj4,
      area: trimmedOrNull(entry.area),
      bbox: entry.bbox ?? null,
      accuracyNote: null,
      grid: null,
    }));
    continue;
  }
  if (entry.kind === "CRS-COMPOUNDCRS") {
    if (!entry.proj4) continue;
    // Skip compounds whose horizontal component is geographic (lat/lon).
    // IfcMapConversion expects projected easting/northing in metric-like
    // units; a geographic-horizontal compound would resolve to coordinates
    // in degrees and silently produce wrong georeferencing. Examples:
    // EPSG:5498 (NAD83 + NAVD88 height), 5628 (SWEREF99 + RH2000 height).
    if (entry.proj4.includes("+proj=longlat")) {
      skippedGeographic++;
      continue;
    }
    compound.push(applyOverride({
      code: Number(entry.code),
      name: entry.name,
      proj4: entry.proj4,
      area: trimmedOrNull(entry.area),
      bbox: entry.bbox ?? null,
      accuracyNote: null,
      grid: null,
    }));
    continue;
  }
  if (entry.kind === "CRS-VERTCRS") {
    vertical.push({
      code: Number(entry.code),
      name: entry.name,
      area: trimmedOrNull(entry.area),
      bbox: entry.bbox ?? null,
    });
    continue;
  }
}

const byCode = (a, b) => a.code - b.code;
compound.sort(byCode);
projected.sort(byCode);
vertical.sort(byCode);

await mkdir(publicDir, { recursive: true });
await writeFile(outPath, JSON.stringify({ compound, projected, vertical }));

const toMb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const bytes = (await readFile(outPath)).byteLength;

// Sanity check: every override should have matched an entry in the input.
// If it didn't, the EPSG code is wrong or epsg-index dropped the entry.
const overriddenCodes = new Set(Object.keys(CRS_OVERRIDES).map(Number));
const matched = new Set(
  [...compound, ...projected]
    .filter((e) => e.accuracyNote != null)
    .map((e) => e.code),
);
const missing = [...overriddenCodes].filter((c) => !matched.has(c));
if (missing.length > 0) {
  throw new Error(
    `CRS_OVERRIDES has codes that don't match any epsg-index entry: ${missing.join(", ")}`,
  );
}

console.log(
  `Wrote ${outPath}: ${compound.length} compound + ${projected.length} projected + ${vertical.length} vertical (${toMb(bytes)} MB)`,
);
console.log(
  `  Skipped ${skippedGeographic} compounds with geographic horizontal`,
);
console.log(
  `  Applied ${matched.size} per-CRS overrides: ${[...matched].sort((a, b) => a - b).join(", ")}`,
);
