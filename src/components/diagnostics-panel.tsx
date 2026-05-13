import { TriangleDownIcon } from "@radix-ui/react-icons";
import { useSyncExternalStore } from "react";
import {
  Button as AriaButton,
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
import { Button } from "./input/button";

const style = { gridArea: "diagnostics" };

const LEVEL_CLASSES: Record<LogEntry["level"], string> = {
  info: "text-slate-700",
  warn: "text-amber-700",
  error: "text-red-700",
};

export function DiagnosticsPanel() {
  const entries = useSyncExternalStore(subscribeLog, getLogEntries);

  return (
    <Disclosure
      style={style}
      className="border-t border-slate-200 bg-slate-50 text-xs"
    >
      <Heading className="m-0">
        <AriaButton
          slot="trigger"
          className="flex w-full items-center justify-between px-3 py-1.5 text-left font-medium text-slate-700 outline-none hover:bg-slate-100 focus-visible:bg-slate-100 group"
        >
          <span>Diagnostics ({entries.length})</span>
          <span
            aria-hidden
            className="text-slate-400 group-aria-expanded:rotate-180 transition-transform"
          >
            <TriangleDownIcon />
          </span>
        </AriaButton>
      </Heading>

      <DisclosurePanel>
        <div className="flex items-center justify-between px-3 py-1 text-[11px] text-slate-500">
          <span>Newest at the bottom</span>

          <Button
            variant="ghost"
            size="sm"
            onPress={clearLog}
            isDisabled={entries.length === 0}
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

        <div className="flex items-center justify-end gap-1 border-t border-slate-200 px-3 py-1 text-[11px] text-slate-500">
          <span>by</span>
          <a
            className="underline hover:text-slate-700"
            href="https://bedrock.engineer"
            target="_blank"
            rel="noreferrer"
          >
            Bedrock.engineer
          </a>
          <span>for</span>
          <a
            className="underline hover:text-slate-700"
            href="https://www.buildingsmart.nl/"
            target="_blank"
            rel="noreferrer"
          >
            buildingSMART NL
          </a>
        </div>
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
