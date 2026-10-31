import type { ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 text-center text-muted",
        compact ? "px-4 py-6" : "min-h-[280px] border border-dashed border-line-strong px-6",
        className,
      )}
    >
      {icon ? <span className="mb-1 text-faint">{icon}</span> : null}
      <h3 className="m-0 text-md font-semibold text-ink">{title}</h3>
      {description ? <p className="m-0 max-w-[420px] text-sm leading-relaxed">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
