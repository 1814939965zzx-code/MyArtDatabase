"use client";

import { X } from "lucide-react";
import { Spinner } from "./ui";

/** 维度预览左下角的批量 AI 进度胶囊；不属于任何其他 tab。 */
export function AiDimensionStatus({
  status,
  done,
  total,
  timedOut,
  canStop,
  onStop,
}: {
  status: "running" | "stopping";
  done: number;
  total: number;
  timedOut: number;
  canStop: boolean;
  onStop: () => void;
}) {
  return (
    <div className="ai-dimension-status" role="status" aria-live="polite">
      <Spinner size={14} />
      <span className="ai-dimension-status-text">
        {status === "stopping" ? "正在停止…" : `AI 自动标记中 · ${done}/${total}`}
        {status !== "stopping" && timedOut ? ` · ${timedOut} 张超时` : ""}
      </span>
      {canStop ? (
        <button
          type="button"
          className="ai-dimension-status-stop"
          aria-label="停止 AI 标注"
          title="停止 AI 标注"
          onClick={onStop}
        >
          <X size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
