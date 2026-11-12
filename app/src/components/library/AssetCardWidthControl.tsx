import { useState } from "react";
import {
  ASSET_CARD_WIDTH_DEFAULT,
  ASSET_CARD_WIDTH_MAX,
  ASSET_CARD_WIDTH_MIN,
  clampAssetCardWidth,
  readAssetCardWidth,
  writeAssetCardWidth,
} from "../../layoutPreferences";
import { RangeSlider } from "../../ui";

/**
 * 素材库卡片宽度控制：拖动滑块在 240～400px 之间调整卡片宽度。
 * 值同时写入 localStorage，项目素材库与全部素材库共用同一偏好。
 */
export function useAssetCardWidth() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? ASSET_CARD_WIDTH_DEFAULT : readAssetCardWidth()));

  function update(next: number) {
    const clamped = clampAssetCardWidth(next);
    setWidth(clamped);
    writeAssetCardWidth(clamped);
  }

  return [width, update] as const;
}

/** 工具栏里的宽度滑块；宽度值直接写在标签上，拖动时实时变化。 */
export function AssetCardWidthControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div
      className="flex h-[31px] flex-none items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-muted"
      role="group"
      aria-label="卡片宽度"
      title={`卡片宽度：拖动调整 240～400px（当前 ${value}px）`}
    >
      <span className="text-2xs leading-none" aria-hidden>卡片宽度</span>
      <RangeSlider
        min={ASSET_CARD_WIDTH_MIN}
        max={ASSET_CARD_WIDTH_MAX}
        step={10}
        value={value}
        onValueChange={onChange}
        aria-label="卡片宽度"
        aria-valuetext={`${value} 像素`}
        className="h-1 w-[86px]"
      />
      <span className="min-w-[38px] text-center text-2xs leading-none tabular-nums">{value}px</span>
    </div>
  );
}
