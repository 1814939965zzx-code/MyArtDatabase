import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type IconButtonVariant = "ghost" | "solid" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: "text-muted hover:bg-line-soft hover:text-ink",
  solid: "border-line bg-surface text-ink hover:bg-surface-muted",
  danger: "text-danger hover:bg-danger-soft",
};

const SIZE: Record<IconButtonSize, string> = {
  sm: "size-6.5",
  md: "size-8.5",
  lg: "size-9.5",
};

const BASE =
  "inline-grid place-items-center rounded-md border border-transparent transition-colors duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  // 默认手型与“禁用=禁止”光标来自 base.css。
  "disabled:opacity-55";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** 必须提供：图标按钮没有可见文字，屏幕阅读器依赖它。 */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  active?: boolean;
};

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  active = false,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], active && "bg-line-soft text-ink", className)}
      {...rest}
    />
  );
}
