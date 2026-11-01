"use client";

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Grid2X2,
  ImageIcon,
  LayoutGrid,
  List,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./api";
import { formatDuration, isVideoMime, transcodePercent, useTranscodePolling, videoStatusOf } from "./assetMedia";
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
import { DimensionPages, type PreviewPage } from "./DimensionPages";
import { mergePreviewPage, useDimensionSync } from "./sync/dimensionSync";
import { HomeView } from "./HomeView";
import { TagFilterBar } from "./TagFilterBar";
import { TagManager, type TagEntry } from "./TagManager";
import { TokenSettingsModal } from "./TokenSettingsModal";
import { TrashView, type TrashedAsset } from "./TrashView";
import { UploadModal } from "./UploadModal";
import { UserManagerModal } from "./UserManagerModal";
import { BrandMark } from "./components/layout/BrandMark";
import { SidebarNavItem } from "./components/layout/SidebarNavItem";
import { TopbarTabs } from "./components/layout/TopbarTabs";
import { TopbarTitle } from "./components/layout/TopbarTitle";
import { UserMenu } from "./components/layout/UserMenu";
import { AssetCard } from "./components/library/AssetCard";
import { ViewToggle } from "./components/library/ViewToggle";
import { Button, EmptyState, Field, IconButton, Input, Modal, SearchInput, Spinner, Textarea, Toast, cn } from "./ui";
import { VisualComponentsPage } from "./design/VisualComponentsPage";
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
  transcodeProgress: number;
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
  | { token: string; kind: "dimension"; projectId: string; pageId: string; dimension: Dimension; seconds: number };

export function ArtDatabaseApp({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [trashAssets, setTrashAssets] = useState<TrashedAsset[]>([]);
  const [activeArea, setActiveArea] = useState<"home" | "library" | "project" | "trash" | "components">("home");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [previewPage, setPreviewPage] = useState<PreviewPage | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const currentPreviewPage = previewPage?.projectId === workspace?.project.id ? previewPage : null;

  // ---- 维度坐标同步：本地先定稿，后台按坐标合并提交；失败保留本地并标红 ----
  const dimSync = useDimensionSync({
    projectId: workspace?.project.id ?? "",
    pageId: currentPreviewPage?.id ?? "",
    onApplied: (applied) => {
      if (!applied.length) return;
      setPreviewPage((current) => {
        if (!current) return current;
        const assets = current.assets.map((asset) => {
          const hits = applied.filter((entry) => entry.assetId === asset.assetId);
          if (!hits.length) return asset;
          const dimensionValues = { ...asset.dimensionValues };
          const valueRevs = { ...(asset.valueRevs ?? {}) };
          for (const hit of hits) {
            dimensionValues[hit.dimensionId] = hit.value;
            if (typeof hit.lastRev === "number") valueRevs[hit.dimensionId] = hit.lastRev;
          }
          return { ...asset, dimensionValues, valueRevs };
        });
        return { ...current, assets };
      });
    },
    onDrop: (keys) => {
      if (!keys.length) return;
      const dropped = new Set(keys);
      setPreviewPage((current) => {
        if (!current) return current;
        const assets = current.assets.map((asset) => {
          const dimensionValues = { ...asset.dimensionValues };
          let changed = false;
          for (const dimensionId of Object.keys(dimensionValues)) {
            if (dropped.has(`${asset.assetId}|${dimensionId}`)) { delete dimensionValues[dimensionId]; changed = true; }
          }
          return changed ? { ...asset, dimensionValues } : asset;
        });
        return { ...current, assets };
      });
    },
    onRevision: (revision) => setPreviewPage((current) => current ? { ...current, revision: Math.max(current.revision ?? 0, revision) } : current),
  });

  /** 服务器返回的预览页：未同步坐标保留本地，其余按版本合并。 */
  function receivePreviewPage(next: PreviewPage) {
    setPreviewPage((current) => current && current.id === next.id ? mergePreviewPage(next, current, dimSync.isPending) : next);
  }

  // 打开 Page 时恢复上次没传完的坐标草稿，并立即补传。
  useEffect(() => {
    if (!currentPreviewPage?.id) return;
    const draft = dimSync.restoreDraft();
    if (!draft.length) return;
    setPreviewPage((current) => {
      if (!current || current.id !== currentPreviewPage.id) return current;
      const assets = current.assets.map((asset) => {
        const hits = draft.filter((entry) => entry.assetId === asset.assetId);
        if (!hits.length) return asset;
        const dimensionValues = { ...asset.dimensionValues };
        for (const hit of hits) dimensionValues[hit.dimensionId] = hit.value;
        return { ...asset, dimensionValues };
      });
      return { ...current, assets };
    });
    void dimSync.flush();
  }, [currentPreviewPage?.id]);
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [tokenSettingsOpen, setTokenSettingsOpen] = useState(false);
  const [userManagerOpen, setUserManagerOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<SessionUser>(user);
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

  async function loadWorkspace(projectId: string, quiet = false) {
    if (!projectId) {
      setWorkspace(null);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const data = await apiFetch<Workspace>(`/api/workspace?projectId=${encodeURIComponent(projectId)}`);
      setWorkspace(data);
      setSelectedAssetId((current) =>
        current && data.assets.some((asset) => asset.id === current) ? current : null,
      );
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : "项目载入失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function loadLibrary(quiet = false) {
    if (!quiet) setLibraryLoading(true);
    try {
      const data = await apiFetch<{ assets: LibraryAsset[] }>("/api/library");
      setLibraryAssets(data.assets);
    } finally {
      if (!quiet) setLibraryLoading(false);
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

  // 素材可能由其他标签页/窗口（如 Chrome 采集扩展）新增：
  // 切回本页时静默刷新当前视图，新保存的素材立即可见（不做定时轮询）。
  // 刷新时禁止列表 loading 闪烁，素材详情打开时不打扰（关闭时自会保存刷新）。
  const autoRefreshStateRef = useRef({ activeArea, workspace, selectedAssetId });
  autoRefreshStateRef.current = { activeArea, workspace, selectedAssetId };
  const lastAutoRefreshAt = useRef(Date.now());

  useEffect(() => {
    const run = () => {
      // 防抖：visibilitychange 与 focus 常成对触发；页面刚加载 500ms 内的初始 focus 也跳过
      if (Date.now() - lastAutoRefreshAt.current < 500) return;
      lastAutoRefreshAt.current = Date.now();
      const state = autoRefreshStateRef.current;
      if (state.selectedAssetId) return; // 详情打开中不打扰
      if (state.activeArea === "project") {
        if (state.workspace?.project.id) void loadWorkspace(state.workspace.project.id, true);
      } else if (state.activeArea === "library") {
        void loadLibrary(true);
      } else if (state.activeArea === "home") {
        void loadProjects();
      } else if (state.activeArea === "trash") {
        void loadTrash(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    const onFocus = () => run();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
    // 监听只注册一次，回调经 ref 读取最新状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      void commitDimensionDeletion(pending.projectId, pending.pageId, pending.dimension);
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

  // 有视频在转码时每 2 秒刷新工作区，驱动"转码中 X%"进度
  useTranscodePolling(activeArea === "project" ? workspace?.assets : [], () => {
    if (workspace) void loadWorkspace(workspace.project.id);
  });

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

  const selectedProjectAsset = workspace?.assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const selectedPageAsset = surface === "preview" ? currentPreviewPage?.assets.find((asset) => asset.assetId === selectedAssetId) : null;
  const selectedAsset = selectedProjectAsset ? { ...selectedProjectAsset, dimensionValues: selectedPageAsset?.dimensionValues ?? {} } : null;
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
    if (!workspace || !currentPreviewPage) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await apiFetch("/api/preview-dimensions", {
        method: "POST",
        body: JSON.stringify({
          projectId: workspace.project.id,
          pageId: currentPreviewPage.id,
          leftLabel: form.get("leftLabel"),
          rightLabel: form.get("rightLabel"),
        }),
      });
      await loadProjects(workspace.project.id);
      setPreviewRevision((v) => v + 1);
      setDimensionOpen(false);
      setMessage("维度已添加，现有素材已置于中点");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  function scheduleDimensionDeletion(dimension: Dimension) {
    if (!workspace || !currentPreviewPage) return;
    if (pendingDeletion) {
      setMessage("请先撤销或等待当前删除完成");
      return;
    }
    setMessage(null);
    setPendingDeletion({
      token: `${dimension.id}-${Date.now()}`,
      kind: "dimension",
      projectId: workspace.project.id,
      pageId: currentPreviewPage.id,
      dimension,
      seconds: 5,
    });
  }

  async function commitDimensionDeletion(projectId: string, pageId: string, dimension: Dimension) {
    setBusy(true);
    try {
      await apiFetch(
        `/api/preview-dimensions?id=${encodeURIComponent(dimension.id)}&projectId=${encodeURIComponent(projectId)}&pageId=${encodeURIComponent(pageId)}`,
        { method: "DELETE" },
      );
      await loadProjects();
      setPreviewPage((current) => current?.id === pageId ? {
        ...current,
        selectedIds: current.selectedIds.filter((id) => id !== dimension.id),
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
    setPreviewPage((current) => current?.id === currentPreviewPage?.id && current ? {
      ...current,
      assets: current.assets.map((asset) => asset.assetId === assetId ? {
        ...asset,
        dimensionValues: { ...asset.dimensionValues, [dimensionId]: value },
      } : asset),
    } : current);
  }

  async function saveDimensionValue(assetId: string, dimensionId: string, value: number) {
    if (!workspace || !currentPreviewPage) return;
    // 本地已经通过 onChangeValue 更新过了：这里只入队，由同步器合并提交、失败重试。
    dimSync.setValue(assetId, dimensionId, value);
  }

  async function applyDimensionLabels(updates: Array<{ id: string; leftLabel: string; rightLabel: string }>) {
    if (!workspace || !currentPreviewPage || !updates.length) return;
    setBusy(true);
    try {
      await apiFetch("/api/preview-dimensions", {
        method: "PATCH",
        body: JSON.stringify({ projectId: workspace.project.id, pageId: currentPreviewPage.id, dimensions: updates }),
      });
      const updateMap = new Map(updates.map((entry) => [entry.id, entry]));
      setPreviewPage((current) => current?.id === currentPreviewPage.id ? {
        ...current,
        dimensions: current.dimensions.map((dimension) => {
          const update = updateMap.get(dimension.id);
          return update ? { ...dimension, leftLabel: update.leftLabel, rightLabel: update.rightLabel } : dimension;
        }),
      } : current);
      setMessage("维度名称已在当前 Page 更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "维度名称修改失败");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function savePreviewDimensionValues(assetId: string, values: Record<string, number>): Promise<boolean> {
    if (!workspace || !currentPreviewPage) return false;
    setPreviewPage((current) => current?.id === currentPreviewPage.id ? {
      ...current,
      assets: current.assets.map((asset) => asset.assetId === assetId
        ? { ...asset, dimensionValues: { ...asset.dimensionValues, ...values } }
        : asset),
    } : current);
    // 乐观合并后立即返回：坐标进队列，由同步器合并提交、失败重试，不再回滚整页。
    for (const [dimensionId, value] of Object.entries(values)) dimSync.setValue(assetId, dimensionId, value);
    return true;
  }

  function acceptUpload(file?: File) {
    if (activeArea !== "project") return; // 上传只发生在项目内
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/tiff", "image/heic", "image/heif", "image/avif"].includes(file.type)) {
      setMessage("仅支持 JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC/AVIF 图片或 mp4/mov/webm/mkv 等视频");
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
        <aside className={cn("sidebar", sidebarOpen && "sidebar-open")}>
          <div className="flex items-center gap-2.5 border-b border-ink-soft px-[7px] pb-[23px]">
            <BrandMark />
            <div className="min-w-0">
              <strong className="block truncate text-md font-semibold">Art Database</strong>
              <span className="mt-0.5 block truncate text-xs text-white/60">视觉素材工作台</span>
            </div>
            <IconButton
              label="隐藏导航栏"
              className="ml-auto text-white/70 hover:bg-ink-hover hover:text-white"
              onClick={() => {
                setSidebarOpen(false);
                setSidebarCollapsed(true);
              }}
            >
              <PanelLeftClose size={17} aria-hidden />
            </IconButton>
          </div>

          <nav className="mt-4 flex flex-col gap-1" aria-label="主导航">
            <SidebarNavItem
              icon={<Archive size={16} aria-hidden />}
              title="项目"
              subtitle={`${projects.length} 个独立空间`}
              active={activeArea === "home"}
              onClick={() => {
                setActiveArea("home");
                setSelectedAssetId(null);
                setSidebarOpen(false);
                void loadProjects();
              }}
            />
            <SidebarNavItem
              icon={<Grid2X2 size={16} aria-hidden />}
              title="全部素材"
              subtitle={`${libraryAssets.length} 个数据库素材`}
              active={activeArea === "library"}
              onClick={() => {
                setActiveArea("library");
                setSelectedAssetId(null);
                setSidebarOpen(false);
                void loadLibrary();
              }}
            />
            <SidebarNavItem
              icon={<Tags size={16} aria-hidden />}
              title="标签管理"
              subtitle="词库与标签维护"
              onClick={() => {
                setSidebarOpen(false);
                setTagManagerOpen(true);
              }}
            />
          </nav>

          <div className="mt-6 flex items-center justify-between px-2.5 pb-2 pt-1 text-2xs uppercase tracking-[.12em] text-white/50">
            <span>项目</span>
            <span>{projects.length}</span>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-2.5 flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-white/25 text-sm text-white/70 transition-colors hover:border-white/40 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Plus size={17} aria-hidden /> 新建项目
          </button>

          <SidebarNavItem
            className="mt-auto"
            icon={<Trash2 size={16} aria-hidden />}
            title="回收站"
            subtitle={`${trashAssets.length} 个已删除素材`}
            active={activeArea === "trash"}
            onClick={() => {
              setActiveArea("trash");
              setSelectedAssetId(null);
              setSidebarOpen(false);
              void loadTrash();
            }}
          />
        </aside>
      ) : null}

      <section
        className={`workspace ${activeArea === "project" && surface === "preview" ? "preview-active" : activeArea === "project" && surface === "board" ? "board-active" : ""}`}
        onDragOver={(event) => { if (activeArea === "project" && Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setDragActive(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); acceptUpload(event.dataTransfer.files[0]); }}
      >
        <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/tiff,image/heic,image/heif,image/avif,video/mp4,video/webm,video/quicktime,video/x-msvideo,video/x-matroska,video/mpeg,video/3gpp,video/3gpp2" onChange={(event) => { acceptUpload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        {dragActive ? (
          <div className="pointer-events-none fixed bottom-[22px] left-[294px] right-[22px] top-[78px] z-overlay flex flex-col items-center justify-center gap-2 border-2 border-dashed border-accent bg-paper/95 text-accent max-md:left-[22px]">
            <Upload size={28} aria-hidden />
            <strong className="text-md font-semibold">松开即可添加图片</strong>
            <span className="text-sm">填写素材信息后上传，再手动加入维度 Page</span>
          </div>
        ) : null}
        <header className="topbar">
          <div className="topbar-leading">
            {activeArea === "project" ? (
              <Button variant="secondary" icon={<ArrowLeft size={17} aria-hidden />} onClick={returnHome} className="flex-none">
                返回主页
              </Button>
            ) : (
              <IconButton
                label="展开导航栏"
                className={sidebarCollapsed ? "" : "hidden max-md:inline-grid"}
                onClick={() => {
                  setSidebarCollapsed(false);
                  setSidebarOpen(true);
                }}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden /> : <Menu size={19} aria-hidden />}
              </IconButton>
            )}

            {activeArea === "project" && workspace ? (
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <h1 className="truncate text-lg font-semibold tracking-[-.01em] text-ink">{workspace.project.name}</h1>
                  <IconButton
                    size="sm"
                    label="编辑项目"
                    className="flex-none"
                    onClick={() => {
                      setEditingProject(workspace.project);
                      setEditOpen(true);
                    }}
                  >
                    <Pencil size={14} aria-hidden />
                  </IconButton>
                </div>
                <div className="flex min-w-0 items-center gap-2 max-sm:hidden">
                  <span className="truncate text-sm text-muted">{workspace.project.description || "还没有项目说明"}</span>
                  <span className="flex-none rounded-full bg-surface-sunken px-2 py-0.5 text-sm text-muted">{workspace.assets.length} 素材</span>
                </div>
              </div>
            ) : activeArea === "home" ? (
              <TopbarTitle title="项目" count={filteredProjects.length} />
            ) : activeArea === "library" ? (
              <TopbarTitle title="全部素材" count={libraryAssets.length} />
            ) : activeArea === "trash" ? (
              <TopbarTitle title="回收站" count={trashAssets.length} />
            ) : activeArea === "components" ? (
              <div className="flex min-w-0 flex-col gap-1">
                <TopbarTitle title="视觉组件" />
                <span className="truncate text-sm text-muted">产品样式与交互模式</span>
              </div>
            ) : null}

            {activeArea === "project" && workspace ? <TopbarTabs value={surface} onChange={setSurface} /> : null}
          </div>

          <div className="topbar-actions">
            {activeArea === "library" ? (
              <Button variant="secondary" size="sm" icon={<Tags size={14} aria-hidden />} onClick={() => setTagManagerOpen(true)}>
                标签管理
              </Button>
            ) : null}
            {activeArea !== "components" ? (
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder={activeArea === "home" ? "搜索项目名称或说明" : "搜索名称、文件或标签"}
                aria-label={activeArea === "home" ? "搜索项目" : "搜索素材"}
                className="w-[min(205px,27.5vw)] max-sm:w-auto max-sm:flex-1"
              />
            ) : null}
            {activeArea === "project" && workspace ? (
              <Button variant="primary" size="lg" icon={<Upload size={15} aria-hidden />} onClick={() => fileInputRef.current?.click()}>
                上传素材
              </Button>
            ) : null}
            <UserMenu
              displayName={currentUser.displayName}
              role={currentUser.role}
              onAction={(action) => {
                if (action === "account") setAccountOpen(true);
                else if (action === "tokens") setTokenSettingsOpen(true);
                else if (action === "members") setUserManagerOpen(true);
                else if (action === "announcement") setAnnouncementOpen(true);
                else if (action === "components") {
                  setActiveArea("components");
                  setSelectedAssetId(null);
                  setSidebarOpen(false);
                } else if (action === "logout") onLogout();
              }}
            />
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
        ) : activeArea === "components" ? (
          <VisualComponentsPage />
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
          <div className="flex min-h-[65vh] items-center justify-center gap-2 text-md text-muted">
            <Spinner size={22} />
            正在整理素材库…
          </div>
        ) : workspace ? (
          <>
            {surface === "assets" ? <><div className="mx-[42px] flex items-end justify-between gap-6 pb-[18px] pt-[34px] max-md:mx-6">
              <div>
                <h2 className="m-0 text-lg font-semibold text-ink">项目素材</h2>
                <p className="mt-1 text-sm text-muted">{search || projectTagFilter.length ? `找到 ${filteredAssets.length} 项` : "按维度整理与比较你的视觉参考"}</p>
              </div>
              <div className="flex items-center gap-2.5">
                <Button variant="secondary" size="sm" icon={<Tags size={14} aria-hidden />} onClick={() => setProjectTagManagerOpen(true)}>标签管理</Button>
                <ViewToggle value={view} onChange={setView} />
              </div>
            </div>

            <div className="mx-[42px] mb-[18px] mt-0 border border-line bg-surface px-3.5 py-3 max-md:mx-6">
              <TagFilterBar
                tags={projectTags}
                selected={projectTagFilter}
                label="标签"
                onToggle={(tag) => setProjectTagFilter((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
              />
            </div>

            {filteredAssets.length ? (
              <div className={cn("asset-collection", view === "list" ? "asset-list" : "asset-grid")}>
                {filteredAssets.map((asset, index) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    index={index}
                    variant={view}
                    thumbnailLoading={index > 3 ? "lazy" : "eager"}
                    onOpen={() => setSelectedAssetId(asset.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Grid2X2 size={25} aria-hidden />}
                title={search || projectTagFilter.length ? "没有匹配的素材" : "项目还是空的"}
                description={search || projectTagFilter.length ? "换一个关键词或标签试试。" : "拖入、粘贴或选择图片/视频开始。"}
                className="mx-[42px] max-md:mx-6"
                action={
                  <Button variant="primary" icon={<Upload size={15} aria-hidden />} onClick={() => fileInputRef.current?.click()}>
                    上传素材
                  </Button>
                }
              />
            )}</> : surface === "preview" ? <DimensionPages key={workspace.project.id} projectId={workspace.project.id} assets={workspace.assets} page={currentPreviewPage} onPageChange={setPreviewPage} onReceivePage={receivePreviewPage} revision={previewRevision} syncStatus={dimSync.status} onRetrySync={dimSync.retry} onMessage={setMessage} onSelectAsset={setSelectedAssetId} onUpdateAssetDimensions={savePreviewDimensionValues} onAddDimension={() => setDimensionOpen(true)} onEditDimension={(dimension) => setEditingDimensionId(dimension.id)} /> : <BoardView key={workspace.project.id} projectId={workspace.project.id} assets={workspace.assets} onMessage={setMessage} onSelectAsset={setSelectedAssetId} />}
          </>
        ) : (
          <EmptyState
            icon={<Archive size={28} aria-hidden />}
            title="建立第一个项目"
            description="项目用于保存独立的素材集合与分类维度。"
            className="mx-[42px] max-md:mx-6"
            action={
              <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => setCreateOpen(true)}>
                新建项目
              </Button>
            }
          />
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
                      ? <><AlertTriangle size={30} /><small>转码失败，原文件已保留</small><Button size="sm" icon={<RotateCcw size={13} aria-hidden />} onClick={(event) => { event.stopPropagation(); void retranscodeVideo(selectedAsset); }}>重新转码</Button></>
                      : <><Spinner size={30} /><small>视频转码中 {transcodePercent(selectedAsset.transcodeProgress)}%</small><span className="drawer-progress"><span style={{ width: `${transcodePercent(selectedAsset.transcodeProgress)}%` }} /></span></>}
                  </span>
                );
              }
              return detailImage ? <span className="drawer-image-frame"><img key={detailImage} className="drawer-image" src={detailImage} alt={selectedAsset.name} onClick={(event) => event.stopPropagation()} /></span> : <span className="drawer-image-fallback" onClick={(event) => event.stopPropagation()}><ImageIcon size={40} /></span>;
            })()}
          </div>
          <div className="drawer-panel">
            <div className="drawer-heading"><div><p className="mb-1 text-2xs font-bold uppercase tracking-[.15em] text-accent">ASSET DETAIL</p><h2>素材详情</h2></div><IconButton label="关闭素材详情" onClick={() => void closeAssetDetail()}><X size={18} aria-hidden /></IconButton></div>
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
              {selectedPageAsset && currentPreviewPage ? (
                <>
                  <div className="mb-2 mt-4 flex items-center gap-2 text-sm">
                    <Settings2 size={16} aria-hidden />
                    <strong>{currentPreviewPage.name} · 维度位置</strong>
                  </div>
                  {currentPreviewPage.dimensions.length ? (
                    <DimensionControlsEditor
                      ref={dimensionEditorRef}
                      dimensions={currentPreviewPage.dimensions}
                      values={selectedAsset.dimensionValues}
                      assetId={selectedAsset.id}
                      busy={busy}
                      onChangeValue={setLocalDimensionValue}
                      onSaveValue={saveDimensionValue}
                    />
                  ) : (
                    <p className="text-sm text-muted">先为当前 Page 添加维度，再给素材定位。</p>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    className="mt-4 w-full"
                    icon={<Trash2 size={14} aria-hidden />}
                    onClick={async () => {
                      if (await metadataEditorRef.current?.save() === false) return;
                      try {
                        await apiFetch(`/api/preview-page-assets?projectId=${encodeURIComponent(workspace.project.id)}&pageId=${encodeURIComponent(currentPreviewPage.id)}&assetId=${encodeURIComponent(selectedAsset.id)}`, { method: "DELETE" });
                        setSelectedAssetId(null);
                        setPreviewRevision((v) => v + 1);
                        setMessage("已从当前 Page 移除，项目素材保留");
                      } catch (error) { setMessage(error instanceof Error ? error.message : "移除失败"); }
                    }}
                  >
                    从当前 Page 移除
                  </Button>
                </>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-4 w-full"
                  icon={<Trash2 size={14} aria-hidden />}
                  onClick={() => void removeAssetFromProject(selectedAsset)}
                >
                  从当前项目移除
                </Button>
              )}
            </div>
          </div>
        </aside>
      ) : null}

      {createOpen ? (
        <Modal
          open
          onClose={() => setCreateOpen(false)}
          eyebrow="PROJECT"
          title="新建项目"
          description="为一组视觉探索建立独立空间。"
          footer={
            <>
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" form="create-project-form" variant="primary" loading={busy}>
                {busy ? "创建中…" : "创建项目"}
              </Button>
            </>
          }
        >
          <form id="create-project-form" className="flex flex-col gap-4" onSubmit={createProject}>
            <Field label="项目名称" required htmlFor="create-project-name">
              <Input id="create-project-name" name="name" required maxLength={50} placeholder="例如：2026 产品视觉方向" />
            </Field>
            <Field label="项目说明" htmlFor="create-project-description">
              <Textarea id="create-project-description" name="description" maxLength={240} rows={3} placeholder="这组素材要解决什么问题？" />
            </Field>
          </form>
        </Modal>
      ) : null}

      {editOpen && editingProject ? (
        <Modal
          open
          onClose={() => { setEditOpen(false); setEditingProject(null); }}
          eyebrow="PROJECT"
          title="项目设置"
          description="修改项目名称和用途说明。"
          footer={
            <>
              <Button onClick={() => { setEditOpen(false); setEditingProject(null); }}>取消</Button>
              <Button type="submit" form="edit-project-form" variant="primary" loading={busy}>
                {busy ? "保存中…" : "保存修改"}
              </Button>
            </>
          }
        >
          <form id="edit-project-form" className="flex flex-col gap-4" onSubmit={editProject}>
            <Field label="项目名称" required htmlFor="edit-project-name">
              <Input id="edit-project-name" name="name" required maxLength={50} defaultValue={editingProject.name} />
            </Field>
            <Field label="项目说明" htmlFor="edit-project-description">
              <Textarea id="edit-project-description" name="description" maxLength={240} rows={3} defaultValue={editingProject.description} />
            </Field>
            <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pt-3">
              <Button variant="danger" size="sm" icon={<Trash2 size={15} aria-hidden />} onClick={() => void deleteProject()} disabled={busy}>
                删除项目
              </Button>
              <span className="text-xs text-muted">素材原文件不会被删除</span>
            </div>
          </form>
        </Modal>
      ) : null}

      {dimensionOpen && currentPreviewPage ? (
        <Modal
          open
          onClose={() => setDimensionOpen(false)}
          eyebrow="DIMENSION"
          title="添加分类维度"
          description="维度仅属于当前 Page，最多同时选择 3 个坐标轴。"
          footer={
            <>
              <Button onClick={() => setDimensionOpen(false)}>取消</Button>
              <Button type="submit" form="add-dimension-form" variant="primary" loading={busy}>
                {busy ? "添加中…" : "添加维度"}
              </Button>
            </>
          }
        >
          <form id="add-dimension-form" className="flex flex-col gap-4" onSubmit={addDimension}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <Field label="左端名称" required htmlFor="dimension-left">
                <Input id="dimension-left" name="leftLabel" required maxLength={24} placeholder="例如：克制" />
              </Field>
              <span className="hidden pb-2 text-center text-muted sm:block">—</span>
              <Field label="右端名称" required htmlFor="dimension-right">
                <Input id="dimension-right" name="rightLabel" required maxLength={24} placeholder="例如：张扬" />
              </Field>
            </div>
            <p className="m-0 text-xs text-muted">添加后，当前 Page 内的素材会先放在新维度中点。</p>
          </form>
        </Modal>
      ) : null}

      {currentPreviewPage ? (() => { const editingDimension = currentPreviewPage.dimensions.find((dimension) => dimension.id === editingDimensionId); return editingDimension
        ? <DimensionEditorModal
            key={editingDimension.id}
            dimension={editingDimension}
            busy={busy}
            onClose={() => setEditingDimensionId(null)}
            onApplyLabels={applyDimensionLabels}
            onDelete={(dimension) => {
              setEditingDimensionId(null);
              const fullDimension = currentPreviewPage.dimensions.find((entry) => entry.id === dimension.id);
              if (fullDimension) scheduleDimensionDeletion(fullDimension);
            }}
          />
        : null; })() : null}

      {activeArea === "project" && uploadFile && workspace ? <UploadModal file={uploadFile} projectId={workspace.project.id} onClose={() => setUploadFile(null)} onComplete={async () => { await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id), loadLibrary()]); }} onMessage={setMessage} /> : null}

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

      {tokenSettingsOpen ? (
        <TokenSettingsModal onClose={() => setTokenSettingsOpen(false)} />
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

      {message ? <Toast open>{message}</Toast> : null}
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
