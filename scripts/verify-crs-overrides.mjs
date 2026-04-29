// Verify each entry in CRS_OVERRIDES (via the built manifest) transforms
// projected fixture points to within tests/crs-overrides.fixtures.json's
// reference WGS84 (computed by pyproj). Network access required — grids
// fetched from cdn.proj.org.
//
// Run: npm run verify:crs
//
// See docs/crs-datum-grids.md for the why; this script is the safety net
// catching any accidental regression in the override path (epsg-index
// drift, geotiff.js API drift, typo in build-crs-manifest.mjs, …).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import proj4 from "proj4";
import { fromArrayBuffer } from "geotiff";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, "..", "public", "crs-index.json");
const fixturePath = resolve(here, "..", "tests", "crs-overrides.fixtures.json");
const CDN_BASE = "https://cdn.proj.org";

function adaptForProj4(tiff) {
  return {
    getImageCount: () => tiff.getImageCount(),
    getImage: async (idx) => {
      const img = await tiff.getImage(idx);
      const [scaleX, scaleY] = img.getResolution();
      return new Proxy(img, {
        get(target, prop) {
          if (prop === "fileDirectory") {
            return { ModelPixelScale: [Math.abs(scaleX), Math.abs(scaleY), 0] };
          }
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    },
  };
}

function haversineMeters(a, b) {
  // a, b: [lon, lat] in degrees
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

const byCode = new Map();
for (const entry of [...manifest.compound, ...manifest.projected]) {
  byCode.set(entry.code, entry);
}

const loadedGrids = new Set();

async function loadGrid(spec) {
  if (loadedGrids.has(spec.key)) return;
  const url = `${CDN_BASE}/${spec.filename}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (spec.format !== "geotiff") {
    throw new Error(`Unsupported grid format: ${spec.format}`);
  }
  const tiff = await fromArrayBuffer(buffer);
  const grid = proj4.nadgrid(spec.key, adaptForProj4(tiff));
  if (grid?.ready) await grid.ready;
  loadedGrids.add(spec.key);
  console.log(
    `  loaded ${spec.filename} (${(buffer.byteLength / 1024).toFixed(0)} KB)`,
  );
}

const threshold = fixture._threshold_m ?? 0.5;
console.log(
  `Verification fixture: ${fixture._generated} (threshold ${threshold} m)`,
);

let failures = 0;
for (const [codeStr, points] of Object.entries(fixture.fixtures)) {
  const code = Number(codeStr);
  const entry = byCode.get(code);
  if (!entry) {
    console.error(`✗ EPSG:${code}: not found in manifest`);
    failures++;
    continue;
  }
  console.log(`\nEPSG:${code} (${entry.name})`);
  if (entry.grid) {
    try {
      await loadGrid(entry.grid);
    } catch (e) {
      console.error(`✗ EPSG:${code}: grid load failed — ${e.message}`);
      failures++;
      continue;
    }
  }
  try {
    proj4.defs(`EPSG:${code}`, entry.proj4);
  } catch (e) {
    console.error(`✗ EPSG:${code}: proj4.defs failed — ${e.message}`);
    failures++;
    continue;
  }

  let codeFailures = 0;
  for (const { projected, wgs84 } of points) {
    const [lon, lat] = proj4(`EPSG:${code}`, "EPSG:4326", projected);
    const distance = haversineMeters([lon, lat], wgs84);
    const ok = distance < threshold;
    const mark = ok ? "✓" : "✗";
    console.log(
      `  ${mark} (${projected[0]}, ${projected[1]}) → (${lon.toFixed(7)}, ${lat.toFixed(7)})  Δ ${distance.toFixed(3)} m`,
    );
    if (!ok) {
      codeFailures++;
      failures++;
    }
  }
  if (codeFailures === 0) {
    console.log(`  → all ${points.length} points within ${threshold} m`);
  }
}

console.log("");
if (failures > 0) {
  console.error(`✗ Verification failed: ${failures} mismatch(es)`);
  process.exit(1);
}
console.log("✓ All overrides match reference within threshold.");
