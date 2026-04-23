// Build the static CRS manifest shipped with the app.
//
// Reads epsg-index (a frozen snapshot of the EPSG dataset; 
// keeps only entries we can actually project through — ProjectedCRS
// and CompoundCRS — and trims each to the fields proj4js needs plus a bbox
// for future area-of-use validation. Output lands in public/ so Vite copies
// it to the build root; the app lazy-fetches it on first non-static lookup.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const allJsonPath = require.resolve("epsg-index/all.json");
const outPath = resolve(here, "..", "public", "crs-index.json");

const raw = JSON.parse(await readFile(allJsonPath, "utf8"));

const manifest = {};
let kept = 0;
for (const entry of Object.values(raw)) {
  if (entry.kind !== "CRS-PROJCRS" && entry.kind !== "CRS-COMPOUNDCRS") {
    continue;
  }
  // Some CRS entries in epsg-index have no proj4 string — they're unusable
  // for projection, so don't ship them in the manifest.
  if (!entry.proj4) {
    continue;
  }
  manifest[entry.code] = {
    name: entry.name,
    proj4: entry.proj4,
    area: entry.area ?? null,
    bbox: entry.bbox ?? null,
  };
  kept++;
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(manifest));

const toMb = (bytes) => (bytes / 1024 / 1024).toFixed(2);

const bytes = (await readFile(outPath)).byteLength;
console.log(`Wrote ${outPath} (${kept} CRS entries, ${toMb(bytes)} MB)`);
