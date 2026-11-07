"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { AnnouncementFields } from "./components/account/AnnouncementFields";
import type { AnnouncementFieldsMessage } from "./components/account/AnnouncementFields";
import { Button, Modal, Spinner } from "./ui";

const ANNOUNCEMENT_TEXT_MAX = 2000;

/** 公告的两种用途：登录页公告只在未登录时展示，全局公告只在登录后的站内展示。 */
export type AnnouncementScope = "login" | "global";

const COPY: Record<AnnouncementScope, {
  title: string;
  description: string;
  enabledHint: string;
  saved: string;
}> = {
  login: {
    title: "登录页公告",
    description: "只在未登录的登录页展示。登录后的站内公告是另一份独立设置，请从「全局公告」单独编辑。",
    enabledHint: "在登录页显示公告",
    saved: "已保存，登录页将展示更新后的公告",
  },
  global: {
    title: "全局公告",
    description: "只在登录后的导航栏下方展示。未登录登录页的公告是另一份独立设置，请从「登录页公告」单独编辑。成员可关闭站内公告条，但可随时从用户菜单再次查看。",
    enabledHint: "在登录后导航栏下方显示公告",
    saved: "已保存，站内导航栏下方将展示更新后的公告",
  },
};

export function AnnouncementModal({
  scope,
  onClose,
  onSaved,
}: {
  scope: AnnouncementScope;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<AnnouncementFieldsMessage>(null);
  const copy = COPY[scope];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    apiFetch<{ text: string; enabled: boolean }>(`/api/announcement?scope=${scope}`)
      .then((data) => {
        setText(data.text);
        setEnabled(data.enabled);
      })
      .catch((reason) => setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "公告加载失败" }))
      .finally(() => setLoading(false));
  }, [scope]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch(`/api/announcement?scope=${scope}`, {
        method: "PUT",
        body: JSON.stringify({ text, enabled }),
      });
      setMessage({ kind: "ok", text: enabled ? copy.saved : "已保存，公告当前为关闭状态，内容已保留" });
      onSaved?.();
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
      eyebrow="ANNOUNCEMENT"
      title={copy.title}
      description={copy.description}
      footer={
        loading ? undefined : (
          <>
            <Button onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={busy}>
              保存公告
            </Button>
          </>
        )
      }
    >
      {loading ? (
        <div className="flex min-h-[120px] items-center justify-center gap-2 text-md text-muted">
          <Spinner size={18} />
          正在加载公告…
        </div>
      ) : (
        <AnnouncementFields
          text={text}
          onTextChange={setText}
          enabled={enabled}
          onEnabledChange={setEnabled}
          enabledHint={copy.enabledHint}
          maxLength={ANNOUNCEMENT_TEXT_MAX}
          message={message}
        />
      )}
    </Modal>
  );
}
