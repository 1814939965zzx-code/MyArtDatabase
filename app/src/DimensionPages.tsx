import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Box, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "./api";
import { DimensionPreview } from "./DimensionPreview";
import { TagFilterBar } from "./TagFilterBar";
import { Button, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, SearchInput, Spinner, Tabs, cn } from "./ui";

export type PageDimension = { id: string; projectId: string; pageId: string; leftLabel: string; rightLabel: string; sortOrder: number };
export type PreviewPage = {
  id: string; projectId: string; name: string; selectedIds: string[];
  dimensions: PageDimension[];
  assets: { assetId: string; dimensionValues: Record<string, number> }[];
};
type Asset = { id: string; name: string; fileName: string; tags: string[]; thumbnailUrl: string | null; width: number; height: number };
type Summary = { id: string; name: string; assetCount: number };

export function DimensionPages({ projectId, assets, page, onPageChange, revision, onSelectAsset, onUpdateAssetDimensions, onAddDimension, onEditDimension, onMessage }: {
  projectId: string; assets: Asset[]; page: PreviewPage | null; onPageChange: (page: PreviewPage | null) => void; revision: number;
  onSelectAsset: (id: string) => void;
  onUpdateAssetDimensions: (id: string, values: Record<string, number>) => Promise<boolean>;
  onAddDimension: () => void; onEditDimension: (dimension: PageDimension) => void; onMessage: (message: string) => void;
}) {
  const [pages, setPages] = useState<Summary[]>([]);
  const [pageId, setPageId] = useState(() => {
    try { return localStorage.getItem(`artdatabase:preview-page:${projectId}`) || ""; } catch { return ""; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<"create" | "rename" | "delete" | null>(null);
  const [editTargetId, setEditTargetId] = useState("");
  const [name, setName] = useState("");
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const changeRef = useRef(onPageChange);
  changeRef.current = onPageChange;
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
      setPages(data.pages);
      const id = data.pages.some((p) => p.id === pageId) ? pageId : data.pages[0]?.id || "";
      if (id !== pageId) { setPageId(id); return; }
      if (!id) { changeRef.current(null); setLoading(false); return; }
      const result = await apiFetch<{ page: PreviewPage }>(`/api/preview-page?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(id)}`);
      if (active) {
        changeRef.current(result.page);
        setLoading(false);
        try { localStorage.setItem(`artdatabase:preview-page:${projectId}`, id); } catch { /* optional preference */ }
      }
    })().catch((reason) => { if (active) { setError(reason instanceof Error ? reason.message : "Page 载入失败"); setLoading(false); } });
    return () => { active = false; };
  }, [projectId, pageId, revision, reload]);

  const current = page?.projectId === projectId && page.id === pageId ? page : null;
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

  async function deletePage() {
    setBusy(true);
    try {
      await apiFetch(`/api/preview-pages?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(pageId)}`, { method: "DELETE" });
      switchPage("");
      setEdit(null);
      setReload((v) => v + 1);
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setBusy(false);
    }
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
        title="双击重命名"
        onDoubleClick={() => {
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
        </div>
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
          <IconButton variant="solid" size="sm" label="删除当前 Page" disabled={!current || loading} onClick={() => setEdit("delete")}>
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
              此 Page 暂无素材，点击“添加素材”从项目中选择。维度和位置仅属于当前 Page。
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
            onAddDimension={onAddDimension}
            onMessage={onMessage}
            onEditDimension={(dimension) => { const found = current.dimensions.find((d) => d.id === dimension.id); if (found) onEditDimension(found); }}
          />
        </>
      ) : (
        <EmptyState
          className="flex-1"
          icon={<Box size={36} aria-hidden />}
          title="还没有维度 Page"
          description="新建一个 Page，然后从项目素材中添加要比较的素材。"
          action={
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
          }
        />
      )}

      {edit && edit !== "delete" ? (
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

      {edit === "delete" ? (
        <ConfirmDialog
          open
          onClose={closePageDialog}
          onConfirm={() => void deletePage()}
          tone="danger"
          title="删除 Page？"
          description={`删除“${current?.name ?? ""}”及其中的维度和位置数据？项目素材和其他 Page 不受影响。`}
          confirmText="删除 Page"
          busy={busy}
        />
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
    </div>
  );
}
