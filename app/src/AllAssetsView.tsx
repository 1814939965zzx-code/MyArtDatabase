"use client";

import {
  AlertTriangle,
  Check,
  Database,
  FolderPlus,
  ImageIcon,
  Images,
  LayoutGrid,
  List,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filteredAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return assets;
    return assets.filter((asset) =>
      [asset.name, asset.fileName, ...asset.tags, ...asset.projects.map((project) => project.name)]
        .some((text) => text.toLowerCase().includes(keyword)),
    );
  }, [assets, search]);

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const assignAsset = assets.find((asset) => asset.id === assignAssetId) ?? null;
  const assignedIds = new Set(assignAsset?.projects.map((project) => project.id) ?? []);
  const unassignedCount = assets.filter((asset) => !asset.projects.length).length;

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

  async function permanentlyDelete(asset: LibraryAsset) {
    const referenceNote = asset.projects.length
      ? `\n\n它目前被 ${asset.projects.length} 个项目引用，这些引用和相关画板内容也会一并移除。`
      : "";
    if (!window.confirm(`永久删除“${asset.name}”？${referenceNote}\n\n此操作会删除原始图片文件和数据库记录，无法恢复。`)) return;
    setBusy(true);
    try {
      await request(`/api/assets?id=${encodeURIComponent(asset.id)}&mode=permanent&force=true`, { method: "DELETE" });
      setSelectedAssetId(null);
      setAssignAssetId(null);
      await onRefresh();
      onMessage("素材及其所有项目引用已永久删除");
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "永久删除失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="loading-state"><LoaderCircle className="spin" size={22} /> 正在载入全部素材…</div>;
  }

  return (
    <>
      <div className="project-header library-header">
        <div>
          <div className="title-row"><h1>全部素材</h1></div>
          <p>统一管理素材库中的原始素材，不受项目边界限制。</p>
        </div>
        <div className="header-stats">
          <span><strong>{assets.length}</strong> 素材</span>
          <span><strong>{unassignedCount}</strong> 未归档</span>
        </div>
      </div>

      <div className="library-callout"><Database size={16} /><span>这里的永久删除会移除原文件、数据库记录及全部项目引用。</span></div>

      <div className="content-toolbar">
        <div><h2>全局素材预览</h2><p>{search ? `找到 ${filteredAssets.length} 项` : "点击素材可查看引用项目与管理操作"}</p></div>
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
              <span className="asset-meta"><strong>{asset.name}</strong><small>{asset.fileName}</small><span className="tag-row">{asset.tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state"><Images size={28} /><h3>{search ? "没有匹配的素材" : "数据库里还没有素材"}</h3><p>{search ? "换一个名称、文件、标签或项目关键词试试。" : "请先进入一个项目上传图片。"}</p></div>
      )}

      {selectedAsset ? (
        <aside className="asset-drawer" aria-label="全局素材详情">
          <div className="asset-detail-stage">
            {selectedAsset.thumbnailUrl ? <img className="drawer-image" src={selectedAsset.thumbnailUrl} alt={selectedAsset.name} /> : <span className="drawer-image-fallback"><ImageIcon size={40} /></span>}
          </div>
          <div className="drawer-panel">
            <div className="drawer-heading"><div><p className="eyebrow">GLOBAL ASSET</p><h2>{selectedAsset.name}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedAssetId(null)} aria-label="关闭素材详情"><X size={18} /></button></div>
            <div className="drawer-scroll">
              <div className="drawer-file"><small>文件名</small><span>{selectedAsset.fileName}</span></div>
              <div className="drawer-facts"><span>{selectedAsset.width && selectedAsset.height ? `${selectedAsset.width} × ${selectedAsset.height}` : "尺寸未知"}</span><span>{selectedAsset.fileSize ? `${(selectedAsset.fileSize / 1024 / 1024).toFixed(2)} MB` : "大小未知"}</span><span>{selectedAsset.mimeType || "image"}</span></div>
              {selectedAsset.description ? <p className="drawer-description">{selectedAsset.description}</p> : null}
              <div className="drawer-tags">{selectedAsset.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="drawer-section-title"><Images size={16} /><strong>已引用项目</strong><em>{selectedAsset.projects.length}</em></div>
              {selectedAsset.projects.length ? <div className="reference-projects">{selectedAsset.projects.map((project) => <span key={project.id}><Check size={12} />{project.name}</span>)}</div> : <p className="drawer-empty">当前没有项目引用这项素材。</p>}
              <button className="drawer-project-add" type="button" onClick={() => openAssign(selectedAsset)}><FolderPlus size={14} />添加到其他项目</button>
              <button className="drawer-remove drawer-permanent-delete" type="button" disabled={busy} onClick={() => void permanentlyDelete(selectedAsset)}><Trash2 size={14} />永久删除素材</button>
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
