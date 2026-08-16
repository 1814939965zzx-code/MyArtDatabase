"use client";

import {
  Archive,
  Grid2X2,
  ImageIcon,
  ImagePlus,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AllAssetsView, type LibraryAsset } from "./AllAssetsView";
import { BoardView } from "./BoardView";
import { DimensionPreview } from "./DimensionPreview";
import { UploadModal } from "./UploadModal";

type Project = {
  id: string;
  name: string;
  description: string;
  assetCount: number;
  dimensionCount: number;
};

type Dimension = {
  id: string;
  projectId: string;
  leftLabel: string;
  rightLabel: string;
  sortOrder: number;
};

type Asset = {
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
  dimensionValues: Record<string, number>;
};

type Workspace = {
  project: Project;
  dimensions: Dimension[];
  assets: Asset[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">ART DATABASE</p>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function ArtDatabaseApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [activeArea, setActiveArea] = useState<"library" | "project">("project");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [surface, setSurface] = useState<"assets" | "preview" | "board">("assets");
  const [loading, setLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [dimensionOpen, setDimensionOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadProjects(preferredId?: string) {
    const data = await api<{ projects: Project[] }>("/api/projects");
    setProjects(data.projects);
    setSelectedProjectId((current) => {
      const next = preferredId || current;
      return data.projects.some((project) => project.id === next)
        ? next
        : data.projects[0]?.id || "";
    });
  }

  async function loadWorkspace(projectId: string) {
    if (!projectId) {
      setWorkspace(null);
      return;
    }
    setLoading(true);
    try {
      const data = await api<Workspace>(`/api/workspace?projectId=${encodeURIComponent(projectId)}`);
      setWorkspace(data);
      setSelectedAssetId((current) =>
        current && data.assets.some((asset) => asset.id === current) ? current : null,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "项目载入失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadLibrary() {
    setLibraryLoading(true);
    try {
      const data = await api<{ assets: LibraryAsset[] }>("/api/library");
      setLibraryAssets(data.assets);
    } finally {
      setLibraryLoading(false);
    }
  }

  useEffect(() => {
    // The state updates happen after the initial API request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([loadProjects(), loadLibrary()]).catch((error) => {
      setMessage(error instanceof Error ? error.message : "项目载入失败");
      setLoading(false);
      setLibraryLoading(false);
    });
  }, []);

  useEffect(() => {
    // The state updates happen after the workspace API request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorkspace(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((candidate) => candidate.type.startsWith("image/"));
      if (file && activeArea === "project") setUploadFile(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeArea]);

  const filteredAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return workspace?.assets ?? [];
    return (workspace?.assets ?? []).filter((asset) =>
      [asset.name, asset.fileName, ...asset.tags].some((text) => text.toLowerCase().includes(keyword)),
    );
  }, [search, workspace]);

  const selectedAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId) ?? null;

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const data = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: form.get("name"), description: form.get("description") }),
      });
      await loadProjects(data.project.id);
      setCreateOpen(false);
      setMessage("项目已创建");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function editProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api("/api/projects", {
        method: "PATCH",
        body: JSON.stringify({
          id: workspace.project.id,
          name: form.get("name"),
          description: form.get("description"),
        }),
      });
      await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id)]);
      setEditOpen(false);
      setMessage("项目信息已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject() {
    if (!workspace || !window.confirm(`确定删除“${workspace.project.name}”吗？项目中的分类数据会同时删除。`)) return;
    setBusy(true);
    try {
      await api(`/api/projects?id=${encodeURIComponent(workspace.project.id)}`, { method: "DELETE" });
      setEditOpen(false);
      setWorkspace(null);
      setSelectedProjectId("");
      await loadProjects();
      setMessage("项目已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function addDimension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api("/api/dimensions", {
        method: "POST",
        body: JSON.stringify({
          projectId: workspace.project.id,
          leftLabel: form.get("leftLabel"),
          rightLabel: form.get("rightLabel"),
        }),
      });
      await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id)]);
      setDimensionOpen(false);
      setMessage("维度已添加，现有素材已置于中点");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDimension(dimension: Dimension) {
    if (!workspace || !window.confirm(`删除“${dimension.leftLabel} — ${dimension.rightLabel}”维度？`)) return;
    setBusy(true);
    try {
      await api(
        `/api/dimensions?id=${encodeURIComponent(dimension.id)}&projectId=${encodeURIComponent(workspace.project.id)}`,
        { method: "DELETE" },
      );
      await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id)]);
      setMessage("维度已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  function setLocalDimensionValue(assetId: string, dimensionId: string, value: number) {
    setWorkspace((current) => current ? {
      ...current,
      assets: current.assets.map((asset) => asset.id === assetId ? {
        ...asset,
        dimensionValues: { ...asset.dimensionValues, [dimensionId]: value },
      } : asset),
    } : current);
  }

  async function saveDimensionValue(assetId: string, dimensionId: string, value: number) {
    if (!workspace) return;
    try {
      await api("/api/asset-values", {
        method: "PATCH",
        body: JSON.stringify({ projectId: workspace.project.id, assetId, dimensionId, value }),
      });
      setMessage("维度位置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
      await loadWorkspace(workspace.project.id);
    }
  }

  async function savePreviewDimensionValues(assetId: string, values: Record<string, number>) {
    if (!workspace) return;
    setWorkspace((current) => current ? {
      ...current,
      assets: current.assets.map((asset) => asset.id === assetId
        ? { ...asset, dimensionValues: { ...asset.dimensionValues, ...values } }
        : asset),
    } : current);
    try {
      await Promise.all(Object.entries(values).map(([dimensionId, value]) => api("/api/asset-values", {
        method: "PATCH",
        body: JSON.stringify({ projectId: workspace.project.id, assetId, dimensionId, value }),
      })));
      setMessage("图片坐标与维度值已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "维度位置保存失败");
      await loadWorkspace(workspace.project.id);
    }
  }

  function acceptUpload(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("仅支持 JPEG、PNG 和 WebP 图片");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setMessage("图片不能超过 50MB");
      return;
    }
    setUploadFile(file);
  }

  async function removeAssetFromProject(asset: Asset) {
    if (!workspace || !window.confirm(`从当前项目移除“${asset.name}”？全局素材不会被删除。`)) return;
    try {
      await api(`/api/project-assets?projectId=${encodeURIComponent(workspace.project.id)}&assetId=${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      setSelectedAssetId(null);
      await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id)]);
      setMessage("素材已从当前项目移除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移除失败");
    }
  }

  return (
    <main className={`app-shell ${sidebarCollapsed ? "sidebar-hidden" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark"><Sparkles size={17} /></div>
          <div><strong>Art Database</strong><span>视觉素材工作台</span></div>
          <button className="icon-button sidebar-hide-button" type="button" onClick={() => { setSidebarOpen(false); setSidebarCollapsed(true); }} aria-label="隐藏项目栏"><PanelLeftClose size={17} /></button>
        </div>
        <button
          className={`all-assets-item ${activeArea === "library" ? "active" : ""}`}
          type="button"
          onClick={() => { setActiveArea("library"); setSelectedAssetId(null); setSidebarOpen(false); void loadLibrary(); }}
        >
          <span className="project-icon"><Grid2X2 size={16} /></span>
          <span className="project-copy"><strong>全部素材</strong><small>{libraryAssets.length} 个数据库素材</small></span>
        </button>
        <div className="sidebar-section-title">
          <span>项目</span><span>{projects.length}</span>
        </div>
        <nav className="project-list" aria-label="项目列表">
          {projects.map((project) => (
            <button
              type="button"
              key={project.id}
              className={`project-item ${activeArea === "project" && selectedProjectId === project.id ? "active" : ""}`}
              onClick={() => { setActiveArea("project"); setSelectedProjectId(project.id); setSelectedAssetId(null); setSidebarOpen(false); }}
            >
              <span className="project-icon"><Archive size={16} /></span>
              <span className="project-copy"><strong>{project.name}</strong><small>{project.assetCount} 个素材 · {project.dimensionCount} 个维度</small></span>
            </button>
          ))}
        </nav>
        <button className="new-project-button" type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={17} /> 新建项目
        </button>
        <div className="sidebar-note"><Info size={15} /><span>原文件保存在本地图片存储；项目只保存素材引用与分类数据。</span></div>
      </aside>

      <section
        className="workspace"
        onDragOver={(event) => { if (activeArea === "project") { event.preventDefault(); setDragActive(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); acceptUpload(event.dataTransfer.files[0]); }}
      >
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { acceptUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        {dragActive ? <div className="drop-overlay"><Upload size={28} /><strong>松开即可添加图片</strong><span>上传前会先填写 Metadata 和维度值</span></div> : null}
        <header className="topbar">
          <div className="topbar-leading">
            <button className={`icon-button menu-button ${sidebarCollapsed ? "force-visible" : ""}`} type="button" onClick={() => { setSidebarCollapsed(false); setSidebarOpen(true); }} aria-label="展开项目栏">{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <Menu size={19} />}</button>
            {activeArea === "project" && workspace ? (
              <div className="topbar-project">
                <div className="topbar-title">
                  <h1>{workspace.project.name}</h1>
                  <button className="icon-button" type="button" onClick={() => setEditOpen(true)} aria-label="编辑项目"><Pencil size={14} /></button>
                </div>
                <div className="topbar-subtitle">
                  <span>{workspace.project.description || "还没有项目说明"}</span>
                  <em className="topbar-count-badge">{workspace.assets.length} 素材</em>
                </div>
              </div>
            ) : null}
          </div>
          <div className="topbar-actions">
            <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、文件或标签" aria-label="搜索素材" /></div>
            {activeArea === "project" && workspace ? <button className="upload-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={15} />上传图片</button> : null}
          </div>
        </header>

        {activeArea === "library" ? (
          <AllAssetsView
            assets={libraryAssets}
            projects={projects}
            search={search}
            view={view}
            loading={libraryLoading}
            onViewChange={setView}
            onRefresh={async () => { await Promise.all([loadLibrary(), loadProjects()]); }}
            onMessage={setMessage}
          />
        ) : loading && !workspace ? (
          <div className="loading-state"><LoaderCircle className="spin" size={22} /> 正在整理素材库…</div>
        ) : workspace ? (
          <>
            <nav className="surface-tabs" aria-label="项目视图">
              <button type="button" className={surface === "assets" ? "active" : ""} onClick={() => setSurface("assets")}><LayoutGrid size={16} />素材库</button>
              <button type="button" className={surface === "preview" ? "active" : ""} onClick={() => setSurface("preview")}><SlidersHorizontal size={16} />维度预览</button>
              <button type="button" className={surface === "board" ? "active" : ""} onClick={() => setSurface("board")}><ImagePlus size={16} />自由画板</button>
            </nav>

            {surface === "assets" ? <><div className="content-toolbar">
              <div><h2>项目素材</h2><p>{search ? `找到 ${filteredAssets.length} 项` : "按维度整理与比较你的视觉参考"}</p></div>
              <div className="view-toggle" aria-label="显示方式">
                <button type="button" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="网格显示"><LayoutGrid size={16} /></button>
                <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="列表显示"><List size={17} /></button>
              </div>
            </div>

            {filteredAssets.length ? (
              <div className={`asset-collection ${view === "list" ? "asset-list" : "asset-grid"}`}>
                {filteredAssets.map((asset, index) => (
                  <button className="asset-card" type="button" key={asset.id} onClick={() => setSelectedAssetId(asset.id)}>
                    <span className="asset-image-wrap">
                      {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" loading={index > 3 ? "lazy" : "eager"} /> : <span className="asset-fallback"><ImageIcon /></span>}
                      <span className="asset-index">{String(index + 1).padStart(2, "0")}</span>
                    </span>
                    <span className="asset-meta"><strong>{asset.name}</strong><small>{asset.fileName}</small><span className="tag-row">{asset.tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}</span></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state"><Grid2X2 size={25} /><h3>{search ? "没有匹配的素材" : "项目还是空的"}</h3><p>{search ? "换一个关键词试试。" : "拖入、粘贴或选择一张图片开始。"}</p><button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={15} />上传图片</button></div>
            )}</> : surface === "preview" ? <DimensionPreview key={workspace.project.id} dimensions={workspace.dimensions} assets={workspace.assets} onSelectAsset={setSelectedAssetId} onUpdateAssetDimensions={savePreviewDimensionValues} onAddDimension={() => setDimensionOpen(true)} onDeleteDimension={(dimension) => { const fullDimension = workspace.dimensions.find((entry) => entry.id === dimension.id); if (fullDimension) void deleteDimension(fullDimension); }} /> : <BoardView key={workspace.project.id} projectId={workspace.project.id} assets={workspace.assets} onMessage={setMessage} />}
          </>
        ) : (
          <div className="empty-state project-empty"><Archive size={28} /><h2>建立第一个项目</h2><p>项目用于保存独立的素材集合与分类维度。</p><button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} /> 新建项目</button></div>
        )}
      </section>

      {activeArea === "project" && selectedAsset && workspace ? (
        <aside className="asset-drawer" aria-label="素材详情">
          <div className="asset-detail-stage">
            {selectedAsset.thumbnailUrl ? <img className="drawer-image" src={selectedAsset.thumbnailUrl} alt={selectedAsset.name} /> : <span className="drawer-image-fallback"><ImageIcon size={40} /></span>}
          </div>
          <div className="drawer-panel">
            <div className="drawer-heading"><div><p className="eyebrow">ASSET DETAIL</p><h2>{selectedAsset.name}</h2></div><button className="icon-button" type="button" onClick={() => setSelectedAssetId(null)} aria-label="关闭素材详情"><X size={18} /></button></div>
            <div className="drawer-scroll">
              <div className="drawer-file"><small>文件名</small><span>{selectedAsset.fileName}</span></div>
              {selectedAsset.width || selectedAsset.fileSize ? <div className="drawer-facts"><span>{selectedAsset.width && selectedAsset.height ? `${selectedAsset.width} × ${selectedAsset.height}` : "尺寸未知"}</span><span>{selectedAsset.fileSize ? `${(selectedAsset.fileSize / 1024 / 1024).toFixed(2)} MB` : "演示素材"}</span><span>{selectedAsset.mimeType || "image"}</span></div> : null}
              {selectedAsset.description ? <p className="drawer-description">{selectedAsset.description}</p> : null}
              <div className="drawer-tags">{selectedAsset.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="drawer-section-title"><Settings2 size={16} /><strong>维度位置</strong></div>
              {workspace.dimensions.length ? workspace.dimensions.map((dimension) => {
                const value = selectedAsset.dimensionValues[dimension.id] ?? 500;
                return (
                  <div className="dimension-control" key={dimension.id}>
                    <span><b>{dimension.leftLabel}</b><em>{Math.round(value / 10)}%</em><b>{dimension.rightLabel}</b></span>
                    <input
                      id={`dimension-${dimension.id}`}
                      aria-label={`调整${dimension.leftLabel}到${dimension.rightLabel}的位置`}
                      type="range" min="0" max="1000" step="10" value={value}
                      onChange={(event) => setLocalDimensionValue(selectedAsset.id, dimension.id, Number(event.target.value))}
                      onPointerUp={(event) => void saveDimensionValue(selectedAsset.id, dimension.id, Number(event.currentTarget.value))}
                      onBlur={(event) => void saveDimensionValue(selectedAsset.id, dimension.id, Number(event.currentTarget.value))}
                    />
                  </div>
                );
              }) : <p className="drawer-empty">先为项目添加维度，再给素材定位。</p>}
              <button className="drawer-remove" type="button" onClick={() => void removeAssetFromProject(selectedAsset)}><Trash2 size={14} />从当前项目移除</button>
            </div>
          </div>
        </aside>
      ) : null}

      {createOpen ? <Modal title="新建项目" description="为一组视觉探索建立独立空间。" onClose={() => setCreateOpen(false)}><form className="modal-form" onSubmit={createProject}><label>项目名称<input name="name" required maxLength={50} placeholder="例如：2026 产品视觉方向" /></label><label>项目说明<textarea name="description" maxLength={240} rows={3} placeholder="这组素材要解决什么问题？" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "创建中…" : "创建项目"}</button></div></form></Modal> : null}

      {editOpen && workspace ? <Modal title="项目设置" description="修改项目名称和用途说明。" onClose={() => setEditOpen(false)}><form className="modal-form" onSubmit={editProject}><label>项目名称<input name="name" required maxLength={50} defaultValue={workspace.project.name} /></label><label>项目说明<textarea name="description" maxLength={240} rows={3} defaultValue={workspace.project.description} /></label><div className="danger-zone"><button type="button" onClick={() => void deleteProject()} disabled={busy}><Trash2 size={15} /> 删除项目</button><span>素材原文件不会被删除</span></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></div></form></Modal> : null}

      {dimensionOpen && workspace ? <Modal title="添加分类维度" description="项目维度数量不限；进入预览后再选择最多 3 个坐标轴。" onClose={() => setDimensionOpen(false)}><form className="modal-form" onSubmit={addDimension}><div className="dimension-form-row"><label>左端名称<input name="leftLabel" required maxLength={24} placeholder="例如：克制" /></label><span>—</span><label>右端名称<input name="rightLabel" required maxLength={24} placeholder="例如：张扬" /></label></div><p className="form-hint">添加后，项目内已有素材会先放在维度中点。</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDimensionOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "添加中…" : "添加维度"}</button></div></form></Modal> : null}

      {activeArea === "project" && uploadFile && workspace ? <UploadModal file={uploadFile} projectId={workspace.project.id} dimensions={workspace.dimensions} onClose={() => setUploadFile(null)} onComplete={async () => { await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id), loadLibrary()]); }} onMessage={setMessage} /> : null}

      {message ? <div className="toast" role="status">{message}</div> : null}
    </main>
  );
}
