import type { ReactNode } from "react";
import { cn } from "./cn";

/** 浮层菜单容器：相对触发器定位到右下方。 */
export function MenuPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="menu"
      className={cn("absolute right-0 top-[calc(100%+6px)] z-popover min-w-[168px] rounded-lg border border-line bg-white p-1 shadow-panel", className)}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  danger = false,
  onClick,
  children,
}: {
  icon?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-8.5 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        danger ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-surface-muted",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line-soft" />;
}
