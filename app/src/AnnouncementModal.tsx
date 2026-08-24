"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

const ANNOUNCEMENT_TEXT_MAX = 2000;

export function AnnouncementModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

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
    <div className="modal-backdrop">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">ANNOUNCEMENT</p>
            <h2 id="announcement-title">登录页公告</h2>
            <p>公告会展示在登录页，团队成员登录前即可看到。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        {message ? <div className={`user-manager-message ${message.kind === "error" ? "error" : ""}`}>{message.text}</div> : null}
        {loading ? (
          <div className="loading-state"><LoaderCircle className="spin" size={18} /> 正在加载公告…</div>
        ) : (
          <form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>公告内容
              <textarea
                className="announcement-textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={ANNOUNCEMENT_TEXT_MAX}
                rows={6}
                placeholder="例如：本周五 18:00 素材库停机维护，请提前保存工作。"
              />
              <span className="form-hint">{text.length} / {ANNOUNCEMENT_TEXT_MAX}，支持多行</span>
            </label>
            <label className="announcement-toggle">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              启用（在登录页显示公告）
            </label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={onClose}>取消</button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={14} /> : "保存公告"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
