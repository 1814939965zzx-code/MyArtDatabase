"use client";

import { LoaderCircle, LogIn, Megaphone, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch, notifyUnauthorized } from "./api";
import { ArtDatabaseApp } from "./ArtDatabaseApp";
import { PasswordInput } from "./PasswordInput";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member";
  active: boolean;
};

export function AuthGate() {
  const [booting, setBooting] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{ text: string; enabled: boolean } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    apiFetch<{ needsSetup: boolean; user: SessionUser | null }>("/api/auth/status")
      .then((status) => {
        setNeedsSetup(status.needsSetup);
        setUser(status.user);
      })
      .catch(() => setMessage("无法连接服务器，请确认服务已启动"))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    // 登录页公告：未登录即可读取；失败时静默隐藏公告
    apiFetch<{ text: string; enabled: boolean }>("/api/announcement")
      .then(setAnnouncement)
      .catch(() => setAnnouncement(null));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setNeedsSetup(false);
      setMessage("登录已过期，请重新登录");
    };
    window.addEventListener("artdb:unauthorized", onUnauthorized);
    return () => window.removeEventListener("artdb:unauthorized", onUnauthorized);
  }, []);

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 即使服务端失败也回到登录页
    }
    setUser(null);
  }

  if (booting) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark auth-brand"><Sparkles size={20} /></div>
          <div className="loading-state"><LoaderCircle className="spin" size={20} /> 正在连接素材库…</div>
        </div>
      </div>
    );
  }

  if (user) {
    return <ArtDatabaseApp user={user} onLogout={() => void logout()} />;
  }

  return (
    <div className="auth-screen">
      {announcement && announcement.enabled && announcement.text.trim() ? (
        <div className="auth-announcement" role="note">
          <strong><Megaphone size={13} />公告</strong>
          <p>{announcement.text}</p>
        </div>
      ) : null}
      <div className="auth-card">
        <div className="auth-heading">
          <div className="brand-mark auth-brand"><Sparkles size={20} /></div>
          <p className="eyebrow">ART DATABASE</p>
          <h1>{needsSetup ? "初始化管理员账号" : "登录素材库"}</h1>
          <p>{needsSetup ? "首次使用需要创建管理员账号，用于管理成员与系统设置。" : "请输入账号密码访问团队素材库。"}</p>
        </div>
        {message ? <div className="auth-error" role="alert">{message}</div> : null}
        {needsSetup ? <SetupForm onDone={setUser} onMessage={setMessage} /> : <LoginForm onDone={setUser} onMessage={setMessage} />}
      </div>
    </div>
  );
}

function LoginForm({ onDone, onMessage }: { onDone: (user: SessionUser) => void; onMessage: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    onMessage(null);
    try {
      const data = await apiFetch<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: String(form.get("username") || "").trim(),
          password: String(form.get("password") || ""),
          remember: form.get("remember") === "on",
        }),
      });
      onDone(data.user);
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>用户名
        <span className="auth-input"><UserRound size={15} /><input name="username" required autoComplete="username" maxLength={50} placeholder="用户名" /></span>
      </label>
      <label>密码
        <PasswordInput name="password" required autoComplete="current-password" placeholder="密码" />
      </label>
      <label className="auth-remember"><input name="remember" type="checkbox" />记住我（30 天内免登录）</label>
      <button className="primary-button auth-submit" type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />}
        {busy ? "登录中…" : "登录"}
      </button>
    </form>
  );
}

function SetupForm({ onDone, onMessage }: { onDone: (user: SessionUser) => void; onMessage: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) {
      onMessage("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    onMessage(null);
    try {
      const data = await apiFetch<{ user: SessionUser }>("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({
          username: String(form.get("username") || "").trim(),
          displayName: String(form.get("displayName") || "").trim(),
          password,
        }),
      });
      onDone(data.user);
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "初始化失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>用户名
        <span className="auth-input"><UserRound size={15} /><input name="username" required autoComplete="username" maxLength={50} placeholder="登录用户名（字母、数字、点、下划线、连字符）" /></span>
      </label>
      <label>显示名
        <span className="auth-input"><ShieldCheck size={15} /><input name="displayName" maxLength={50} placeholder="如：张三（可留空，默认同用户名）" /></span>
      </label>
      <label>密码
        <PasswordInput name="password" required minLength={8} autoComplete="new-password" placeholder="至少 8 位" />
      </label>
      <label>确认密码
        <PasswordInput name="confirm" required minLength={8} autoComplete="new-password" placeholder="再次输入密码" />
      </label>
      <button className="primary-button auth-submit" type="submit" disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
        {busy ? "创建中…" : "创建管理员并进入"}
      </button>
    </form>
  );
}

// 让 notifyUnauthorized 在 api 模块被引用（AuthGate 直接使用 apiFetch 即可，导出仅为类型一致性）
export { notifyUnauthorized };
