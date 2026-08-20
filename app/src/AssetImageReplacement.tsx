"use client";

import { AlertTriangle, ClipboardPaste, ImagePlus, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;

type ReplacementCandidate = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
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
  asset: { id: string; name: string; thumbnailUrl: string | null; originalUrl: string | null };
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onComplete: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<ReplacementCandidate | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (candidate?.previewUrl) URL.revokeObjectURL(candidate.previewUrl);
  }, [candidate]);

  async function prepareFile(rawFile: File) {
    setError("");
    if (!ALLOWED_IMAGE_TYPES.has(rawFile.type)) {
      setError("仅支持 JPEG、PNG 和 WebP 图片");
      return;
    }
    if (rawFile.size <= 0 || rawFile.size > MAX_FILE_SIZE) {
      setError("图片不能为空或超过 50MB");
      return;
    }
    const file = rawFile.name
      ? rawFile
      : new File([rawFile], `clipboard-${Date.now()}.${rawFile.type === "image/png" ? "png" : rawFile.type === "image/webp" ? "webp" : "jpg"}`, { type: rawFile.type });
    setPreparing(true);
    try {
      const bitmap = await createImageBitmap(file);
      const next = { file, previewUrl: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height };
      bitmap.close();
      setCandidate(next);
    } catch {
      setError("无法读取这张图片");
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
      onMessage("已撤销待替换图片");
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
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "替换图片失败");
      await onComplete();
      clearCandidate();
      onMessage("图片已替换，素材信息和项目数据保持不变");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "替换图片失败");
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="asset-image-replacement">
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void prepareFile(file); }}
      />
      <button className="replace-image-button" type="button" disabled={busy || preparing} onClick={() => inputRef.current?.click()}>
        {preparing ? <LoaderCircle className="spin" size={14} /> : <ImagePlus size={14} />}
        {preparing ? "正在读取…" : "替换图片"}
      </button>
      <span className="replace-image-hint"><ClipboardPaste size={12} />也可直接粘贴图片</span>
      {error && !candidate ? <div className="form-error"><AlertTriangle size={15} />{error}</div> : null}

      {candidate ? (
        <div className="modal-backdrop replacement-backdrop" role="presentation">
          <section className="modal-card replacement-modal" role="dialog" aria-modal="true" aria-labelledby="replacement-title">
            <div className="modal-heading">
              <div><p className="eyebrow">REPLACE IMAGE</p><h2 id="replacement-title">确认替换图片</h2><p>只替换图片文件；素材信息、项目引用、维度值和画板内容不会改变。</p></div>
              <button className="icon-button" type="button" onClick={clearCandidate} aria-label="取消替换"><X size={18} /></button>
            </div>
            <div className="replacement-compare">
              <figure><figcaption>当前图片</figcaption>{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt={asset.name} /> : <span>无预览</span>}</figure>
              <figure><figcaption>替换后</figcaption><img src={candidate.previewUrl} alt="待替换图片预览" /></figure>
            </div>
            <div className="replacement-file-facts">
              <strong>{candidate.file.name}</strong>
              <span>{candidate.width} × {candidate.height} · {(candidate.file.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            {error ? <div className="form-error"><AlertTriangle size={15} />{error}</div> : null}
            <p className="replacement-undo-hint"><RotateCcw size={13} />确认前可按 {navigator.platform.includes("Mac") ? "Command" : "Ctrl"} + Z 撤回</p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={clearCandidate}>取消</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmReplacement()}><Upload size={15} />{busy ? "替换中…" : "确认替换"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
