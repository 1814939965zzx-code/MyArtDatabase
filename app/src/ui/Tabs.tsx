import type { ReactNode } from "react";
import { cn } from "./cn";

export type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
};

export type TabsProps<T extends string> = {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "underline" | "topbar";
  ariaLabel?: string;
  className?: string;
};

/** 页签：下划线 / 顶栏紧凑两种外观，行为一致。 */
export function Tabs<T extends string>({ items, value, onChange, variant = "underline", ariaLabel, className }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex items-center gap-0.5", variant === "underline" && "border-b border-line", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 border-transparent text-sm transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              variant === "topbar" ? "whitespace-nowrap px-2.5 py-1" : "px-3 py-2.5",
              active ? "border-accent font-semibold text-ink" : "text-muted hover:text-ink",
            )}
          >
            {item.icon ? <span className="flex-none">{item.icon}</span> : null}
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "min-w-[17px] rounded-full px-1 text-center text-2xs leading-[17px]",
                  active ? "bg-surface-muted text-ink" : "bg-line-soft text-muted",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
