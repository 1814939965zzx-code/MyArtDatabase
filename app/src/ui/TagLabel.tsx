import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";

export type TagLabelTone = "solid" | "paper";

const TONE: Record<TagLabelTone, string> = {
  solid: "border-faint bg-faint text-white",
  paper: "border-line bg-surface/90 text-ink-label",
};

export type TagLabelProps = {
  children: ReactNode;
  tone?: TagLabelTone;
  className?: string;
  style?: CSSProperties;
};

/**
 * 只读标签：展示一段不可交互的名称（场景端点名称、角落坐标等）。
 * 默认 faint 灰实底、白字；与可点击的 Tag 筛选 chip 区分：不是按钮、没有选中态、不会获得焦点。
 */
export function TagLabel({ children, tone = "solid", className, style }: TagLabelProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center justify-center whitespace-nowrap rounded-full border px-2 text-xs font-normal",
        TONE[tone],
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
