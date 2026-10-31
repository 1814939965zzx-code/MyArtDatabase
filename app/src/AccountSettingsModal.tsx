"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { apiFetch } from "./api";
import type { SessionUser } from "./AuthGate";
import { AccountSettingsFields } from "./components/account/AccountSettingsFields";
import type { AccountSettingsMessage } from "./components/account/AccountSettingsFields";
import { Button, Modal } from "./ui";

export function AccountSettingsModal({
  user,
  onClose,
  onUserChange,
}: {
  user: SessionUser;
  onClose: () => void;
  onUserChange: (user: SessionUser) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<AccountSettingsMessage>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React 事件对象在同步处理结束后会将 currentTarget 置为 null，
    // 必须在异步回调前保存表单引用，避免 await 之后 reset 崩溃。
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload: Record<string, string> = {};
    const displayName = String(form.get("displayName") || "").trim();
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (displayName) payload.displayName = displayName;
    if (newPassword) {
      if (newPassword.length < 8) {
        setMessage({ kind: "error", text: "新密码至少 8 位" });
        return;
      }
      if (newPassword !== confirmPassword) {
        setMessage({ kind: "error", text: "两次输入的新密码不一致" });
        return;
      }
      payload.currentPassword = currentPassword;
      payload.newPassword = newPassword;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await apiFetch<{ user: SessionUser }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onUserChange(data.user);
      formElement.reset();
      setMessage({ kind: "ok", text: "已保存" });
    } catch (reason) {
      setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="ACCOUNT"
      title="账号设置"
      description="修改显示名或登录密码。"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" form="account-settings-form" variant="primary" loading={busy}>
            保存
          </Button>
        </>
      }
    >
      <form id="account-settings-form" className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        <AccountSettingsFields username={user.username} displayName={user.displayName} message={message} />
      </form>
    </Modal>
  );
}
