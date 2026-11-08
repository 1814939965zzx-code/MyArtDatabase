"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, Field, InlineMessage, Textarea } from "./ui";

/** 维度说明：用户手填，或让 AI 根据左右端名称生成后继续编辑。 */
export function DimensionDescriptionEditor({
  leftLabel,
  rightLabel,
  value,
  onChange,
  disabled = false,
  onGenerate,
}: {
  leftLabel: string;
  rightLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onGenerate: (leftLabel: string, rightLabel: string) => Promise<string>;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const labelsReady = leftLabel.trim().length > 0 && rightLabel.trim().length > 0 && leftLabel.trim() !== rightLabel.trim();

  async function generate() {
    if (!labelsReady || disabled || generating) return;
    setGenerating(true);
    setError("");
    try {
      const next = await onGenerate(leftLabel.trim(), rightLabel.trim());
      onChange(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Field
      label="维度说明（可选）"
      hint="说明左右两端分别指什么、有哪些可观察特征。AI 标注时会优先按这段说明判断。"
    >
      <Textarea
        value={value}
        rows={3}
        maxLength={500}
        disabled={disabled || generating}
        placeholder="例如：冷色指蓝、青、灰等；暖色指红、橙、黄等。中间值表示冷暖程度。"
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-2xs text-muted">
          {value.length}/500 · 留空时只按两端名称判断
        </span>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          icon={<Sparkles size={13} aria-hidden />}
          loading={generating}
          disabled={disabled || !labelsReady || generating}
          title={!labelsReady ? "先填写不同的左右端名称" : "根据左右端名称生成说明"}
          onClick={() => void generate()}
        >
          AI 生成说明
        </Button>
      </div>
      {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
    </Field>
  );
}
