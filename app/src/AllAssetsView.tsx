"use client";

import {
  AlertTriangle,
  Check,
  FolderPlus,
  ImageIcon,
  Images,
  LayoutGrid,
  List,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssetMetadataEditor, type AssetMetadataEditorHandle, type AssetMetadataUpdate } from "./AssetMetadataEditor";
import { AssetImageReplacement } from "./AssetImageReplacement";
import type { TagEntry } from "./TagManager";
import { useProgressiveImage } from "./useProgressiveImage";

export type LibraryProject = {
  id: string;
  name: string;
  description: string;
  assetCount: number;
  dimensionCount: number;
};

export type LibraryAsset = {
  id: string;
  name: string;
  fileName: string;
  thumbnailUrl: string | null;
  originalUrl: string | null;
  tags: string[];
  description: string;
  notes: string;
  sourceUrl: string;
  fileSize: number;
  width: number;
  height: number;
  mimeType: string;
  createdAt: string;
  projects: Array<{ id: string; name: string }>;
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

export function AllAssetsView({
  assets,
  projects,
  search,
  view,
  loading,
  onViewChange,
  onRefresh,
  onMessage,
}: {
  assets: LibraryAsset[];
  projects: LibraryProject[];
  search: string;
  view: "grid" | "list";
  loading: boolean;
  onViewChange: (view: "grid" | "list") => void;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assignAssetId, setAssignAssetId] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tagDict, setTagDict] = useState<TagEntry[]>([]);
  const [aiTagBusy, setAiTagBusy] = useState(false);
  const [tagsOverflow, setTagsOverflow] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const metadataEditorRef = useRef<AssetMetadataEditorHandle>(null);
  const tagFilterRef = useRef<HTMLDivElement>(null);

  const globalTags = useMemo(
    () => [...new Set(assets.flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [assets],
  );

  // 筛选按钮排序：已选中的标签排最前，其余按拼音顺序
  const sortedGlobalTags = useMemo(
    () => [...globalTags].sort((a, b) => (
      Number(selectedTags.includes(b)) - Number(selectedTags.includes(a)) || a.localeCompare(b, "zh-CN")
    )),
    [globalTags, selectedTags],
  );

  const availableTags = useMemo(
    () => tagDict.filter((tag) => tag.usageCount > 0).map((tag) => tag.name).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [tagDict],
  );

  async function loadTagDict() {
    try {
      const data = await request<{ tags: TagEntry[] }>("/api/tags");
      setTagDict(data.tags);
    } catch {
      // 联想词载入失败不阻塞素材浏览
    }
  }

  useEffect(() => {
    void loadTagDict();
  }, []);

  useEffect(() => {
    setSelectedTags((current) => {
      const next = current.filter((tag) => globalTags.includes(tag));
      return next.length === current.length ? current : next;
    });
  }, [globalTags]);

  // 全局标签默认只展示 2 行：仅在折叠态测量内容是否溢出，溢出时给出展开/收起入口
  useEffect(() => {
    if (tagsExpanded) return;
    const element = tagFilterRef.current;
    if (!element) return;
    const update = () => setTagsOverflow(element.scrollHeight > element.clientHeight + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [globalTags, tagsExpanded]);

  const filteredAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesTag = selectedTags.length === 0 || selectedTags.some((tag) => asset.tags.includes(tag));
      const matchesKeyword = !keyword || [asset.name, asset.fileName, ...asset.tags, ...asset.projects.map((project) => project.name)]
        .some((text) => text.toLowerCase().includes(keyword));
      return matchesTag && matchesKeyword;
    });
  }, [assets, search, selectedTags]);

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const detailImage = useProgressiveImage(selectedAsset?.thumbnailUrl ?? null, selectedAsset?.originalUrl ?? null);
  const assignAsset = assets.find((asset) => asset.id === assignAssetId) ?? null;
  const assignedIds = new Set(assignAsset?.projects.map((project) => project.id) ?? []);

  useEffect(() => {
    if (!selectedAssetId) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeAssetDetail();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedAssetId]);

  async function closeAssetDetail() {
    const saved = await metadataEditorRef.current?.save();
    if (saved !== false) setSelectedAssetId(null);
  }

  function openAssign(asset: LibraryAsset) {
    setAssignAssetId(asset.id);
    setSelectedProjectIds([]);
    setError("");
  }

  async function assignToProjects() {
    if (!assignAsset || !selectedProjectIds.length) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/project-assets", {
        method: "POST",
        body: JSON.stringify({ assetId: assignAsset.id, projectIds: selectedProjectIds }),
      });
      await onRefresh();
      setAssignAssetId(null);
      setSelectedProjectIds([]);
      onMessage(`已将素材添加到 ${selectedProjectIds.length} 个项目`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteToTrash(asset: LibraryAsset) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/assets?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      setSelectedAssetId(null);
      setAssignAssetId(null);
      await onRefresh();
      onMessage("素材已移入回收站，可在回收站恢复或永久删除");
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveAssetMetadata(asset: LibraryAsset, update: AssetMetadataUpdate) {
    setBusy(true);
    setError("");
    try {
      await request("/api/assets", {
        method: "PATCH",
        body: JSON.stringify({ ...update, id: asset.id, tags: update.tags.join(",") }),
      });
      await Promise.all([onRefresh(), loadTagDict()]);
      onMessage("素材信息已保存");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存失败";
      setError(message);
      onMessage(message);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function runAiTag() {
    if (!selectedAsset) return;
    const saved = await metadataEditorRef.current?.save();
    if (saved === false) {
      onMessage("AI 打标未执行：素材信息校验或保存失败");
      return;
    }
    setAiTagBusy(true);
    try {
      const data = await request<{ reused: number; created: number; dropped: number }>("/api/assets/ai-tags", {
        method: "POST",
        body: JSON.stringify({ id: selectedAsset.id }),
      });
      await Promise.all([onRefresh(), loadTagDict()]);
      const parts = [`复用 ${data.reused} 个`, `新建 ${data.created} 个`];
      if (data.dropped) parts.push(`超出上限丢弃 ${data.dropped} 个`);
      onMessage(`AI 打标完成：${parts.join("，")}`);
    } catch (reason) {
      onMessage(`AI 打标失败：${reason instanceof Error ? reason.message : "未知错误"}`);
    } finally {
      setAiTagBusy(false);
    }
  }

  if (loading) {
    return <div className="loading-state"><LoaderCircle className="spin" size={22} /> 正在载入全部素材…</div>;
  }

  return (
    <>
      <div className="library-filter-bar">
        <div className="global-tag-area">
          <div ref={tagFilterRef} className={`global-tag-filter library-tag-filter ${tagsExpanded ? "expanded" : ""}`} aria-label="按全局标签筛选">
            <strong>全局标签</strong>
            {sortedGlobalTags.map((tag) => (
              <button type="button" className={selectedTags.includes(tag) ? "active" : ""} key={tag} onClick={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}>
                {tag}
              </button>
            ))}
            {!globalTags.length ? <span>暂无标签</span> : null}
          </div>
          {(tagsOverflow || tagsExpanded) ? (
            <button className="tag-filter-expand" type="button" onClick={() => setTagsExpanded((current) => !current)}>
              {tagsExpanded ? "收起全部标签" : "展开全部标签"}
            </button>
          ) : null}
        </div>
        <div className="library-filter-actions">
          {(search || selectedTags.length) ? <span>找到 {filteredAssets.length} 项</span> : null}
        </div>
      </div>

      <div className="library-view-bar">
        <div className="view-toggle" aria-label="显示方式">
          <button type="button" className={view === "grid" ? "active" : ""} onClick={() => onViewChange("grid")} aria-label="网格显示"><LayoutGrid size={16} /></button>
          <button type="button" className={view === "list" ? "active" : ""} onClick={() => onViewChange("list")} aria-label="列表显示"><List size={17} /></button>
        </div>
      </div>

      {filteredAssets.length ? (
        <div className={`asset-collection library-collection ${view === "list" ? "asset-list" : "asset-grid"}`}>
          {filteredAssets.map((asset, index) => (
            <button className="asset-card" type="button" key={asset.id} onClick={() => setSelectedAssetId(asset.id)}>
              <span className="asset-image-wrap">
                {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" loading={index > 7 ? "lazy" : "eager"} /> : <span className="asset-fallback"><ImageIcon /></span>}
                <span className="asset-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="project-count-badge">{asset.projects.length} 个项目</span>
              </span>
              <span className="asset-meta"><strong>{asset.name}</strong><span className="tag-row">{asset.tags.map((tag) => <i key={tag}>{tag}</i>)}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state"><Images size={28} /><h3>{search || selectedTags.length ? "没有匹配的素材" : "数据库里还没有素材"}</h3><p>{search || selectedTags.length ? "换一个名称、文件、标签或项目关键词试试。" : "请先进入一个项目上传图片。"}</p></div>
      )}

      {selectedAsset ? (
        <aside className="asset-drawer" aria-label="全局素材详情">
          <div className="asset-detail-stage" role="button" tabIndex={0} aria-label="关闭素材详情" onClick={() => void closeAssetDetail()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void closeAssetDetail(); } }}>
            {detailImage ? <span className="drawer-image-frame"><img key={detailImage} className="drawer-image" src={detailImage} alt={selectedAsset.name} onClick={(event) => event.stopPropagation()} /></span> : <span className="drawer-image-fallback" onClick={(event) => event.stopPropagation()}><ImageIcon size={40} /></span>}
          </div>
          <div className="drawer-panel">
            <div className="drawer-heading"><div><p className="eyebrow">GLOBAL ASSET</p><h2>素材详情</h2></div><button className="icon-button" type="button" onClick={() => void closeAssetDetail()} aria-label="关闭素材详情"><X size={18} /></button></div>
            <div className="drawer-scroll">
              <div className="drawer-file"><small>文件名</small><span>{selectedAsset.fileName}</span></div>
              <div className="drawer-facts"><span>{selectedAsset.width && selectedAsset.height ? `${selectedAsset.width} × ${selectedAsset.height}` : "尺寸未知"}</span><span>{selectedAsset.fileSize ? `${(selectedAsset.fileSize / 1024 / 1024).toFixed(2)} MB` : "大小未知"}</span><span>{selectedAsset.mimeType || "image"}</span></div>
              {error ? <div className="form-error"><AlertTriangle size={15} />{error}</div> : null}
              <AssetImageReplacement
                asset={selectedAsset}
                busy={busy}
                onBusyChange={setBusy}
                onComplete={onRefresh}
                onMessage={onMessage}
              />
              <AssetMetadataEditor
                ref={metadataEditorRef}
                asset={selectedAsset}
                busy={busy}
                availableTags={availableTags}
                aiTagBusy={aiTagBusy}
                onAiTag={() => void runAiTag()}
                onSave={(update) => saveAssetMetadata(selectedAsset, update)}
              />
              <div className="drawer-section-title"><Images size={16} /><strong>已引用项目</strong><em>{selectedAsset.projects.length}</em></div>
              {selectedAsset.projects.length ? <div className="reference-projects">{selectedAsset.projects.map((project) => <span key={project.id}><Check size={12} />{project.name}</span>)}</div> : <p className="drawer-empty">当前没有项目引用这项素材。</p>}
              <button className="drawer-project-add" type="button" onClick={() => openAssign(selectedAsset)}><FolderPlus size={14} />添加到其他项目</button>
              <button className="drawer-remove drawer-delete" type="button" disabled={busy} onClick={() => void deleteToTrash(selectedAsset)}><Trash2 size={14} />删除素材</button>
            </div>
          </div>
        </aside>
      ) : null}

      {assignAsset ? (
        <div className="modal-backdrop">
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="assign-title">
            <div className="modal-heading"><div><p className="eyebrow">PROJECT REFERENCES</p><h2 id="assign-title">添加到其他项目</h2><p>“{assignAsset.name}”只保留一份原文件，项目中创建的是引用。</p></div><button className="icon-button" type="button" onClick={() => setAssignAssetId(null)} aria-label="关闭"><X size={18} /></button></div>
            {error ? <div className="form-error"><AlertTriangle size={15} />{error}</div> : null}
            <div className="project-picker">
              {projects.map((project) => {
                const alreadyAssigned = assignedIds.has(project.id);
                const checked = alreadyAssigned || selectedProjectIds.includes(project.id);
                return (
                  <div key={project.id} className={`project-picker-option ${alreadyAssigned ? "already-assigned" : ""}`}>
                    <input id={`assign-project-${project.id}`} aria-label={`选择项目 ${project.name}`} type="checkbox" checked={checked} disabled={alreadyAssigned || busy} onChange={(event) => setSelectedProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} />
                    <label htmlFor={`assign-project-${project.id}`}><strong>{project.name}</strong><small>{alreadyAssigned ? "已在项目中" : `${project.assetCount} 个素材`}</small></label>
                  </div>
                );
              })}
              {!projects.length ? <p className="drawer-empty">还没有可添加的项目。</p> : null}
            </div>
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setAssignAssetId(null)}>取消</button><button className="primary-button" type="button" disabled={busy || !selectedProjectIds.length} onClick={() => void assignToProjects()}>{busy ? "添加中…" : `添加到 ${selectedProjectIds.length || 0} 个项目`}</button></div>
          </section>
        </div>
      ) : null}
    </>
  );
}
