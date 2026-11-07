import { Field, InlineMessage, Textarea } from "../../ui";

export type AnnouncementFieldsMessage = { kind: "ok" | "error"; text: string } | null;

/** 公告编辑字段（弹窗与视觉组件页共用）。 */
export function AnnouncementFields({
  text,
  onTextChange,
  enabled,
  onEnabledChange,
  enabledHint,
  maxLength = 2000,
  message,
}: {
  text: string;
  onTextChange: (text: string) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** 启用开关里的补充说明，用来说明这份公告显示在哪（登录页 / 站内导航栏）。 */
  enabledHint: string;
  maxLength?: number;
  message?: AnnouncementFieldsMessage;
}) {
  return (
    <>
      {message ? <InlineMessage tone={message.kind === "error" ? "error" : "success"}>{message.text}</InlineMessage> : null}
      <Field label="公告内容" hint={`${text.length} / ${maxLength}，支持多行`}>
        <Textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          maxLength={maxLength}
          rows={6}
          placeholder="例如：本周五 18:00 素材库停机维护，请提前保存工作。"
        />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-normal text-muted">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} className="accent-sage" />
        启用（{enabledHint}）
      </label>
    </>
  );
}
