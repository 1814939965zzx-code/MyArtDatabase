import type { ReactNode } from "react";

/** 顶栏标题组：标题 + 计数徽标。 */
export function TopbarTitle({ title, count }: { title: ReactNode; count?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <h1 className="truncate text-lg font-semibold tracking-[-.01em] text-ink">{title}</h1>
      {typeof count === "number" ? (
        <span className="flex-none rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">{count}</span>
      ) : null}
    </div>
  );
}
