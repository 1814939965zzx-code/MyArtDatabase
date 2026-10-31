import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "sage" | "success" | "warning" | "danger";
export type BadgeSize = "sm" | "md";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-muted",
  accent: "bg-accent-soft text-accent-strong",
  sage: "bg-sage-soft text-sage-deep",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

const SIZE: Record<BadgeSize, string> = {
  sm: "min-h-[17px] px-1.5 text-2xs",
  md: "min-h-6 px-2 py-0.5 text-xs",
};

export function Badge({ tone = "neutral", size = "sm", children, className }: { tone?: BadgeTone; size?: BadgeSize; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center gap-1 rounded-full font-medium", TONE[tone], SIZE[size], className)}>
      {children}
    </span>
  );
}
