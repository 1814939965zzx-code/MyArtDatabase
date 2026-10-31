import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-accent bg-accent text-white hover:border-accent-strong hover:bg-accent-strong",
  secondary: "border-line bg-white text-ink hover:border-line-strong hover:bg-surface",
  ghost: "border-transparent bg-transparent text-muted hover:bg-line-soft hover:text-ink",
  danger: "border-danger-border bg-danger-soft text-danger hover:border-danger hover:bg-danger hover:text-white",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "h-6.5 px-2 text-xs",
  sm: "h-8 px-2.5 text-xs",
  md: "min-h-9 px-3.5 text-sm",
  lg: "h-9.5 px-3.5 text-sm",
};

const BASE =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-wait disabled:opacity-55";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" size={14} aria-hidden /> : icon}
      {children}
    </button>
  );
}
