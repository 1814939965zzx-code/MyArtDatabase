"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { apiFetch } from "./api";
import { Button, EmptyState, InlineMessage, Modal, Spinner } from "./ui";

type Announcement = { text: string; enabled: boolean; updatedAt?: string | null };

/** 成员/游客查看当前站内全局公告的只读面板（登录页公告是另一份设置，不在此展示）。 */
export function AnnouncementViewerModal({ onClose }: { onClose: () => void }) {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<Announcement>("/api/announcement?scope=global")
      .then((data) => {
        if (active) setAnnouncement(data);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "公告加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const text = announcement?.text.trim() ?? "";

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="ANNOUNCEMENT"
      title="当前公告"
      description="这是登录后的站内全局公告；登录页公告由管理员在「登录页公告」中单独维护。关闭公告条后仍可随时从这里再次查看。"
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {loading ? (
        <div className="flex min-h-[120px] items-center justify-center gap-2 text-md text-muted">
          <Spinner size={18} />
          正在加载公告…
        </div>
      ) : error ? (
        <InlineMessage tone="error">{error}</InlineMessage>
      ) : text ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 rounded-md border border-sage/25 border-l-4 border-l-sage bg-sage-wash px-3.5 py-3 text-sage-deep">
            <Megaphone size={16} aria-hidden className="mt-0.5 flex-none" />
            <p className="min-w-0 whitespace-pre-wrap break-words text-base leading-relaxed">{text}</p>
          </div>
          {announcement?.enabled ? null : (
            <p className="text-sm text-muted">公告当前已关闭，管理员重新开启后会再次显示。</p>
          )}
        </div>
      ) : (
        <EmptyState compact title="当前没有公告" description="管理员发布公告后会显示在这里。" />
      )}
    </Modal>
  );
}
