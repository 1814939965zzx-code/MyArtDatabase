"use client";

import { AlertTriangle, ClipboardPaste, ImagePlus, LoaderCircle, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { notifyUnauthorized } from "./api";
import { isVideoMime } from "./assetMedia";
import { Button, InlineMessage, Modal, Spinner } from "./ui";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/avif",
]);
const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/mpeg",
  "video/3gpp",
  "video/3gpp2",
]);
const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

type ReplacementCandidate = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  isVideo: boolean;
};

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

export function AssetImageReplacement({
  asset,
  busy,
  onBusyChange,
  onComplete,
  onMessage,
}: {
  asset: { id: string; name: string; thumbnailUrl: string | null; originalUrl: string | null; mimeType: string };
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<ReplacementCandidate | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);

  // 同类型替换：图片换图片、视频换视频
  const assetIsVideo = isVideoMime(asset.mimeType);
  const allowedTypes = assetIsVideo ? ALLOWED_VIDEO_TYPES : ALLOWED_IMAGE_TYPES;
  const maxBytes = assetIsVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  const acceptTypes = [...allowedTypes].join(",");

  useEffect(() => () => {
    if (candidate?.previewUrl) URL.revokeObjectURL(candidate.previewUrl);
  }, [candidate]);

  async function prepareFile(rawFile: File) {
    setError("");
    setPreviewFailed(false);
    if (!allowedTypes.has(rawFile.type)) {
      setError(assetIsVideo ? "仅支持 mp4/mov/webm/mkv 等视频" : "仅支持 JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC 图片");
      return;
    }
    if (rawFile.size <= 0 || rawFile.size > maxBytes) {
      setError(assetIsVideo ? "视频不能为空或超过 200MB" : "图片不能为空或超过 50MB");
      return;
    }
    const file = rawFile.name
      ? rawFile
      : new File([rawFile], `clipboard-${Date.now()}.${rawFile.type === "image/png" ? "png" : rawFile.type === "image/webp" ? "webp" : rawFile.type.startsWith("video/") ? "mp4" : "jpg"}`, { type: rawFile.type });
    setPreparing(true);
    try {
      let width = 0;
      let height = 0;
      if (!isVideoMime(file.type)) {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      }
      setCandidate({ file, previewUrl: URL.createObjectURL(file), width, height, isVideo: isVideoMime(file.type) });
    } catch {
      setError("无法读取这个文件");
    } finally {
      setPreparing(false);
    }
  }

  function clearCandidate() {
    setCandidate(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      // 剪贴板粘贴只适用于图片（浏览器通常拿不到剪贴板视频文件）
      if (assetIsVideo) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((entry) => entry.type.startsWith("image/"))
        ?? Array.from(event.clipboardData?.items ?? []).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"))?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void prepareFile(file);
    };
    const handleUndo = (event: KeyboardEvent) => {
      if (!candidate || isTextEditingTarget(event.target)) return;
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      clearCandidate();
      onMessage("已撤销待替换素材");
    };
    window.addEventListener("paste", handlePaste);
    window.addEventListener("keydown", handleUndo);
    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("keydown", handleUndo);
    };
  }, [candidate]);

  async function confirmReplacement() {
    if (!candidate || busy) return;
    const form = new FormData();
    form.set("id", asset.id);
    form.set("file", candidate.file);
    onBusyChange(true);
    setError("");
    try {
      const response = await fetch("/api/assets/image", { method: "POST", body: form });
      if (response.status === 401) notifyUnauthorized();
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "替换素材失败");
      await onComplete();
      clearCandidate();
      onMessage("素材已替换，素材信息和项目数据保持不变");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "替换素材失败");
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={acceptTypes}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void prepareFile(file); }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || preparing} loading={preparing} icon={<ImagePlus size={14} aria-hidden />} onClick={() => inputRef.current?.click()}>
          {preparing ? "正在读取…" : "替换素材"}
        </Button>
        <span className="flex items-center gap-1 text-xs text-muted">
          <ClipboardPaste size={12} aria-hidden />
          {assetIsVideo ? "视频请用文件选择替换" : "也可直接粘贴图片"}
        </span>
      </div>
      {error && !candidate ? <InlineMessage tone="error">{error}</InlineMessage> : null}

      <Modal
        open={Boolean(candidate)}
        onClose={clearCandidate}
        eyebrow="REPLACE ASSET"
        title="确认替换素材"
        description="只替换文件；素材信息、项目引用、维度值和画板内容不会改变。"
        size="lg"
        footer={
          <>
            <Button disabled={busy} onClick={clearCandidate}>
              取消
            </Button>
            <Button variant="primary" loading={busy} icon={<Upload size={15} aria-hidden />} onClick={() => void confirmReplacement()}>
              {busy ? "替换中…" : "确认替换"}
            </Button>
          </>
        }
      >
        {candidate ? (
          <>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <figure className="m-0 flex flex-col gap-1.5 rounded-md border border-line bg-surface-muted p-2">
                <figcaption className="text-xs text-muted">当前素材</figcaption>
                {asset.thumbnailUrl ? (
                  <img src={asset.thumbnailUrl} alt={asset.name} className="h-[220px] w-full rounded-sm object-contain" />
                ) : (
                  <span className="grid h-[220px] place-items-center text-sm text-muted">无预览</span>
                )}
              </figure>
              <figure className="m-0 flex flex-col gap-1.5 rounded-md border border-line bg-surface-muted p-2">
                <figcaption className="text-xs text-muted">替换后</figcaption>
                {candidate.isVideo ? (
                  <video src={candidate.previewUrl} controls muted playsInline className="h-[220px] w-full rounded-sm object-contain" />
                ) : previewFailed ? (
                  <span className="grid h-[220px] place-items-center text-sm text-muted">该格式无法预览</span>
                ) : (
                  <img src={candidate.previewUrl} alt="待替换素材预览" onError={() => setPreviewFailed(true)} className="h-[220px] w-full rounded-sm object-contain" />
                )}
              </figure>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line-soft pt-3 text-sm">
              <strong className="min-w-0 truncate text-ink">{candidate.file.name}</strong>
              <span className="text-xs text-muted">
                {candidate.isVideo ? "视频" : `${candidate.width} × ${candidate.height}`} · {(candidate.file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>

            {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
            <p className="m-0 flex items-center gap-1.5 text-xs text-muted">
              <RotateCcw size={13} aria-hidden />
              确认前可按 {navigator.platform.includes("Mac") ? "Command" : "Ctrl"} + Z 撤回
            </p>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
