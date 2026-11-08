import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "./api";
import { DeletionToast } from "./DeletionToast";
import { DimensionPreview } from "./DimensionPreview";
import { TagFilterBar } from "./TagFilterBar";
import { Button, EmptyState, Field, IconButton, Input, Modal, SearchInput, Spinner, Tabs, cn } from "./ui";

export type PageDimension = { id: string; projectId: string; pageId: string; leftLabel: string; rightLabel: string; description: string; sortOrder: number };
export type PreviewPage = {
  id: string; projectId: string; name: string; selectedIds: string[];
  dimensions: PageDimension[];
  assets: { assetId: string; dimensionValues: Record<string, number>; valueRevs?: Record<string, number> }[];
  revision?: number;
};
type Asset = { id: string; name: string; fileName: string; tags: string[]; thumbnailUrl: string | null; mimeType?: string; width: number; height: number };
type Summary = { id: string; name: string; assetCount: number };

export function DimensionPages({ projectId, assets, page, onPageChange, onReceivePage, revision, syncStatus, onRetrySync, onSelectAsset, onUpdateAssetDimensions, onAddDimension, onEditDimension, onMessage, readOnly = false, aiTag, lockedAssetIds = [], onOpenAiBatch }: {
  projectId: string; assets: Asset[]; page: PreviewPage | null; onPageChange: (page: PreviewPage | null) => void; revision: number;
  onReceivePage: (page: PreviewPage) => void;
  syncStatus: "synced" | "saving" | "offline";
  onRetrySync: () => void;
  onSelectAsset: (id: string, navigation?: string[] | null) => void;
  onUpdateAssetDimensions: (id: string, values: Record<string, number>) => Promise<boolean>;
  onAddDimension: () => void; onEditDimension: (dimension: PageDimension) => void; onMessage: (message: string) => void;
  /** 游客只读：隐藏 Page/素材/维度的增删改，坐标轴切换仅保留本地视图状态。 */
  readOnly?: boolean;
  aiTag?: {
    status: "running" | "stopping";
    done: number;
    total: number;
    timedOut: number;
    canStop: boolean;
    stop: () => void;
  };
  lockedAssetIds?: string[];
  onOpenAiBatch?: () => void;
}) {
  const [pages, setPages] = useState<Summary[]>([]);
  const [pageId, setPageId] = useState(() => {
    try { return localStorage.getItem(`artdatabase:preview-page:${projectId}`) || ""; } catch { return ""; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<"create" | "rename" | null>(null);
  const [editTargetId, setEditTargetId] = useState("");
  const [name, setName] = useState("");
  const [pendingPageDeletion, setPendingPageDeletion] = useState<{
    token: string; page: Summary; index: number; seconds: number;
  } | null>(null);
  const pageDeleteTimer = useRef<number | null>(null);
  const pendingPageIds = useRef(new Set<string>());
  const pendingPageDeletionRef = useRef(pendingPageDeletion);
  pendingPageDeletionRef.current = pendingPageDeletion;
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const changeRef = useRef(onPageChange);
  changeRef.current = onPageChange;
  const receiveRef = useRef(onReceivePage);
  receiveRef.current = onReceivePage;
  const statusRef = useRef(syncStatus);
  statusRef.current = syncStatus;
  const pageRef = useRef(page);
  pageRef.current = page;
  const axesQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      const data = await apiFetch<{ pages: Summary[] }>(`/api/preview-pages?projectId=${encodeURIComponent(projectId)}`);
      if (!active) return;
      const visiblePages = data.pages.filter((p) => !pendingPageIds.current.has(p.id));
      setPages(visiblePages);
      const id = visiblePages.some((p) => p.id === pageId) ? pageId : visiblePages[0]?.id || "";
      if (id !== pageId) { setPageId(id); return; }
      if (!id) { changeRef.current(null); setLoading(false); return; }
      const result = await apiFetch<{ page: PreviewPage }>(`/api/preview-page?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(id)}`);
      if (active) {
        // 交给 App 合并：未同步的坐标不会被这次拉取覆盖。
        receiveRef.current(result.page);
        setLoading(false);
        try { localStorage.setItem(`artdatabase:preview-page:${projectId}`, id); } catch { /* optional preference */ }
      }
    })().catch((reason) => { if (active) { setError(reason instanceof Error ? reason.message : "Page 载入失败"); setLoading(false); } });
    return () => { active = false; };
  }, [projectId, pageId, revision, reload]);

  // 拉取时机：切回标签 / 窗口聚焦时拉一次，停留期间 30 秒兜底；有未同步坐标时跳过。
  useEffect(() => {
    if (!pageId) return;
    const refresh = async () => {
      if (statusRef.current !== "synced") return;
      if (document.visibilityState !== "visible") return;
      try {
        const result = await apiFetch<{ page: PreviewPage }>(`/api/preview-page?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(pageId)}`);
        receiveRef.current(result.page);
      } catch { /* 兜底刷新失败不打断编辑 */ }
    };
    const timer = window.setInterval(() => { void refresh(); }, 30000);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const onFocus = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [projectId, pageId]);

  const current = page?.projectId === projectId && page.id === pageId ? page : null;
  // 删除 Page 的 5 秒撤销窗口：只做界面倒计时，服务端删除在倒计时结束后提交。
  useEffect(() => {
    if (!pendingPageDeletion) return;
    const token = pendingPageDeletion.token;
    const interval = window.setInterval(() => {
      setPendingPageDeletion((current) => current?.token === token
        ? { ...current, seconds: Math.max(1, current.seconds - 1) }
        : current);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [pendingPageDeletion?.token]);

  // 组件卸载（切项目/关页面）时仍要兑现删除，不能让撤销窗口把删除吞掉
  useEffect(() => () => {
    if (pageDeleteTimer.current === null) return;
    window.clearTimeout(pageDeleteTimer.current);
    pageDeleteTimer.current = null;
    const pending = pendingPageDeletionRef.current;
    if (!pending) return;
    void apiFetch(`/api/preview-pages?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(pending.page.id)}`, { method: "DELETE" });
  }, [projectId]);
  const pageAssets = useMemo(() => {
    const map = new Map((current?.assets ?? []).map((a) => [a.assetId, a.dimensionValues]));
    return assets.filter((a) => map.has(a.id)).map((a) => ({ ...a, dimensionValues: map.get(a.id)! }));
  }, [assets, current]);
  const existingIds = useMemo(() => new Set(current?.assets.map((a) => a.assetId)), [current]);
  const allTags = useMemo(() => [...new Set(assets.flatMap((a) => a.tags))], [assets]);
  const filtered = assets.filter((a) => (!search.trim() || [a.name, a.fileName, ...a.tags].some((s) => s.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))) && (!tags.length || a.tags.some((t) => tags.includes(t))));

  function switchPage(id: string) {
    if (id === pageId) return;
    changeRef.current(null);
    setPageId(id);
    setPicker(false);
  }

  function closePageDialog() {
    if (busy) return;
    setEdit(null);
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (edit === "create") {
        const result = await apiFetch<{ page?: PreviewPage }>("/api/preview-pages", { method: "POST", body: JSON.stringify({ projectId, name }) });
        if (result.page) switchPage(result.page.id);
      } else {
        await apiFetch("/api/preview-pages", {
          method: "PATCH",
          body: JSON.stringify({ projectId, pageId: editTargetId || pageId, name }),
        });
      }
      setEdit(null);
      setReload((v) => v + 1);
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  /** 删除 Page：立即从页签隐藏并切走，5 秒撤销窗口结束后才提交服务端删除。 */
  function deletePage() {
    if (busy || pendingPageDeletion) return;
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    const index = pages.findIndex((p) => p.id === target.id);
    const remaining = pages.filter((p) => p.id !== target.id);
    const nextId = remaining[Math.min(index, remaining.length - 1)]?.id || "";
    pendingPageIds.current.add(target.id);
    setPages(remaining);
    setEdit(null);
    switchPage(nextId);
    const pending = {
      token: `page:${target.id}:${Date.now()}`,
      page: target,
      index: index >= 0 ? index : 0,
      seconds: 5,
    };
    setPendingPageDeletion(pending);
    pageDeleteTimer.current = window.setTimeout(() => {
      pageDeleteTimer.current = null;
      setPendingPageDeletion(null);
      void commitPageDeletion(pending);
    }, 5000);
  }

  async function commitPageDeletion(pending: NonNullable<typeof pendingPageDeletion>) {
    setBusy(true);
    try {
      await apiFetch(`/api/preview-pages?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(pending.page.id)}`, { method: "DELETE" });
      pendingPageIds.current.delete(pending.page.id);
      setReload((v) => v + 1);
      onMessage(`Page“${pending.page.name}”已删除`);
    } catch (reason) {
      pendingPageIds.current.delete(pending.page.id);
      setPages((current) => {
        if (current.some((p) => p.id === pending.page.id)) return current;
        const next = [...current];
        next.splice(Math.min(pending.index, next.length), 0, pending.page);
        return next;
      });
      onMessage(reason instanceof Error ? reason.message : "删除 Page 失败");
    } finally {
      setBusy(false);
      setPendingPageDeletion((current) => current?.token === pending.token ? null : current);
    }
  }

  function undoPageDeletion() {
    const pending = pendingPageDeletion;
    if (!pending) return;
    if (pageDeleteTimer.current !== null) {
      window.clearTimeout(pageDeleteTimer.current);
      pageDeleteTimer.current = null;
    }
    pendingPageIds.current.delete(pending.page.id);
    setPages((current) => {
      if (current.some((p) => p.id === pending.page.id)) return current;
      const next = [...current];
      next.splice(Math.min(pending.index, next.length), 0, pending.page);
      return next;
    });
    setPageId(pending.page.id);
    setPendingPageDeletion(null);
    onMessage("已撤销删除");
  }

  async function addAssets() {
    setBusy(true);
    try {
      await apiFetch("/api/preview-page-assets", { method: "POST", body: JSON.stringify({ projectId, pageId, assetIds: selected }) });
      setPicker(false);
      setReload((v) => v + 1);
    } catch (reason) { onMessage(reason instanceof Error ? reason.message : "添加失败"); }
    finally { setBusy(false); }
  }

  function selectAxes(selectedIds: string[]) {
    if (!current) return;
    onPageChange({ ...current, selectedIds });
    if (readOnly) return; // 游客只切换本地视图，不写回 Page
    const id = current.id;
    // 顺序提交，避免快速切换坐标轴时较早的请求覆盖最后一次选择。
    axesQueue.current = axesQueue.current.catch(() => {}).then(() => apiFetch("/api/preview-pages", { method: "PATCH", body: JSON.stringify({ projectId, pageId: id, selectedIds }) })).catch((reason) => {
      onMessage(reason instanceof Error ? reason.message : "坐标轴保存失败");
      if (pageRef.current?.id === id) setReload((v) => v + 1);
    });
  }

  const tabItems = pages.map((p) => ({
    value: p.id,
    icon: <Box size={14} aria-hidden />,
    label: (
      <span
        title={readOnly ? undefined : "双击重命名"}
        onDoubleClick={() => {
          if (readOnly) return;
          setEditTargetId(p.id);
          setName(p.name);
          setEdit("rename");
        }}
      >
        {p.name}
      </span>
    ),
    count: p.id === current?.id ? pageAssets.length : p.assetCount,
  }));

  return (
    <div className="dimension-pages">
      <div className="flex flex-col gap-3 border-b border-line px-3 py-2.5 min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between">
        <div className={cn("flex min-w-0 items-center gap-1 overflow-x-auto", busy && "pointer-events-none opacity-60")}>
          <Tabs variant="underline" ariaLabel="维度 Pages" value={pageId} onChange={switchPage} className="border-b-0" items={tabItems} />
          {!readOnly ? (
            <IconButton
              size="sm"
              label="新建维度 Page"
              className="flex-none"
              onClick={() => {
                setEditTargetId("");
                setName(`Page ${pages.length + 1}`);
                setEdit("create");
              }}
            >
              <Plus size={15} aria-hidden />
            </IconButton>
          ) : null}
        </div>
        {!readOnly ? (
          <div className="flex flex-none items-center justify-end gap-1.5">
            <IconButton
              variant="solid"
              size="sm"
              label="重命名当前 Page"
              disabled={!current || loading}
              onClick={() => {
                if (!current) return;
                setEditTargetId(current.id);
                setName(current.name);
                setEdit("rename");
              }}
            >
              <Pencil size={14} aria-hidden />
            </IconButton>
            <IconButton variant="solid" size="sm" label="删除当前 Page" disabled={!current || loading || Boolean(pendingPageDeletion)} onClick={() => deletePage()}>
              <Trash2 size={14} aria-hidden />
            </IconButton>
            <Button
              variant="primary"
              icon={<Plus size={14} aria-hidden />}
              disabled={!current || loading}
              onClick={() => {
                setSearch("");
                setTags([]);
                setSelected([]);
                setPicker(true);
              }}
            >
              添加素材
            </Button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-md text-muted">
          <Spinner size={20} />
          正在载入 Page…
        </div>
      ) : error ? (
        <EmptyState
          className="flex-1"
          compact
          icon={<AlertTriangle size={26} aria-hidden />}
          title="Page 载入失败"
          description={error}
          action={<Button onClick={() => setReload((v) => v + 1)}>重试</Button>}
        />
      ) : current ? (
        <>
          {!pageAssets.length ? (
            <div className="border-b border-line-soft px-4 py-2 text-sm text-muted">
              {readOnly ? "此 Page 暂无素材。" : "此 Page 暂无素材，点击“添加素材”从项目中选择。维度和位置仅属于当前 Page。"}
            </div>
          ) : null}
          <DimensionPreview
            key={current.id}
            dimensions={current.dimensions}
            assets={pageAssets}
            selectedIds={current.selectedIds}
            onSelectedIdsChange={selectAxes}
            onSelectAsset={onSelectAsset}
            onUpdateAssetDimensions={onUpdateAssetDimensions}
            syncStatus={syncStatus}
            onRetrySync={onRetrySync}
            lockedAssetIds={lockedAssetIds}
            aiTag={aiTag}
            onOpenAiBatch={onOpenAiBatch}
            onAddDimension={onAddDimension}
            onMessage={onMessage}
            onEditDimension={(dimension) => { const found = current.dimensions.find((d) => d.id === dimension.id); if (found) onEditDimension(found); }}
            readOnly={readOnly}
          />
        </>
      ) : (
        <EmptyState
          className="flex-1"
          icon={<Box size={36} aria-hidden />}
          title="还没有维度 Page"
          description={readOnly ? "当前项目还没有维度 Page。" : "新建一个 Page，然后从项目素材中添加要比较的素材。"}
          action={readOnly ? undefined : (
            <Button
              variant="primary"
              icon={<Plus size={15} aria-hidden />}
              onClick={() => {
                setEditTargetId("");
                setName("Page 1");
                setEdit("create");
              }}
            >
              新建 Page
            </Button>
          )}
        />
      )}

      {edit ? (
        <Modal
          open
          onClose={closePageDialog}
          size="md"
          eyebrow="DIMENSION PAGE"
          title={edit === "create" ? "新建维度 Page" : "重命名 Page"}
          description="Page 名称最多 50 个字符；维度与位置仅属于当前 Page。"
          footer={
            <>
              <Button type="button" onClick={closePageDialog} disabled={busy}>
                取消
              </Button>
              <Button type="submit" form="page-edit-form" variant="primary" loading={busy} disabled={busy || !name.trim()}>
                {edit === "create" ? "创建" : "保存"}
              </Button>
            </>
          }
        >
          <form id="page-edit-form" className="flex flex-col gap-4" onSubmit={(event) => void savePage(event)}>
            <Field label="Page 名称">
              <Input {...{ "data-autofocus": true }} required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </form>
        </Modal>
      ) : null}

      {picker ? (
        <Modal
          open
          onClose={() => { if (!busy) setPicker(false); }}
          size="xl"
          className="flex max-h-[85dvh] flex-col overflow-hidden"
          bodyClassName="min-h-0 flex-1"
          eyebrow="ADD ASSETS"
          title={`添加素材到“${current?.name ?? ""}”`}
          description="从项目素材中选择，已加入的素材不会重复添加。"
          footer={
            <>
              <Button type="button" onClick={() => { if (!busy) setPicker(false); }} disabled={busy}>
                取消
              </Button>
              <Button variant="primary" loading={busy} disabled={busy || !selected.length} onClick={() => void addAssets()}>
                {busy ? "添加中…" : `添加 ${selected.length} 个素材`}
              </Button>
            </>
          }
        >
          <SearchInput value={search} onValueChange={setSearch} placeholder="搜索名称、文件名或标签" aria-label="搜索项目素材" />
          <div className="min-w-0">
            <TagFilterBar tags={allTags} selected={tags} onToggle={(tag) => setTags((v) => v.includes(tag) ? v.filter((t) => t !== tag) : [...v, tag])} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>已选 {selected.length} 个 · 匹配 {filtered.length} 个</span>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => setSelected((ids) => [...new Set([...ids, ...filtered.filter((a) => !existingIds.has(a.id)).map((a) => a.id)])].slice(0, 1000))}
            >
              选择筛选结果
            </Button>
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => setSelected([])}>
              清空选择
            </Button>
          </div>
          <div className="grid min-h-[140px] grid-cols-[repeat(auto-fill,minmax(120px,1fr))] content-start gap-3 overflow-y-auto p-[3px]">
            {filtered.map((asset) => {
              const already = existingIds.has(asset.id);
              const active = selected.includes(asset.id);
              return (
                <button
                  type="button"
                  key={asset.id}
                  disabled={busy || already}
                  aria-pressed={active}
                  className={cn(
                    "relative flex min-w-0 flex-col items-center gap-2 rounded-sm border bg-white p-2 text-ink transition-colors",
                    active ? "border-accent outline outline-1 outline-accent" : "border-line hover:border-line-strong",
                    already && "cursor-default opacity-45",
                  )}
                  onClick={() => setSelected((ids) => ids.includes(asset.id) ? ids.filter((id) => id !== asset.id) : ids.length < 1000 ? [...ids, asset.id] : ids)}
                >
                  {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" loading="lazy" className="h-[100px] w-full object-contain" /> : <Box size={30} aria-hidden />}
                  <span className="max-w-full truncate text-sm">{asset.name}</span>
                  {already ? <small className="text-xs text-muted">已加入</small> : active ? <Check size={16} aria-hidden className="absolute right-2 top-2 text-accent" /> : null}
                </button>
              );
            })}
            {!filtered.length ? (
              <EmptyState compact className="col-span-full" title="没有匹配的项目素材" description="换一个名称、文件名或标签试试。" />
            ) : null}
          </div>
        </Modal>
      ) : null}

      {pendingPageDeletion ? (
        <DeletionToast
          label={`Page“${pendingPageDeletion.page.name}”`}
          seconds={pendingPageDeletion.seconds}
          onUndo={undoPageDeletion}
        />
      ) : null}
    </div>
  );
}
