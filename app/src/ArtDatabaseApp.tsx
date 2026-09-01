"use client";

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ChevronDown,
  Grid2X2,
  ImageIcon,
  ImagePlus,
  LayoutGrid,
  List,
  LoaderCircle,
  LogOut,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./api";
import { formatDuration, isVideoMime, videoStatusOf } from "./assetMedia";
import type { SessionUser } from "./AuthGate";
import { AccountSettingsModal } from "./AccountSettingsModal";
import { AllAssetsView, type LibraryAsset } from "./AllAssetsView";
import { AnnouncementModal } from "./AnnouncementModal";
import { AssetMetadataEditor, type AssetMetadataEditorHandle, type AssetMetadataUpdate } from "./AssetMetadataEditor";
import { AssetImageReplacement } from "./AssetImageReplacement";
import { BoardView } from "./BoardView";
import { DeletionToast } from "./DeletionToast";
import { DimensionControlsEditor, type DimensionControlsEditorHandle } from "./DimensionControlsEditor";
import { DimensionEditorModal } from "./DimensionEditorModal";
import { DimensionPreview } from "./DimensionPreview";
import { HomeView } from "./HomeView";
import { TagFilterBar } from "./TagFilterBar";
import { TagManager, type TagEntry } from "./TagManager";
import { TrashView, type TrashedAsset } from "./TrashView";
import { UploadModal } from "./UploadModal";
import { UserManagerModal } from "./UserManagerModal";
import { useProgressiveImage } from "./useProgressiveImage";

type Project = {
  id: string;
  name: string;
  description: string;
  assetCount: number;
  dimensionCount: number;
  thumbnails?: string[];
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
  originalUrl: string | null;
  tags: string[];
  description: string;
  notes: string;
  sourceUrl: string;
  fileSize: number;
  width: number;
  height: number;
  mimeType: string;
  duration: number;
  transcodeStatus: string | null;
  createdAt: string;
  createdByName?: string;
  dimensionValues: Record<string, number>;
};

type Workspace = {
  project: Project;
  dimensions: Dimension[];
  assets: Asset[];
};

type PendingDeletion =
  | { token: string; kind: "dimension"; projectId: string; dimension: Dimension; seconds: number };

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

export function ArtDatabaseApp({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [trashAssets, setTrashAssets] = useState<TrashedAsset[]>([]);
  const [activeArea, setActiveArea] = useState<"home" | "library" | "project" | "trash">("home");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [surface, setSurface] = useState<"assets" | "preview" | "board">("preview");
  const [projectTagFilter, setProjectTagFilter] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [trashLoading, setTrashLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [dimensionOpen, setDimensionOpen] = useState(false);
  const [editingDimensionId, setEditingDimensionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [tagDict, setTagDict] = useState<TagEntry[]>([]);
  const [aiTagBusy, setAiTagBusy] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [projectTagManagerOpen, setProjectTagManagerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [userManagerOpen, setUserManagerOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<SessionUser>(user);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const metadataEditorRef = useRef<AssetMetadataEditorHandle>(null);
  const dimensionEditorRef = useRef<DimensionControlsEditorHandle>(null);
  const availableTags = useMemo(
    () => tagDict.filter((tag) => tag.usageCount > 0).map((tag) => tag.name).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [tagDict],
  );
  const projectTags = useMemo(
    () => [...new Set((workspace?.assets ?? []).flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [workspace],
  );

  async function loadProjects(preferredId?: string) {
    const data = await apiFetch<{ projects: Project[] }>("/api/projects");
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
      const data = await apiFetch<Workspace>(`/api/workspace?projectId=${encodeURIComponent(projectId)}`);
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
      const data = await apiFetch<{ assets: LibraryAsset[] }>("/api/library");
      setLibraryAssets(data.assets);
    } finally {
      setLibraryLoading(false);
    }
  }

  async function loadTrash(quiet = false) {
    if (!quiet) setTrashLoading(true);
    try {
      const data = await apiFetch<{ assets: TrashedAsset[] }>("/api/trash");
      setTrashAssets(data.assets);
    } finally {
      setTrashLoading(false);
    }
  }

  async function loadTagDict() {
    try {
      const data = await apiFetch<{ tags: TagEntry[] }>("/api/tags");
      setTagDict(data.tags);
    } catch {
      // 联想词载入失败不阻塞页面
    }
  }

  useEffect(() => {
    // The state updates happen after the initial API request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([loadProjects(), loadLibrary(), loadTrash(), loadTagDict()]).catch((error) => {
      setMessage(error instanceof Error ? error.message : "项目载入失败");
      setLoading(false);
      setLibraryLoading(false);
      setTrashLoading(false);
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
    if (!userMenuOpen) return;
    const closeOnClick = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", closeOnClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOnClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [userMenuOpen]);

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
    if (dimensionEditorRef.current?.dismissEditor()) return;
    const saved = await metadataEditorRef.current?.save();
    if (saved !== false) setSelectedAssetId(null);
  }

  useEffect(() => {
    if (!pendingDeletion) return;
    const pending = pendingDeletion;
    const interval = window.setInterval(() => {
      setPendingDeletion((current) => current?.token === pending.token
        ? { ...current, seconds: Math.max(1, current.seconds - 1) }
        : current);
    }, 1000);
    const timer = window.setTimeout(() => {
      setPendingDeletion((current) => current?.token === pending.token ? null : current);
      void commitDimensionDeletion(pending.projectId, pending.dimension);
    }, 5000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, [pendingDeletion?.token]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((candidate) => candidate.type.startsWith("image/"));
      if (file && activeArea === "project" && !selectedAssetId) setUploadFile(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeArea, selectedAssetId]);

  const filteredAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (workspace?.assets ?? []).filter((asset) => {
      const matchesTags = projectTagFilter.length === 0 || projectTagFilter.some((tag) => asset.tags.includes(tag));
      const matchesKeyword = !keyword || [asset.name, asset.fileName, ...asset.tags].some((text) => text.toLowerCase().includes(keyword));
      return matchesTags && matchesKeyword;
    });
  }, [search, workspace, projectTagFilter]);

  const filteredProjects = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return projects;
    return projects.filter((project) =>
      [project.name, project.description].some((text) => text.toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [projects, search]);

  /** 从主页进入项目：收起侧边栏，只保留项目工作区。 */
  function openProject(project: Project) {
    setActiveArea("project");
    setSelectedProjectId(project.id);
    setSelectedAssetId(null);
    setSidebarCollapsed(true);
    setSidebarOpen(false);
  }

  /** 从项目返回主页：恢复侧边导航并刷新项目列表。 */
  function returnHome() {
    setActiveArea("home");
    setSelectedAssetId(null);
    setSidebarCollapsed(false);
    void loadProjects();
  }

  useEffect(() => {
    setProjectTagFilter((current) => {
      const next = current.filter((tag) => projectTags.includes(tag));
      return next.length === current.length ? current : next;
    });
  }, [projectTags]);

  const selectedAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const detailImage = useProgressiveImage(selectedAsset?.thumbnailUrl ?? null, selectedAsset?.originalUrl ?? null);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const data = await apiFetch<{ project: Project }>("/api/projects", {
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
    if (!editingProject) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await apiFetch("/api/projects", {
        method: "PATCH",
        body: JSON.stringify({
          id: editingProject.id,
          name: form.get("name"),
          description: form.get("description"),
        }),
      });
      await loadProjects(editingProject.id);
      if (workspace?.project.id === editingProject.id) await loadWorkspace(editingProject.id);
      setEditOpen(false);
      setEditingProject(null);
      setMessage("项目信息已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProject(projectOverride?: Project) {
    const target = projectOverride ?? editingProject;
    if (!target || !window.confirm(`确定删除“${target.name}”吗？项目中的分类数据会同时删除。`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/projects?id=${encodeURIComponent(target.id)}`, { method: "DELETE" });
      setEditOpen(false);
      setEditingProject(null);
      if (workspace?.project.id === target.id) {
        setWorkspace(null);
        setSelectedProjectId("");
      }
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
      await apiFetch("/api/dimensions", {
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

  function scheduleDimensionDeletion(dimension: Dimension) {
    if (!workspace) return;
    if (pendingDeletion) {
      setMessage("请先撤销或等待当前删除完成");
      return;
    }
    setMessage(null);
    setPendingDeletion({
      token: `${dimension.id}-${Date.now()}`,
      kind: "dimension",
      projectId: workspace.project.id,
      dimension,
      seconds: 5,
    });
  }

  async function commitDimensionDeletion(projectId: string, dimension: Dimension) {
    setBusy(true);
    try {
      await apiFetch(
        `/api/dimensions?id=${encodeURIComponent(dimension.id)}&projectId=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      await loadProjects();
      setWorkspace((current) => current?.project.id === projectId ? {
        ...current,
        dimensions: current.dimensions.filter((item) => item.id !== dimension.id),
        assets: current.assets.map((asset) => {
          const dimensionValues = { ...asset.dimensionValues };
          delete dimensionValues[dimension.id];
          return { ...asset, dimensionValues };
        }),
      } : current);
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
      await apiFetch("/api/asset-values", {
        method: "PATCH",
        body: JSON.stringify({ projectId: workspace.project.id, assetId, dimensionId, value }),
      });
      setMessage("维度位置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "维度位置保存失败");
      await loadWorkspace(workspace.project.id);
    }
  }

  async function applyDimensionLabels(updates: Array<{ id: string; leftLabel: string; rightLabel: string }>) {
    if (!workspace || !updates.length) return;
    setBusy(true);
    try {
      await apiFetch("/api/dimensions", {
        method: "PATCH",
        body: JSON.stringify({ projectId: workspace.project.id, dimensions: updates }),
      });
      const updateMap = new Map(updates.map((entry) => [entry.id, entry]));
      setWorkspace((current) => current ? {
        ...current,
        dimensions: current.dimensions.map((dimension) => {
          const update = updateMap.get(dimension.id);
          return update ? { ...dimension, leftLabel: update.leftLabel, rightLabel: update.rightLabel } : dimension;
        }),
      } : current);
      setMessage("维度名称已在当前项目全局更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "维度名称修改失败");
      throw error;
    } finally {
      setBusy(false);
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
      await Promise.all(Object.entries(values).map(([dimensionId, value]) => apiFetch("/api/asset-values", {
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
    if (activeArea !== "project") return; // 上传只发生在项目内
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("仅支持 JPEG、PNG、WebP 图片或 mp4/mov/webm/mkv 等视频");
      return;
    }
    if (isVideo && !["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska", "video/mpeg", "video/3gpp", "video/3gpp2"].includes(file.type)) {
      setMessage("仅支持 mp4/mov/webm/mkv 等视频格式");
      return;
    }
    if (file.size > (isVideo ? 200 * 1024 * 1024 : 50 * 1024 * 1024)) {
      setMessage(isVideo ? "视频不能超过 200MB" : "图片不能超过 50MB");
      return;
    }
    setUploadFile(file);
  }

  /** 转码失败后重新转码（原文件仍在，服务端置回 processing 并入队）。 */
  async function retranscodeVideo(asset: Asset) {
    if (!workspace) return;
    setBusy(true);
    try {
      await apiFetch("/api/assets/retranscode", { method: "POST", body: JSON.stringify({ id: asset.id }) });
      setMessage("已开始重新转码，完成后自动可播放");
      await loadWorkspace(workspace.project.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重新转码失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeAssetFromProject(asset: Asset) {
    if (!workspace || !window.confirm(`从当前项目移除“${asset.name}”？全局素材不会被删除。`)) return;
    try {
      await apiFetch(`/api/project-assets?projectId=${encodeURIComponent(workspace.project.id)}&assetId=${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      setSelectedAssetId(null);
      await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id)]);
      setMessage("素材已从当前项目移除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移除失败");
    }
  }

  async function saveAssetMetadata(asset: Asset, update: AssetMetadataUpdate) {
    if (!workspace) return;
    setBusy(true);
    try {
      await apiFetch("/api/assets", {
        method: "PATCH",
        body: JSON.stringify({ ...update, id: asset.id, tags: update.tags.join(",") }),
      });
      await Promise.all([loadWorkspace(workspace.project.id), loadLibrary(), loadTagDict()]);
      setMessage("素材信息已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function runAiTag(asset: Asset) {
    if (!workspace) return;
    const projectId = workspace.project.id;
    const saved = await metadataEditorRef.current?.save();
    if (saved === false) {
      setMessage("AI 打标未执行：素材信息校验或保存失败");
      return;
    }
    setAiTagBusy(true);
    try {
      const data = await apiFetch<{ reused: number; created: number; dropped: number }>("/api/assets/ai-tags", {
        method: "POST",
        body: JSON.stringify({ id: asset.id }),
      });
      await Promise.all([loadWorkspace(projectId), loadLibrary(), loadTagDict()]);
      const parts = [`复用 ${data.reused} 个`, `新建 ${data.created} 个`];
      if (data.dropped) parts.push(`超出上限丢弃 ${data.dropped} 个`);
      setMessage(`AI 打标完成：${parts.join("，")}`);
    } catch (error) {
      setMessage(`AI 打标失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setAiTagBusy(false);
    }
  }

  async function restoreTrashAsset(asset: TrashedAsset) {
    try {
      await apiFetch("/api/assets/restore", {
        method: "POST",
        body: JSON.stringify({ id: asset.id }),
      });
      await Promise.all([loadTrash(true), loadLibrary(), loadProjects()]);
      setMessage(`已恢复“${asset.name}”`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败");
    }
  }

  async function restoreTrashAssets(assetsToRestore: TrashedAsset[]) {
    if (!assetsToRestore.length) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(assetsToRestore.map((asset) =>
        apiFetch("/api/assets/restore", { method: "POST", body: JSON.stringify({ id: asset.id }) }),
      ));
      const ok = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - ok;
      await Promise.all([loadTrash(true), loadLibrary(), loadProjects()]);
      setMessage(failed ? `已恢复 ${ok} 个素材，${failed} 个失败` : `已恢复 ${ok} 个素材`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  }

  async function purgeTrashAsset(asset: TrashedAsset) {
    const referenceNote = asset.projects.length
      ? `\n\n它目前被 ${asset.projects.length} 个项目引用，这些引用和相关画板内容也会一并移除。`
      : "";
    if (!window.confirm(`永久删除“${asset.name}”？${referenceNote}\n\n此操作会删除原始图片文件和数据库记录，无法恢复。`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/assets?id=${encodeURIComponent(asset.id)}&mode=permanent&force=true`, { method: "DELETE" });
      await Promise.all([loadTrash(true), loadLibrary(), loadProjects()]);
      setMessage("素材已永久删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "永久删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function purgeTrashAssets(assetsToPurge: TrashedAsset[]) {
    if (!assetsToPurge.length) return;
    const referenced = assetsToPurge.filter((asset) => asset.projects.length).length;
    const referenceNote = referenced ? `\n\n其中 ${referenced} 个素材仍被项目引用，这些引用和相关画板内容也会一并移除。` : "";
    if (!window.confirm(`永久删除选中的 ${assetsToPurge.length} 个素材？${referenceNote}\n\n此操作会删除原始图片文件和数据库记录，无法恢复。`)) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(assetsToPurge.map((asset) =>
        apiFetch(`/api/assets?id=${encodeURIComponent(asset.id)}&mode=permanent&force=true`, { method: "DELETE" }),
      ));
      const ok = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - ok;
      await Promise.all([loadTrash(true), loadLibrary(), loadProjects()]);
      setMessage(failed ? `已永久删除 ${ok} 个素材，${failed} 个失败` : `已永久删除 ${ok} 个素材`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "永久删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`app-shell ${sidebarCollapsed || activeArea === "project" ? "sidebar-hidden" : ""}`}>
      {activeArea !== "project" ? (
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
          <div className="brand-block">
            <div className="brand-mark"><Sparkles size={17} /></div>
            <div><strong>Art Database</strong><span>视觉素材工作台</span></div>
            <button className="icon-button sidebar-hide-button" type="button" onClick={() => { setSidebarOpen(false); setSidebarCollapsed(true); }} aria-label="隐藏导航栏"><PanelLeftClose size={17} /></button>
          </div>
          <button
            className={`all-assets-item ${activeArea === "home" ? "active" : ""}`}
            type="button"
            onClick={() => { setActiveArea("home"); setSelectedAssetId(null); setSidebarOpen(false); void loadProjects(); }}
          >
            <span className="project-icon"><Archive size={16} /></span>
            <span className="project-copy"><strong>项目</strong><small>{projects.length} 个独立空间</small></span>
          </button>
          <button
            className={`all-assets-item ${activeArea === "library" ? "active" : ""}`}
            type="button"
            onClick={() => { setActiveArea("library"); setSelectedAssetId(null); setSidebarOpen(false); void loadLibrary(); }}
          >
            <span className="project-icon"><Grid2X2 size={16} /></span>
            <span className="project-copy"><strong>全部素材</strong><small>{libraryAssets.length} 个数据库素材</small></span>
          </button>
          <button
            className="all-assets-item"
            type="button"
            onClick={() => { setSidebarOpen(false); setTagManagerOpen(true); }}
          >
            <span className="project-icon"><Tags size={16} /></span>
            <span className="project-copy"><strong>标签管理</strong><small>词库与标签维护</small></span>
          </button>
          <div className="sidebar-section-title">
            <span>项目</span><span>{projects.length}</span>
          </div>
          <button className="new-project-button" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={17} /> 新建项目
          </button>
          <button
            className={`trash-nav-item ${activeArea === "trash" ? "active" : ""}`}
            type="button"
            onClick={() => { setActiveArea("trash"); setSelectedAssetId(null); setSidebarOpen(false); void loadTrash(); }}
          >
            <span className="project-icon"><Trash2 size={16} /></span>
            <span className="project-copy"><strong>回收站</strong><small>{trashAssets.length} 个已删除素材</small></span>
          </button>
        </aside>
      ) : null}

      <section
        className={`workspace ${activeArea === "project" && surface === "preview" ? "preview-active" : activeArea === "project" && surface === "board" ? "board-active" : ""}`}
        onDragOver={(event) => { if (activeArea === "project" && Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setDragActive(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); acceptUpload(event.dataTransfer.files[0]); }}
      >
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,video/mpeg,video/3gpp,video/3gpp2" onChange={(event) => { acceptUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        {dragActive ? <div className="drop-overlay"><Upload size={28} /><strong>松开即可添加图片</strong><span>上传前会先填写 Metadata 和维度值</span></div> : null}
        <header className="topbar">
          <div className="topbar-leading">
            {activeArea === "project" ? (
              <button className="back-button" type="button" onClick={returnHome}><ArrowLeft size={17} />返回主页</button>
            ) : (
              <button className={`icon-button menu-button ${sidebarCollapsed ? "force-visible" : ""}`} type="button" onClick={() => { setSidebarCollapsed(false); setSidebarOpen(true); }} aria-label="展开导航栏">{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <Menu size={19} />}</button>
            )}
            {activeArea === "project" && workspace ? (
              <div className="topbar-project">
                <div className="topbar-title">
                  <h1>{workspace.project.name}</h1>
                  <button className="icon-button" type="button" onClick={() => { setEditingProject(workspace.project); setEditOpen(true); }} aria-label="编辑项目"><Pencil size={14} /></button>
                </div>
                <div className="topbar-subtitle">
                  <span>{workspace.project.description || "还没有项目说明"}</span>
                  <em className="topbar-count-badge">{workspace.assets.length} 素材</em>
                </div>
              </div>
            ) : activeArea === "home" ? (
              <div className="topbar-project">
                <div className="topbar-title">
                  <h1>项目</h1>
                  <em className="topbar-title-total">{filteredProjects.length}</em>
                </div>
              </div>
            ) : activeArea === "library" ? (
              <div className="topbar-project">
                <div className="topbar-title">
                  <h1>全部素材</h1>
                  <em className="topbar-title-total">{libraryAssets.length}</em>
                </div>
              </div>
            ) : activeArea === "trash" ? (
              <div className="topbar-project">
                <div className="topbar-title">
                  <h1>回收站</h1>
                  <em className="topbar-title-total">{trashAssets.length}</em>
                </div>
              </div>
            ) : null}
          </div>
          <div className="topbar-actions">
            {activeArea === "library" ? <button className="tag-manager-open-button" type="button" onClick={() => setTagManagerOpen(true)}><Tags size={14} />标签管理</button> : null}
            <div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeArea === "home" ? "搜索项目名称或说明" : "搜索名称、文件或标签"} aria-label={activeArea === "home" ? "搜索项目" : "搜索素材"} /></div>
            {activeArea === "project" && workspace ? <button className="upload-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={15} />上传素材</button> : null}
            <div className="user-menu" ref={userMenuRef}>
              <button className="user-menu-trigger" type="button" onClick={() => setUserMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={userMenuOpen}>
                <span className="user-avatar">{currentUser.displayName.slice(0, 1).toUpperCase()}</span>
                <span className="user-menu-copy">
                  <strong>{currentUser.displayName}</strong>
                  <small>{currentUser.role === "admin" ? "管理员" : "成员"}</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {userMenuOpen ? (
                <div className="user-menu-dropdown" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setAccountOpen(true); setUserMenuOpen(false); }}><UserCog size={15} />账号设置</button>
                  {currentUser.role === "admin" ? (
                    <button type="button" role="menuitem" onClick={() => { setUserManagerOpen(true); setUserMenuOpen(false); }}><Users size={15} />成员管理</button>
                  ) : null}
                  {currentUser.role === "admin" ? (
                    <button type="button" role="menuitem" onClick={() => { setAnnouncementOpen(true); setUserMenuOpen(false); }}><Megaphone size={15} />登录页公告</button>
                  ) : null}
                  <div className="user-menu-divider" />
                  <button className="user-menu-logout" type="button" role="menuitem" onClick={() => { setUserMenuOpen(false); onLogout(); }}><LogOut size={15} />退出登录</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {activeArea === "trash" ? (
          <TrashView
            assets={trashAssets}
            search={search}
            loading={trashLoading}
            busy={busy}
            onRestore={(asset) => void restoreTrashAsset(asset)}
            onPurge={(asset) => void purgeTrashAsset(asset)}
            onRestoreMany={(assets) => void restoreTrashAssets(assets)}
            onPurgeMany={(assets) => void purgeTrashAssets(assets)}
          />
        ) : activeArea === "library" ? (
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
        ) : activeArea === "home" ? (
          <HomeView
            projects={filteredProjects}
            search={search}
            loading={loading}
            onEnter={openProject}
            onNewProject={() => setCreateOpen(true)}
            onRename={(project) => { setEditingProject(project); setEditOpen(true); }}
            onDelete={(project) => void deleteProject(project)}
          />
        ) : loading && !workspace ? (
          <div className="loading-state"><LoaderCircle className="spin" size={22} /> 正在整理素材库…</div>
        ) : workspace ? (
          <>
            <nav className="surface-tabs" aria-label="项目视图">
              <button type="button" className={surface === "preview" ? "active" : ""} onClick={() => setSurface("preview")}><SlidersHorizontal size={16} />维度预览</button>
              <button type="button" className={surface === "board" ? "active" : ""} onClick={() => setSurface("board")}><ImagePlus size={16} />自由画板</button>
              <button type="button" className={surface === "assets" ? "active" : ""} onClick={() => setSurface("assets")}><LayoutGrid size={16} />素材库</button>
            </nav>

            {surface === "assets" ? <><div className="content-toolbar">
              <div><h2>项目素材</h2><p>{search || projectTagFilter.length ? `找到 ${filteredAssets.length} 项` : "按维度整理与比较你的视觉参考"}</p></div>
              <div className="content-toolbar-actions">
                <button className="tag-manager-open-button" type="button" onClick={() => setProjectTagManagerOpen(true)}><Tags size={14} />标签管理</button>
                <div className="view-toggle" aria-label="显示方式">
                  <button type="button" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="网格显示"><LayoutGrid size={16} /></button>
                  <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="列表显示"><List size={17} /></button>
                </div>
              </div>
            </div>

            <div className="library-filter-bar project-tag-filter">
              <TagFilterBar
                tags={projectTags}
                selected={projectTagFilter}
                label="标签"
                onToggle={(tag) => setProjectTagFilter((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
              />
            </div>

            {filteredAssets.length ? (
              <div className={`asset-collection ${view === "list" ? "asset-list" : "asset-grid"}`}>
                {filteredAssets.map((asset, index) => (
                  <button className="asset-card" type="button" key={asset.id} onClick={() => setSelectedAssetId(asset.id)}>
                    <span className="asset-image-wrap">
                      {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" loading={index > 3 ? "lazy" : "eager"} /> : <span className="asset-fallback"><ImageIcon /></span>}
                      <span className="asset-index">{String(index + 1).padStart(2, "0")}</span>
                    </span>
                    <span className="asset-meta"><strong>{asset.name}</strong><span className="tag-row">{asset.tags.map((tag) => <i key={tag}>{tag}</i>)}</span></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state"><Grid2X2 size={25} /><h3>{search || projectTagFilter.length ? "没有匹配的素材" : "项目还是空的"}</h3><p>{search || projectTagFilter.length ? "换一个关键词或标签试试。" : "拖入、粘贴或选择图片/视频开始。"}</p><button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload size={15} />上传素材</button></div>
            )}</> : surface === "preview" ? <DimensionPreview key={workspace.project.id} dimensions={workspace.dimensions} assets={workspace.assets} onSelectAsset={setSelectedAssetId} onUpdateAssetDimensions={savePreviewDimensionValues} onAddDimension={() => setDimensionOpen(true)} onEditDimension={(dimension) => setEditingDimensionId(dimension.id)} /> : <BoardView key={workspace.project.id} projectId={workspace.project.id} assets={workspace.assets} onMessage={setMessage} onSelectAsset={setSelectedAssetId} />}
          </>
        ) : (
          <div className="empty-state project-empty"><Archive size={28} /><h2>建立第一个项目</h2><p>项目用于保存独立的素材集合与分类维度。</p><button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><Plus size={16} /> 新建项目</button></div>
        )}
      </section>

      {activeArea === "project" && selectedAsset && workspace ? (
        <aside className="asset-drawer" aria-label="素材详情">
          <div className="asset-detail-stage" role="button" tabIndex={0} aria-label="关闭素材详情" onClick={() => void closeAssetDetail()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void closeAssetDetail(); } }}>
            {(() => {
              const isVideo = isVideoMime(selectedAsset.mimeType);
              if (isVideo) {
                const status = videoStatusOf(selectedAsset.mimeType, selectedAsset.transcodeStatus);
                if (status === "ready" && selectedAsset.originalUrl) {
                  return <span className="drawer-image-frame" onClick={(event) => event.stopPropagation()}><video key={selectedAsset.originalUrl} className="drawer-image" src={selectedAsset.originalUrl} controls playsInline onClick={(event) => event.stopPropagation()} /></span>;
                }
                return (
                  <span className="drawer-image-fallback" onClick={(event) => event.stopPropagation()}>
                    {status === "failed"
                      ? <><AlertTriangle size={30} /><small>转码失败，原文件已保留</small><button className="secondary-button" type="button" onClick={(event) => { event.stopPropagation(); void retranscodeVideo(selectedAsset); }}><RotateCcw size={13} />重新转码</button></>
                      : <><LoaderCircle className="spin" size={30} /><small>视频转码中…</small></>}
                  </span>
                );
              }
              return detailImage ? <span className="drawer-image-frame"><img key={detailImage} className="drawer-image" src={detailImage} alt={selectedAsset.name} onClick={(event) => event.stopPropagation()} /></span> : <span className="drawer-image-fallback" onClick={(event) => event.stopPropagation()}><ImageIcon size={40} /></span>;
            })()}
          </div>
          <div className="drawer-panel">
            <div className="drawer-heading"><div><p className="eyebrow">ASSET DETAIL</p><h2>素材详情</h2></div><button className="icon-button" type="button" onClick={() => void closeAssetDetail()} aria-label="关闭素材详情"><X size={18} /></button></div>
            <div className="drawer-scroll">
              <div className="drawer-file"><small>文件名</small><span>{selectedAsset.fileName}</span></div>
              {selectedAsset.createdByName ? <div className="drawer-file"><small>上传者</small><span>{selectedAsset.createdByName}</span></div> : null}
              {selectedAsset.width || selectedAsset.fileSize || isVideoMime(selectedAsset.mimeType) ? (
                <div className="drawer-facts">
                  <span>{isVideoMime(selectedAsset.mimeType)
                    ? (videoStatusOf(selectedAsset.mimeType, selectedAsset.transcodeStatus) === "ready" ? formatDuration(selectedAsset.duration) : "转码中")
                    : selectedAsset.width && selectedAsset.height ? `${selectedAsset.width} × ${selectedAsset.height}` : "尺寸未知"}</span>
                  <span>{selectedAsset.fileSize ? `${(selectedAsset.fileSize / 1024 / 1024).toFixed(2)} MB` : "演示素材"}</span>
                  <span>{selectedAsset.mimeType || "image"}</span>
                </div>
              ) : null}
              <AssetImageReplacement
                asset={selectedAsset}
                busy={busy}
                onBusyChange={setBusy}
                onComplete={async () => { await Promise.all([loadWorkspace(workspace.project.id), loadLibrary()]); }}
                onMessage={setMessage}
              />
              <AssetMetadataEditor
                ref={metadataEditorRef}
                asset={selectedAsset}
                busy={busy}
                availableTags={availableTags}
                aiTagBusy={aiTagBusy}
                onAiTag={() => void runAiTag(selectedAsset)}
                onSave={(update) => saveAssetMetadata(selectedAsset, update)}
              />
              <div className="drawer-section-title"><Settings2 size={16} /><strong>维度位置</strong></div>
              {workspace.dimensions.length ? <DimensionControlsEditor
                ref={dimensionEditorRef}
                dimensions={workspace.dimensions}
                values={selectedAsset.dimensionValues}
                assetId={selectedAsset.id}
                busy={busy}
                onChangeValue={setLocalDimensionValue}
                onSaveValue={saveDimensionValue}
              /> : <p className="drawer-empty">先为项目添加维度，再给素材定位。</p>}
              <button className="drawer-remove" type="button" onClick={() => void removeAssetFromProject(selectedAsset)}><Trash2 size={14} />从当前项目移除</button>
            </div>
          </div>
        </aside>
      ) : null}

      {createOpen ? <Modal title="新建项目" description="为一组视觉探索建立独立空间。" onClose={() => setCreateOpen(false)}><form className="modal-form" onSubmit={createProject}><label>项目名称<input name="name" required maxLength={50} placeholder="例如：2026 产品视觉方向" /></label><label>项目说明<textarea name="description" maxLength={240} rows={3} placeholder="这组素材要解决什么问题？" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "创建中…" : "创建项目"}</button></div></form></Modal> : null}

      {editOpen && editingProject ? <Modal title="项目设置" description="修改项目名称和用途说明。" onClose={() => { setEditOpen(false); setEditingProject(null); }}><form className="modal-form" onSubmit={editProject}><label>项目名称<input name="name" required maxLength={50} defaultValue={editingProject.name} /></label><label>项目说明<textarea name="description" maxLength={240} rows={3} defaultValue={editingProject.description} /></label><div className="danger-zone"><button type="button" onClick={() => void deleteProject()} disabled={busy}><Trash2 size={15} /> 删除项目</button><span>素材原文件不会被删除</span></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => { setEditOpen(false); setEditingProject(null); }}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></div></form></Modal> : null}

      {dimensionOpen && workspace ? <Modal title="添加分类维度" description="项目维度数量不限；进入预览后再选择最多 3 个坐标轴。" onClose={() => setDimensionOpen(false)}><form className="modal-form" onSubmit={addDimension}><div className="dimension-form-row"><label>左端名称<input name="leftLabel" required maxLength={24} placeholder="例如：克制" /></label><span>—</span><label>右端名称<input name="rightLabel" required maxLength={24} placeholder="例如：张扬" /></label></div><p className="form-hint">添加后，项目内已有素材会先放在维度中点。</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDimensionOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "添加中…" : "添加维度"}</button></div></form></Modal> : null}

      {workspace ? (() => { const editingDimension = workspace.dimensions.find((dimension) => dimension.id === editingDimensionId); return editingDimension
        ? <DimensionEditorModal
            key={editingDimension.id}
            dimension={editingDimension}
            busy={busy}
            onClose={() => setEditingDimensionId(null)}
            onApplyLabels={applyDimensionLabels}
            onDelete={(dimension) => {
              setEditingDimensionId(null);
              const fullDimension = workspace.dimensions.find((entry) => entry.id === dimension.id);
              if (fullDimension) scheduleDimensionDeletion(fullDimension);
            }}
          />
        : null; })() : null}

      {activeArea === "project" && uploadFile && workspace ? <UploadModal file={uploadFile} projectId={workspace.project.id} dimensions={workspace.dimensions} onClose={() => setUploadFile(null)} onComplete={async () => { await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id), loadLibrary()]); }} onMessage={setMessage} /> : null}

      {tagManagerOpen ? (
        <TagManager
          isAdmin={currentUser.role === "admin"}
          onClose={() => setTagManagerOpen(false)}
          onChanged={() => { void loadLibrary(); void loadTagDict(); }}
        />
      ) : null}

      {projectTagManagerOpen && workspace ? (
        <TagManager
          mode="project"
          projectTags={projectTags}
          onClose={() => setProjectTagManagerOpen(false)}
          onChanged={() => { void loadWorkspace(workspace.project.id); void loadLibrary(); void loadTagDict(); }}
        />
      ) : null}

      {accountOpen ? (
        <AccountSettingsModal
          user={currentUser}
          onClose={() => setAccountOpen(false)}
          onUserChange={(next) => { setCurrentUser(next); }}
        />
      ) : null}

      {userManagerOpen ? (
        <UserManagerModal
          meId={currentUser.id}
          onClose={() => setUserManagerOpen(false)}
          onChanged={() => { void loadProjects(); void loadLibrary(); void loadTrash(true); }}
        />
      ) : null}

      {announcementOpen ? (
        <AnnouncementModal onClose={() => setAnnouncementOpen(false)} />
      ) : null}

      {message ? <div className="toast" role="status">{message}</div> : null}
      {pendingDeletion ? (
        <DeletionToast
          label={`维度“${pendingDeletion.dimension.leftLabel} — ${pendingDeletion.dimension.rightLabel}”`}
          seconds={pendingDeletion.seconds}
          onUndo={() => { setPendingDeletion(null); setMessage("已撤销删除"); }}
        />
      ) : null}
    </main>
  );
}
