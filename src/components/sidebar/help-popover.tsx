import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  OverlayArrow,
  Popover,
} from "react-aria-components";

interface CardHelpButtonProps {
  label: string;
  children: ReactNode;
}

export function CardHelpButton({ label, children }: CardHelpButtonProps) {
  return (
    <DialogTrigger>
      <Button
        aria-label={label}
        className="flex size-5 cursor-pointer items-center justify-center rounded text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-700 data-focus-visible:ring-2 data-focus-visible:ring-slate-500"
      >
        <QuestionMarkCircledIcon />
      </Button>

      <Popover
        placement="top start"
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

        <Dialog className="space-y-2 outline-none">{children}</Dialog>
      </Popover>
    </DialogTrigger>
  );
}
