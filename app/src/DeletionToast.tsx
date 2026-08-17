"use client";

export function DeletionToast({
  label,
  seconds,
  onUndo,
}: {
  label: string;
  seconds: number;
  onUndo: () => void;
}) {
  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span><strong>{label}</strong> 将在 {seconds} 秒后删除</span>
      <button type="button" onClick={onUndo}>撤销</button>
    </div>
  );
}
