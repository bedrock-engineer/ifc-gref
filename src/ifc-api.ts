import * as Comlink from 'comlink'
import IfcWorker from './worker/ifc-worker?worker'
import type { IfcWorkerApi } from './worker/ifc-worker'

/**
 * Main-thread Comlink wrapper around the IFC worker. Lazy-instantiates
 * the worker on first use so initial page load isn't blocked by WASM init.
 */

let workerInstance: Worker | null = null
let apiProxy: Comlink.Remote<IfcWorkerApi> | null = null

export function getIfcApi(): Comlink.Remote<IfcWorkerApi> {
  if (apiProxy) return apiProxy
  workerInstance = new IfcWorker()
  apiProxy = Comlink.wrap<IfcWorkerApi>(workerInstance)
  return apiProxy
}

export function disposeIfcApi(): void {
  if (workerInstance) {
    workerInstance.terminate()
    workerInstance = null
    apiProxy = null
  }
}
