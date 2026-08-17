"use client";

import { Plus, Save, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

export type EditableAssetMetadata = {
  id: string;
  name: string;
  tags: string[];
  description: string;
  notes: string;
  sourceUrl: string;
};

export type AssetMetadataUpdate = Omit<EditableAssetMetadata, "id">;

export function AssetMetadataEditor({
  asset,
  busy,
  pendingDeleteTag,
  onSave,
  onDeleteTag,
}: {
  asset: EditableAssetMetadata;
  busy: boolean;
  pendingDeleteTag?: string | null;
  onSave: (update: AssetMetadataUpdate) => Promise<void>;
  onDeleteTag?: (tag: string) => void;
}) {
  const [name, setName] = useState(asset.name);
  const [tags, setTags] = useState(asset.tags.length ? asset.tags : [""]);
  const [description, setDescription] = useState(asset.description);
  const [notes, setNotes] = useState(asset.notes);
  const [sourceUrl, setSourceUrl] = useState(asset.sourceUrl);

  useEffect(() => {
    setName(asset.name);
    setTags(asset.tags.length ? asset.tags : [""]);
    setDescription(asset.description);
    setNotes(asset.notes);
    setSourceUrl(asset.sourceUrl);
  }, [asset.id, asset.name, asset.tags, asset.description, asset.notes, asset.sourceUrl]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
    await onSave({
      name: name.trim(),
      tags: normalizedTags,
      description: description.trim(),
      notes: notes.trim(),
      sourceUrl: sourceUrl.trim(),
    });
  }

  function removeTag(index: number) {
    const tag = tags[index].trim();
    if (tag && asset.tags.includes(tag) && onDeleteTag) {
      onDeleteTag(tag);
      return;
    }
    setTags((current) => current.length === 1 ? [""] : current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <form className="asset-metadata-form" onSubmit={(event) => void submit(event)}>
      <label>
        素材名称
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          required
        />
      </label>

      <fieldset className="asset-tag-editor">
        <legend>全局标签</legend>
        <div className="asset-tag-inputs">
          {tags.map((tag, index) => (
            <div className={`asset-tag-input ${pendingDeleteTag === tag.trim() ? "pending-delete" : ""}`} key={`${index}-${tags.length}`}>
              <input
                aria-label={`全局标签 ${index + 1}`}
                value={tag}
                maxLength={40}
                placeholder={index === 0 ? "输入标签" : "新标签"}
                onChange={(event) => setTags((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
              />
              <button
                type="button"
                aria-label={`删除标签 ${tag || index + 1}`}
                disabled={Boolean(pendingDeleteTag)}
                onClick={() => removeTag(index)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <button className="asset-tag-add" type="button" disabled={tags.length >= 20} onClick={() => setTags((current) => [...current, ""])}>
          <Plus size={13} />添加标签
        </button>
      </fieldset>

      <label>
        描述
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="描述图片内容或使用方向" />
      </label>
      <label>
        来源链接
        <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} type="url" maxLength={1000} placeholder="https://" />
      </label>
      <label>
        备注
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="团队内部备注" />
      </label>

      <button className="asset-save-button" type="submit" disabled={busy || !name.trim()}>
        <Save size={14} />{busy ? "保存中…" : "保存素材信息"}
      </button>
    </form>
  );
}
