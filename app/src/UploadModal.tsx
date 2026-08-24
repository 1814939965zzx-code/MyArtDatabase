"use client";

import { AlertTriangle, Check, FileImage, LoaderCircle, Upload, X } from "lucide-react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { FormEvent, useEffect, useState } from "react";
import { notifyUnauthorized } from "./api";
import { centeredRangeStyle, displayDimensionValue } from "./dimensionScale";

type Dimension = { id: string; leftLabel: string; rightLabel: string };
type Duplicate = { id: string; name: string; fileName: string; thumbnailUrl: string | null; inProject: number };
type PreparedFile = {
  hash: string;
  width: number;
  height: number;
  previewUrl: string;
  duplicates: Duplicate[];
};

async function prepareImage(file: File, projectId: string): Promise<PreparedFile> {
  const buffer = await file.arrayBuffer();
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buffer))
    : sha256(new Uint8Array(buffer));
  const hash = bytesToHex(digest);
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
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
  dimensions,
  onClose,
  onComplete,
  onMessage,
}: {
  file: File;
  projectId: string;
  dimensions: Dimension[];
  onClose: () => void;
  onComplete: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [prepared, setPrepared] = useState<PreparedFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(dimensions.map((dimension) => [dimension.id, 500])),
  );

  useEffect(() => {
    let active = true;
    let previewUrl = "";
    void prepareImage(file, projectId).then((result) => {
      previewUrl = result.previewUrl;
      if (active) setPrepared(result);
      else URL.revokeObjectURL(result.previewUrl);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "图片读取失败");
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
      onMessage("已引用素材库中的现有图片");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "引用失败");
    } finally {
      setBusy(false);
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
    form.set("tags", String(fields.get("tags") || ""));
    form.set("description", String(fields.get("description") || ""));
    form.set("notes", String(fields.get("notes") || ""));
    form.set("sourceUrl", String(fields.get("sourceUrl") || ""));
    form.set("width", String(Math.round(prepared.width)));
    form.set("height", String(Math.round(prepared.height)));
    form.set("allowDuplicate", String(allowDuplicate));
    form.set("dimensionValues", JSON.stringify(values));
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      if (response.status === 401) notifyUnauthorized();
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "上传失败");
      await onComplete();
      onMessage("图片已上传并加入项目");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return (
    <div className="modal-backdrop upload-backdrop">
      <section className="modal-card upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <div className="modal-heading">
          <div><p className="eyebrow">NEW ASSET</p><h2 id="upload-title">上传图片</h2><p>提交前补充全局 Metadata 和项目维度位置。</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭上传"><X size={18} /></button>
        </div>
        {!prepared && !error ? <div className="upload-preparing"><LoaderCircle className="spin" /> 正在读取图片并检查重复…</div> : null}
        {error ? <div className="form-error"><AlertTriangle size={15} />{error}</div> : null}
        {prepared ? (
          <form className="upload-layout" onSubmit={submit}>
            <div className="upload-preview-column">
              <img src={prepared.previewUrl} alt="待上传图片预览" />
              <div className="file-facts"><FileImage size={15} /><span>{file.name}</span><small>{Math.round(prepared.width)} × {Math.round(prepared.height)} · {(file.size / 1024 / 1024).toFixed(2)}MB</small></div>
              {prepared.duplicates.length ? (
                <div className={`duplicate-card ${allowDuplicate ? "duplicate-confirmed" : ""}`}>
                  <div><AlertTriangle size={16} /><strong>发现完全相同的素材</strong></div>
                  <p>SHA-256 与“{prepared.duplicates[0].name}”一致。</p>
                  {!allowDuplicate ? <div className="duplicate-actions"><button type="button" onClick={() => void referenceExisting(prepared.duplicates[0].id, Boolean(prepared.duplicates[0].inProject))}>使用已有素材</button><button type="button" onClick={() => { setAllowDuplicate(true); setError(""); }}>仍保留为新素材</button></div> : <span><Check size={13} /> 已确认保留独立记录</span>}
                </div>
              ) : <div className="duplicate-clear"><Check size={14} /> 未发现完全重复素材</div>}
            </div>
            <div className="upload-fields">
              <div className="upload-scroll">
                <label>素材名称<input name="name" maxLength={120} defaultValue={baseName} /></label>
                <label>全局标签<input name="tags" maxLength={4000} placeholder="用逗号分隔，例如：建筑, 暖色, 户外" /></label>
                <label>描述<textarea name="description" rows={2} maxLength={2000} placeholder="描述图片内容或使用方向" /></label>
                <div className="upload-two-fields"><label>来源链接<input name="sourceUrl" type="url" maxLength={1000} placeholder="https://" /></label><label>备注<input name="notes" maxLength={2000} placeholder="团队内部备注" /></label></div>
                <div className="upload-dimensions">
                  <div className="upload-section-heading"><strong>项目维度</strong><span>{dimensions.length} 个</span></div>
                  {dimensions.length ? dimensions.map((dimension) => (
                    <div className="upload-dimension" key={dimension.id}>
                      <span><b>{dimension.leftLabel}</b><em>{displayDimensionValue(values[dimension.id])}</em><b>{dimension.rightLabel}</b></span>
                      <input className="centered-range" aria-label={`设置${dimension.leftLabel}到${dimension.rightLabel}的位置`} aria-valuetext={String(displayDimensionValue(values[dimension.id]))} type="range" min="0" max="1000" step="5" value={values[dimension.id]} style={centeredRangeStyle(values[dimension.id])} onChange={(event) => setValues((current) => ({ ...current, [dimension.id]: Number(event.target.value) }))} />
                    </div>
                  )) : <p className="form-hint">项目还没有维度，可上传后再添加。</p>}
                </div>
              </div>
              <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={busy}><Upload size={15} />{busy ? "上传中…" : "确认上传"}</button></div>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
