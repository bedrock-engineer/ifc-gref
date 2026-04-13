# ts-poc

TypeScript / React prototype of the IFC Georeferencer rewrite. See the
parent repo's `CLAUDE.md` for the full architecture, and `docs/` for the
specific decisions on web-ifc, large file handling, and testing.

This folder is a standalone Vite project. It will eventually move to its
own repo (`ifcgref-web` or similar). For now it lives next to the Flask
app for convenient context.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- react-aria-components for accessible UI primitives
- web-ifc (WASM) inside a Web Worker, exposed via Comlink
- @thatopen/components for IFC mesh extraction (3D shell rendering)
- proj4js for CRS transforms, ml-levenberg-marquardt for the Helmert solver
- neverthrow Result/ResultAsync for domain errors
- MapLibre GL JS for the map (PDOK BRT default basemap)

## Module structure

```
src/
  worker/
    ifc-worker.ts     — Comlink-exposed API surface
    ifc-parser.ts     — web-ifc operations (read/write IFC entities)
  lib/
    crs.ts            — proj4js + epsg.io lookup
    helmert.ts        — Helmert solver
    units.ts          — length unit conversion
    types.ts          — shared types and domain error unions
  components/         — React components (TBD)
  ifc-api.ts          — main-thread Comlink wrapper
  App.tsx
  main.tsx
```

The Worker contains only `ifc-parser` (and geometry extraction once it
exists). Everything else runs on the main thread.

## Commands

```bash
npm run dev      # start dev server
npm run build    # production build
npm run preview  # preview production build
```
