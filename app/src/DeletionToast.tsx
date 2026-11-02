"use client";

import { Toast } from "./ui";

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
    <Toast open action={{ label: "撤销", onClick: onUndo }}>
      <span>
        <strong>{label}</strong> 已删除，{seconds} 秒内可撤销
      </span>
    </Toast>
  );
}
