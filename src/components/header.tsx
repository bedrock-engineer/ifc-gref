import {
  GitHubLogoIcon,
  QuestionMarkCircledIcon,
  UploadIcon,
} from "@radix-ui/react-icons";
import { FileTrigger, ToggleButton } from "react-aria-components";
import { Button } from "./input/button";

const REPO_URL = "https://github.com/bedrock-engineer/ifc-gref";
const style = { gridArea: "header" };

interface HeaderProps {
  filename: string | null;
  onFile: (file: File) => void;
  isGuideOpen: boolean;
  onToggleGuide: (next: boolean) => void;
}

export function Header({
  filename,
  onFile,
  isGuideOpen,
  onToggleGuide,
}: HeaderProps) {
  return (
    <header
      style={style}
      className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3"
    >
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          IFC Georeferencer
        </h1>

        {filename ? (
          <p className="text-xs text-slate-500">File: {filename}</p>
        ) : (
          <p className="text-[11px] text-slate-400">
            By{" "}
            <a
              href="https://bedrock.engineer"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm outline-none hover:text-slate-600 underline focus-visible:ring-2 gap-0.5 focus-visible:ring-slate-500"
            >
              <img
                src="/bedrock.png"
                alt="Bedrock.engineer logo"
                className="h-2.5 w-2.5 mr-0.5 inline-block"
              />
              Bedrock.engineer
            </a>
            {" for "}
            <a
              href="https://www.buildingsmart.nl"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm outline-none hover:text-slate-600 underline focus-visible:ring-2 gap-0.5 focus-visible:ring-slate-500"
            >
              <img
                src="/buildingsmart.png"
                alt="buildingSMART NL logo"
                className="h-2.5 w-2.5 mr-0.5 inline-block"
              />
              buildingSMART NL
            </a>
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <ToggleButton
          isSelected={isGuideOpen}
          onChange={onToggleGuide}
          aria-label="User guide"
          aria-controls="user-guide-drawer"
          className="flex size-8 cursor-pointer items-center justify-center rounded text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 data-focus-visible:ring-2 data-focus-visible:ring-slate-500 data-selected:bg-slate-100 data-selected:text-slate-900"
        >
          <QuestionMarkCircledIcon />
        </ToggleButton>

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
            <UploadIcon />
            {filename ? "Load different IFC file" : "Load IFC file"}
          </Button>
        </FileTrigger>
      </div>
    </header>
  );
}
