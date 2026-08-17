"use client";

import { Pencil, X } from "lucide-react";
import { FormEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { centeredRangeStyle, displayDimensionValue } from "./dimensionScale";

type Dimension = { id: string; leftLabel: string; rightLabel: string };
type DimensionLabels = { id: string; leftLabel: string; rightLabel: string };

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
  onApplyLabels: (updates: DimensionLabels[]) => Promise<void>;
}>(function DimensionControlsEditor({ dimensions, values, assetId, busy, onChangeValue, onSaveValue, onApplyLabels }, ref) {
  const formRef = useRef<HTMLFormElement>(null);
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, { leftLabel: string; rightLabel: string }>>({});

  function resetDraft(dimension?: Dimension) {
    setLabelDrafts(dimension ? { [dimension.id]: { leftLabel: dimension.leftLabel, rightLabel: dimension.rightLabel } } : {});
  }

  function openEditor(dimension: Dimension) {
    resetDraft(dimension);
    setEditingDimensionId(dimension.id);
  }

  function cancelEditor() {
    setEditingDimensionId(null);
    resetDraft();
  }

  useEffect(() => {
    setEditingDimensionId(null);
    resetDraft();
    // Drafts are deliberately reset whenever the selected asset or saved data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, dimensions]);

  useImperativeHandle(ref, () => ({
    dismissEditor() {
      if (!editingDimensionId) return false;
      if (applying) return true;
      cancelEditor();
      return true;
    },
  }));

  async function applyChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current?.reportValidity()) return;
    const dimension = dimensions.find((entry) => entry.id === editingDimensionId);
    const draft = dimension ? labelDrafts[dimension.id] : null;
    if (!dimension || !draft) return;
    if (draft.leftLabel.trim() === draft.rightLabel.trim()) {
      const input = formRef.current.querySelector<HTMLInputElement>(`[data-dimension-id="${CSS.escape(dimension.id)}"][data-dimension-side="right"]`);
      input?.setCustomValidity("维度两端不能相同");
      input?.reportValidity();
      return;
    }

    const leftLabel = draft.leftLabel.trim();
    const rightLabel = draft.rightLabel.trim();
    const labelUpdates = leftLabel !== dimension.leftLabel || rightLabel !== dimension.rightLabel
      ? [{ id: dimension.id, leftLabel, rightLabel }]
      : [];
    setApplying(true);
    try {
      await onApplyLabels(labelUpdates);
      setEditingDimensionId(null);
    } catch {
      // The parent reports the API error and refreshes persisted data.
    } finally {
      setApplying(false);
    }
  }

  const editingDimension = dimensions.find((dimension) => dimension.id === editingDimensionId) ?? null;

  return (
    <div className="dimension-controls-editor">
      <div className="dimension-summary-list">
        {dimensions.map((dimension) => {
          const value = values[dimension.id] ?? 500;
          return <div className="dimension-control" key={dimension.id}>
            <div className="dimension-control-heading">
              <span><b>{dimension.leftLabel}</b><em>{displayDimensionValue(value)}</em><b>{dimension.rightLabel}</b></span>
              <button className="dimension-edit-button" type="button" disabled={busy} aria-label={`编辑维度名称：${dimension.leftLabel}—${dimension.rightLabel}`} title="编辑维度名称" onClick={() => openEditor(dimension)}><Pencil size={13} /></button>
            </div>
            <input className="centered-range" aria-label={`调整${dimension.leftLabel}到${dimension.rightLabel}的位置`} aria-valuetext={String(displayDimensionValue(value))} type="range" min="0" max="1000" step="5" value={value} style={centeredRangeStyle(value)} disabled={busy} onChange={(event) => onChangeValue(assetId, dimension.id, Number(event.target.value))} onPointerUp={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))} onBlur={(event) => void onSaveValue(assetId, dimension.id, Number(event.currentTarget.value))} />
          </div>;
        })}
      </div>

      {editingDimension ? <div className="dimension-editor-backdrop" onMouseDown={(event) => { if (!applying && event.target === event.currentTarget) cancelEditor(); }}>
        <section className="dimension-editor-modal dimension-name-editor-modal" role="dialog" aria-modal="true" aria-labelledby="dimension-editor-title">
          <div className="modal-heading"><div><p className="eyebrow">DIMENSION LABELS</p><h2 id="dimension-editor-title">编辑维度名称</h2><p>名称修改会对当前项目全局生效。</p></div><button className="icon-button" type="button" aria-label="取消编辑维度名称" disabled={applying} onClick={cancelEditor}><X size={18} /></button></div>
          <form ref={formRef} className="dimension-editor-form" onSubmit={(event) => void applyChanges(event)}>
            <div className="dimension-editor-rows">
              {(() => {
                const dimension = editingDimension;
                const draft = labelDrafts[dimension.id] ?? dimension;
                return <div className="dimension-editor-row" key={dimension.id}>
                  <div className="dimension-label-editors">
                    <input aria-label={`维度左端名称：${dimension.leftLabel}`} value={draft.leftLabel} data-dimension-id={dimension.id} data-dimension-side="left" required maxLength={24} disabled={applying} onChange={(event) => { event.currentTarget.setCustomValidity(""); setLabelDrafts((current) => ({ ...current, [dimension.id]: { ...(current[dimension.id] ?? dimension), leftLabel: event.target.value } })); }} />
                    <em>—</em>
                    <input aria-label={`维度右端名称：${dimension.rightLabel}`} value={draft.rightLabel} data-dimension-id={dimension.id} data-dimension-side="right" required maxLength={24} disabled={applying} onChange={(event) => { event.currentTarget.setCustomValidity(""); setLabelDrafts((current) => ({ ...current, [dimension.id]: { ...(current[dimension.id] ?? dimension), rightLabel: event.target.value } })); }} />
                  </div>
                </div>;
              })()}
            </div>
            <div className="modal-actions"><button className="secondary-button" type="button" disabled={applying} onClick={cancelEditor}>取消</button><button className="primary-button" type="submit" disabled={applying}>{applying ? "应用中…" : "应用修改"}</button></div>
          </form>
        </section>
      </div> : null}
    </div>
  );
});
