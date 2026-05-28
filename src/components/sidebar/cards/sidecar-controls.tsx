import type { ReactNode } from "react";
import {
  FileTrigger,
  OverlayArrow,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components";
import { DownloadIcon, UploadIcon } from "@radix-ui/react-icons";
import { Button } from "../../input/button";

interface SidecarControlsProps {
  canDownload: boolean;
  onDownload: () => void;
  onApply: (file: File) => void;
}

/**
 * Paired Save / Apply controls for the .ifcgref.json sidecar. Lives in the
 * Source card because the sidecar is a portable snapshot of this file's
 * full georef (IfcProjectedCRS + IfcMapConversion), not just its CRS.
 */
export function SidecarControls({
  canDownload,
  onDownload,
  onApply,
}: SidecarControlsProps) {
  return (
    <div className="flex gap-2 border-t border-slate-100 pt-2">
      <SidecarTooltip text="Download the current IfcProjectedCRS and IfcMapConversion as a .ifcgref.json file, ready to apply to another IFC file in this app.">
        <Button
          variant="secondary"
          size="sm"
          onPress={onDownload}
          isDisabled={!canDownload}
          className="flex-1"
        >
          <DownloadIcon />
          Save .ifcgref.json
        </Button>
      </SidecarTooltip>

      <FileTrigger
        acceptedFileTypes={[".ifcgref.json", "application/json"]}
        onSelect={(files) => {
          const file = files?.[0];
          if (file) {
            onApply(file);
          }
        }}
      >
        <SidecarTooltip text="Load a previously saved .ifcgref.json file and apply its CRS and anchor to this file.">
          <Button variant="secondary" size="sm" className="flex-1">
            <UploadIcon />
            Apply .ifcgref.json
          </Button>
        </SidecarTooltip>
      </FileTrigger>
    </div>
  );
}

interface SidecarTooltipProps {
  text: string;
  children: ReactNode;
}

function SidecarTooltip({ text, children }: SidecarTooltipProps) {
  return (
    <TooltipTrigger delay={300}>
      {children}
      <Tooltip
        placement="top"
        className="max-w-xs rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-md data-entering:animate-in data-entering:fade-in data-exiting:animate-out data-exiting:fade-out"
      >
        <OverlayArrow>
          <svg
            width={8}
            height={8}
            viewBox="0 0 8 8"
            className="fill-slate-900"
          >
            <path d="M0 0 L4 4 L8 0" />
          </svg>
        </OverlayArrow>
        {text}
      </Tooltip>
    </TooltipTrigger>
  );
}
