"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { centeredRangeStyle, displayDimensionValue } from "./dimensionScale";

type Dimension = { id: string; leftLabel: string; rightLabel: string };
type DimensionLabels = { id: string; leftLabel: string; rightLabel: string };

export type DimensionControlsEditorHandle = {
  save: () => Promise<boolean>;
};

export const DimensionControlsEditor = forwardRef<DimensionControlsEditorHandle, {
  dimensions: Dimension[];
  values: Record<string, number>;
  assetId: string;
  busy: boolean;
  onChangeValue: (assetId: string, dimensionId: string, value: number) => void;
  onSaveValue: (assetId: string, dimensionId: string, value: number) => Promise<void>;
  onSaveLabels: (updates: DimensionLabels[]) => Promise<void>;
}>(function DimensionControlsEditor({
  dimensions,
  values,
  assetId,
  busy,
  onChangeValue,
  onSaveValue,
  onSaveLabels,
}, ref) {
  const formRef = useRef<HTMLFormElement>(null);
  const [drafts, setDrafts] = useState<Record<string, { leftLabel: string; rightLabel: string }>>(() => Object.fromEntries(
    dimensions.map((dimension) => [dimension.id, { leftLabel: dimension.leftLabel, rightLabel: dimension.rightLabel }]),
  ));

  useEffect(() => {
    setDrafts(Object.fromEntries(
      dimensions.map((dimension) => [dimension.id, { leftLabel: dimension.leftLabel, rightLabel: dimension.rightLabel }]),
    ));
  }, [assetId, dimensions]);

  async function save() {
    if (!formRef.current?.reportValidity()) return false;
    const matchingLabels = dimensions.find((dimension) => {
      const draft = drafts[dimension.id];
      return draft && draft.leftLabel.trim() === draft.rightLabel.trim();
    });
    if (matchingLabels) {
      const input = Array.from(formRef.current.elements).find((element) =>
        element instanceof HTMLInputElement
        && element.dataset.dimensionId === matchingLabels.id
        && element.dataset.dimensionSide === "right",
      ) as HTMLInputElement | undefined;
      input?.setCustomValidity("维度两端不能相同");
      input?.reportValidity();
      return false;
    }
    const updates = dimensions.flatMap((dimension) => {
      const draft = drafts[dimension.id];
      if (!draft) return [];
      const leftLabel = draft.leftLabel.trim();
      const rightLabel = draft.rightLabel.trim();
      if (!leftLabel || !rightLabel || leftLabel === rightLabel) return [];
      return leftLabel !== dimension.leftLabel || rightLabel !== dimension.rightLabel
        ? [{ id: dimension.id, leftLabel, rightLabel }]
        : [];
    });
    if (!updates.length) return true;
    try {
      await onSaveLabels(updates);
      return true;
    } catch {
      return false;
    }
  }

  useImperativeHandle(ref, () => ({ save }));

  return (
    <form ref={formRef} className="dimension-controls-editor" onSubmit={(event) => event.preventDefault()}>
      {dimensions.map((dimension) => {
        const value = values[dimension.id] ?? 500;
        const draft = drafts[dimension.id] ?? dimension;
        return (
          <div className="dimension-control" key={dimension.id}>
            <div className="dimension-label-editors">
              <input
                aria-label={`维度左端名称：${dimension.leftLabel}`}
                value={draft.leftLabel}
                data-dimension-id={dimension.id}
                data-dimension-side="left"
                required
                maxLength={24}
                disabled={busy}
                onChange={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setDrafts((current) => ({
                    ...current,
                    [dimension.id]: { ...(current[dimension.id] ?? dimension), leftLabel: event.target.value },
                  }));
                }}
              />
              <em>{displayDimensionValue(value)}</em>
              <input
                aria-label={`维度右端名称：${dimension.rightLabel}`}
                value={draft.rightLabel}
                data-dimension-id={dimension.id}
                data-dimension-side="right"
                required
                maxLength={24}
                disabled={busy}
                onChange={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setDrafts((current) => ({
                    ...current,
                    [dimension.id]: { ...(current[dimension.id] ?? dimension), rightLabel: event.target.value },
                  }));
                }}
              />
            </div>
            <input
              className="centered-range"
              id={`dimension-${dimension.id}`}
              aria-label={`调整${draft.leftLabel}到${draft.rightLabel}的位置`}
              aria-valuetext={String(displayDimensionValue(value))}
              type="range"
              min="0"
              max="1000"
              step="5"
              value={value}
              style={centeredRangeStyle(value)}
              onChange={(event) => onChangeValue(assetId, dimension.id, Number(event.target.value))}
              onPointerUp={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))}
              onBlur={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))}
            />
          </div>
        );
      })}
    </form>
  );
});
