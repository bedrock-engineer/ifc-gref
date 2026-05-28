import {
  Button,
  FieldError,
  Group,
  Input,
  Label,
  NumberField as AriaNumberField,
  Text,
} from "react-aria-components";
import type { ReactNode } from "react";
import { ProvenanceBadge, type Provenance } from "./provenance-badge";
import { TriangleDownIcon, TriangleUpIcon } from "@radix-ui/react-icons";

interface NumberFieldProps {
  /** Visible label above the input. Omit for inline/grid usage; pair with ariaLabel. */
  label?: string;
  /** Hidden label for assistive tech when there is no visible `label`. */
  ariaLabel?: string;
  value: number | null;
  onChange: (value: number) => void;
  isDisabled?: boolean;
  /** Step for stepper buttons and keyboard arrows. Defaults to 1. */
  step?: number;
  /** Inclusive lower bound — react-aria clamps on commit/step. */
  minValue?: number;
  /** Inclusive upper bound — react-aria clamps on commit/step. */
  maxValue?: number;
  provenance?: Provenance;
  formatOptions?: Intl.NumberFormatOptions;
  placeholder?: string;
  /** Helper text rendered below the field and linked via aria-describedby. */
  description?: ReactNode;
  /** Hide the increment/decrement buttons (default: shown). */
  hideSteppers?: boolean;
  /**
   * Flips `data-invalid` on the field (amber border) and `aria-invalid` on
   * the input. Pair with `errorMessage` to render a `<FieldError>`; or set
   * alone to mark a co-implicated field whose message lives on a sibling.
   */
  isInvalid?: boolean;
  /** Rendered as `<FieldError>` when present — wired to the input via
   * `aria-describedby` so screen readers announce on focus. */
  errorMessage?: ReactNode;
}

/**
 * Thin wrapper around react-aria NumberField so cards can declare labelled
 * numeric inputs in one line. If no visible `label` is supplied the field
 * renders input-only (for grid usage); pass `ariaLabel` in that case.
 */
export function NumberField({
  label,
  ariaLabel,
  value,
  onChange,
  isDisabled,
  step,
  minValue,
  maxValue,
  provenance,
  formatOptions,
  placeholder,
  description,
  hideSteppers,
  isInvalid,
  errorMessage,
}: NumberFieldProps) {
  // Default off so values render as `155000.123` (no comma thousands
  // separators), matching the `.toFixed()` style used elsewhere in the app.
  // Callers can opt back in via `formatOptions={{ useGrouping: true }}`.
  const mergedFormatOptions: Intl.NumberFormatOptions = {
    useGrouping: false,
    ...formatOptions,
  };
  return (
    <AriaNumberField
      value={value ?? undefined}
      onChange={(next) => {
        if (Number.isFinite(next)) {
          onChange(next);
        }
      }}
      step={step}
      minValue={minValue}
      maxValue={maxValue}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      formatOptions={mergedFormatOptions}
      aria-label={ariaLabel}
      className="flex flex-col gap-0.5"
    >
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <Label className="text-xs text-slate-600">{label}</Label>
          {provenance && <ProvenanceBadge provenance={provenance} />}
        </div>
      )}

      <Group className="flex items-center rounded border border-slate-300 bg-white transition-[border-color] duration-150 focus-within:border-slate-500 data-invalid:border-amber-500">
        <Input
          placeholder={placeholder}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-right font-mono text-sm outline-none disabled:text-slate-400"
        />

        {!hideSteppers && (
          <div className="flex flex-col border-l border-slate-200">
            <Stepper slot="increment" label="Increase">
              <TriangleUpIcon />
            </Stepper>

            <Stepper slot="decrement" label="Decrease">
              <TriangleDownIcon />
            </Stepper>
          </div>
        )}
      </Group>

      {description ? (
        <Text slot="description" className="pl-1 text-xs text-slate-500">
          {description}
        </Text>
      ) : null}
      {errorMessage ? (
        <FieldError className="pl-1 text-xs text-amber-700">
          {errorMessage}
        </FieldError>
      ) : null}
    </AriaNumberField>
  );
}

interface StepperProps {
  slot: "increment" | "decrement";
  label: string;
  children: ReactNode;
}

function Stepper({ slot, label, children }: StepperProps) {
  return (
    <Button
      slot={slot}
      aria-label={label}
      className="flex h-3 w-5 items-center justify-center text-[8px] leading-none text-slate-500 outline-none transition-colors duration-100 hover:bg-slate-100 hover:text-slate-700 focus-visible:bg-slate-100 disabled:text-slate-300"
    >
      {children}
    </Button>
  );
}
