"use client";

import { Check, ExternalLink, Pencil, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button, Field, IconButton, Input, Textarea, cn } from "./ui";

const MAX_TAGS = 50;

export type EditableAssetMetadata = {
  id: string;
  name: string;
  tags: string[];
  description: string;
  notes: string;
  sourceUrl: string;
  mimeType?: string;
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
  /** 游客只读：所有输入禁用，隐藏标签增删、AI 打标与来源链接编辑。 */
  readOnly?: boolean;
}>(function AssetMetadataEditor({
  asset,
  busy,
  availableTags = [],
  aiTagBusy = false,
  onAiTag,
  onSave,
  readOnly = false,
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
    if (readOnly) return true;
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
    <form
      ref={formRef}
      aria-busy={busy}
      onSubmit={(event) => event.preventDefault()}
      className="flex flex-col gap-3 border-b border-line-soft pb-4 pt-4"
    >
      <Field label="素材名称" required htmlFor="asset-name">
        <Input id="asset-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required readOnly={readOnly} />
      </Field>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-medium text-ink-label">全局标签</legend>

        {tags.length ? (
          <div className="flex flex-wrap items-start gap-1.5">
            {tags.map((tag) => {
              const pendingDelete = pendingDeleteTags.includes(tag);
              return (
                <span
                  key={tag}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
                    pendingDelete ? "border-danger-border bg-danger-soft text-danger line-through" : "border-line bg-surface-muted text-muted",
                  )}
                >
                  <button
                    type="button"
                    aria-label={pendingDelete ? `撤销删除标签 ${tag}` : `删除标签 ${tag}`}
                    onClick={() => pendingDelete ? undoTagDeletion(tag) : removeTag(tag)}
                    className={cn("grid size-4 place-items-center rounded-full transition-colors hover:bg-white/70", readOnly && "hidden")}
                  >
                    {pendingDelete ? <RotateCcw size={11} aria-hidden /> : <X size={11} aria-hidden />}
                  </button>
                  <span>{tag}</span>
                </span>
              );
            })}
          </div>
        ) : null}

        <div className={cn("relative flex flex-col gap-1", readOnly && "hidden")}>
          <div className="flex items-center gap-1.5">
            <Input
              aria-label="添加全局标签"
              className="min-w-0 flex-1"
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
            <IconButton label="添加标签" size="sm" disabled={!tagQuery.trim() || tags.length >= MAX_TAGS} onClick={() => addTag()}>
              <Plus size={13} aria-hidden />
            </IconButton>
            {onAiTag && !(asset.mimeType ?? "").startsWith("video/") ? (
              <Button
                size="sm"
                variant="secondary"
                className="flex-none border-accent-border bg-accent-soft text-accent-strong"
                disabled={busy || aiTagBusy}
                loading={aiTagBusy}
                icon={<Sparkles size={12} aria-hidden />}
                onClick={onAiTag}
                title="调用 AI 观察这张图片并自动补充标签"
              >
                {aiTagBusy ? "AI 打标中…" : "AI 打标"}
              </Button>
            ) : null}
          </div>

          {suggestions.length ? (
            <div
              role="listbox"
              aria-label="匹配的已有标签"
              className="absolute left-0 right-0 top-[calc(100%+4px)] z-popover flex flex-col rounded-sm border border-line bg-white p-1 shadow-md"
            >
              {suggestions.map(({ tag }, index) => (
                <button
                  key={tag}
                  type="button"
                  role="option"
                  aria-selected={index === highlightIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => addTag(tag)}
                  className={cn(
                    "rounded-sm px-2 py-1.5 text-left text-sm",
                    index === highlightIndex ? "bg-surface-muted text-ink" : "text-muted hover:bg-surface-muted",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </fieldset>

      <Field label="描述" htmlFor="asset-description">
        <Textarea id="asset-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} placeholder="描述图片内容或使用方向" readOnly={readOnly} />
      </Field>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm font-medium text-ink-label">来源链接</strong>
          {!readOnly && !editingSourceUrl ? (
            sourceUrl ? (
              <Button size="xs" variant="ghost" icon={<Pencil size={12} aria-hidden />} onClick={() => setEditingSourceUrl(true)}>
                编辑
              </Button>
            ) : (
              <Button size="xs" variant="ghost" icon={<Plus size={13} aria-hidden />} onClick={() => setEditingSourceUrl(true)}>
                增加
              </Button>
            )
          ) : null}
        </div>

        {editingSourceUrl ? (
          <div className="flex items-center gap-1.5">
            <Input
              className="source-link-input min-w-0 flex-1"
              value={sourceUrl}
              onChange={(event) => { event.target.setCustomValidity(""); setSourceUrl(event.target.value); }}
              type="url"
              maxLength={1000}
              placeholder="https://"
              autoFocus
            />
            <IconButton label="保存来源链接" size="sm" disabled={busy} onClick={() => void applySourceUrl()}>
              <Check size={14} aria-hidden />
            </IconButton>
            <IconButton label="取消编辑来源链接" size="sm" disabled={busy} onClick={() => { setSourceUrl(asset.sourceUrl); setEditingSourceUrl(false); }}>
              <X size={14} aria-hidden />
            </IconButton>
          </div>
        ) : sourceUrl && safeExternalUrl(sourceUrl) ? (
          <a
            className="flex min-w-0 items-center gap-1.5 text-sm text-sage-deep hover:underline"
            href={safeExternalUrl(sourceUrl) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="truncate">{sourceUrl}</span>
            <ExternalLink size={13} aria-hidden className="flex-none" />
          </a>
        ) : sourceUrl ? (
          readOnly
            ? <span className="break-all text-sm text-danger">{sourceUrl}</span>
            : <button className="text-left text-sm text-danger" type="button" onClick={() => setEditingSourceUrl(true)}>
                链接格式无效，点击编辑
              </button>
        ) : (
          <span className="text-sm text-muted">暂无来源链接</span>
        )}
      </div>

      <Field label="备注" htmlFor="asset-notes">
        <Textarea id="asset-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="团队内部备注" readOnly={readOnly} />
      </Field>
    </form>
  );
});
