import type { ReactNode } from "react";
import { Radio, type RadioProps } from "react-aria-components";

interface RadioButtonProps extends Omit<RadioProps, "children" | "className"> {
  /** Outer container classes — layout, spacing, and selected-state chrome. */
  className?: string;
  /** Extra classes on the indicator dot (e.g. `mt-0.5` for baseline alignment). */
  indicatorClassName?: string;
  children: ReactNode;
}

const BASE =
  "group cursor-pointer outline-none data-focus-visible:ring-2 data-focus-visible:ring-slate-500 data-disabled:cursor-not-allowed data-disabled:opacity-50";

const INDICATOR =
  "flex size-3 shrink-0 items-center justify-center rounded-full border border-slate-400 group-data-selected:border-slate-900";

export function RadioButton({
  className,
  indicatorClassName,
  children,
  ...rest
}: RadioButtonProps) {
  return (
    <Radio {...rest} className={className ? `${BASE} ${className}` : BASE}>
      <span
        className={
          indicatorClassName ? `${INDICATOR} ${indicatorClassName}` : INDICATOR
        }
      >
        <span className="hidden size-1.5 rounded-full bg-slate-900 group-data-selected:block" />
      </span>
      {children}
    </Radio>
  );
}
