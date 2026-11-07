"use client";

import { Check, KeyRound, Merge, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiConfigModal } from "./AiConfigModal";
import { DeletionToast } from "./DeletionToast";
import { Badge, Button, EmptyState, IconButton, InlineMessage, Input, Modal, SearchInput, Spinner, Tag, cn } from "./ui";

export type TagEntry = {
  id: string;
  name: string;
  source: "manual" | "ai";
  usageCount: number;
};

type MergeAsset = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  tags: string[];
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
  isAdmin = true,
}: {
  onClose: () => void;
  /** 标签字典或关联关系变化后回调（父组件刷新素材列表与联想词）。 */
  onChanged: () => void;
  /** global：完整字典管理；project：只展示该项目使用的标签，无合并/清理/AI 配置。 */
  mode?: "global" | "project";
  projectTags?: string[];
  /** 当前用户是否为管理员；非管理员隐藏 AI 服务配置入口（服务端同时校验权限）。 */
  isAdmin?: boolean;
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
  const [mergeAssets, setMergeAssets] = useState<MergeAsset[] | null>(null);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<{
    token: string; tag: TagEntry; index: number; seconds: number;
  } | null>(null);
  const deleteTimer = useRef<number | null>(null);
  const pendingTagId = useRef<string | null>(null);
  const pendingDeletionRef = useRef(pendingDeletion);
  pendingDeletionRef.current = pendingDeletion;

  const load = useCallback(async () => {
    try {
      const data = await request<{ tags: TagEntry[] }>("/api/tags");
      const visible = isProject && projectTags
        ? data.tags.filter((tag) => projectTags.includes(tag.name))
        : data.tags;
      setTags(pendingTagId.current ? visible.filter((tag) => tag.id !== pendingTagId.current) : visible);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "标签载入失败");
    } finally {
      setLoading(false);
    }
  }, [isProject, projectTags]);

  useEffect(() => {
    void load();
  }, [load]);

  // 删除标签的 5 秒撤销窗口倒计时
  useEffect(() => {
    if (!pendingDeletion) return;
    const token = pendingDeletion.token;
    const interval = window.setInterval(() => {
      setPendingDeletion((current) => current?.token === token
        ? { ...current, seconds: Math.max(1, current.seconds - 1) }
        : current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [pendingDeletion?.token]);

  // 关闭标签管理时仍要兑现删除
  useEffect(() => () => {
    if (deleteTimer.current === null) return;
    window.clearTimeout(deleteTimer.current);
    deleteTimer.current = null;
    const pending = pendingDeletionRef.current;
    if (!pending) return;
    void request(`/api/tags?id=${encodeURIComponent(pending.tag.id)}`, { method: "DELETE" }).then(onChanged).catch(() => undefined);
  }, []);

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

  async function loadMergeAssets() {
    try {
      const data = await request<{ assets: MergeAsset[] }>("/api/library");
      setMergeAssets(data.assets);
    } catch {
      setMergeAssets([]);
    }
  }

  function enterMergeMode(tag: TagEntry) {
    setError("");
    setEditingId(null);
    setMergeSelected([tag.id]); // 触发合并的那个标签默认进入备选，一次点击即可
    setMergeKeptId(null);
    setMergeMode(true);
    void loadMergeAssets();
  }

  function exitMergeMode() {
    setMergeMode(false);
    setMergeSelected([]);
    setMergeKeptId(null);
    setMergeAssets(null);
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

  /** 删除标签：立即从列表隐藏，5 秒撤销窗口结束后才提交服务端删除。 */
  function removeTag(tag: TagEntry) {
    if (busy || pendingDeletion) return;
    const index = tags.findIndex((entry) => entry.id === tag.id);
    setTags((current) => current.filter((entry) => entry.id !== tag.id));
    setError("");
    pendingTagId.current = tag.id;
    const pending = {
      token: `tag:${tag.id}:${Date.now()}`,
      tag,
      index: index >= 0 ? index : 0,
      seconds: 5,
    };
    setPendingDeletion(pending);
    deleteTimer.current = window.setTimeout(() => {
      deleteTimer.current = null;
      setPendingDeletion(null);
      void commitTagDeletion(pending);
    }, 5000);
  }

  async function commitTagDeletion(pending: NonNullable<typeof pendingDeletion>) {
    setBusy(true);
    try {
      await request(`/api/tags?id=${encodeURIComponent(pending.tag.id)}`, { method: "DELETE" });
      pendingTagId.current = null;
      await load();
      onChanged();
    } catch (reason) {
      pendingTagId.current = null;
      setTags((current) => {
        if (current.some((tag) => tag.id === pending.tag.id)) return current;
        const next = [...current];
        next.splice(Math.min(pending.index, next.length), 0, pending.tag);
        return next;
      });
      setError(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setBusy(false);
      setPendingDeletion((current) => current?.token === pending.token ? null : current);
    }
  }

  function undoTagDeletion() {
    const pending = pendingDeletion;
    if (!pending) return;
    if (deleteTimer.current !== null) {
      window.clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
    pendingTagId.current = null;
    setTags((current) => {
      if (current.some((tag) => tag.id === pending.tag.id)) return current;
      const next = [...current];
      next.splice(Math.min(pending.index, next.length), 0, pending.tag);
      return next;
    });
    setPendingDeletion(null);
    setError("");
  }

  async function cleanupUnused() {
    if (busy || pendingDeletion) return;
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
  const selectedTagNames = new Set(selectedMergeTags.map((tag) => tag.name));
  const mergePreviewAssets = (mergeAssets ?? [])
    .filter((asset) => asset.tags.some((tag) => selectedTagNames.has(tag)));
  const messageTone = /失败|无法|错误/.test(error) ? "error" : "success";

  return (
    <>
      <Modal
        open
        onClose={onClose}
        eyebrow="TAG DICTIONARY"
        title="标签管理"
        description={isProject ? "管理当前项目使用的标签；重命名或删除会同步影响所有项目引用。" : "重命名、合并或删除全局标签；变更会同步影响所有项目引用。"}
        size="md"
        className="flex max-h-[calc(100dvh-40px)] max-w-[680px] flex-col"
        bodyClassName="min-h-0 flex-1 gap-3 overflow-y-auto pr-1"
        closeOnEsc={!aiConfigOpen}
      >
        {error ? <InlineMessage tone={messageTone}>{error}</InlineMessage> : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <SearchInput
            value={keyword}
            onValueChange={setKeyword}
            placeholder="搜索标签"
            aria-label="搜索标签"
            className="w-[240px] max-sm:w-full"
          />
          <span className="text-sm text-muted">
            {isProject ? `${tags.length} 个标签` : `${tags.length} 个标签 · ${unusedCount} 个未使用`}
          </span>
          {!isProject && isAdmin ? (
            <Button variant="ghost" size="sm" icon={<KeyRound size={13} aria-hidden />} onClick={() => setAiConfigOpen(true)}>
              AI 服务配置
            </Button>
          ) : null}
          {!isProject ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} aria-hidden />}
              disabled={busy || !unusedCount || Boolean(pendingDeletion)}
              onClick={() => void cleanupUnused()}
            >
              清理未使用
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-10 text-md text-muted">
            <Spinner size={18} />
            正在载入标签…
          </div>
        ) : (
          <div className={cn("flex min-h-0 flex-1 gap-3", mergeMode && "flex-col lg:flex-row")}>
            <div className={cn("min-w-0", mergeMode ? "lg:w-1/3" : "flex-1")}>
              {filtered.length ? (
                <div role="list" className="flex flex-col">
                  {filtered.map((tag) => {
                    const selected = mergeSelected.includes(tag.id);
                    return (
                      <div
                        className={cn(
                          "flex min-h-[42px] items-center justify-between gap-2.5 border-b border-l-2 border-line-soft border-l-transparent px-3 py-1.5",
                          mergeMode && "cursor-pointer hover:bg-surface-muted",
                          mergeMode && selected && "border-l-warning bg-warning-soft",
                        )}
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
                        <div className="flex min-w-0 items-center gap-2">
                          {editingId === tag.id ? (
                            <Input
                              size="sm"
                              className="h-8 max-w-[220px]"
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
                              type="button"
                              disabled={busy}
                              tabIndex={mergeMode ? -1 : undefined}
                              onClick={mergeMode ? undefined : () => startRename(tag)}
                              title={mergeMode ? "点击选择或取消选择要合并的标签" : "点击重命名"}
                              className="max-w-[300px] truncate rounded-sm px-1 py-0.5 text-base font-medium text-ink transition-colors hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
                            >
                              {tag.name}
                            </button>
                          )}
                          <Badge tone="neutral" size="sm">{tag.usageCount} 次</Badge>
                          <Badge tone={tag.source === "ai" ? "sage" : "neutral"} size="sm">{tag.source === "ai" ? "AI" : "人工"}</Badge>
                        </div>

                        {editingId === tag.id ? (
                          <div className="flex flex-none gap-1">
                            <IconButton size="sm" label="保存重命名" disabled={busy || !editingName.trim()} onClick={() => void submitRename(tag)}>
                              <Check size={14} aria-hidden />
                            </IconButton>
                            <IconButton size="sm" label="取消重命名" disabled={busy} onClick={() => setEditingId(null)}>
                              <X size={14} aria-hidden />
                            </IconButton>
                          </div>
                        ) : mergeMode ? null : (
                          <div className="flex flex-none gap-1">
                            <IconButton size="sm" label={`重命名 ${tag.name}`} disabled={busy} onClick={() => startRename(tag)}>
                              <Pencil size={13} aria-hidden />
                            </IconButton>
                            {!isProject ? (
                              <IconButton size="sm" label={`选择 ${tag.name} 参与合并`} disabled={busy} onClick={() => enterMergeMode(tag)}>
                                <Merge size={13} aria-hidden />
                              </IconButton>
                            ) : null}
                            <IconButton size="sm" variant="danger" label={`删除 ${tag.name}`} disabled={busy || Boolean(pendingDeletion)} onClick={() => void removeTag(tag)}>
                              <Trash2 size={13} aria-hidden />
                            </IconButton>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  compact
                  title={keyword ? "没有匹配的标签" : isProject ? "该项目还没有标签" : "标签字典还是空的"}
                />
              )}
            </div>

            {mergeMode ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 rounded-sm border border-line-soft bg-white p-2.5">
                <div className="text-sm font-semibold text-ink">包含所选标签的素材 · {mergePreviewAssets.length}</div>
                {mergePreviewAssets.length ? (
                  <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pr-0.5">
                    {mergePreviewAssets.map((asset) => {
                      const shownTags = asset.tags.filter((tag) => selectedTagNames.has(tag));
                      return (
                        <figure className="m-0 flex min-w-0 flex-col overflow-hidden border border-line-soft bg-surface" key={asset.id}>
                          {asset.thumbnailUrl ? (
                            <img src={asset.thumbnailUrl} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
                          ) : (
                            <span className="grid aspect-[4/3] w-full place-items-center bg-surface-sunken text-xs text-faint">无图</span>
                          )}
                          <figcaption className="flex min-w-0 flex-col gap-0.5 p-2">
                            <strong className="truncate text-sm text-ink">{asset.name}</strong>
                            <span className="truncate text-xs text-muted">{shownTags.join("、")}</span>
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    title={mergeSelected.length ? "没有素材包含所选标签" : "在上方列表选择标签后，这里展示包含所选标签的素材"}
                  />
                )}
              </div>
            ) : null}
          </div>
        )}

        {mergeMode ? (
          <div className="mt-3 flex flex-col gap-2.5 rounded-md border border-warning-border bg-warning-soft p-3">
            <div className="flex flex-col gap-1 text-sm text-ink">
              <span>
                最终保留的标签：
                {keptTag ? <strong>{keptTag.name}</strong> : <em className="text-muted">点击下方标签选择一个最终保留的标签</em>}
              </span>
              <span>删除的标签：<em>{deletedTags.length ? deletedTags.map((tag) => tag.name).join("、") : ""}</em></span>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="listbox" aria-label="选择最终保留的标签">
              {selectedMergeTags.map((tag) => (
                <Tag
                  key={tag.id}
                  role="option"
                  aria-selected={tag.id === mergeKeptId}
                  active={tag.id === mergeKeptId}
                  onClick={() => setMergeKeptId(tag.id)}
                >
                  {tag.name}
                </Tag>
              ))}
              {!selectedMergeTags.length ? <span className="text-sm text-muted">尚未选择标签，请在上方列表中点击选择</span> : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button disabled={busy} onClick={exitMergeMode}>取消</Button>
              <Button
                variant="primary"
                disabled={busy || !keptTag || !deletedTags.length}
                loading={busy}
                onClick={() => void confirmMerge()}
              >
                {busy ? "合并中…" : "确认合并"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      {aiConfigOpen ? <AiConfigModal onClose={() => setAiConfigOpen(false)} /> : null}
      {pendingDeletion ? (
        <DeletionToast
          label={`标签“${pendingDeletion.tag.name}”`}
          seconds={pendingDeletion.seconds}
          onUndo={undoTagDeletion}
        />
      ) : null}
    </>
  );
}
