"use client";

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { apiFetch, notifyUnauthorized } from "./api";
import { ArtDatabaseApp } from "./ArtDatabaseApp";
import { AuthCard, AuthScreen, LoginForm, SetupForm } from "./components/auth/AuthCard";
import type { LoginPayload, SetupPayload } from "./components/auth/AuthCard";
import { Button, Spinner } from "./ui";

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "member" | "guest";
  active: boolean;
};

export function AuthGate() {
  const [booting, setBooting] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
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
    // 登录页公告：未登录即可读取；与登录后的站内全局公告是两份独立设置
    apiFetch<{ text: string; enabled: boolean }>("/api/announcement?scope=login")
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

  async function login(payload: LoginPayload) {
    setMessage(null);
    try {
      const data = await apiFetch<{ user: SessionUser }>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
      setUser(data.user);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "登录失败");
    }
  }

  async function setup(payload: SetupPayload) {
    setMessage(null);
    try {
      const data = await apiFetch<{ user: SessionUser }>("/api/auth/setup", { method: "POST", body: JSON.stringify(payload) });
      setUser(data.user);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "初始化失败");
    }
  }

  async function guestLogin() {
    setMessage(null);
    setGuestBusy(true);
    try {
      const data = await apiFetch<{ user: SessionUser }>("/api/auth/guest", { method: "POST" });
      setUser(data.user);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "游客登录失败");
    } finally {
      setGuestBusy(false);
    }
  }

  if (booting) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
        <AuthCard>
          <div className="flex items-center justify-center gap-2.5 py-2 text-md text-muted">
            <Spinner size={20} />
            正在连接素材库…
          </div>
        </AuthCard>
      </div>
    );
  }

  if (user) {
    return <ArtDatabaseApp user={user} onLogout={() => void logout()} />;
  }

  const announcementText = announcement?.enabled ? announcement.text.trim() : "";

  return (
    <AuthScreen
      announcement={announcementText || null}
      title={needsSetup ? "初始化管理员账号" : "登录素材库"}
      description={needsSetup ? "首次使用需要创建管理员账号，用于管理成员与系统设置。" : "请输入账号密码访问团队素材库。"}
      error={message}
    >
      {needsSetup ? <SetupForm onSubmit={setup} onError={setMessage} /> : (
        <>
          <LoginForm onSubmit={login} />
          <div className="flex items-center gap-2 text-2xs text-faint" aria-hidden>
            <span className="h-px flex-1 bg-line-soft" />或<span className="h-px flex-1 bg-line-soft" />
          </div>
          <Button
            variant="secondary"
            className="min-h-10 w-full"
            icon={<Eye size={15} aria-hidden />}
            loading={guestBusy}
            onClick={() => void guestLogin()}
          >
            {guestBusy ? "正在进入…" : "以游客身份浏览"}
          </Button>
          <p className="m-0 text-center text-xs text-muted">游客无需账号，可浏览全部项目内容，但不能编辑。</p>
        </>
      )}
    </AuthScreen>
  );
}

// 让 notifyUnauthorized 在 api 模块被引用（AuthGate 直接使用 apiFetch 即可，导出仅为类型一致性）
export { notifyUnauthorized };
