# IFC Georeferencer

Georeference an IFC (BIM) file in your browser. Place the model on a map,
solve the Helmert transform from your survey points, and download a file
with `IfcMapConversion` + `IfcProjectedCRS` written in.

**Your file never leaves your machine.** Everything runs client-side — no
uploads, no account, no server.

> Status: beta. Usable end-to-end, some rough edges.

## What it does

A BIM model's local coordinates (metres from some arbitrary origin on the
construction site) have to be placed in a real-world CRS before the model
can be combined with geodata, planning documents, or other buildings. The
IFC spec defines `IfcMapConversion` and `IfcProjectedCRS` for this; most
authoring tools either don't fill them in or fill them in wrong.

This tool:

1. Opens your IFC file and reads whatever georeferencing is already
   there (`IfcSite` lat/lon, `TrueNorth`, an existing `IfcMapConversion`,
   or the IFC2X3 `ePSet_MapConversion` fallback).
2. Lets you pick a target CRS — searchable list of every projected,
   compound, and vertical EPSG entry, bundled with the app.
3. Lets you anchor the model on a live map — drop a reference point, or
   paste a list of surveyed correspondences (engineering XYZ ↔ projected
   XYZ) and solve a five-parameter Helmert fit.
4. Shows the result on a real basemap (aerial / topo) with optional 3D
   buildings (NL 3D BAG), terrain, and a live 3D preview of your model.
5. Writes `IfcMapConversion` + `IfcProjectedCRS` into the file and hands
   you the georeferenced IFC back as a download.

## Features

- **Survey-point solver** — paste correspondences from a clipboard
  (Excel / CSV / semicolon-CSV / whitespace), solve least-squares with
  Levenberg–Marquardt, see per-point residuals on the map and in a chart.
  Single-point fallback for when you only have one known reference.
- **Three fit modes** — use the `IfcSite` reference alone, refine it with
  extra points, or ignore it entirely.
- **Interactive parameter editing** — nudge easting / northing / height
  / rotation by hand and watch the map update live.
- **Vertical datum picker** — separate horizontal CRS + vertical datum
  inputs, written into `IfcProjectedCRS.VerticalDatum`. Compound EPSG
  codes (e.g. 7415 = RD New + NAP) collapse this into a single field.
- **Address search** — PDOK Locatieserver autocomplete for placing the
  model when you don't have a coordinate to anchor against.
- **Bundled CRS index** — every projected, compound, and vertical EPSG
  entry from `epsg-index` ships as a static asset. No runtime calls to
  epsg.io; works offline once the page is loaded.
- **Precision grids on demand** — CRSs whose default proj4 string is
  inaccurate (e.g. RD New, OSGB36) ship a GeoTIFF datum-shift grid
  fetched from cdn.proj.org. The Target CRS card surfaces accuracy
  state and lets you retry a failed grid load.
- **Rich basemaps** (Netherlands-focused for now):
  - PDOK BRT (topographic), PDOK Luchtfoto (aerial), OpenStreetMap
  - BGT large-scale topography overlay
  - 3D BAG buildings (LoD 2.2) for visual verification in 3D
  - AHN5 terrain (5 m DEM via Mapterhorn) for drape + elevation picks
- **2D ↔ 3D toggle** — see your model rendered in place on the globe
  using Three.js inside a MapLibre custom layer.
- **Demo model** — MiniBIM preloaded so you can try the workflow without
  having your own file to hand.
- **Level of Georeferencing** badge (LoGeoRef 10–50) tells you what the
  file currently achieves.

## Standards

Follows the two relevant practice guides:

- [Georefereren GeoBIM Praktijkrichtlijn](https://docs.geostandaarden.nl/g4bim/geobim/) — Geonovum (NL)
- [User Guide for Geo-referencing in IFC](https://www.buildingsmart.org/wp-content/uploads/2020/02/User-Guide-for-Geo-referencing-in-IFC-v2.0.pdf) — buildingSMART Australia

## IFC versions

- **IFC4 / IFC4 ADD1 / IFC4 ADD2 / IFC4.3** — native `IfcMapConversion`
  + `IfcProjectedCRS` read + write.
- **IFC2X3** — falls back to `ePSet_MapConversion` / `ePSet_ProjectedCRS`
  property sets, the convention used before IFC4 added first-class
  georef entities.

## Limitations

- **Datum accuracy outside grid coverage** — we use proj4js with
  GeoTIFF-format datum-shift grids for the CRSs that need them (NL, UK,
  …; see `docs/crs-datum-grids.md`). Other CRSs use the default proj4
  string, which is fine for typical BIM georeferencing (sub-metre) but
  may lose precision vs. PROJ/pyproj on complex datums.
- **No vertical-datum transforms.** Heights round-trip as a single
  `OrthogonalHeight` offset. proj4js can't transform between vertical
  datums (NAP ↔ ellipsoidal etc.); outside the Netherlands the vertical
  story is "horizontal-only, vertical approximate."
- **First-load needs internet** — the CRS index ships with the app, but
  precision grids are pulled from cdn.proj.org on first use of a covered
  CRS. Once cached they work offline.
- **Large files** — web-ifc runs in a worker, but opening a multi-GB
  IFC file is still constrained by browser memory.

## Relation to the Flask app

This is a rewrite of the Python/Flask app at
<https://ifcgref.bk.tudelft.nl>, which continues to run. The original
processes files server-side; this version does not upload anything.
The solver logic and IFC version handling are modelled after the Flask
implementation.

## Development

```bash
npm install
npm run dev          # start dev server (rebuilds the CRS index first)
npm run build        # production build
npm run preview      # preview production build
npm run lint         # ESLint
npm run build:crs    # regenerate public/crs-index.json from epsg-index
npm run verify:crs   # check CRS overrides against captured fixtures
npm run knip         # find unused exports
```

### Stack

React 19 + TypeScript + Vite; Tailwind CSS v4; react-aria-components;
web-ifc (WASM) in a Web Worker via Comlink; proj4js for CRS transforms,
with on-demand GeoTIFF precision grids (geotiff.js); Zod for boundary
validation; ml-levenberg-marquardt for the Helmert solver; MapLibre GL
JS + Three.js for the map and 3D view; 3d-tiles-renderer for 3D BAG;
neverthrow `Result` for error handling.

### Layout

```
src/
  worker/
    ifc/             web-ifc operations
      georef/        IFC4 vs IFC2X3 read/write, version-split
      metadata.ts    site, units, true north, length-unit boundary
      footprint.ts   convex-hull extraction
      meshes.ts      triangle extraction for 3D
  lib/               pure TS modules: CRS, units, Helmert, logging, validators
  components/
    map/             MapLibre init, custom layers, controls, map hooks
    sidebar/         cards for file info, CRS, anchor, survey points, save
    workspace/       workspace-level orchestration hooks
```

All IFC / CRS / Helmert logic lives in plain TypeScript under `src/lib/`
and `src/worker/`; React components call into it via `getIfc()` and
the lib modules.

## Contributing

Contributions welcome — open an issue before starting anything non-trivial.
See `CLAUDE.md` for coding conventions.

## License

Open source. License TBD before public v1.
