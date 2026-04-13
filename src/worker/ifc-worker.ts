import * as Comlink from 'comlink'
import {
  closeModel,
  extractFootprint,
  openModel,
  readMetadata,
  saveModel,
  writeMapConversion,
} from './ifc-parser'

/**
 * The Comlink-exposed API surface for the IFC worker. The main thread
 * imports this Worker via `?worker` and wraps it with Comlink.wrap to
 * call these functions as if they were local async functions.
 */
const api = {
  openModel,
  readMetadata,
  extractFootprint,
  writeMapConversion,
  saveModel,
  closeModel,
}

export type IfcWorkerApi = typeof api

Comlink.expose(api)
