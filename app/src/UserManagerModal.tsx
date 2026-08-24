"use client";

import { LoaderCircle, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { PasswordInput } from "./PasswordInput";

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  assetCount: number;
};

type LoginLogEntry = {
  id: number;
  username: string;
  success: boolean;
  ip: string;
  userAgent: string;
  message: string;
  createdAt: string;
};

export function UserManagerModal({ meId, onClose, onChanged }: { meId: string; onClose: () => void; onChanged: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [logs, setLogs] = useState<LoginLogEntry[]>([]);
  const [tab, setTab] = useState<"users" | "logs">("users");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ users: ManagedUser[] }>("/api/users");
      setUsers(data.users);
    } catch (reason) {
      setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "用户列表载入失败" });
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const data = await apiFetch<{ logs: LoginLogEntry[] }>("/api/login-logs");
      setLogs(data.logs);
    } catch (reason) {
      setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "登录记录载入失败" });
    }
  }, []);

  useEffect(() => {
    void load();
    void loadLogs();
  }, [load, loadLogs]);

  function flash(kind: "ok" | "error", text: string) {
    setMessage({ kind, text });
    window.setTimeout(() => setMessage(null), 3200);
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React 事件对象在同步处理结束后会将 currentTarget 置为 null，
    // 必须在异步回调前保存表单引用，避免 await 之后 reset 崩溃。
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      username: String(form.get("username") || "").trim(),
      displayName: String(form.get("displayName") || "").trim(),
      password: String(form.get("password") || ""),
      role: form.get("role") === "admin" ? "admin" : "member",
    };
    if (payload.password.length < 8) {
      flash("error", "密码至少 8 位");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/users", { method: "POST", body: JSON.stringify(payload) });
      setCreating(false);
      formElement.reset();
      await load();
      onChanged();
      flash("ok", "成员已创建");
    } catch (reason) {
      flash("error", reason instanceof Error ? reason.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(id: string, patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await apiFetch("/api/users", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
      await load();
      onChanged();
      flash("ok", "已保存");
    } catch (reason) {
      flash("error", reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(user: ManagedUser) {
    const password = window.prompt(`为「${user.displayName || user.username}」设置新密码（至少 8 位）：`);
    if (password === null) return;
    if (password.length < 8) {
      flash("error", "密码至少 8 位");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/users", { method: "PATCH", body: JSON.stringify({ id: user.id, password }) });
      await load();
      flash("ok", `已重置「${user.displayName || user.username}」的密码`);
    } catch (reason) {
      flash("error", reason instanceof Error ? reason.message : "重置失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(user: ManagedUser) {
    if (!window.confirm(`确定删除成员「${user.displayName || user.username}」？\n\n其上传的素材会保留，上传者标记为「已删除用户」。`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/users?id=${encodeURIComponent(user.id)}`, { method: "DELETE" });
      await load();
      onChanged();
      flash("ok", "成员已删除");
    } catch (reason) {
      flash("error", reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-card user-manager-card" role="dialog" aria-modal="true" aria-labelledby="user-manager-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">ACCOUNT ADMIN</p>
            <h2 id="user-manager-title">成员管理</h2>
            <p>创建、停用或删除成员；停用会立即踢下线，删除后素材保留。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="user-manager-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "users"} className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><Users size={14} />成员列表</button>
          <button type="button" role="tab" aria-selected={tab === "logs"} className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}><ShieldCheck size={14} />登录记录</button>
        </div>
        {message ? <div className={`user-manager-message ${message.kind === "error" ? "error" : ""}`}>{message.text}</div> : null}

        {tab === "users" ? (
          <div className="user-manager-body">
            <div className="user-manager-list" role="list">
              {users.map((user) => (
                <div className="user-manager-row" role="listitem" key={user.id}>
                  <div className="user-manager-main">
                    <strong>{user.displayName || user.username}</strong>
                    <span>{user.username} · {user.role === "admin" ? "管理员" : "成员"}{user.active ? "" : " · 已停用"}</span>
                    <small>{user.assetCount} 个素材{user.lastLoginAt ? ` · 最近登录 ${new Date(user.lastLoginAt).toLocaleString("zh-CN")}` : " · 从未登录"}</small>
                  </div>
                  <div className="user-manager-actions">
                    <button type="button" disabled={busy || user.id === meId} onClick={() => void patchUser(user.id, { active: !user.active })} title={user.id === meId ? "不能停用自己的账号" : user.active ? "停用" : "启用"}>
                      {user.active ? "停用" : "启用"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void patchUser(user.id, { role: user.role === "admin" ? "member" : "admin" })} title="切换角色">
                      {user.role === "admin" ? "降为成员" : "设为管理员"}
                    </button>
                    <button className="danger" type="button" disabled={busy} onClick={() => void resetPassword(user)} title="重置密码">重置密码</button>
                    <button className="danger" type="button" disabled={busy || user.id === meId} onClick={() => void removeUser(user)} title={user.id === meId ? "不能删除自己的账号" : "删除成员"}>删除</button>
                  </div>
                </div>
              ))}
            </div>
            {creating ? (
              <form className="user-create-form" onSubmit={(event) => void createUser(event)}>
                <div className="user-create-fields">
                  <label>用户名<input name="username" required maxLength={50} placeholder="字母、数字、点、下划线、连字符" /></label>
                  <label>显示名<input name="displayName" maxLength={50} placeholder="可选" /></label>
                  <label>密码<PasswordInput name="password" required minLength={8} placeholder="至少 8 位" /></label>
                  <label className="user-role-select">角色
                    <select name="role" defaultValue="member">
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                  </label>
                </div>
                <div className="user-create-actions">
                  <button className="secondary-button" type="button" onClick={() => setCreating(false)}>取消</button>
                  <button className="primary-button" type="submit" disabled={busy}>{busy ? "创建中…" : "创建成员"}</button>
                </div>
              </form>
            ) : (
              <button className="user-create-button" type="button" onClick={() => setCreating(true)}><UserPlus size={14} />新建成员</button>
            )}
          </div>
        ) : (
          <div className="user-manager-body">
            <div className="login-log-list" role="list">
              {logs.length ? logs.map((log) => (
                <div className={`login-log-row ${log.success ? "ok" : "fail"}`} role="listitem" key={log.id}>
                  <strong>{log.username || "（未知用户）"}</strong>
                  <span>{log.success ? "成功" : "失败"} · {log.message}</span>
                  <small>{new Date(log.createdAt).toLocaleString("zh-CN")} · IP {log.ip || "未知"}</small>
                </div>
              )) : <div className="user-manager-empty">还没有登录记录</div>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
