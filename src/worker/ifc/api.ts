/**
 * web-ifc lifecycle: module singleton + file open/save/close.
 *
 * Runs in a Web Worker, called from the main thread via Comlink. This
 * module owns the IfcAPI instance; every other module in `ifc/` calls
 * `getApi()` rather than holding its own reference.
 *
 * The Worker boundary is the natural place to hold the WASM module and
 * keep heavy parsing off the main thread. See docs/large-file-handling.md.
 */

import { IfcAPI } from "web-ifc";
// Vite resolves this to a URL at build time. The worker bundle would
// otherwise try to fetch web-ifc.wasm from the document root and get
// the SPA fallback HTML back, which fails the WASM magic-word check.
import wasmUrl from "web-ifc/web-ifc.wasm?url";
import { emitLog } from "../../lib/log";

let api: IfcAPI | null = null;

export async function getApi(): Promise<IfcAPI> {
  if (api) {
    return api;
  }
  api = new IfcAPI();

  // Force single-threaded mode: it sidesteps the multithreaded wasm
  // (which needs SharedArrayBuffer + COOP/COEP headers — painful on
  // GitHub Pages) and we only need to ship one .wasm asset.
  await api.Init((path) => {
    if (path.endsWith(".wasm")) {
      return wasmUrl;
    }
    return path;
  }, true);

  return api;
}

// FileReaderSync lives in the WebWorker lib; the project tsconfig only
// includes DOM, so declare the minimal shape we use here.
declare class FileReaderSync {
  readAsArrayBuffer(blob: Blob): ArrayBuffer;
}

export async function openModel(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<number> {
  const ifcAPI = await getApi();
  const total = file.size;
  const reader = new FileReaderSync();

  // Track the furthest byte web-ifc has pulled from the file. web-ifc can
  // re-read earlier ranges as it resolves references, so we clamp to a
  // monotonic high-water mark and throttle updates so Comlink doesn't flood
  // the main thread with postMessage calls during a big parse.
  let maxReached = 0;
  let lastReported = 0;

  const modelID = ifcAPI.OpenModelFromCallback((offset, size) => {
    const end = Math.min(offset + size, total);
    // web-ifc's callback must return synchronously; FileReaderSync blocks
    // the worker on disk I/O, which is fine — the worker is already
    // blocked inside WASM for the duration of the parse.
    const chunk = new Uint8Array(
      reader.readAsArrayBuffer(file.slice(offset, end)),
    );
    if (end > maxReached) {
      maxReached = end;
      if (onProgress) {
        const fraction = total > 0 ? maxReached / total : 1;
        if (fraction - lastReported >= 0.01) {
          lastReported = fraction;
          // Fire-and-forget: the Comlink proxy call is async but the web-ifc
          // callback must return synchronously. postMessage is enqueued
          // immediately; the main thread processes it while we're still in WASM.
          onProgress(fraction);
        }
      }
    }
    return chunk;
  });
  if (onProgress && lastReported < 1) {
    onProgress(1);
  }
  const schema = ifcAPI.GetModelSchema(modelID);
  emitLog({
    source: "worker",
    message: `Opened IFC model (schema: ${schema})`,
  });
  return modelID;
}

export async function saveModel(modelID: number): Promise<Blob> {
  const ifcAPI = await getApi();
  // Stream the serialized output chunk-by-chunk. Each chunk must be copied
  // out of the WASM-backed buffer before the next callback invocation, since
  // web-ifc may reuse the underlying memory. Once SaveModelToCallback
  // returns, we hand the chunks to the Blob constructor — large Blobs get
  // backed by disk by the browser, so the accumulated chunks can be GC'd.
  // web-ifc types Uint8Array<ArrayBufferLike>, but the Blob constructor
  // requires a concrete ArrayBuffer-backed view. Allocating a fresh
  // Uint8Array(length) gives us Uint8Array<ArrayBuffer>; set() copies the
  // bytes out of the WASM-backed memory before the next callback.
  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  ifcAPI.SaveModelToCallback(modelID, (data) => {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    chunks.push(copy);
  });
  return new Blob(chunks, { type: "application/octet-stream" });
}

export async function closeModel(modelID: number): Promise<void> {
  const ifcAPI = await getApi();
  ifcAPI.CloseModel(modelID);
}
