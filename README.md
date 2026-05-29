# IFC Georeferencer

Georeference an IFC (BIM) file in your browser. Place the model on a map,
solve the Helmert transform from your survey points, and download a file
with `IfcMapConversion` + `IfcProjectedCRS` written in.

**Your file never leaves your machine.** Everything runs client-side.
Files are not uploaded, and no account is required.

> Status: beta. Usable end-to-end, some rough edges.

## What it does

A BIM model's local coordinates (project units from some arbitrary origin on the
construction site) have to be placed in a real-world CRS before the model
can be combined with geodata, planning documents, or other buildings. The
IFC spec defines `IfcMapConversion` and `IfcProjectedCRS` for this; most
authoring tools either don't fill them in or fill them in wrong.

This tool:

1. Opens your IFC file and reads whatever georeferencing is already
   there: `IfcSite` lat/lon, `TrueNorth`, an existing `IfcMapConversion`
   (or the IFC4.3 `IfcRigidOperation`), a projected offset baked into the
   site placement, or the IFC2X3 `ePSet_MapConversion` fallback.
2. Lets you pick a target CRS from a searchable list of every projected,
   compound, and vertical EPSG entry, bundled with the app.
3. Lets you anchor the model on a live map: drop a reference point, or
   paste a list of surveyed correspondences (engineering XYZ ↔ projected
   XYZ) and solve a five-parameter Helmert fit.
4. Shows the result on a real basemap (aerial / topo) with optional 3D
   buildings (NL 3D BAG), terrain, and a live 3D preview of your model.
5. Writes `IfcMapConversion` + `IfcProjectedCRS` into the file and hands
   you the georeferenced IFC back as a download.

## Features

- **Survey-point solver.** Paste correspondences from the clipboard
  (Excel / CSV / semicolon-CSV / whitespace), solve least-squares with
  Levenberg–Marquardt, and inspect per-point residuals on the map and in
  a histogram. Single-point fallback for when you only have one known
  reference.
- **Three fit modes.** Encode the existing `IfcSite` reference alone,
  refine it with extra survey points, or ignore the file and fit points
  only.
- **Live parameter editing.** Nudge easting / northing / height by hand,
  and set rotation either as an angle (clockwise from grid north) or as
  the raw `XAxisAbscissa` / `XAxisOrdinate` vector. The map updates as
  you type.
- **Baked-origin repair.** Detects the two common authoring bugs: a
  projected offset baked into `IfcSite.ObjectPlacement` with no
  `IfcMapConversion`, and the same offset double-counted in both. A
  one-click button migrates or de-duplicates it.
- **Vertical datum picker.** Separate horizontal CRS + vertical datum
  inputs, written into `IfcProjectedCRS.VerticalDatum`. Compound EPSG
  codes (e.g. 7415 = RD New + NAP) collapse this into a single field.
- **MapUnit preservation.** Keeps the file's existing
  `IfcProjectedCRS.MapUnit` across a save, recovers a malformed one, and
  emits a fresh `IfcSIUnit METRE` only when none was set.
- **Bundled CRS index.** Every projected, compound, and vertical EPSG
  entry from `epsg-index` ships as a static asset. No runtime calls to
  epsg.io; EPSG lookup works offline once the page is loaded.
- **Precision grids on demand.** CRSs whose default proj4 string is
  inaccurate (e.g. RD New, OSGB36) fetch a GeoTIFF datum-shift grid from
  cdn.proj.org. The Target CRS card surfaces accuracy state and lets you
  retry a failed grid load.
- **Address search.** PDOK Locatieserver autocomplete for NL, with a
  Nominatim fallback elsewhere, for placing the model when you have no
  coordinate to anchor against.
- **Maps.** Global OpenStreetMap basemap plus PDOK topo (BRT) and aerial
  (Luchtfoto); add your own via a raster XYZ or MapLibre style URL; a
  transparent-basemap toggle for screenshots. NL overlays: BGT
  large-scale topography, Kadaster parcels, 2D BAG footprints, 3D BAG
  buildings (LoD 2.2, 3D view only), and the model's own `IfcSpace`
  boundaries. AHN5 terrain (5 m DEM via Mapterhorn) for drape and
  elevation picks.
- **2D ↔ 3D toggle.** See your model rendered in place on the globe via
  Three.js inside a MapLibre custom layer, transformed live by the
  current Helmert parameters.
- **Sidecar files.** Export the active CRS, vertical datum, and Helmert
  parameters as a small `.ifcgref.json`, then re-apply it later to
  round-trip a placement without committing the IFC itself.
- **Demo model.** MiniBIM preloaded so you can try the workflow without
  having your own file to hand.
- **Level of Georeferencing badge** (LoGeoRef 10–50) tells you what the
  file currently achieves.

## Standards

Follows the two relevant practice guides:

- [Georefereren GeoBIM Praktijkrichtlijn](https://docs.geostandaarden.nl/g4bim/geobim/), Geonovum (NL)
- [User Guide for Geo-referencing in IFC](https://www.buildingsmart.org/wp-content/uploads/2020/02/User-Guide-for-Geo-referencing-in-IFC-v2.0.pdf), buildingSMART Australia

## IFC versions

- **IFC4 / IFC4 ADD1 / IFC4 ADD2 / IFC4.3.** Native `IfcMapConversion`
  + `IfcProjectedCRS` read and write. On IFC4.3 it also reads the
  translation-only `IfcRigidOperation` sibling, and writes
  `IfcMapConversionScaled` when a non-unit vertical scale is needed.
- **IFC2X3.** Falls back to `ePSet_MapConversion` / `ePSet_ProjectedCRS`
  property sets, the convention used before IFC4 added first-class
  georef entities.

## Limitations

- **Datum accuracy outside grid coverage.** We use proj4js with
  GeoTIFF-format datum-shift grids for the CRSs that need them (NL, UK,
  …). Other CRSs use the default proj4 string, which is fine for typical
  BIM georeferencing (sub-metre) but may lose precision vs. PROJ/pyproj
  on complex datums.
- **No vertical-datum transforms.** Heights round-trip as a single
  `OrthogonalHeight` offset. proj4js can't transform between vertical
  datums (NAP ↔ ellipsoidal etc.); outside the Netherlands the vertical
  story is "horizontal-only, vertical approximate."
- **First-load needs internet.** The CRS index ships with the app, but
  precision grids are pulled from cdn.proj.org on first use of a covered
  CRS. Once cached they work offline.
- **Large files.** web-ifc runs in a worker, but opening a multi-GB
  IFC file is still constrained by browser memory.

## Relation to the Flask app

This is a sort of rewrite of the Python/Flask app at
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
[web-ifc](https://github.com/ThatOpen/engine_web-ifc) (WASM) in a Web Worker via [Comlink](https://github.com/googlechromelabs/comlink); [proj4js](https://github.com/proj4js/proj4js) for CRS transforms,
with on-demand GeoTIFF precision grids using [geotiff.js](https://geotiffjs.github.io/); [Zod](https://zod.dev/) for boundary
validation; [ml-levenberg-marquardt](https://github.com/mljs/levenberg-marquardt) for the Helmert solver; [MapLibre GL
JS](https://maplibre.org/maplibre-gl-js/docs/) + Three.js for the map and 3D view; [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) for [3D BAG](https://docs.3dbag.nl/en/);
neverthrow `Result` for error handling.

### Repository Layout

```
src/
  modules/             pure-TS domain logic, no React (#modules/* alias)
    ifc/
      facade.ts        high-level IFC ops, delegates to the worker
      lo-geo-ref.ts    Level of Georeferencing classification
      worker/          Comlink-exposed Web Worker (web-ifc inside)
        georef/        IfcMapConversion + IfcProjectedCRS, schema-split
        metadata.ts    schema, site, units, local origin, true north
        footprint.ts   convex-hull extraction
        meshes.ts      triangle extraction for 3D
    crs/               proj4js wrapper, manifest loader, transforms
    helmert/           least-squares solver + survey-point clipboard parse
    units/             IFC length-unit conversion + display formatting
  lib/                 app-level glue: logging, PDOK/Nominatim, validators,
                       CRS hooks
  state/               app state: workspace orchestration + georef-status
                       discriminated union (#state/* alias)
  components/
    map/               MapLibre init, custom layers, controls, hooks
    sidebar/           cards for file info, CRS, anchor, survey points, save
    workspace/         workspace-level orchestration hooks
  worker/              ifc-worker.ts entrypoint (re-exports modules/ifc/worker)
```

All IFC / CRS / Helmert / units logic lives in `src/modules/`; React
components call into it via the worker facade and module barrels.
`src/lib/` holds the smaller, app-level helpers that don't fit a domain
module, and `src/state/` holds the shared workspace state.

## Contributing

Contributions welcome, please open an issue before starting anything non-trivial.

## License

Apache License Version 2.0.

## Credits

Developed by [Bedrock.engineer](https://bedrock.engineer) for [buildingSMART Nederlands](https://www.buildingsmart.nl/).

Inspiration take from the original [IfcGref app](https://ifcgref.bk.tudelft.nl/) by [Amir Hakim](https://github.com/amiroo4) for the TU Delft 3D Geoinformation research group.