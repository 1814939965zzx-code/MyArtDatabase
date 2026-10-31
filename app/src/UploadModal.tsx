"use client";

import { AlertTriangle, Check, FileImage, LoaderCircle, Sparkles, Upload, X } from "lucide-react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { FormEvent, useEffect, useState } from "react";
import { notifyUnauthorized } from "./api";
import { Button, Field, InlineMessage, Input, Modal, ProgressBar, Spinner, Textarea } from "./ui";

type Duplicate = { id: string; name: string; fileName: string; thumbnailUrl: string | null; inProject: number };
type PreparedFile = {
  hash: string;
  width: number;
  height: number;
  previewUrl: string;
  duplicates: Duplicate[];
};

const MAX_TAGS = 50;

/** XHR 上传并回报进度（fetch 不提供上传进度事件）。 */
function uploadWithProgress(form: FormData, onProgress: (fraction: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      resolve(new Response(xhr.responseText, { status: xhr.status, headers: { "Content-Type": "application/json" } }));
    };
    xhr.onerror = () => reject(new Error("网络错误，上传中断"));
    xhr.send(form);
  });
}

async function prepareFile(file: File, projectId: string): Promise<PreparedFile> {
  const buffer = await file.arrayBuffer();
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buffer))
    : sha256(new Uint8Array(buffer));
  const hash = bytesToHex(digest);
  let width = 0;
  let height = 0;
  if (!file.type.startsWith("video/")) {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  }
  const response = await fetch("/api/uploads/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha256: hash, projectId }),
  });
  if (response.status === 401) notifyUnauthorized();
  const data = await response.json() as { duplicates?: Duplicate[]; error?: string };
  if (!response.ok) throw new Error(data.error || "重复检查失败");
  return {
    hash,
    width,
    height,
    previewUrl: URL.createObjectURL(file),
    duplicates: data.duplicates ?? [],
  };
}

export function UploadModal({
  file,
  projectId,
  onClose,
  onComplete,
  onMessage,
}: {
  file: File;
  projectId: string;
  onClose: () => void;
  onComplete: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [tagsText, setTagsText] = useState("");
  const [aiTagBusy, setAiTagBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let previewUrl = "";
    setPreviewFailed(false);
    void prepareFile(file, projectId).then((result) => {
      previewUrl = result.previewUrl;
      if (active) setPrepared(result);
      else URL.revokeObjectURL(result.previewUrl);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "文件读取失败");
    });
    return () => {
      active = false;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [file, projectId]);

  async function referenceExisting(assetId: string, alreadyInProject: boolean) {
    if (alreadyInProject) {
      onMessage("该素材已经在当前项目中");
      onClose();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/project-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, assetId }),
      });
      if (response.status === 401) notifyUnauthorized();
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "引用失败");
      await onComplete();
      onMessage("已引用素材库中的现有素材");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "引用失败");
    } finally {
      setBusy(false);
    }
  }

  /** AI 打标：把待上传图片发给服务端分析，建议标签合并进标签输入框，由用户确认编辑后随上传提交。 */
  async function runAiTag() {
    if (!prepared) return;
    setAiTagBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/uploads/ai-tags", { method: "POST", body: form });
      if (response.status === 401) notifyUnauthorized();
      const data = await response.json() as { tags?: string[]; reused?: number; created?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "AI 打标失败");
      const suggested = (data.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean);
      if (!suggested.length) throw new Error("AI 未返回标签");
      setTagsText((current) => {
        const existing = [...new Set(current.split(",").map((tag) => tag.trim()).filter(Boolean))];
        const merged = [...existing];
        for (const tag of suggested) {
          const key = tag.toLocaleLowerCase("zh-CN");
          if (merged.some((item) => item.toLocaleLowerCase("zh-CN") === key)) continue;
          if (merged.length >= MAX_TAGS) break;
          merged.push(tag);
        }
        return merged.join(", ");
      });
      const parts = [`建议 ${suggested.length} 个标签`, `复用 ${data.reused ?? 0} 个`, `新建 ${data.created ?? 0} 个`];
      onMessage(`AI 打标完成：${parts.join("，")}，已填入标签输入框，可编辑后提交`);
    } catch (reason) {
      onMessage(`AI 打标失败：${reason instanceof Error ? reason.message : "未知错误"}`);
    } finally {
      setAiTagBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prepared) return;
    if (prepared.duplicates.length && !allowDuplicate) {
      setError("请选择引用已有素材，或确认保留为新素材");
      return;
    }
    const fields = new FormData(event.currentTarget);
    const form = new FormData();
    form.set("file", file);
    form.set("projectId", projectId);
    form.set("name", String(fields.get("name") || ""));
    form.set("tags", tagsText);
    form.set("description", String(fields.get("description") || ""));
    form.set("notes", String(fields.get("notes") || ""));
    form.set("sourceUrl", String(fields.get("sourceUrl") || ""));
    form.set("width", String(Math.round(prepared.width)));
    form.set("height", String(Math.round(prepared.height)));
    form.set("allowDuplicate", String(allowDuplicate));
    setBusy(true);
    setError("");
    setUploadProgress(0);
    try {
      const response = await uploadWithProgress(form, setUploadProgress);
      if (response.status === 401) notifyUnauthorized();
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "上传失败");
      await onComplete();
      onMessage("素材已上传并加入项目");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  const baseName = file.name.replace(/\.[^.]+$/, "");
  const isVideo = file.type.startsWith("video/");
  const percent = uploadProgress === null ? 0 : Math.round(uploadProgress * 100);

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="NEW ASSET"
      title="上传素材"
      description={`提交前补充全局 Metadata 和项目维度位置${isVideo ? "（视频上传后会自动压缩为低码率版本）" : ""}。`}
      size="xl"
      footer={
        prepared ? (
          <>
            <Button onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button type="submit" form="upload-form" variant="primary" loading={busy} icon={<Upload size={15} aria-hidden />}>
              {busy ? (uploadProgress !== null ? `上传中 ${percent}%` : "上传中…") : "确认上传"}
            </Button>
          </>
        ) : undefined
      }
    >
      {!prepared && !error ? (
        <div className="flex min-h-[180px] items-center justify-center gap-2 text-md text-muted">
          <Spinner size={20} />
          正在读取文件并检查重复…
        </div>
      ) : null}
      {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}

      {prepared ? (
        <form id="upload-form" className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" onSubmit={submit}>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid max-h-[360px] place-items-center overflow-hidden rounded-md bg-surface-sunken">
              {isVideo ? (
                <video src={prepared.previewUrl} controls muted playsInline className="max-h-[360px] w-full" />
              ) : previewFailed ? (
                <p className="p-6 text-center text-sm text-muted">该格式浏览器无法预览，仍可正常上传</p>
              ) : (
                <img src={prepared.previewUrl} alt="待上传素材预览" onError={() => setPreviewFailed(true)} className="max-h-[360px] w-full object-contain" />
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted">
              <FileImage size={15} aria-hidden className="flex-none" />
              <span className="min-w-0 flex-1 truncate text-ink">{file.name}</span>
              <small className="flex-none text-xs text-muted">
                {isVideo ? "视频" : `${Math.round(prepared.width)} × ${Math.round(prepared.height)}`} · {(file.size / 1024 / 1024).toFixed(2)}MB
              </small>
            </div>

            {prepared.duplicates.length ? (
              <div className={allowDuplicate ? "flex flex-col gap-2 rounded-md border border-success-border bg-success-soft p-3 text-sm text-success" : "flex flex-col gap-2 rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning"}>
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle size={16} aria-hidden />
                  <strong>发现完全相同的素材</strong>
                </div>
                <p className="m-0">SHA-256 与“{prepared.duplicates[0].name}”一致。</p>
                {!allowDuplicate ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="xs" onClick={() => void referenceExisting(prepared.duplicates[0].id, Boolean(prepared.duplicates[0].inProject))}>
                      使用已有素材
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => { setAllowDuplicate(true); setError(""); }}>
                      仍保留为新素材
                    </Button>
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5"><Check size={13} aria-hidden /> 已确认保留独立记录</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-success"><Check size={14} aria-hidden /> 未发现完全重复素材</div>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <Field label="素材名称" required htmlFor="upload-name">
              <Input id="upload-name" name="name" maxLength={120} defaultValue={baseName} />
            </Field>

            <Field label="全局标签" hint={`逗号分隔，最多 ${MAX_TAGS} 个`} htmlFor="upload-tags">
              <div className="flex gap-2">
                <Input
                  id="upload-tags"
                  name="tags"
                  className="min-w-0 flex-1"
                  value={tagsText}
                  onChange={(event) => setTagsText(event.target.value)}
                  maxLength={4000}
                  placeholder="例如：建筑, 暖色, 户外"
                />
                {!isVideo ? (
                  <Button
                    size="md"
                    variant="secondary"
                    className="flex-none border-accent-border bg-accent-soft text-accent-strong"
                    disabled={busy || aiTagBusy || !prepared}
                    loading={aiTagBusy}
                    icon={<Sparkles size={12} aria-hidden />}
                    onClick={() => void runAiTag()}
                  >
                    {aiTagBusy ? "AI 打标中…" : "AI 打标"}
                  </Button>
                ) : null}
              </div>
            </Field>

            <Field label="描述" htmlFor="upload-description">
              <Textarea id="upload-description" name="description" rows={2} maxLength={2000} placeholder="描述图片内容或使用方向" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="来源链接" htmlFor="upload-source">
                <Input id="upload-source" name="sourceUrl" type="url" maxLength={1000} placeholder="https://" />
              </Field>
              <Field label="备注" htmlFor="upload-notes">
                <Input id="upload-notes" name="notes" maxLength={2000} placeholder="团队内部备注" />
              </Field>
            </div>

            <p className="m-0 text-xs text-muted">上传后素材加入项目，可在维度 Page 中手动添加并设置维度位置。</p>

            {uploadProgress !== null ? (
              <div className="flex flex-col gap-1.5">
                <ProgressBar value={percent} size="md" />
                <span className="text-xs text-muted">上传中 {percent}%</span>
              </div>
            ) : null}
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
