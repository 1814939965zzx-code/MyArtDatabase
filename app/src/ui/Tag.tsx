import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type TagProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

/** 筛选 chip：未选中为浅底描边，选中为鼠尾草绿实底。 */
export function Tag({ active = false, className, type = "button", ...rest }: TagProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active
          ? "border-sage bg-sage text-white"
          : "border-line bg-surface-muted text-muted hover:border-sage/60 hover:text-sage-deep",
        className,
      )}
      {...rest}
    />
  );
}
