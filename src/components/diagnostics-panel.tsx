import { useSyncExternalStore } from "react";
import {
  Button,
  Disclosure,
  DisclosurePanel,
  Heading,
} from "react-aria-components";
import {
  clearLog,
  getLogEntries,
  subscribeLog,
  type LogEntry,
} from "../lib/log";

const LEVEL_CLASSES: Record<LogEntry["level"], string> = {
  info: "text-slate-700",
  warn: "text-amber-700",
  error: "text-red-700",
};

export function DiagnosticsPanel() {
  const entries = useSyncExternalStore(subscribeLog, getLogEntries);

  return (
    <Disclosure className="shrink-0 border-t border-slate-200 bg-slate-50 text-xs">
      <Heading className="m-0">
        <Button
          slot="trigger"
          className="flex w-full items-center justify-between px-3 py-1.5 text-left font-medium text-slate-700 outline-none hover:bg-slate-100 focus-visible:bg-slate-100"
        >
          <span>Diagnostics ({entries.length})</span>
          <span aria-hidden className="text-slate-400 group-aria-expanded:rotate-180">
            ▾
          </span>
        </Button>
      </Heading>

      <DisclosurePanel>
        <div className="flex items-center justify-between px-3 py-1 text-[11px] text-slate-500">
          <span>Newest at the bottom</span>

          <Button
            onPress={clearLog}
            isDisabled={entries.length === 0}
            className="rounded px-1 outline-none hover:text-slate-700 focus-visible:text-slate-700 disabled:opacity-40"
          >
            Clear
          </Button>
        </div>

        <ol
          role="log"
          aria-live="polite"
          aria-label="IFC operation log"
          className="max-h-48 overflow-auto border-t border-slate-200 px-3 py-1 font-mono leading-tight"
        >
          {entries.length === 0 ? (
            <li className="text-slate-400">No entries yet.</li>
          ) : (
            entries.map((entry) => <LogRow key={entry.id} entry={entry} />)
          )}
        </ol>
      </DisclosurePanel>
    </Disclosure>
  );
}

interface LogRowProps {
  entry: LogEntry;
}

function LogRow({ entry }: LogRowProps) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour12: false,
  });
  
  return (
    <li className={LEVEL_CLASSES[entry.level]}>
      <span className="text-slate-400">{time}</span>{" "}
      <span className="text-slate-400">[{entry.source}]</span> {entry.message}
    </li>
  );
}
