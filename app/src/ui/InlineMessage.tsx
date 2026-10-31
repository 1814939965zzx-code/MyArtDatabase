import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "./cn";

export type InlineMessageTone = "success" | "error" | "warning" | "info";

const TONE: Record<InlineMessageTone, string> = {
  success: "border-success-border bg-success-soft text-success",
  error: "border-danger-border bg-danger-soft text-danger",
  warning: "border-warning-border bg-warning-soft text-warning",
  info: "border-line bg-surface-muted text-muted",
};

const ICONS = { success: CheckCircle2, error: AlertTriangle, warning: AlertTriangle, info: Info } as const;

export type InlineMessageProps = {
  tone?: InlineMessageTone;
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
};

/** 表单内/区块内的持久提示条（原 form-error、ai-config-message、user-manager-message 等）。 */
export function InlineMessage({ tone = "info", children, className, role }: InlineMessageProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={cn("flex items-center gap-2 border px-2.5 py-2 text-sm", TONE[tone], className)}
    >
      <Icon size={15} aria-hidden className="flex-none" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
