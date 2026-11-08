"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, InlineMessage, Modal } from "./ui";

export type AiDimensionDialogDimension = {
  id: string;
  leftLabel: string;
  rightLabel: string;
};

export type AiDimensionDialogAsset = {
  id: string;
  name: string;
  mimeType?: string;
  dimensionValues: Record<string, number>;
};

export type AiDimensionMode = "all" | "zero";

export type AiDimensionDialogOptions = {
  dimensionIds: string[];
  mode: AiDimensionMode;
};

/**
 * 单图/批量共用的 AI 维度确认框。
 * 单图入口传 1 个 asset；批量入口传当前 Page 的全部图片。
 */
export function AiDimensionDialog({
  open,
  dimensions,
  assets,
  busy = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  dimensions: AiDimensionDialogDimension[];
  assets: AiDimensionDialogAsset[];
  busy?: boolean;
  onClose: () => void;
  onConfirm: (options: AiDimensionDialogOptions) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(dimensions.map((dimension) => dimension.id)));
  const [mode, setMode] = useState<AiDimensionMode>("zero");
  const [submitting, setSubmitting] = useState(false);

  const imageAssets = assets.filter((asset) => !asset.mimeType || asset.mimeType.startsWith("image/"));
  const targetCoordinates: string[] = [];
  const targetAssetIds = new Set<string>();
  for (const asset of imageAssets) {
    for (const dimension of dimensions) {
      if (!selected.has(dimension.id)) continue;
      const value = asset.dimensionValues?.[dimension.id] ?? 500;
      if (mode === "all" || value === 500) {
        targetCoordinates.push(`${asset.id}|${dimension.id}`);
        targetAssetIds.add(asset.id);
      }
    }
  }

  const noDimension = selected.size === 0;
  const noTarget = targetCoordinates.length === 0;
  const tooManyDimensions = selected.size > 20;
  const tooManyImages = targetAssetIds.size > 200;
  const canStart = !busy && !submitting && !noDimension && !noTarget && !tooManyDimensions && !tooManyImages;

  function toggleDimension(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const single = imageAssets.length === 1 && assets.length === 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
      size="md"
      title={single ? "AI 标记这张图" : "AI 标注维度"}
      description={single
        ? "让 AI 判断当前图片在选中维度上的位置。处理期间只会暂时禁用这张图的维度滑块。"
        : "让 AI 判断当前 Page 中图片在选中维度上的位置；每张图片单独发送，处理期间只锁正在处理的图片。"}
      footer={
        <>
          <Button onClick={onClose} disabled={busy || submitting}>取消</Button>
          <Button
            variant="primary"
            icon={<Sparkles size={14} aria-hidden />}
            loading={busy || submitting}
            disabled={!canStart}
            onClick={() => {
              if (!canStart) return;
              setSubmitting(true);
              onConfirm({ dimensionIds: [...selected], mode });
            }}
          >
            开始标记
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-sm font-medium text-ink">选择维度</strong>
            <span className="text-2xs text-muted">{selected.size} / {dimensions.length}</span>
          </div>
          <div className="max-h-[190px] overflow-y-auto border border-line">
            {dimensions.map((dimension) => (
              <label
                key={dimension.id}
                className="flex cursor-pointer items-center gap-2 border-b border-line-soft px-2.5 py-2 text-sm last:border-b-0 hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  className="accent-sage"
                  checked={selected.has(dimension.id)}
                  onChange={() => toggleDimension(dimension.id)}
                  disabled={busy}
                />
                <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <b className="truncate text-left font-medium">{dimension.leftLabel}</b>
                  <i className="not-italic text-faint">—</i>
                  <b className="truncate text-right font-medium">{dimension.rightLabel}</b>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <strong className="mb-2 block text-sm font-medium text-ink">标记范围</strong>
          <div className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-0.5 accent-sage"
                name="ai-dimension-mode"
                checked={mode === "zero"}
                onChange={() => setMode("zero")}
                disabled={busy}
              />
              <span>
                <b className="block font-medium text-ink">只标记未修改的（选中维度当前为 0）</b>
                <span className="text-2xs text-muted">按坐标补全：只写界面值为 0 的维度，已有值不动。</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-0.5 accent-sage"
                name="ai-dimension-mode"
                checked={mode === "all"}
                onChange={() => setMode("all")}
                disabled={busy}
              />
              <span>
                <b className="block font-medium text-ink">全部标记</b>
                <span className="text-2xs text-muted">选中维度全部重新判断并覆盖。</span>
              </span>
            </label>
          </div>
        </section>

        {mode === "all" ? (
          <InlineMessage tone="warning">会覆盖这些图片在选中维度上已有的值。</InlineMessage>
        ) : null}

        <InlineMessage tone="info">
          {single
            ? "处理期间这张图的维度滑块会暂时禁用；超过 60 秒未返回会自动解锁，迟到的结果不会写入。"
            : "每张图片单独发送给 AI；处理期间只锁正在处理的 1～2 张图，其他图仍可编辑。刷新或切页不会中断批量任务。"}
        </InlineMessage>

        {noDimension ? <InlineMessage tone="error">请至少选择一个维度。</InlineMessage> : null}
        {tooManyDimensions ? <InlineMessage tone="error">单次最多 20 个维度，请减少选择。</InlineMessage> : null}
        {tooManyImages ? <InlineMessage tone="error">单次最多 200 张图片，请减少 Page 素材或分批处理。</InlineMessage> : null}
        {!noDimension && !tooManyDimensions && noTarget ? (
          <InlineMessage tone="warning">
            {mode === "zero" ? "选中维度没有需要标记的 0 值，请改用“全部标记”或换一个维度。" : "没有可处理的图片。"}
          </InlineMessage>
        ) : null}

        <div className="border-t border-line-soft pt-3 text-sm text-muted">
          将处理 <b className="text-ink">{targetAssetIds.size}</b> 张图片 ×{" "}
          <b className="text-ink">{selected.size}</b> 个维度，共{" "}
          <b className="text-ink">{targetCoordinates.length}</b> 个坐标。
        </div>
      </div>
    </Modal>
  );
}
