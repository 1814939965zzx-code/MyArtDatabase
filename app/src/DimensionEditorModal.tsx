"use client";

import { Trash2 } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { Button, Input, Modal } from "./ui";

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
    if (applying || busy) return;
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
    <Modal
      open
      onClose={cancel}
      size="lg"
      eyebrow="DIMENSION LABELS"
      title="编辑维度名称"
      description="名称修改仅对当前 Page 生效。"
      footer={
        <>
          <Button type="button" onClick={cancel} disabled={applying || busy}>
            取消
          </Button>
          <Button type="submit" form="dimension-editor-form" variant="primary" loading={applying} disabled={busy}>
            应用修改
          </Button>
        </>
      }
    >
      <form id="dimension-editor-form" ref={formRef} className="flex flex-col gap-4" onSubmit={(event) => void applyChanges(event)}>
        <div className="border-t border-line-soft py-3.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <Input
              aria-label="维度左端名称"
              value={leftLabel}
              data-dimension-side="left"
              required
              maxLength={24}
              disabled={applying || busy}
              placeholder={dimension.leftLabel}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setLeftLabel(event.target.value);
              }}
            />
            <em className="not-italic text-muted">—</em>
            <Input
              aria-label="维度右端名称"
              value={rightLabel}
              data-dimension-side="right"
              required
              maxLength={24}
              disabled={applying || busy}
              placeholder={dimension.rightLabel}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setRightLabel(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border border-danger-border bg-danger-soft p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger-soft hover:text-danger"
            icon={<Trash2 size={15} aria-hidden />}
            disabled={applying || busy}
            onClick={() => onDelete(dimension)}
          >
            删除维度
          </Button>
          <span className="text-sm text-muted">删除后素材将回到该维度中点</span>
        </div>
      </form>
    </Modal>
  );
}
