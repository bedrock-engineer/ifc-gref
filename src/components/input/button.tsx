import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";
import clsx from "clsx";
import "./button.css";

type ButtonVariant = "primary" | "secondary" | "warning" | "ghost";
type ButtonSize = "sm" | "md";

interface ButtonProps extends Omit<AriaButtonProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonProps) {
  return (
    <AriaButton
      data-variant={variant}
      data-size={size}
      className={clsx("btn", className)}
      {...rest}
    />
  );
}
