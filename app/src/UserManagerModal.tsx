"use client";

import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import {
  Button,
  EmptyState,
  Field,
  InlineMessage,
  Input,
  Modal,
  PasswordInput,
  Tabs,
  cn,
} from "./ui";

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
    <Modal
      open
      onClose={onClose}
      eyebrow="ACCOUNT ADMIN"
      title="成员管理"
      description="创建、停用或删除成员；停用会立即踢下线，删除后素材保留。"
      size="md"
      className="flex max-h-[calc(100dvh-40px)] max-w-[680px] flex-col"
      bodyClassName="min-h-0 gap-3 overflow-y-auto"
    >
      <Tabs
        value={tab}
        onChange={setTab}
        ariaLabel="成员管理视图"
        items={[
          { value: "users", label: "成员列表", icon: <Users size={14} aria-hidden /> },
          { value: "logs", label: "登录记录", icon: <ShieldCheck size={14} aria-hidden /> },
        ]}
      />

      {message ? <InlineMessage tone={message.kind === "error" ? "error" : "success"}>{message.text}</InlineMessage> : null}

      {tab === "users" ? (
        <div className="flex flex-col gap-3">
          <div role="list" className="flex flex-col">
            {users.map((user) => (
              <div
                className="flex min-h-[54px] items-center justify-between gap-3 border-b border-line-soft px-2.5 py-2"
                role="listitem"
                key={user.id}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <strong className="truncate text-base font-semibold text-ink">{user.displayName || user.username}</strong>
                  <span className="truncate text-sm text-muted">
                    {user.username} · {user.role === "admin" ? "管理员" : "成员"}
                    {user.active ? "" : " · 已停用"}
                  </span>
                  <small className="truncate text-xs text-faint">
                    {user.assetCount} 个素材{user.lastLoginAt ? ` · 最近登录 ${new Date(user.lastLoginAt).toLocaleString("zh-CN")}` : " · 从未登录"}
                  </small>
                </div>
                <div className="flex flex-none items-center gap-1">
                  <Button
                    size="xs"
                    disabled={busy || user.id === meId}
                    onClick={() => void patchUser(user.id, { active: !user.active })}
                    title={user.id === meId ? "不能停用自己的账号" : user.active ? "停用" : "启用"}
                  >
                    {user.active ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() => void patchUser(user.id, { role: user.role === "admin" ? "member" : "admin" })}
                    title="切换角色"
                  >
                    {user.role === "admin" ? "降为成员" : "设为管理员"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-danger"
                    disabled={busy}
                    onClick={() => void resetPassword(user)}
                    title="重置密码"
                  >
                    重置密码
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-danger"
                    disabled={busy || user.id === meId}
                    onClick={() => void removeUser(user)}
                    title={user.id === meId ? "不能删除自己的账号" : "删除成员"}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
            {!users.length ? <EmptyState compact title="还没有成员" /> : null}
          </div>

          {creating ? (
            <form
              className="flex flex-col gap-2.5 rounded-md border border-warning-border bg-warning-soft p-3"
              onSubmit={(event) => void createUser(event)}
            >
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label="用户名" htmlFor="um-username">
                  <Input id="um-username" name="username" required maxLength={50} placeholder="字母、数字、点、下划线、连字符" />
                </Field>
                <Field label="显示名" htmlFor="um-display-name">
                  <Input id="um-display-name" name="displayName" maxLength={50} placeholder="可选" />
                </Field>
                <Field label="密码" htmlFor="um-password">
                  <PasswordInput id="um-password" name="password" required minLength={8} placeholder="至少 8 位" />
                </Field>
                <Field label="角色" htmlFor="um-role">
                  <select
                    id="um-role"
                    name="role"
                    defaultValue="member"
                    className="h-9.5 w-full rounded-sm border border-line-strong bg-white px-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <option value="member">成员</option>
                    <option value="admin">管理员</option>
                  </select>
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setCreating(false)}>取消</Button>
                <Button type="submit" variant="primary" loading={busy}>{busy ? "创建中…" : "创建成员"}</Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" className="self-start" icon={<UserPlus size={14} aria-hidden />} onClick={() => setCreating(true)}>
              新建成员
            </Button>
          )}
        </div>
      ) : (
        <div role="list" className="flex flex-col">
          {logs.length ? (
            logs.map((log) => (
              <div
                className={cn(
                  "flex min-h-[46px] items-center gap-2.5 border-b border-l-2 border-line-soft border-l-transparent px-2.5 py-2",
                  !log.success && "border-l-danger",
                )}
                role="listitem"
                key={log.id}
              >
                <strong className="truncate text-sm text-ink">{log.username || "（未知用户）"}</strong>
                <span className="truncate text-sm text-muted">{log.success ? "成功" : "失败"} · {log.message}</span>
                <small className="ml-auto flex-none text-xs text-faint">
                  {new Date(log.createdAt).toLocaleString("zh-CN")} · IP {log.ip || "未知"}
                </small>
              </div>
            ))
          ) : (
            <EmptyState compact title="还没有登录记录" />
          )}
        </div>
      )}
    </Modal>
  );
}
