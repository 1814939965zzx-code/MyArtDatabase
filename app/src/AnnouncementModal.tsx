"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { AnnouncementFields } from "./components/account/AnnouncementFields";
import type { AnnouncementFieldsMessage } from "./components/account/AnnouncementFields";
import { Button, Modal, Spinner } from "./ui";

const ANNOUNCEMENT_TEXT_MAX = 2000;

export function AnnouncementModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<AnnouncementFieldsMessage>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    apiFetch<{ text: string; enabled: boolean }>("/api/announcement")
      .then((data) => {
        setText(data.text);
        setEnabled(data.enabled);
      })
      .catch((reason) => setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "公告加载失败" }))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/api/announcement", {
        method: "PUT",
        body: JSON.stringify({ text, enabled }),
      });
      setMessage({ kind: "ok", text: "已保存，登录页将展示更新后的公告" });
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
      title="登录页公告"
      description="公告会展示在登录页，团队成员登录前即可看到。"
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
          maxLength={ANNOUNCEMENT_TEXT_MAX}
          message={message}
        />
      )}
    </Modal>
  );
}
