"use client";

import { forwardRef, useImperativeHandle } from "react";
import { RangeSlider } from "./ui";
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
  onChangeValue: (assetId: string, dimensionId: string, value: number) => void;
  onSaveValue: (assetId: string, dimensionId: string, value: number) => Promise<void>;
}>(function DimensionControlsEditor({ dimensions, values, assetId, busy, onChangeValue, onSaveValue }, ref) {
  useImperativeHandle(ref, () => ({
    // Kept for API compatibility with the parent; there is no in-drawer editor to dismiss anymore.
    dismissEditor() {
      return false;
    },
  }));

  return (
    <div className="block">
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
                disabled={busy}
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
