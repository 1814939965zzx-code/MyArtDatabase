"use client";

import { Check, ExternalLink, LoaderCircle, Pencil, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

const MAX_TAGS = 50;

export type EditableAssetMetadata = {
  id: string;
  name: string;
  tags: string[];
  description: string;
  notes: string;
  sourceUrl: string;
};

export type AssetMetadataUpdate = Omit<EditableAssetMetadata, "id">;

export type AssetMetadataEditorHandle = {
  save: () => Promise<boolean>;
};

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const AssetMetadataEditor = forwardRef<AssetMetadataEditorHandle, {
  asset: EditableAssetMetadata;
  busy: boolean;
  availableTags?: string[];
  aiTagBusy?: boolean;
  onAiTag?: () => void;
  onSave: (update: AssetMetadataUpdate) => Promise<void>;
}>(function AssetMetadataEditor({
  asset,
  busy,
  availableTags = [],
  aiTagBusy = false,
  onAiTag,
  onSave,
}, ref) {
  const formRef = useRef<HTMLFormElement>(null);
  const composingRef = useRef(false);
  const [name, setName] = useState(asset.name);
  const [tags, setTags] = useState(asset.tags);
  const [tagQuery, setTagQuery] = useState("");
  const [description, setDescription] = useState(asset.description);
  const [notes, setNotes] = useState(asset.notes);
  const [sourceUrl, setSourceUrl] = useState(asset.sourceUrl);
  const [editingSourceUrl, setEditingSourceUrl] = useState(false);
  const [pendingDeleteTags, setPendingDeleteTags] = useState<string[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  useEffect(() => {
    setName(asset.name);
    setTags(asset.tags);
    setTagQuery("");
    setDescription(asset.description);
    setNotes(asset.notes);
    setSourceUrl(asset.sourceUrl);
    setEditingSourceUrl(false);
    setPendingDeleteTags([]);
  }, [asset.id, asset.name, asset.tags, asset.description, asset.notes, asset.sourceUrl]);

  function metadataUpdate(): AssetMetadataUpdate {
    const normalizedTags = [...new Set([...tags, tagQuery]
      .map((tag) => tag.trim())
      .filter(Boolean)
      .filter((tag) => !pendingDeleteTags.includes(tag)))]
      .slice(0, MAX_TAGS);
    return {
      name: name.trim(),
      tags: normalizedTags,
      description: description.trim(),
      notes: notes.trim(),
      sourceUrl: sourceUrl.trim(),
    };
  }

  function hasChanges(update: AssetMetadataUpdate) {
    const originalTags = [...new Set(asset.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, MAX_TAGS);
    return update.name !== asset.name
      || update.description !== asset.description
      || update.notes !== asset.notes
      || update.sourceUrl !== asset.sourceUrl
      || update.tags.join("\u0000") !== originalTags.join("\u0000");
  }

  async function save() {
    if (!formRef.current?.reportValidity()) return false;
    const update = metadataUpdate();
    if (!hasChanges(update) && !pendingDeleteTags.length) return true;
    try {
      await onSave(update);
      return true;
    } catch {
      return false;
    }
  }

  useImperativeHandle(ref, () => ({ save }));

  async function applySourceUrl() {
    const normalized = sourceUrl.trim();
    if (normalized && !safeExternalUrl(normalized)) {
      formRef.current?.querySelector<HTMLInputElement>(".source-link-input")?.setCustomValidity("请输入以 http:// 或 https:// 开头的网页链接");
      formRef.current?.reportValidity();
      return;
    }
    const saved = await save();
    if (saved) setEditingSourceUrl(false);
  }

  function removeTag(tag: string) {
    if (!tag || !tags.includes(tag)) return;
    setPendingDeleteTags((current) => current.includes(tag) ? current : [...current, tag]);
  }

  function undoTagDeletion(tag: string) {
    setPendingDeleteTags((current) => current.filter((item) => item !== tag));
  }

  function addTag(candidate = tagQuery) {
    const tag = candidate.trim();
    if (!tag) return;
    if (pendingDeleteTags.includes(tag)) {
      undoTagDeletion(tag);
      setTagQuery("");
      setHighlightIndex(-1);
      return;
    }
    if (tags.includes(tag) || tags.length >= MAX_TAGS) return;
    setTags((current) => [...current, tag]);
    setTagQuery("");
    setHighlightIndex(-1);
  }

  const suggestions = useMemo(() => {
    const query = tagQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query) return [];
    const subsequenceScore = (candidate: string) => {
      let queryIndex = 0;
      for (const character of candidate) {
        if (character === query[queryIndex]) queryIndex += 1;
      }
      return queryIndex === query.length ? 3 : 0;
    };
    return [...new Set(availableTags)]
      .filter((tag) => !tags.includes(tag))
      .map((tag) => {
        const normalized = tag.toLocaleLowerCase("zh-CN");
        const score = normalized === query ? 100
          : normalized.startsWith(query) ? 80
            : normalized.includes(query) ? 60
              : query.includes(normalized) ? 40
                : subsequenceScore(normalized);
        return { tag, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag, "zh-CN"))
      .slice(0, 6);
  }, [availableTags, tagQuery, tags]);

  return (
    <form ref={formRef} className="asset-metadata-form" aria-busy={busy} onSubmit={(event) => event.preventDefault()}>
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
        {tags.length ? <div className="asset-tag-badges">
          {tags.map((tag) => {
            const pendingDelete = pendingDeleteTags.includes(tag);
            return (
              <span className={`asset-tag-badge ${pendingDelete ? "pending-delete" : ""}`} key={tag}>
                <button
                  type="button"
                  aria-label={pendingDelete ? `撤销删除标签 ${tag}` : `删除标签 ${tag}`}
                  onClick={() => pendingDelete ? undoTagDeletion(tag) : removeTag(tag)}
                >
                  {pendingDelete ? <RotateCcw size={11} /> : <X size={11} />}
                </button>
                <span>{tag}</span>
              </span>
            );
          })}
        </div> : null}
        <div className="asset-tag-combobox">
          <div className="asset-tag-input">
            <input
              aria-label="添加全局标签"
              value={tagQuery}
              maxLength={40}
              placeholder={tags.length >= MAX_TAGS ? `最多添加 ${MAX_TAGS} 个标签` : "输入标签，可匹配已有标签"}
              disabled={tags.length >= MAX_TAGS}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onChange={(event) => { setTagQuery(event.target.value); setHighlightIndex(-1); }}
              onKeyDown={(event) => {
                if (composingRef.current || event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown") {
                  if (!suggestions.length) return;
                  event.preventDefault();
                  setHighlightIndex((current) => current < suggestions.length - 1 ? current + 1 : 0);
                  return;
                }
                if (event.key === "ArrowUp") {
                  if (!suggestions.length) return;
                  event.preventDefault();
                  setHighlightIndex((current) => current > 0 ? current - 1 : suggestions.length - 1);
                  return;
                }
                const active = highlightIndex >= 0 ? suggestions[highlightIndex] : undefined;
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(active ? active.tag : tagQuery);
                  return;
                }
                if (event.key === " ") {
                  if (!active) return;
                  event.preventDefault();
                  addTag(active.tag);
                  return;
                }
                if (event.key === ",") {
                  event.preventDefault();
                  addTag(active ? active.tag : (suggestions[0]?.tag ?? tagQuery));
                }
              }}
            />
            <button type="button" aria-label="添加标签" disabled={!tagQuery.trim() || tags.length >= MAX_TAGS} onClick={() => addTag()}>
              <Plus size={13} />
            </button>
            {onAiTag ? (
              <button
                className="ai-tag-button"
                type="button"
                disabled={busy || aiTagBusy}
                onClick={onAiTag}
                title="调用 AI 观察这张图片并自动补充标签"
              >
                {aiTagBusy ? <><LoaderCircle className="spin" size={12} />AI 打标中…</> : <><Sparkles size={12} />AI 打标</>}
              </button>
            ) : null}
          </div>
          {suggestions.length ? <div className="asset-tag-suggestions" role="listbox" aria-label="匹配的已有标签">
            {suggestions.map(({ tag }, index) => (
              <button type="button" role="option" aria-selected={index === highlightIndex} className={index === highlightIndex ? "highlighted" : ""} key={tag} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlightIndex(index)} onClick={() => addTag(tag)}>{tag}</button>
            ))}
          </div> : null}
        </div>
      </fieldset>

      <label>
        描述
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="描述图片内容或使用方向" />
      </label>
      <div className="source-link-field">
        <div className="source-link-heading">
          <strong>来源链接</strong>
          {!editingSourceUrl ? sourceUrl ? (
            <button type="button" onClick={() => setEditingSourceUrl(true)}><Pencil size={12} />编辑</button>
          ) : (
            <button type="button" aria-label="增加来源链接" onClick={() => setEditingSourceUrl(true)}><Plus size={13} />增加</button>
          ) : null}
        </div>
        {editingSourceUrl ? (
          <div className="source-link-editor">
            <input
              className="source-link-input"
              value={sourceUrl}
              onChange={(event) => { event.target.setCustomValidity(""); setSourceUrl(event.target.value); }}
              type="url"
              maxLength={1000}
              placeholder="https://"
              autoFocus
            />
            <button type="button" aria-label="保存来源链接" disabled={busy} onClick={() => void applySourceUrl()}><Check size={14} /></button>
            <button type="button" aria-label="取消编辑来源链接" disabled={busy} onClick={() => { setSourceUrl(asset.sourceUrl); setEditingSourceUrl(false); }}><X size={14} /></button>
          </div>
        ) : sourceUrl && safeExternalUrl(sourceUrl) ? (
          <a className="source-link-display" href={safeExternalUrl(sourceUrl) ?? undefined} target="_blank" rel="noopener noreferrer">
            <span>{sourceUrl}</span><ExternalLink size={13} />
          </a>
        ) : sourceUrl ? (
          <button className="source-link-invalid" type="button" onClick={() => setEditingSourceUrl(true)}>链接格式无效，点击编辑</button>
        ) : (
          <span className="source-link-empty">暂无来源链接</span>
        )}
      </div>
      <label>
        备注
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="团队内部备注" />
      </label>
    </form>
  );
});
