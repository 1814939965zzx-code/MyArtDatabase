import { useEffect } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "./cn";

export type ToastAction = { label: string; onClick: () => void };

export type ToastProps = {
  open?: boolean;
  onClose?: () => void;
  tone?: "default" | "success" | "error";
  action?: ToastAction;
  /** 毫秒；0 表示不自动关闭。 */
  duration?: number;
  children: ReactNode;
  className?: string;
};

/**
 * 统一轻提示：固定底部居中、页面层级最高。
 * 带 action 时按“撤销条”布局展示（等价原 undo-toast）。
 */
export function Toast({ open = true, onClose, tone = "default", action, duration = 0, children, className }: ToastProps) {
  useEffect(() => {
    if (!open || !duration) return;
    const timer = window.setTimeout(() => onClose?.(), duration);
    return () => window.clearTimeout(timer);
  }, [open, duration, onClose]);

  if (!open) return null;

  const Icon = tone === "error" ? AlertTriangle : tone === "success" ? CheckCircle2 : null;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "fixed bottom-6 left-1/2 z-toast flex -translate-x-1/2 items-center gap-2 rounded-md bg-ink-panel py-2.5 text-sm text-white shadow-lg",
        action ? "min-w-[min(390px,calc(100vw-32px))] justify-between gap-4 pl-3.5 pr-2.5" : "px-3.5",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon size={15} aria-hidden className="flex-none" /> : null}
        <span className="min-w-0">{children}</span>
      </span>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="flex-none rounded-sm px-2 py-1 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
