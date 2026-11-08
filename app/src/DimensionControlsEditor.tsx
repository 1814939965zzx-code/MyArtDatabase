"use client";

import { forwardRef, useImperativeHandle } from "react";
import { Sparkles } from "lucide-react";
import { Button, RangeSlider } from "./ui";
import { centeredRangeStyle, displayDimensionValue } from "./dimensionScale";

type Dimension = { id: string; leftLabel: string; rightLabel: string };

export type DimensionControlsEditorHandle = {
  dismissEditor: () => boolean;
};

export const DimensionControlsEditor = forwardRef<DimensionControlsEditorHandle, {
  dimensions: Dimension[];
  values: Record<string, number>;
  assetId: string;
  busy: boolean;
  readOnly?: boolean;
  /** 当前图片正在被 AI 处理：只锁维度滑块，不影响其他字段。 */
  locked?: boolean;
  aiTagBusy?: boolean;
  aiTagDisabled?: boolean;
  onAiTag?: () => void;
  onChangeValue: (assetId: string, dimensionId: string, value: number) => void;
  onSaveValue: (assetId: string, dimensionId: string, value: number) => Promise<void>;
}>(function DimensionControlsEditor({ dimensions, values, assetId, busy, readOnly = false, locked = false, aiTagBusy = false, aiTagDisabled = false, onAiTag, onChangeValue, onSaveValue }, ref) {
  useImperativeHandle(ref, () => ({
    // Kept for API compatibility with the parent; there is no in-drawer editor to dismiss anymore.
    dismissEditor() {
      return false;
    },
  }));

  return (
    <div className="block">
      {onAiTag ? (
        <div className="flex items-center justify-between gap-2 pb-2">
          <span className="text-sm text-muted">
            {locked ? "AI 正在处理这张图…" : "AI 标记"}
          </span>
          <Button
            size="xs"
            icon={<Sparkles size={13} aria-hidden />}
            loading={aiTagBusy}
            disabled={busy || readOnly || locked || aiTagDisabled}
            onClick={onAiTag}
            title="让 AI 判断这张图片在选中维度上的位置"
          >
            AI 标记这张图
          </Button>
        </div>
      ) : null}
      <div className="border-t border-line-soft">
        {dimensions.map((dimension) => {
          const value = values[dimension.id] ?? 500;
          return (
            <div className="block border-b border-line-soft py-[13px]" key={dimension.id}>
              <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-2">
                <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <b className="truncate text-sm font-medium text-ink">{dimension.leftLabel}</b>
                  <em className="text-2xs not-italic text-accent">{displayDimensionValue(value)}</em>
                  <b className="truncate text-right text-sm font-medium text-ink">{dimension.rightLabel}</b>
                </span>
              </div>
              <RangeSlider
                // centered-range 只负责中点向两侧延伸的轨道填充视觉；交互仍由 RangeSlider 统一。
                className="centered-range mt-3 h-[18px]"
                style={centeredRangeStyle(value)}
                aria-label={`调整${dimension.leftLabel}到${dimension.rightLabel}的位置`}
                aria-valuetext={String(displayDimensionValue(value))}
                min={0}
                max={1000}
                step={5}
                value={value}
                disabled={busy || readOnly || locked}
                onValueChange={(next) => onChangeValue(assetId, dimension.id, next)}
                onPointerUp={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))}
                onBlur={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
