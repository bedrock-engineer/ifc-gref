import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import {
  Button,
  Dialog,
  DialogTrigger,
  OverlayArrow,
  Popover,
} from "react-aria-components";

const KBD =
  "rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700";

interface ShortcutRowProps {
  action: string;
  primary: React.ReactNode;
  alt?: React.ReactNode;
}

function ShortcutRow({ action, primary, alt }: ShortcutRowProps) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-0.5">
      <dt className="text-slate-500">{action}</dt>
      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{primary}</span>
        {alt ? (
          <>
            <span className="text-slate-400">or</span>
            <span>{alt}</span>
          </>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Map control listing the 3D navigation shortcuts users won't discover
 * on their own (right-drag for pitch/rotate, modifier keys, compass
 * click-to-reset). Sits next to the 2D/3D toggle so it's adjacent to
 * the action that makes the shortcuts relevant.
 */
export function NavHelp() {
  return (
    <DialogTrigger>
      <Button
        aria-label="Navigation shortcuts"
        className="flex size-7.25 cursor-pointer items-center justify-center rounded bg-white text-slate-700 shadow-[0_0_0_2px_rgba(0,0,0,0.1)] outline-none hover:bg-slate-50 data-focus-visible:ring-2 data-focus-visible:ring-slate-500 data-pressed:scale-[0.96]"
      >
        <QuestionMarkCircledIcon className="size-4" />
      </Button>

      <Popover
        placement="top end"
        offset={8}
        className="group max-w-xs rounded border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700 shadow-md outline-none"
      >
        <OverlayArrow>
          <svg
            viewBox="0 0 12 6"
            width={12}
            height={6}
            className="block fill-white stroke-slate-200 group-data-[placement=top]:rotate-180 group-data-[placement=left]:rotate-90 group-data-[placement=right]:-rotate-90"
          >
            <path d="M0 6 L6 0 L12 6" />
          </svg>
        </OverlayArrow>

        <Dialog className="outline-none">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Map navigation
          </div>

          <dl className="space-y-1">
            <ShortcutRow
              action="Pan"
              primary="drag"
              alt={<kbd className={KBD}>↑ ↓ ← →</kbd>}
            />
            <ShortcutRow
              action="Zoom"
              primary="scroll"
              alt={
                <>
                  <kbd className={KBD}>+</kbd> / <kbd className={KBD}>−</kbd>
                </>
              }
            />
            <ShortcutRow
              action="Rotate"
              primary="right-drag ↔"
              alt={
                <>
                  <kbd className={KBD}>Shift</kbd> + drag
                </>
              }
            />
            <ShortcutRow
              action="Tilt"
              primary="right-drag ↕"
              alt={
                <>
                  <kbd className={KBD}>Ctrl</kbd> + drag
                </>
              }
            />
            <ShortcutRow
              action="Reset"
              primary={<>click compass / pitch indicator</>}
            />
          </dl>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
