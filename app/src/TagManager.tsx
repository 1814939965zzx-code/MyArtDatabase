"use client";

import { Check, KeyRound, LoaderCircle, Merge, Pencil, Search, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AiConfigModal } from "./AiConfigModal";

export type TagEntry = {
  id: string;
  name: string;
  source: "manual" | "ai";
  usageCount: number;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

export function TagManager({
  onClose,
  onChanged,
  mode = "global",
  projectTags,
}: {
  onClose: () => void;
  /** 标签字典或关联关系变化后回调（父组件刷新素材列表与联想词）。 */
  onChanged: () => void;
  /** global：完整字典管理；project：只展示该项目使用的标签，无合并/清理/AI 配置。 */
  mode?: "global" | "project";
  projectTags?: string[];
}) {
  const isProject = mode === "project";
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<string[]>([]);
  const [mergeKeptId, setMergeKeptId] = useState<string | null>(null);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request<{ tags: TagEntry[] }>("/api/tags");
      const visible = isProject && projectTags
        ? data.tags.filter((tag) => projectTags.includes(tag.name))
        : data.tags;
      setTags(visible);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "标签载入失败");
    } finally {
      setLoading(false);
    }
  }, [isProject, projectTags]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const list = query ? tags.filter((tag) => tag.name.toLowerCase().includes(query)) : tags;
    return [...list].sort((a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name, "zh-CN"));
  }, [tags, keyword]);

  const unusedCount = tags.filter((tag) => tag.usageCount === 0).length;

  function startRename(tag: TagEntry) {
    setEditingId(tag.id);
    setEditingName(tag.name);
    setError("");
  }

  async function submitRename(tag: TagEntry) {
    const name = editingName.trim();
    if (!name) return;
    if (name === tag.name) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request<{ merged?: boolean; tag?: { name: string } }>("/api/tags", {
        method: "PATCH",
        body: JSON.stringify({ id: tag.id, name }),
      });
      setEditingId(null);
      await load();
      onChanged();
      if (result.merged && result.tag) {
        setError(`“${tag.name}”与已有标签同名，已并入“${result.tag.name}”`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重命名失败");
    } finally {
      setBusy(false);
    }
  }

  function enterMergeMode() {
    setError("");
    setEditingId(null);
    setMergeSelected([]);
    setMergeKeptId(null);
    setMergeMode(true);
  }

  function exitMergeMode() {
    setMergeMode(false);
    setMergeSelected([]);
    setMergeKeptId(null);
  }

  /**
   * 合并模式下的列表点击：只负责把标签加入/移出选择；
   * 最终保留的标签由底部标签组件指定。
   */
  function toggleMergeRow(tag: TagEntry) {
    setError("");
    setEditingId(null);
    setMergeSelected((current) => current.includes(tag.id)
      ? current.filter((id) => id !== tag.id)
      : [...current, tag.id]);
    setMergeKeptId((current) => (current === tag.id ? null : current));
  }

  async function confirmMerge() {
    if (!mergeKeptId) return;
    const sources = mergeSelected.filter((id) => id !== mergeKeptId);
    if (!sources.length) return;
    const kept = tags.find((tag) => tag.id === mergeKeptId);
    setBusy(true);
    setError("");
    try {
      for (const sourceId of sources) {
        await request("/api/tags/merge", {
          method: "POST",
          body: JSON.stringify({ sourceId, targetId: mergeKeptId }),
        });
      }
      exitMergeMode();
      await load();
      onChanged();
      setError(kept ? `已把 ${sources.length} 个标签并入“${kept.name}”` : `已合并 ${sources.length} 个标签`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "合并失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tag: TagEntry) {
    const usageNote = tag.usageCount ? `它正被 ${tag.usageCount} 个素材使用，删除后这些素材将不再拥有该标签。` : "它目前没有任何素材使用。";
    if (!window.confirm(`删除标签“${tag.name}”？${usageNote}\n\n此操作会从所有素材移除该标签并移出标签字典，无法撤销。`)) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/tags?id=${encodeURIComponent(tag.id)}`, { method: "DELETE" });
      await load();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function cleanupUnused() {
    if (!window.confirm(`清理未使用标签？将删除 ${unusedCount} 个没有任何素材引用的标签。`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ removed: number }>("/api/tags/cleanup", { method: "POST" });
      await load();
      onChanged();
      setError(`已清理 ${result.removed} 个未使用标签`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "清理失败");
    } finally {
      setBusy(false);
    }
  }

  const keptTag = mergeKeptId ? tags.find((tag) => tag.id === mergeKeptId) ?? null : null;
  const deletedTags = tags.filter((tag) => mergeSelected.includes(tag.id) && tag.id !== mergeKeptId);
  const selectedMergeTags = mergeSelected
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is TagEntry => Boolean(tag));

  return (
    <>
    <div className="modal-backdrop">
      <section className="modal-card tag-manager-card" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">TAG DICTIONARY</p>
            <h2 id="tag-manager-title">标签管理</h2>
            <p>{isProject ? "管理当前项目使用的标签；重命名或删除会同步影响所有项目引用。" : "重命名、合并或删除全局标签；变更会同步影响所有项目引用。"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        {error ? <div className="tag-manager-message"><Sparkles size={15} />{error}</div> : null}
        <div className="tag-manager-toolbar">
          <div className="tag-manager-search">
            <Search size={15} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标签"
              aria-label="搜索标签"
            />
          </div>
          <span className="tag-manager-count">{isProject ? `${tags.length} 个标签` : `${tags.length} 个标签 · ${unusedCount} 个未使用`}</span>
          {!isProject ? (
            <button className="tag-ai-config-button" type="button" onClick={() => setAiConfigOpen(true)}>
              <KeyRound size={13} />AI 服务配置
            </button>
          ) : null}
          {!isProject ? (
            <button className="tag-cleanup-button" type="button" disabled={busy || !unusedCount} onClick={() => void cleanupUnused()}>
              <Trash2 size={13} />清理未使用
            </button>
          ) : null}
        </div>
        {loading ? (
          <div className="tag-manager-loading"><LoaderCircle className="spin" size={18} /> 正在载入标签…</div>
        ) : filtered.length ? (
          <div className="tag-manager-list" role="list">
            {filtered.map((tag) => {
              const selected = mergeSelected.includes(tag.id);
              return (
                <div
                  className={`tag-manager-row ${mergeMode ? "merge-selectable" : ""} ${mergeMode && selected ? "merge-selected" : ""}`}
                  key={tag.id}
                  role={mergeMode ? "button" : "listitem"}
                  tabIndex={mergeMode ? 0 : undefined}
                  aria-pressed={mergeMode ? selected : undefined}
                  onClick={() => { if (mergeMode && !busy && editingId !== tag.id) toggleMergeRow(tag); }}
                  onKeyDown={(event) => {
                    if (!mergeMode || busy || editingId !== tag.id) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleMergeRow(tag);
                    }
                  }}
                >
                  <div className="tag-manager-main">
                    {editingId === tag.id ? (
                      <input
                        className="tag-rename-input"
                        value={editingName}
                        maxLength={40}
                        autoFocus
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") { event.preventDefault(); void submitRename(tag); }
                          if (event.key === "Escape") setEditingId(null);
                        }}
                        aria-label={`重命名标签 ${tag.name}`}
                      />
                    ) : (
                      <button
                        className="tag-manager-name"
                        type="button"
                        disabled={busy}
                        tabIndex={mergeMode ? -1 : undefined}
                        onClick={mergeMode ? undefined : () => startRename(tag)}
                        title={mergeMode ? "点击选择或取消选择要合并的标签" : "点击重命名"}
                      >
                        {tag.name}
                      </button>
                    )}
                    <span className="tag-usage-badge">{tag.usageCount} 次</span>
                    <span className={`tag-source-badge ${tag.source === "ai" ? "ai" : ""}`}>{tag.source === "ai" ? "AI" : "人工"}</span>
                  </div>
                  {editingId === tag.id ? (
                    <div className="tag-manager-actions">
                      <button type="button" disabled={busy || !editingName.trim()} onClick={() => void submitRename(tag)} aria-label="保存重命名"><Check size={14} /></button>
                      <button type="button" disabled={busy} onClick={() => setEditingId(null)} aria-label="取消重命名"><X size={14} /></button>
                    </div>
                  ) : mergeMode ? null : (
                    <div className="tag-manager-actions">
                      <button type="button" disabled={busy} onClick={() => startRename(tag)} aria-label={`重命名 ${tag.name}`}><Pencil size={13} /></button>
                      {!isProject ? (
                        <button type="button" disabled={busy} onClick={enterMergeMode} aria-label={`选择 ${tag.name} 参与合并`}><Merge size={13} /></button>
                      ) : null}
                      <button className="tag-delete-button" type="button" disabled={busy} onClick={() => void removeTag(tag)} aria-label={`删除 ${tag.name}`}><Trash2 size={13} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tag-manager-loading">{keyword ? "没有匹配的标签" : isProject ? "该项目还没有标签" : "标签字典还是空的"}</div>
        )}
        {mergeMode ? (
          <div className="tag-merge-bar">
            <div className="tag-merge-summary">
              <span>最终保留的标签：<strong>{keptTag ? keptTag.name : ""}</strong></span>
              <span>删除的标签：<em>{deletedTags.length ? deletedTags.map((tag) => tag.name).join("、") : ""}</em></span>
            </div>
            <div className="tag-merge-chips" role="listbox" aria-label="选择最终保留的标签">
              {selectedMergeTags.map((tag) => (
                <button type="button" role="option" aria-selected={tag.id === mergeKeptId} className={tag.id === mergeKeptId ? "active" : ""} key={tag.id} onClick={() => setMergeKeptId(tag.id)}>
                  {tag.name}
                </button>
              ))}
              {!selectedMergeTags.length ? <span>尚未选择标签，请在上方列表中点击选择</span> : null}
            </div>
            <div className="tag-merge-bar-actions">
              <button className="secondary-button" type="button" disabled={busy} onClick={exitMergeMode}>取消</button>
              <button className="primary-button" type="button" disabled={busy || !keptTag || !deletedTags.length} onClick={() => void confirmMerge()}>{busy ? "合并中…" : "确认合并"}</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
      {aiConfigOpen ? <AiConfigModal onClose={() => setAiConfigOpen(false)} /> : null}
    </>
  );
}
