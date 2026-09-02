"use client";

import { LoaderCircle, UserRound, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { apiFetch } from "./api";
import type { SessionUser } from "./AuthGate";
import { PasswordInput } from "./PasswordInput";

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
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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
    <div className="modal-backdrop">
      <section className="modal-card account-settings-card" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">ACCOUNT</p>
            <h2 id="account-settings-title">账号设置</h2>
            <p>修改显示名或登录密码。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        {message ? <div className={`user-manager-message ${message.kind === "error" ? "error" : ""}`}>{message.text}</div> : null}
        <form className="modal-form" onSubmit={(event) => void save(event)}>
          <label>用户名
            <input value={user.username} disabled />
          </label>
          <label>显示名
            <span className="auth-input"><UserRound size={15} /><input name="displayName" maxLength={50} defaultValue={user.displayName} placeholder="显示名（可留空不修改）" /></span>
          </label>
          <label>当前密码
            <PasswordInput name="currentPassword" autoComplete="current-password" placeholder="修改密码时需要" />
          </label>
          <label>新密码
            <PasswordInput name="newPassword" minLength={8} autoComplete="new-password" placeholder="留空表示不修改密码" />
          </label>
          <label>确认新密码
            <PasswordInput name="confirmPassword" minLength={8} autoComplete="new-password" placeholder="再次输入新密码" />
          </label>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>取消</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : "保存"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
