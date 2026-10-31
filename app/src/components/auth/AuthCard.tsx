import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { LogIn, Megaphone, ShieldCheck, UserRound } from "lucide-react";
import { BrandMark } from "../layout/BrandMark";
import { Button, Field, InlineMessage, Input, PasswordInput, cn } from "../../ui";

/* ────────────────────────────── 品牌与卡片 ────────────────────────────── */

export function AuthBrand({ className }: { className?: string }) {
  return <BrandMark size={42} radius={10} className={cn("mb-1", className)} />;
}

export type AuthCardProps = {
  title?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** 登录/初始化页的卡片本体（不含全屏背景）。 */
export function AuthCard({ title, description, error, className, children }: AuthCardProps) {
  return (
    <section className={cn("flex w-full max-w-[400px] flex-col gap-[18px] border border-line bg-surface px-7 py-[30px] shadow-xl", className)}>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <AuthBrand />
        {title ? (
          <>
            <p className="text-2xs font-bold uppercase tracking-[.15em] text-accent">ART DATABASE</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-[-.01em] text-ink">{title}</h1>
          </>
        ) : null}
        {description ? <p className="text-sm leading-relaxed text-muted">{description}</p> : null}
      </div>
      {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
      {children}
    </section>
  );
}

/** 登录页公告条。 */
export function AuthAnnouncement({ text }: { text: string }) {
  return (
    <div role="note" className="flex w-full max-w-[440px] flex-col gap-1 rounded-lg border border-l-4 border-sage/25 border-l-sage bg-sage-wash px-4 py-3 text-sage-deep">
      <strong className="flex items-center gap-1.5 text-sm font-semibold">
        <Megaphone size={13} aria-hidden />
        公告
      </strong>
      <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{text}</p>
    </div>
  );
}

export type AuthScreenProps = AuthCardProps & { announcement?: string | null };

/** 全屏登录页：公告 + 卡片。 */
export function AuthScreen({ announcement, ...card }: AuthScreenProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3.5 bg-paper p-6">
      {announcement ? <AuthAnnouncement text={announcement} /> : null}
      <AuthCard {...card} />
    </div>
  );
}

/* ────────────────────────────── 登录表单 ────────────────────────────── */

export type LoginPayload = { username: string; password: string; remember: boolean };

export function LoginForm({ onSubmit, disabled }: { onSubmit: (payload: LoginPayload) => Promise<void> | void; disabled?: boolean }) {
  const uid = useId();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await onSubmit({
        username: String(form.get("username") || "").trim(),
        password: String(form.get("password") || ""),
        remember: form.get("remember") === "on",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <Field label="用户名" htmlFor={`${uid}-username`}>
        <Input
          id={`${uid}-username`}
          name="username"
          required
          autoComplete="username"
          maxLength={50}
          placeholder="用户名"
          icon={<UserRound size={15} aria-hidden />}
        />
      </Field>
      <Field label="密码" htmlFor={`${uid}-password`}>
        <PasswordInput id={`${uid}-password`} name="password" required autoComplete="current-password" placeholder="密码" />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-normal text-muted">
        <input type="checkbox" name="remember" className="accent-sage" />
        记住我（30 天内免登录）
      </label>
      <Button type="submit" variant="primary" className="min-h-10 w-full" loading={busy} disabled={disabled} icon={<LogIn size={15} aria-hidden />}>
        {busy ? "登录中…" : "登录"}
      </Button>
    </form>
  );
}

/* ────────────────────────────── 初始化表单 ────────────────────────────── */

export type SetupPayload = { username: string; displayName: string; password: string };

export function SetupForm({
  onSubmit,
  onError,
}: {
  onSubmit: (payload: SetupPayload) => Promise<void> | void;
  onError?: (message: string) => void;
}) {
  const uid = useId();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) {
      onError?.("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        username: String(form.get("username") || "").trim(),
        displayName: String(form.get("displayName") || "").trim(),
        password,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <Field label="用户名" htmlFor={`${uid}-username`}>
        <Input
          id={`${uid}-username`}
          name="username"
          required
          autoComplete="username"
          maxLength={50}
          placeholder="登录用户名（字母、数字、点、下划线、连字符）"
          icon={<UserRound size={15} aria-hidden />}
        />
      </Field>
      <Field label="显示名" htmlFor={`${uid}-displayName`}>
        <Input
          id={`${uid}-displayName`}
          name="displayName"
          maxLength={50}
          placeholder="如：张三（可留空，默认同用户名）"
          icon={<ShieldCheck size={15} aria-hidden />}
        />
      </Field>
      <Field label="密码" htmlFor={`${uid}-password`}>
        <PasswordInput id={`${uid}-password`} name="password" required minLength={8} autoComplete="new-password" placeholder="至少 8 位" />
      </Field>
      <Field label="确认密码" htmlFor={`${uid}-confirm`}>
        <PasswordInput id={`${uid}-confirm`} name="confirm" required minLength={8} autoComplete="new-password" placeholder="再次输入密码" />
      </Field>
      <Button type="submit" variant="primary" className="min-h-10 w-full" loading={busy} icon={<ShieldCheck size={15} aria-hidden />}>
        {busy ? "创建中…" : "创建管理员并进入"}
      </Button>
    </form>
  );
}
