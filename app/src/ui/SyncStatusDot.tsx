import { cn } from "./cn";

export type SyncStatus = "synced" | "saving" | "offline";

const LABELS: Record<SyncStatus, string> = {
  synced: "已保存",
  saving: "正在保存…",
  offline: "有改动未同步，点击立即重试",
};

/**
 * 同步状态小圆点：灰=已保存、黄=保存中（呼吸）、红=未同步（可点重试）。
 * 两处复用：画板右下角工具条左侧、维度预览场景右下角。
 */
export function SyncStatusDot({ status, pending = 0, onRetry, className }: {
  status: SyncStatus;
  pending?: number;
  onRetry?: () => void;
  className?: string;
}) {
  const label = status === "offline" && pending > 0 ? `${pending} 项未同步，点击立即重试` : LABELS[status];
  const tone = status === "synced"
    ? "bg-[#9ca3af]"
    : status === "saving"
      ? "bg-[#f59e0b] motion-safe:animate-pulse"
      : "bg-[#ef4444]";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={status === "offline" ? onRetry : undefined}
      className={cn(
        "h-2 w-2 flex-none rounded-full transition-colors",
        tone,
        status === "offline" ? "cursor-pointer" : "cursor-default",
        className,
      )}
    />
  );
}
