"use client";

import { Trash2, X } from "lucide-react";
import { FormEvent, useRef, useState } from "react";

type Dimension = { id: string; leftLabel: string; rightLabel: string };
type DimensionLabels = { id: string; leftLabel: string; rightLabel: string };

export function DimensionEditorModal({
  dimension,
  busy,
  onClose,
  onApplyLabels,
  onDelete,
}: {
  dimension: Dimension;
  busy: boolean;
  onClose: () => void;
  onApplyLabels: (updates: DimensionLabels[]) => Promise<void>;
  onDelete: (dimension: Dimension) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [leftLabel, setLeftLabel] = useState(dimension.leftLabel);
  const [rightLabel, setRightLabel] = useState(dimension.rightLabel);
  const [applying, setApplying] = useState(false);

  function cancel() {
    if (applying) return;
    onClose();
  }

  async function applyChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current?.reportValidity()) return;
    if (leftLabel.trim() === rightLabel.trim()) {
      const input = formRef.current.querySelector<HTMLInputElement>(`[data-dimension-side="right"]`);
      input?.setCustomValidity("维度两端不能相同");
      input?.reportValidity();
      return;
    }

    const updates = leftLabel.trim() !== dimension.leftLabel || rightLabel.trim() !== dimension.rightLabel
      ? [{ id: dimension.id, leftLabel: leftLabel.trim(), rightLabel: rightLabel.trim() }]
      : [];
    if (!updates.length) {
      onClose();
      return;
    }
    setApplying(true);
    try {
      await onApplyLabels(updates);
      onClose();
    } catch {
      // The parent reports the API error and refreshes persisted data.
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="dimension-editor-backdrop" onMouseDown={(event) => { if (!applying && event.target === event.currentTarget) cancel(); }}>
      <section className="dimension-editor-modal dimension-name-editor-modal" role="dialog" aria-modal="true" aria-labelledby="dimension-editor-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">DIMENSION LABELS</p>
            <h2 id="dimension-editor-title">编辑维度名称</h2>
            <p>名称修改会对当前项目全局生效。</p>
          </div>
          <button className="icon-button" type="button" aria-label="取消编辑维度名称" disabled={applying} onClick={cancel}><X size={18} /></button>
        </div>
        <form ref={formRef} className="dimension-editor-form" onSubmit={(event) => void applyChanges(event)}>
          <div className="dimension-editor-rows">
            <div className="dimension-editor-row">
              <div className="dimension-label-editors">
                <input aria-label="维度左端名称" value={leftLabel} data-dimension-side="left" required maxLength={24} disabled={applying} placeholder={dimension.leftLabel} onChange={(event) => { event.currentTarget.setCustomValidity(""); setLeftLabel(event.target.value); }} />
                <em>—</em>
                <input aria-label="维度右端名称" value={rightLabel} data-dimension-side="right" required maxLength={24} disabled={applying} placeholder={dimension.rightLabel} onChange={(event) => { event.currentTarget.setCustomValidity(""); setRightLabel(event.target.value); }} />
              </div>
            </div>
          </div>
          <div className="danger-zone">
            <button type="button" disabled={applying} onClick={() => onDelete(dimension)}><Trash2 size={15} /> 删除维度</button>
            <span>删除后素材将回到该维度中点</span>
          </div>
          <div className="modal-actions">
            <button className="secondary-button" type="button" disabled={applying} onClick={cancel}>取消</button>
            <button className="primary-button" type="submit" disabled={applying}>{applying ? "应用中…" : "应用修改"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
