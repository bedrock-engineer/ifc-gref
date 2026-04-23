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
2. Lets you pick a target CRS (any EPSG code — resolved via
   [epsg.io](https://epsg.io)).
3. Lets you anchor the model on a live map — drop a reference point, or
   paste a list of surveyed correspondences (engineering XYZ ↔ projected
   XYZ) and solve a five-parameter Helmert fit.
4. Shows the result on a real basemap (aerial / topo) with optional 3D
   buildings (NL 3D BAG), terrain, and a live 3D preview of your model.
5. Writes `IfcMapConversion` + `IfcProjectedCRS` into the file and hands
   you the georeferenced IFC back as a download.

## Features

- **Survey-point solver** — paste correspondences from a clipboard, solve
  least-squares, see per-point residuals. Single-point fallback for when
  you only have one known reference.
- **Three fit modes** — use the `IfcSite` reference alone, refine it with
  extra points, or ignore it entirely.
- **Interactive parameter editing** — nudge easting / northing / height
  / rotation by hand and watch the map update live.
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

- **CRS lookup needs internet.** Only WGS84 is built in; every other
  EPSG code is fetched from [epsg.io](https://epsg.io) on demand and
  cached for the session. Offline use works only if you've already
  looked up the codes you need.
- **Datum accuracy** — we use proj4js, which doesn't do NTv2 grid shifts
  by default. Fine for typical BIM georeferencing (sub-metre); edge-case
  datum transformations may lose precision vs. PROJ/pyproj.
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
npm run dev      # start dev server
npm run build    # production build
npm run preview  # preview production build
npm run lint     # ESLint
```

### Stack

React 19 + TypeScript + Vite; Tailwind CSS v4; react-aria-components;
web-ifc (WASM) in a Web Worker via Comlink; proj4js for CRS transforms;
ml-levenberg-marquardt for the Helmert solver; MapLibre GL JS + Three.js
for the map and 3D view; neverthrow `Result` for error handling.

### Layout

```
src/
  worker/          web-ifc operations (reading, writing, footprint, meshes)
  lib/             pure TS modules: CRS, units, Helmert, logging, validators
  components/
    map/           MapLibre init, custom layers, map controls
    sidebar/       cards for file info, CRS, anchor, survey points, save
    hooks/         workspace-level orchestration hooks
```

All IFC / CRS / Helmert logic lives in plain TypeScript under `src/lib/`
and `src/worker/`; React components call into it.

## Contributing

Contributions welcome — open an issue before starting anything non-trivial.
See `CLAUDE.md` for coding conventions.

## License

Open source. License TBD before public v1.
