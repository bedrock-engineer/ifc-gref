import {
  GitHubLogoIcon,
  QuestionMarkCircledIcon,
} from "@radix-ui/react-icons";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  FileTrigger,
  OverlayArrow,
  Popover,
} from "react-aria-components";
import { Button } from "./input/button";

const REPO_URL = "https://github.com/bedrock-engineer/ifc-gref";
const style = { gridArea: "header" };

interface HeaderProps {
  filename: string | null;
  onFile: (file: File) => void;
}

export function Header({ filename, onFile }: HeaderProps) {
  return (
    <header
      style={style}
      className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3"
    >
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          IFC Georeferencer
        </h1>

        {filename && <p className="text-xs text-slate-500">{filename}</p>}
      </div>

      <div className="flex items-center gap-1">
        <ShortcutsPopover />

        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub repository"
          className="flex size-8 items-center justify-center rounded text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          <GitHubLogoIcon />
        </a>

        <FileTrigger
          acceptedFileTypes={[".ifc"]}
          onSelect={(files) => {
            const f = files ? files[0] : undefined;
            if (f) {
              onFile(f);
            }
          }}
        >
          <Button variant="secondary" size="md" className="ml-2">
            {filename ? "Load different IFC file" : "Load IFC file"}
          </Button>
        </FileTrigger>
      </div>
    </header>
  );
}

function ShortcutsPopover() {
  return (
    <DialogTrigger>
      <AriaButton
        aria-label="Keyboard shortcuts"
        className="flex size-8 cursor-pointer items-center justify-center rounded text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 data-focus-visible:ring-2 data-focus-visible:ring-slate-500"
      >
        <QuestionMarkCircledIcon />
      </AriaButton>

      <Popover
        placement="bottom end"
        offset={8}
        className="group rounded border border-slate-200 bg-white p-4 shadow-md outline-none"
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
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Keyboard shortcuts
          </h2>

          <div className="space-y-3 text-xs">
            <section>
              <h3 className="mb-1 font-medium text-slate-900">Number fields</h3>
              
              <ShortcutRow keys={["↑", "↓"]} desc="± step" />
              
              <ShortcutRow keys={["PgUp", "PgDn"]} desc="± 10× step" />
              
              <ShortcutRow keys={["Home", "End"]} desc="Min / max" />
              
              <ShortcutRow keys={["Scroll"]} desc="± step when focused" />
            </section>

            <section>
              <h3 className="mb-1 font-medium text-slate-900">Map</h3>
              <ShortcutRow keys={["Esc"]} desc="Cancel anchor pick" />
            </section>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

interface ShortcutRowProps {
  keys: ReadonlyArray<string>;
  desc: string;
}

function ShortcutRow({ keys, desc }: ShortcutRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-0.5">
      <span className="flex gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
          >
            {k}
          </kbd>
        ))}
      </span>
      <span className="text-slate-600">{desc}</span>
    </div>
  );
}
