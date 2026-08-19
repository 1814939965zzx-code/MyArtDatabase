"use client";

import { FormEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
    <div className="dimension-controls-editor">
      <div className="dimension-summary-list">
        {dimensions.map((dimension) => {
          const value = values[dimension.id] ?? 500;
          return <div className="dimension-control" key={dimension.id}>
            <div className="dimension-control-heading">
              <span><b>{dimension.leftLabel}</b><em>{displayDimensionValue(value)}</em><b>{dimension.rightLabel}</b></span>
            </div>
            <input className="centered-range" aria-label={`调整${dimension.leftLabel}到${dimension.rightLabel}的位置`} aria-valuetext={String(displayDimensionValue(value))} type="range" min="0" max="1000" step="5" value={value} style={centeredRangeStyle(value)} disabled={busy} onChange={(event) => onChangeValue(assetId, dimension.id, Number(event.target.value))} onPointerUp={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))} onBlur={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))} />
          </div>;
        })}
      </div>
    </div>
  );
});
