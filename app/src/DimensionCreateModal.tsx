"use client";

import { FormEvent, useState } from "react";
import { Button, Field, Input, InlineMessage, Modal } from "./ui";
import { DimensionDescriptionEditor } from "./DimensionDescriptionEditor";

export type DimensionDraft = {
  leftLabel: string;
  rightLabel: string;
  description: string;
};

export function DimensionCreateModal({
  busy,
  onClose,
  onCreate,
  onGenerateDescription,
}: {
  busy: boolean;
  onClose: () => void;
  onCreate: (draft: DimensionDraft) => Promise<boolean>;
  onGenerateDescription: (leftLabel: string, rightLabel: string) => Promise<string>;
}) {
  const [leftLabel, setLeftLabel] = useState("");
  const [rightLabel, setRightLabel] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || busy) return;
    if (!leftLabel.trim() || !rightLabel.trim()) {
      setError("请填写维度两端的名称");
      return;
    }
    if (leftLabel.trim() === rightLabel.trim()) {
      setError("维度两端不能相同");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      if (await onCreate({
        leftLabel: leftLabel.trim(),
        rightLabel: rightLabel.trim(),
        description: description.trim(),
      })) {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => { if (!submitting && !busy) onClose(); }}
      closeOnBackdrop={!submitting && !busy}
      closeOnEsc={!submitting && !busy}
      eyebrow="DIMENSION"
      title="添加分类维度"
      description="维度仅属于当前 Page，最多同时选择 3 个坐标轴。"
      footer={
        <>
          <Button onClick={onClose} disabled={submitting || busy}>取消</Button>
          <Button type="submit" form="add-dimension-form" variant="primary" loading={submitting || busy}>
            {submitting || busy ? "添加中…" : "添加维度"}
          </Button>
        </>
      }
    >
      <form id="add-dimension-form" className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Field label="左端名称" required htmlFor="dimension-left">
            <Input
              id="dimension-left"
              value={leftLabel}
              required
              maxLength={24}
              disabled={submitting || busy}
              placeholder="例如：克制"
              onChange={(event) => setLeftLabel(event.target.value)}
            />
          </Field>
          <span className="hidden pb-2 text-center text-muted sm:block">—</span>
          <Field label="右端名称" required htmlFor="dimension-right">
            <Input
              id="dimension-right"
              value={rightLabel}
              required
              maxLength={24}
              disabled={submitting || busy}
              placeholder="例如：张扬"
              onChange={(event) => setRightLabel(event.target.value)}
            />
          </Field>
        </div>
        <DimensionDescriptionEditor
          leftLabel={leftLabel}
          rightLabel={rightLabel}
          value={description}
          onChange={setDescription}
          disabled={submitting || busy}
          onGenerate={onGenerateDescription}
        />
        {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
        <p className="m-0 text-xs text-muted">添加后，当前 Page 内的素材会先放在新维度中点。</p>
      </form>
    </Modal>
  );
}
