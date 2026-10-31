import type { ReactNode } from "react";
import { cn } from "../../ui";

export type SidebarNavItemProps = {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  active?: boolean;
  onClick: () => void;
  className?: string;
};

/** 侧栏导航项：图标 + 主标题 + 次说明，深色底上的三种状态。 */
export function SidebarNavItem({ icon, title, subtitle, active = false, onClick, className }: SidebarNavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        active ? "bg-surface-muted text-ink" : "text-white/80 hover:bg-ink-hover hover:text-white",
        className,
      )}
    >
      <span className="grid size-[31px] flex-none place-items-center rounded-md border border-current opacity-75">{icon}</span>
      <span className="min-w-0">
        <strong className="block truncate text-sm font-medium">{title}</strong>
        {subtitle ? <small className="mt-0.5 block truncate text-xs opacity-60">{subtitle}</small> : null}
      </span>
    </button>
  );
}
