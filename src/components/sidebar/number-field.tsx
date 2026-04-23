import {
  Button,
  Group,
  Input,
  Label,
  NumberField as AriaNumberField,
  Text,
} from "react-aria-components";
import type { ReactNode } from "react";
import { ProvenanceBadge, type Provenance } from "./provenance-badge";

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
}: NumberFieldProps) {
  return (
    <AriaNumberField
      value={value ?? Number.NaN}
      onChange={(next) => {
        if (Number.isFinite(next)) {
          onChange(next);
        }
      }}
      step={step}
      minValue={minValue}
      maxValue={maxValue}
      isDisabled={isDisabled}
      formatOptions={formatOptions}
      aria-label={label ? undefined : ariaLabel}
      className="flex flex-col gap-0.5"
    >
      {label && (
        <div className="flex items-baseline justify-between gap-2">
          <Label className="text-xs text-slate-600">{label}</Label>
          {provenance && <ProvenanceBadge provenance={provenance} />}
        </div>
      )}
      <Group className="flex items-center rounded border border-slate-300 bg-white focus-within:border-slate-500">
        <Input
          placeholder={placeholder}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-right font-mono text-sm outline-none disabled:text-slate-400"
        />
        {!hideSteppers && (
          <div className="flex flex-col border-l border-slate-200">
            <Stepper slot="increment" label="Increase">
              ▲
            </Stepper>
            <Stepper slot="decrement" label="Decrease">
              ▼
            </Stepper>
          </div>
        )}
      </Group>
      {description ? (
        <Text
          slot="description"
          className="pl-1 text-xs text-slate-500"
        >
          {description}
        </Text>
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
      className="flex h-3 w-5 items-center justify-center text-[8px] leading-none text-slate-500 outline-none hover:bg-slate-100 focus-visible:bg-slate-100 disabled:text-slate-300"
    >
      {children}
    </Button>
  );
}
