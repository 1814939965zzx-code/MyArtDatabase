import { useState } from "react";
import { Button } from "../../ui";
import { AuthCard, LoginForm, SetupForm } from "../../components/auth/AuthCard";
import { AccountSettingsFields } from "../../components/account/AccountSettingsFields";
import type { AccountSettingsMessage } from "../../components/account/AccountSettingsFields";
import { AnnouncementFields } from "../../components/account/AnnouncementFields";
import type { AnnouncementFieldsMessage } from "../../components/account/AnnouncementFields";

/** B2 · 登录 / 初始化：真实 AuthCard + LoginForm / SetupForm。 */
export function AuthSpecimen() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex justify-center rounded-lg bg-paper p-4">
        <AuthCard title="登录素材库" description="请输入账号密码访问团队素材库。">
          <LoginForm onSubmit={async () => {}} />
        </AuthCard>
      </div>
      <div className="flex justify-center rounded-lg bg-paper p-4">
        <AuthCard title="登录素材库" description="请输入账号密码访问团队素材库。" error="登录已过期，请重新登录">
          <LoginForm onSubmit={async () => {}} />
        </AuthCard>
      </div>
      <div className="flex justify-center rounded-lg bg-paper p-4">
        <AuthCard title="初始化管理员账号" description="首次使用需要创建管理员账号，用于管理成员与系统设置。">
          <SetupForm onSubmit={async () => {}} onError={() => {}} />
        </AuthCard>
      </div>
    </div>
  );
}

/** B2 · 账号设置：真实 AccountSettingsFields。 */
export function AccountSettingsSpecimen() {
  const [message, setMessage] = useState<AccountSettingsMessage>(null);
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage({ kind: "ok", text: "已保存" });
        }}
      >
        <AccountSettingsFields username="zhangsan" displayName="张三" message={message} />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            onClick={() => {
              setMessage(null);
            }}
          >
            取消
          </Button>
          <Button type="submit" variant="primary">
            保存
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-4">
        <AccountSettingsFields username="zhangsan" displayName="张三" message={{ kind: "error", text: "当前密码不正确" }} />
        <div className="flex justify-end gap-2">
          <Button disabled>取消</Button>
          <Button variant="primary" disabled>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

/** B2 · 登录页公告：真实 AnnouncementFields。 */
export function AnnouncementSpecimen() {
  const [text, setText] = useState("本周五 18:00 素材库停机维护，请提前保存工作。");
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState<AnnouncementFieldsMessage>(null);
  return (
    <form
      className="flex max-w-[620px] flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage({ kind: "ok", text: "已保存，登录页将展示更新后的公告" });
      }}
    >
      <AnnouncementFields
        text={text}
        onTextChange={setText}
        enabled={enabled}
        onEnabledChange={setEnabled}
        enabledHint="在登录页显示公告"
        message={message}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          onClick={() => {
            setMessage(null);
          }}
        >
          取消
        </Button>
        <Button type="submit" variant="primary">
          保存公告
        </Button>
      </div>
    </form>
  );
}
