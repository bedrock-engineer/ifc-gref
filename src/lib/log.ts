/**
 * In-memory log for the diagnostics panel. Lib/worker modules call
 * `emitLog(...)`; the panel subscribes via `useSyncExternalStore`.
 *
 * Entries are meant to be domain-facing ("Read IfcProjectedCRS: EPSG:28992"),
 * not developer diagnostics
 */

export type LogLevel = "info" | "warn" | "error";

export type LogSource = "main" | "worker";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}

export interface LogInput {
  level?: LogLevel;
  source?: LogSource;
  message: string;
}

// Cap so a noisy parse doesn't grow the array without bound.
const MAX_ENTRIES = 500;

let nextId = 1;
let entries: ReadonlyArray<LogEntry> = [];
const listeners = new Set<() => void>();

/**
 * When set, `emitLog` forwards entries to the sink instead of appending
 * locally. The worker side uses this to ship entries across Comlink to the
 * main-thread store, otherwise each context would accumulate its own
 * isolated list. Return type is `unknown` because Comlink-wrapped callbacks
 * return a Promise we don't await.
 */
let sink: ((entry: LogEntry) => unknown) | null = null;

export function setLogSink(next: ((entry: LogEntry) => unknown) | null): void {
  sink = next;
}

export function emitLog(input: LogInput): void {
  const entry: LogEntry = {
    id: nextId++,
    timestamp: Date.now(),
    level: input.level ?? "info",
    source: input.source ?? "main",
    message: input.message,
  };

  if (sink) {
    sink(entry);
    return;
  }

  entries =
    entries.length >= MAX_ENTRIES
      ? [...entries.slice(entries.length - MAX_ENTRIES + 1), entry]
      : [...entries, entry];

  for (const listener of listeners) {
    listener();
  }
}

export function getLogEntries(): ReadonlyArray<LogEntry> {
  return entries;
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function clearLog(): void {
  if (entries.length === 0) {
    return;
  }

  entries = [];
  
  for (const listener of listeners) {
    listener();
  }
}
