"use client";

import { Copy, LoaderCircle, UserRound, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "./api";
import type { SessionUser } from "./AuthGate";
import { PasswordInput } from "./PasswordInput";

type ApiToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
type FreshToken = { id: string; name: string; token: string };

function formatTime(iso: string | null) {
  if (!iso) return "从未";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

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

  // 插件令牌
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [freshToken, setFreshToken] = useState<FreshToken | null>(null);
  const [tokenMessage, setTokenMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    apiFetch<{ tokens: ApiToken[] }>("/api/auth/tokens")
      .then((data) => setTokens(data.tokens))
      .catch(() => setTokens([]));
  }, []);

  async function refreshTokens() {
    try {
      const data = await apiFetch<{ tokens: ApiToken[] }>("/api/auth/tokens");
      setTokens(data.tokens);
    } catch {
      setTokens([]);
    }
  }

  async function generateToken() {
    setGenerating(true);
    setTokenMessage(null);
    try {
      const data = await apiFetch<FreshToken>("/api/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name: tokenName }),
      });
      setFreshToken(data);
      setTokenName("");
      await refreshTokens();
    } catch (reason) {
      setTokenMessage({ kind: "error", text: reason instanceof Error ? reason.message : "生成失败" });
    } finally {
      setGenerating(false);
    }
  }

  async function revokeToken(id: string) {
    if (!window.confirm("吊销后该令牌立即失效，无法恢复。确定吊销吗？")) return;
    try {
      await apiFetch(`/api/auth/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setTokenMessage({ kind: "ok", text: "已吊销" });
      if (freshToken?.id === id) setFreshToken(null);
      await refreshTokens();
    } catch (reason) {
      setTokenMessage({ kind: "error", text: reason instanceof Error ? reason.message : "吊销失败" });
    }
  }

  async function copyToken() {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken.token);
      setTokenMessage({ kind: "ok", text: "已复制到剪贴板" });
    } catch {
      setTokenMessage({ kind: "error", text: "复制失败，请手动选择复制" });
    }
  }

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

        <div className="api-tokens-section">
          <p className="eyebrow">PLUGIN TOKEN</p>
          <h3>插件令牌</h3>
          <p>供 Chrome 扩展等外部客户端以 <code>Authorization: Bearer</code> 认证调用 API。令牌只存哈希，可随时吊销。</p>
          <div className="extension-download-row">
            <span>配合使用：浏览器采集扩展（网页右键保存图片/视频到素材库），解压后在 chrome://extensions 以「加载已解压的扩展程序」安装，令牌即在上方生成。</span>
            <a className="secondary-button" href="/api/extension" download>下载 Chrome 扩展 (.zip)</a>
          </div>
          {tokenMessage ? <div className={`user-manager-message ${tokenMessage.kind === "error" ? "error" : ""}`}>{tokenMessage.text}</div> : null}
          {freshToken ? (
            <div className="fresh-token">
              <p>令牌已生成，明文只显示这一次，请立即复制保存：</p>
              <div className="fresh-token-row">
                <code>{freshToken.token}</code>
                <button className="secondary-button" type="button" onClick={() => void copyToken()}>
                  <Copy size={13} /> 复制
                </button>
              </div>
            </div>
          ) : null}
          <div className="token-create-row">
            <input
              value={tokenName}
              onChange={(event) => setTokenName(event.target.value)}
              maxLength={50}
              placeholder="备注，如：我的笔记本（可空）"
            />
            <button className="secondary-button" type="button" onClick={() => void generateToken()} disabled={generating}>
              {generating ? <LoaderCircle className="spin" size={14} /> : "生成令牌"}
            </button>
          </div>
          <div className="token-list">
            {tokens === null ? (
              <p className="form-hint">加载中…</p>
            ) : tokens.length === 0 ? (
              <p className="form-hint">还没有令牌</p>
            ) : (
              tokens.map((token) => (
                <div className="token-item" key={token.id}>
                  <div className="token-meta">
                    <strong>{token.name || "（未命名）"}</strong>
                    <span>创建于 {formatTime(token.createdAt)} · 最后使用 {formatTime(token.lastUsedAt)}</span>
                  </div>
                  <button className="token-revoke" type="button" onClick={() => void revokeToken(token.id)}>吊销</button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
