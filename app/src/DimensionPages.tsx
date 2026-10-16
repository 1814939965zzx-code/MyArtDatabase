import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Box, Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { apiFetch } from "./api";
import { DimensionPreview } from "./DimensionPreview";
import { TagFilterBar } from "./TagFilterBar";

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
  onUpdateAssetDimensions: (id: string, values: Record<string, number>) => Promise<void>;
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
    if ((!picker && !edit) || busy) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPicker(false); setEdit(null); }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [picker, edit, busy]);

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
  async function editPage(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (edit === "delete") {
        await apiFetch(`/api/preview-pages?projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(pageId)}`, { method: "DELETE" });
        switchPage("");
      } else {
        const result = await apiFetch<{ page?: PreviewPage }>("/api/preview-pages", { method: edit === "create" ? "POST" : "PATCH", body: JSON.stringify({ projectId, pageId, name }) });
        if (result.page) switchPage(result.page.id);
      }
      setEdit(null);
      setReload((v) => v + 1);
    } catch (reason) { onMessage(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setBusy(false); }
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

  return <div className="dimension-pages">
    <div className="dimension-pages-bar">
      <div className="dimension-pages-tabs" role="tablist" aria-label="维度 Pages">
        {pages.map((p) => <button key={p.id} role="tab" aria-selected={pageId === p.id} disabled={busy} className={pageId === p.id ? "active" : ""} onClick={() => switchPage(p.id)} onDoubleClick={() => { setName(p.name); setEdit("rename"); }}><Box size={14} />{p.name}<small>{p.id === current?.id ? pageAssets.length : p.assetCount}</small></button>)}
        <button type="button" aria-label="新建维度 Page" onClick={() => { setName(`Page ${pages.length + 1}`); setEdit("create"); }}><Plus size={15} /></button>
      </div>
      <div className="dimension-pages-actions">
        <button type="button" className="secondary-button" disabled={!current || loading} onClick={() => { setName(current!.name); setEdit("rename"); }} aria-label="重命名当前 Page"><Pencil size={14} /></button>
        <button type="button" className="secondary-button" disabled={!current || loading} onClick={() => setEdit("delete")} aria-label="删除当前 Page"><Trash2 size={14} /></button>
        <button type="button" className="primary-button" disabled={!current || loading} onClick={() => { setSearch(""); setTags([]); setSelected([]); setPicker(true); }}><Plus size={14} />添加素材</button>
      </div>
    </div>
    {loading ? <div className="dimension-pages-empty">正在载入 Page…</div> : error ? <div className="dimension-pages-empty"><p>{error}</p><button className="secondary-button" onClick={() => setReload((v) => v + 1)}>重试</button></div> : current ? <>
      {!pageAssets.length && <div className="dimension-page-hint">此 Page 暂无素材，点击“添加素材”从项目中选择。维度和位置仅属于当前 Page。</div>}
      <DimensionPreview key={current.id} dimensions={current.dimensions} assets={pageAssets} selectedIds={current.selectedIds} onSelectedIdsChange={selectAxes} onSelectAsset={onSelectAsset} onUpdateAssetDimensions={onUpdateAssetDimensions} onAddDimension={onAddDimension} onEditDimension={(dimension) => { const found = current.dimensions.find((d) => d.id === dimension.id); if (found) onEditDimension(found); }} />
    </> : <div className="dimension-pages-empty"><Box size={36} /><p>还没有维度 Page</p><button className="primary-button" onClick={() => { setName("Page 1"); setEdit("create"); }}><Plus size={15} />新建 Page</button></div>}
    {edit && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="page-edit-title"><div className="modal-heading"><h2 id="page-edit-title">{edit === "create" ? "新建维度 Page" : edit === "rename" ? "重命名 Page" : "删除 Page"}</h2><button className="icon-button" disabled={busy} aria-label="关闭 Page 设置" onClick={() => setEdit(null)}><X size={18} /></button></div><form className="modal-form" onSubmit={(e) => void editPage(e)}>
      {edit === "delete" ? <p>删除“{current?.name}”及其中的维度和位置数据？项目素材和其他 Page 不受影响。</p> : <label>Page 名称<input autoFocus required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} /></label>}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEdit(null)}>取消</button><button className="primary-button" disabled={busy || (edit !== "delete" && !name.trim())}>{busy ? "处理中…" : edit === "delete" ? "删除 Page" : "保存"}</button></div>
    </form></section></div>}
    {picker && <div className="modal-backdrop"><section className="page-asset-picker" role="dialog" aria-modal="true" aria-labelledby="page-picker-title">
      <div className="modal-heading"><div><h2 id="page-picker-title">添加素材到“{current?.name}”</h2><p>从项目素材中选择，已加入的素材不会重复添加。</p></div><button className="icon-button" disabled={busy} aria-label="关闭素材选择" onClick={() => setPicker(false)}><X size={18} /></button></div>
      <label className="page-picker-search"><Search size={16} /><input placeholder="搜索名称、文件名或标签" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <TagFilterBar tags={allTags} selected={tags} onToggle={(tag) => setTags((v) => v.includes(tag) ? v.filter((t) => t !== tag) : [...v, tag])} />
      <div className="page-picker-selection"><span>已选 {selected.length} 个 · 匹配 {filtered.length} 个</span><button type="button" disabled={busy} onClick={() => setSelected((ids) => [...new Set([...ids, ...filtered.filter((a) => !existingIds.has(a.id)).map((a) => a.id)])].slice(0, 1000))}>选择筛选结果</button><button type="button" disabled={busy} onClick={() => setSelected([])}>清空选择</button></div>
      <div className="page-picker-grid">{filtered.map((a) => <button type="button" key={a.id} disabled={busy || existingIds.has(a.id)} aria-pressed={selected.includes(a.id)} className={selected.includes(a.id) ? "selected" : ""} onClick={() => setSelected((ids) => ids.includes(a.id) ? ids.filter((id) => id !== a.id) : ids.length < 1000 ? [...ids, a.id] : ids)}>{a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" loading="lazy" /> : <Box size={30} />}<span>{a.name}</span>{existingIds.has(a.id) ? <small>已加入</small> : selected.includes(a.id) ? <Check size={16} /> : null}</button>)}{!filtered.length && <p>没有匹配的项目素材</p>}</div>
      <div className="modal-actions"><button className="secondary-button" disabled={busy} onClick={() => setPicker(false)}>取消</button><button className="primary-button" disabled={busy || !selected.length} onClick={() => void addAssets()}>{busy ? "添加中…" : `添加 ${selected.length} 个素材`}</button></div>
    </section></div>}
  </div>;
}
