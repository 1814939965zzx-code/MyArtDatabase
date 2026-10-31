import { UserRound } from "lucide-react";
import { Field, InlineMessage, Input, PasswordInput } from "../../ui";

export type AccountSettingsMessage = { kind: "ok" | "error"; text: string } | null;

/** 账号设置表单字段（弹窗与视觉组件页共用）。 */
export function AccountSettingsFields({
  username,
  displayName,
  message,
}: {
  username: string;
  displayName: string;
  message?: AccountSettingsMessage;
}) {
  return (
    <>
      {message ? <InlineMessage tone={message.kind === "error" ? "error" : "success"}>{message.text}</InlineMessage> : null}
      <Field label="用户名">
        <Input value={username} disabled />
      </Field>
      <Field label="显示名">
        <Input
          name="displayName"
          maxLength={50}
          defaultValue={displayName}
          placeholder="显示名（可留空不修改）"
          icon={<UserRound size={15} aria-hidden />}
        />
      </Field>
      <Field label="当前密码">
        <PasswordInput name="currentPassword" autoComplete="current-password" placeholder="修改密码时需要" />
      </Field>
      <Field label="新密码" hint="留空表示不修改密码">
        <PasswordInput name="newPassword" minLength={8} autoComplete="new-password" placeholder="至少 8 位" />
      </Field>
      <Field label="确认新密码">
        <PasswordInput name="confirmPassword" minLength={8} autoComplete="new-password" placeholder="再次输入新密码" />
      </Field>
    </>
  );
}
