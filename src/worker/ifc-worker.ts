import * as Comlink from "comlink";
import { setLogSink } from "#lib/log";
import {
  closeModel,
  extractFootprint,
  extractMeshes,
  extractSpaces,
  openModel,
  readMetadata,
  saveModel,
  writeMapConversion,
  zeroSitePlacementLocation,
} from "#modules/ifc/worker";

/**
 * The Comlink-exposed API surface for the IFC worker. The main thread
 * imports this Worker via `?worker` and wraps it with Comlink.wrap to
 * call these functions as if they were local async functions.
 *
 * `setLogSink` lets the main thread register a Comlink-proxied callback so
 * `emitLog` calls inside this worker forward into the main-thread log
 * store instead of accumulating in an isolated worker-local list.
 */
const api = {
  openModel,
  readMetadata,
  extractFootprint,
  extractMeshes,
  extractSpaces,
  writeMapConversion,
  zeroSitePlacementLocation,
  saveModel,
  closeModel,
  setLogSink,
};

export type IfcWorkerApi = typeof api;

Comlink.expose(api);
