"use client";

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FolderInput,
  Grid2X2,
  ImageIcon,
  LayoutGrid,
  List,
  ListChecks,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Star,
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
import { AiDimensionDialog } from "./AiDimensionDialog";
import { useAiDimensionTag } from "./useAiDimensionTag";
import { AllAssetsView, type LibraryAsset } from "./AllAssetsView";
import { AnnouncementBanner } from "./components/layout/AnnouncementBanner";
import { AnnouncementModal } from "./AnnouncementModal";
import { AnnouncementViewerModal } from "./AnnouncementViewerModal";
import { ArchivedProjectsView } from "./ArchivedProjectsView";
import { AssetMetadataEditor, type AssetMetadataEditorHandle, type AssetMetadataUpdate } from "./AssetMetadataEditor";
import { AssetImageReplacement } from "./AssetImageReplacement";
import { BoardView } from "./BoardView";
import { DeletionToast } from "./DeletionToast";
import { DimensionControlsEditor, type DimensionControlsEditorHandle } from "./DimensionControlsEditor";
import { DimensionEditorModal } from "./DimensionEditorModal";
import { DimensionPages, type PageDimension, type PreviewPage } from "./DimensionPages";
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
import { ImportFromLibraryModal } from "./components/library/ImportFromLibraryModal";
import { ViewToggle } from "./components/library/ViewToggle";
import { Button, EmptyState, Field, IconButton, Input, Modal, SearchInput, Spinner, Tabs, Textarea, Toast, cn } from "./ui";
import { VisualComponentsPage } from "./design/VisualComponentsPage";
import { useProgressiveImage } from "./useProgressiveImage";

type Project = {
  id: string;
  name: string;
  description: string;
  assetCount: number;
  dimensionCount: number;
  archivedAt?: string | null;
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
  /** 项目内收藏：每个项目独立维护 */
  favorite: boolean;
  dimensionValues: Record<string, number>;
};

type Workspace = {
  project: Project;
  dimensions: Dimension[];
  assets: Asset[];
};

type PendingDeletion =
  | {
      token: string; kind: "dimension"; projectId: string; pageId: string;
      dimension: PageDimension; index: number;
      dimensionValues: Record<string, number>; selectedIds: string[];
      seconds: number;
    }
  /** 彻底删除素材（回收站单个/批量）：立即从回收站隐藏，5 秒后才提交服务端删除。 */
  | { token: string; kind: "trash"; assets: TrashedAsset[]; seconds: number }
  /** 删除项目：立即从列表隐藏，5 秒后才提交服务端删除。 */
  | { token: string; kind: "project"; project: Project; index: number; seconds: number };

type Announcement = { text: string; enabled: boolean; updatedAt?: string | null };

/** 公告版本指纹：管理员改内容或重新保存后，之前关闭过公告的浏览器应再次看到。 */
function announcementDismissKey(announcement: Announcement): string {
  const source = `${announcement.updatedAt || ""}|${announcement.text}`;
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
  }
  return `artdatabase:announcement:dismissed:${(hash >>> 0).toString(36)}`;
}

/** 撤销窗口内服务端快照仍带着待删除维度：合并前先剥掉，避免刷新把维度带回来。 */
function withoutDimension(page: PreviewPage, dimensionId: string): PreviewPage {
  return {
    ...page,
    selectedIds: page.selectedIds.filter((id) => id !== dimensionId),
    dimensions: page.dimensions.filter((dimension) => dimension.id !== dimensionId),
    assets: page.assets.map((asset) => {
      if (!(dimensionId in asset.dimensionValues)) return asset;
      const dimensionValues = { ...asset.dimensionValues };
      delete dimensionValues[dimensionId];
      return { ...asset, dimensionValues };
    }),
  };
}

export function ArtDatabaseApp({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  // 游客：只读浏览全部项目内容；界面隐藏所有写入口，服务端也会拒绝非 GET 请求
  const readOnly = user.role === "guest";
  const [projects, setProjects] = useState<Project[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [trashAssets, setTrashAssets] = useState<TrashedAsset[]>([]);
  const [activeArea, setActiveArea] = useState<"home" | "library" | "project" | "trash" | "archived" | "components">("home");
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
    // 删除撤销窗口内服务端还没删掉这些维度：合并前剥掉，避免刷新把维度带回来
    let incoming = next;
    for (const dimensionId of pendingDimensionDeletions.current.get(next.id) ?? []) {
      incoming = withoutDimension(incoming, dimensionId);
    }
    setPreviewPage((current) => current && current.id === incoming.id ? mergePreviewPage(incoming, current, dimSync.isPending) : incoming);
  }

  // 打开 Page 时恢复上次没传完的坐标草稿，并立即补传。
  useEffect(() => {
    if (readOnly || !currentPreviewPage?.id) return;
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
  }, [currentPreviewPage?.id, readOnly]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  // 详情左右切换顺序：维度预览传 1D 全量 / 2D·3D 堆内顺序，项目素材库传当前筛选结果顺序；
  // 自由画板等其他入口保持为 null，不显示箭头。
  const [detailNav, setDetailNav] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [surface, setSurface] = useState<"assets" | "preview" | "board">("preview");
  const [projectAssetCategory, setProjectAssetCategory] = useState<"all" | "favorites">("all");
  // 项目素材库批量选择（从当前项目移除）：选择态只影响项目素材列表，不改变全局素材
  const [projectSelectMode, setProjectSelectMode] = useState(false);
  const [projectSelectedIds, setProjectSelectedIds] = useState<string[]>([]);
  const projectCheckAllRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  // 索引按当前导航顺序实时计算，导航过期时自动不显示
  const detailNavigation = detailNav;
  const detailNavIndex = detailNavigation && selectedAssetId ? detailNavigation.indexOf(selectedAssetId) : -1;
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
  const [aiDimensionTarget, setAiDimensionTarget] = useState<Asset | null>(null);
  const [aiDimensionBusyAssetId, setAiDimensionBusyAssetId] = useState<string | null>(null);
  const [aiBatchDialogAssets, setAiBatchDialogAssets] = useState<Asset[] | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [projectTagManagerOpen, setProjectTagManagerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tokenSettingsOpen, setTokenSettingsOpen] = useState(false);
  const [userManagerOpen, setUserManagerOpen] = useState(false);
  // 公告面板：登录页公告（login）与站内全局公告（global）是两份独立设置，按入口分别打开
  const [announcementPanel, setAnnouncementPanel] = useState<null | { scope: "login" | "global"; readOnly: boolean }>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const [currentUser, setCurrentUser] = useState<SessionUser>(user);

  const aiBatch = useAiDimensionTag({
    projectId: workspace?.project.id ?? "",
    pageId: currentPreviewPage?.id ?? "",
    enabled: !readOnly && Boolean(currentPreviewPage?.id),
    flush: dimSync.flush,
    hasPending: dimSync.hasPending,
    onMessage: setMessage,
    onApplied: (assetId, updates, revision) => {
      const fresh = updates.filter((update) => !dimSync.isPending(`${assetId}|${update.dimensionId}`));
      if (!fresh.length) return;
      setPreviewPage((current) => {
        if (!current) return current;
        return {
          ...current,
          revision: Math.max(current.revision ?? 0, revision),
          assets: current.assets.map((asset) => {
            if (asset.assetId !== assetId) return asset;
            const dimensionValues = { ...asset.dimensionValues };
            const valueRevs = { ...(asset.valueRevs ?? {}) };
            for (const update of fresh) {
              dimensionValues[update.dimensionId] = update.value;
              valueRevs[update.dimensionId] = update.lastRev;
            }
            return { ...asset, dimensionValues, valueRevs };
          }),
        };
      });
    },
  });

  const lockedAssetIds = useMemo(() => {
    const ids = new Set(aiBatch.inFlight);
    if (aiDimensionBusyAssetId) ids.add(aiDimensionBusyAssetId);
    return [...ids];
  }, [aiBatch.inFlight, aiDimensionBusyAssetId]);
  const lockedAssetIdsRef = useRef<string[]>([]);
  lockedAssetIdsRef.current = lockedAssetIds;

  const batchAiAssets = useMemo(() => {
    if (!currentPreviewPage || !workspace) return [];
    const byId = new Map(workspace.assets.map((asset) => [asset.id, asset]));
    const result: Asset[] = [];
    for (const entry of currentPreviewPage.assets) {
      const asset = byId.get(entry.assetId);
      if (asset) result.push({ ...asset, dimensionValues: entry.dimensionValues });
    }
    return result;
  }, [currentPreviewPage, workspace]);

  function openBatchAiDialog() {
    if (readOnly || aiBatch.active || aiDimensionBusyAssetId || !currentPreviewPage) return;
    setAiBatchDialogAssets(batchAiAssets);
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const metadataEditorRef = useRef<AssetMetadataEditorHandle>(null);
  const dimensionEditorRef = useRef<DimensionControlsEditorHandle>(null);
  // 正在等待撤销窗口结束的删除任务：token → timer，用于取消或组件卸载时清理
  const deletionTimers = useRef(new Map<string, number>());
  // 已本地移除、但服务端删除还没提交的维度（pageId → dimensionIds）：刷新合并时先剥掉
  const pendingDimensionDeletions = useRef(new Map<string, Set<string>>());
  // 等待撤销窗口的回收站素材 / 项目：刷新列表时先过滤，避免 5 秒内又出现在界面上
  const pendingTrashIds = useRef(new Set<string>());
  const pendingProjectIds = useRef(new Set<string>());
  const availableTags = useMemo(
    () => tagDict.filter((tag) => tag.usageCount > 0).map((tag) => tag.name).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [tagDict],
  );
  const projectTags = useMemo(
    () => [...new Set((workspace?.assets ?? []).flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [workspace],
  );

  async function loadProjects(preferredId?: string) {
    const data = await apiFetch<{ projects: Project[] }>("/api/projects?includeArchived=1");
    const visible = data.projects.filter((project) => !pendingProjectIds.current.has(project.id));
    const active = visible.filter((project) => !project.archivedAt);
    setProjects(visible);
    setSelectedProjectId((current) => {
      const next = preferredId || current;
      return active.some((project) => project.id === next)
        ? next
        : active[0]?.id || "";
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
      // favorite 在 SQLite 里是 0/1，统一转成布尔值供界面使用
      const next: Workspace = { ...data, assets: data.assets.map((asset) => ({ ...asset, favorite: Boolean(asset.favorite) })) };
      setWorkspace(next);
      setSelectedAssetId((current) =>
        current && next.assets.some((asset) => asset.id === current) ? current : null,
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
      setTrashAssets(data.assets.filter((asset) => !pendingTrashIds.current.has(asset.id)));
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

  async function refreshAnnouncement() {
    try {
      // 站内只读全局公告；登录页公告单独一份，不进入站内状态
      const data = await apiFetch<Announcement>("/api/announcement?scope=global");
      let dismissed = false;
      try {
        dismissed = window.localStorage.getItem(announcementDismissKey(data)) === "1";
      } catch {
        dismissed = false;
      }
      // 同一次更新里写入公告与关闭状态，避免已关闭公告的浏览器先闪一下再消失
      setAnnouncement(data);
      setAnnouncementDismissed(dismissed);
    } catch {
      // 公告读取失败不阻塞页面
    }
  }

  useEffect(() => {
    // 初始读取全局公告
    void refreshAnnouncement();
    // 切回标签/窗口聚焦时刷新，管理员刚发布的公告无需手动刷新页面
    const refresh = () => { if (document.visibilityState === "visible") void refreshAnnouncement(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!announcement) {
      setAnnouncementDismissed(false);
      return;
    }
    try {
      setAnnouncementDismissed(window.localStorage.getItem(announcementDismissKey(announcement)) === "1");
    } catch {
      setAnnouncementDismissed(false);
    }
  }, [announcement]);

  function dismissAnnouncement() {
    if (!announcement) return;
    try {
      window.localStorage.setItem(announcementDismissKey(announcement), "1");
    } catch {
      // 隐私模式/禁用存储时只在本次会话隐藏
    }
    setAnnouncementDismissed(true);
  }

  function openAnnouncementPanel(scope: "login" | "global") {
    setAnnouncementPanel({ scope, readOnly: currentUser.role !== "admin" });
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
    if (saved !== false) {
      setSelectedAssetId(null);
      setDetailNav(null);
    }
  }

  /** 维度预览打开素材详情：同时记下左右切换顺序，供详情页箭头使用。 */
  function openPreviewAsset(assetId: string, navigation?: string[] | null) {
    setDetailNav(navigation && navigation.length ? navigation : null);
    setSelectedAssetId(assetId);
  }

  /** 项目素材库打开详情：按当前筛选结果（含收藏分类）记录左右切换顺序。 */
  function openLibraryAsset(assetId: string) {
    setDetailNav(filteredAssets.map((asset) => asset.id));
    setSelectedAssetId(assetId);
  }

  /** 详情页左右箭头：先保存当前素材的未提交修改，再切换到相邻素材。 */
  async function switchDetailAsset(offset: -1 | 1) {
    if (!detailNavigation || detailNavIndex < 0) return;
    const nextId = detailNavigation[detailNavIndex + offset];
    if (!nextId) return;
    if (await metadataEditorRef.current?.save() === false) return;
    setSelectedAssetId(nextId);
  }

  useEffect(() => () => {
    for (const timer of deletionTimers.current.values()) window.clearTimeout(timer);
    deletionTimers.current.clear();
  }, []);

  /** 排队 5 秒后的服务端提交；到点先收起撤销条，再执行提交（维度删除失败会回滚本地）。 */
  function startDeletionTimer(token: string, commit: () => void) {
    const timer = window.setTimeout(() => {
      deletionTimers.current.delete(token);
      setPendingDeletion((current) => current?.token === token ? null : current);
      commit();
    }, 5000);
    deletionTimers.current.set(token, timer);
  }

  function cancelDeletionTimer(token: string) {
    const timer = deletionTimers.current.get(token);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    deletionTimers.current.delete(token);
  }

  // 删除已即时生效，这里只负责撤销条倒计时；5 秒后的服务端提交由 startDeletionTimer 排队，
  // 倒计时被打断（撤销）时按 token 取消对应提交。
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

  useEffect(() => {
    if (readOnly) return;
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((candidate) => candidate.type.startsWith("image/"));
      if (file && activeArea === "project" && !selectedAssetId) setUploadFile(file);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeArea, selectedAssetId, readOnly]);

  const filteredAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return (workspace?.assets ?? []).filter((asset) => {
      if (projectAssetCategory === "favorites" && !asset.favorite) return false;
      const matchesTags = projectTagFilter.length === 0 || projectTagFilter.some((tag) => asset.tags.includes(tag));
      const matchesKeyword = !keyword || [asset.name, asset.fileName, ...asset.tags].some((text) => text.toLowerCase().includes(keyword));
      return matchesTags && matchesKeyword;
    });
  }, [search, workspace, projectTagFilter, projectAssetCategory]);
  const favoriteAssetCount = useMemo(
    () => (workspace?.assets ?? []).filter((asset) => asset.favorite).length,
    [workspace],
  );
  // 批量选择：全选只作用于当前筛选结果，选中项在素材列表变化时自动清理
  const allProjectAssetsSelected = filteredAssets.length > 0 && filteredAssets.every((asset) => projectSelectedIds.includes(asset.id));
  const someProjectAssetsSelected = projectSelectedIds.length > 0 && !allProjectAssetsSelected;
  useEffect(() => {
    const existing = new Set((workspace?.assets ?? []).map((asset) => asset.id));
    setProjectSelectedIds((current) => {
      const next = current.filter((id) => existing.has(id));
      return next.length === current.length ? current : next;
    });
  }, [workspace?.assets]);
  useEffect(() => {
    if (projectSelectMode && projectCheckAllRef.current) projectCheckAllRef.current.indeterminate = someProjectAssetsSelected;
  }, [projectSelectMode, someProjectAssetsSelected]);
  useEffect(() => {
    if (surface === "assets") return;
    // 离开素材库分类时退出选择模式，避免在预览/画板里留下隐藏的选中态
    setProjectSelectMode((current) => current ? false : current);
    setProjectSelectedIds((current) => current.length ? [] : current);
  }, [surface]);
  useEffect(() => {
    // 搜索词、标签筛选或收藏分类变化后，选中项可能已不可见：清空选择，避免误删看不见的素材
    setProjectSelectedIds((current) => current.length ? [] : current);
  }, [search, projectTagFilter, projectAssetCategory]);

  // 有视频在转码时每 2 秒刷新工作区，驱动"转码中 X%"进度
  useTranscodePolling(activeArea === "project" ? workspace?.assets : [], () => {
    if (workspace) void loadWorkspace(workspace.project.id);
  });

  const activeProjects = useMemo(() => projects.filter((project) => !project.archivedAt), [projects]);
  const filteredProjects = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return activeProjects.filter((project) =>
      !keyword || [project.name, project.description].some((text) => text.toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [activeProjects, search]);

  const archivedProjects = useMemo(() => projects.filter((project) => Boolean(project.archivedAt)), [projects]);
  const filteredArchivedProjects = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return archivedProjects.filter((project) =>
      !keyword || [project.name, project.description].some((text) => text.toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [archivedProjects, search]);

  /** 从主页进入项目：收起侧边栏，只保留项目工作区。 */
  function openProject(project: Project) {
    setActiveArea("project");
    setSelectedProjectId(project.id);
    setSelectedAssetId(null);
    setDetailNav(null);
    setProjectAssetCategory("all");
    setProjectSelectedIds([]);
    setProjectSelectMode(false);
    setImportOpen(false);
    setSidebarCollapsed(true);
    setSidebarOpen(false);
  }

  /** 从项目返回主页：恢复侧边导航并刷新项目列表。 */
  function returnHome() {
    setActiveArea("home");
    setSelectedAssetId(null);
    setDetailNav(null);
    setProjectSelectedIds([]);
    setProjectSelectMode(false);
    setImportOpen(false);
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

  /** 归档项目：从主页隐藏，进入“已归档项目”；不删除任何素材、维度或画板。 */
  async function archiveProject(project: Project) {
    setBusy(true);
    try {
      const data = await apiFetch<{ project: Project }>("/api/projects", {
        method: "PATCH",
        body: JSON.stringify({ id: project.id, name: project.name, description: project.description, archived: true }),
      });
      if (!data.project?.archivedAt) {
        throw new Error("归档状态未保存，请确认服务端已更新并重启后重试");
      }
      const archivedAt = data.project.archivedAt;
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, archivedAt } : entry));
      await loadProjects();
      setEditOpen(false);
      setEditingProject(null);
      if (workspace?.project.id === project.id) {
        setWorkspace(null);
        setSelectedProjectId("");
        setActiveArea("home");
      }
      setMessage("项目已归档，可在“已归档项目”中恢复或删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "归档失败");
    } finally {
      setBusy(false);
    }
  }

  /** 从“已归档项目”恢复：重新回到主页项目列表。 */
  async function unarchiveProject(project: Project) {
    setBusy(true);
    try {
      await apiFetch("/api/projects", {
        method: "PATCH",
        body: JSON.stringify({ id: project.id, name: project.name, description: project.description, archived: false }),
      });
      setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, archivedAt: null } : entry));
      await loadProjects();
      setMessage("项目已恢复");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  }

  /** 删除项目：立即从列表隐藏，5 秒撤销窗口结束后才提交服务端删除。 */
  function deleteProject(projectOverride?: Project) {
    const target = projectOverride ?? editingProject;
    if (!target) return;
    const index = projects.findIndex((project) => project.id === target.id);
    pendingProjectIds.current.add(target.id);
    setMessage(null);
    setProjects((current) => current.filter((project) => project.id !== target.id));
    setEditOpen(false);
    setEditingProject(null);
    if (workspace?.project.id === target.id) {
      setWorkspace(null);
      setSelectedProjectId("");
      setActiveArea("home");
    }
    const pending: Extract<PendingDeletion, { kind: "project" }> = {
      token: `project:${target.id}:${Date.now()}`,
      kind: "project",
      project: target,
      index: index >= 0 ? index : 0,
      seconds: 5,
    };
    setPendingDeletion(pending);
    startDeletionTimer(pending.token, () => { void commitProjectDeletion(pending); });
  }

  async function commitProjectDeletion(pending: Extract<PendingDeletion, { kind: "project" }>) {
    try {
      await apiFetch(`/api/projects?id=${encodeURIComponent(pending.project.id)}`, { method: "DELETE" });
      pendingProjectIds.current.delete(pending.project.id);
      await loadProjects();
      setMessage("项目已删除");
    } catch (error) {
      pendingProjectIds.current.delete(pending.project.id);
      setProjects((current) => {
        if (current.some((project) => project.id === pending.project.id)) return current;
        const next = [...current];
        next.splice(Math.min(pending.index, next.length), 0, pending.project);
        return next;
      });
      setMessage(error instanceof Error ? error.message : "删除项目失败");
    }
  }

  function undoProjectDeletion(pending: Extract<PendingDeletion, { kind: "project" }>) {
    cancelDeletionTimer(pending.token);
    pendingProjectIds.current.delete(pending.project.id);
    setProjects((current) => {
      if (current.some((project) => project.id === pending.project.id)) return current;
      const next = [...current];
      next.splice(Math.min(pending.index, next.length), 0, pending.project);
      return next;
    });
    setPendingDeletion((current) => current?.token === pending.token ? null : current);
    setMessage("已撤销删除");
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

  /** 立即从本地移除维度（含选中轴与所有坐标），服务端删除在 5 秒撤销窗口结束后提交。 */
  function removeDimensionLocally(pageId: string, dimensionId: string) {
    setPreviewPage((current) => current?.id === pageId ? {
      ...current,
      selectedIds: current.selectedIds.filter((id) => id !== dimensionId),
      dimensions: current.dimensions.filter((item) => item.id !== dimensionId),
      assets: current.assets.map((asset) => {
        if (!(dimensionId in asset.dimensionValues)) return asset;
        const dimensionValues = { ...asset.dimensionValues };
        delete dimensionValues[dimensionId];
        return { ...asset, dimensionValues };
      }),
    } : current);
  }

  function markPendingDimension(pageId: string, dimensionId: string) {
    const pending = pendingDimensionDeletions.current.get(pageId) ?? new Set<string>();
    pending.add(dimensionId);
    pendingDimensionDeletions.current.set(pageId, pending);
  }

  function unmarkPendingDimension(pageId: string, dimensionId: string) {
    const pending = pendingDimensionDeletions.current.get(pageId);
    if (!pending) return;
    pending.delete(dimensionId);
    if (!pending.size) pendingDimensionDeletions.current.delete(pageId);
  }

  /** 撤销或服务端删除失败时，把维度、选中顺序与全部坐标放回原位置。 */
  function restoreDimensionLocally(pending: Extract<PendingDeletion, { kind: "dimension" }>) {
    setPreviewPage((current) => {
      if (!current || current.id !== pending.pageId) return current;
      if (current.dimensions.some((item) => item.id === pending.dimension.id)) return current;
      const dimensions = [...current.dimensions];
      dimensions.splice(Math.min(pending.index, dimensions.length), 0, pending.dimension);
      const selectedIds = pending.selectedIds.filter((id) =>
        id === pending.dimension.id || dimensions.some((item) => item.id === id));
      return {
        ...current,
        dimensions,
        selectedIds,
        assets: current.assets.map((asset) => {
          const value = pending.dimensionValues[asset.assetId];
          return value === undefined
            ? asset
            : { ...asset, dimensionValues: { ...asset.dimensionValues, [pending.dimension.id]: value } };
        }),
      };
    });
  }

  function scheduleDimensionDeletion(dimension: PageDimension) {
    if (!workspace || !currentPreviewPage) return;
    const page = currentPreviewPage;
    const index = page.dimensions.findIndex((item) => item.id === dimension.id);
    if (index < 0) return;
    const dimensionValues: Record<string, number> = {};
    for (const asset of page.assets) dimensionValues[asset.assetId] = asset.dimensionValues[dimension.id] ?? 500;
    const pending: Extract<PendingDeletion, { kind: "dimension" }> = {
      token: `dimension:${dimension.id}:${Date.now()}`,
      kind: "dimension",
      projectId: workspace.project.id,
      pageId: page.id,
      dimension,
      index,
      dimensionValues,
      selectedIds: [...page.selectedIds],
      seconds: 5,
    };
    setMessage(null);
    removeDimensionLocally(page.id, dimension.id);
    markPendingDimension(page.id, dimension.id);
    setPendingDeletion(pending);
    startDeletionTimer(pending.token, () => { void commitDimensionDeletion(pending); });
  }

  async function commitDimensionDeletion(pending: Extract<PendingDeletion, { kind: "dimension" }>) {
    setBusy(true);
    try {
      await apiFetch(
        `/api/preview-dimensions?id=${encodeURIComponent(pending.dimension.id)}&projectId=${encodeURIComponent(pending.projectId)}&pageId=${encodeURIComponent(pending.pageId)}`,
        { method: "DELETE" },
      );
      await loadProjects();
      setMessage("维度已删除");
    } catch (error) {
      // 服务端仍在：把本地也恢复，避免刷新前后不一致
      restoreDimensionLocally(pending);
      setMessage(error instanceof Error ? `${error.message}（已恢复维度）` : "删除失败，已恢复维度");
    } finally {
      unmarkPendingDimension(pending.pageId, pending.dimension.id);
      setBusy(false);
    }
  }

  function undoDimensionDeletion(pending: Extract<PendingDeletion, { kind: "dimension" }>) {
    cancelDeletionTimer(pending.token);
    unmarkPendingDimension(pending.pageId, pending.dimension.id);
    restoreDimensionLocally(pending);
    setPendingDeletion((current) => current?.token === pending.token ? null : current);
    setMessage("已撤销删除");
  }

  /** 素材软删除已即时提交到回收站：可随时在回收站恢复，不再显示 5 秒倒计时。 */
  function handleAssetTrashed(asset: { id: string; name: string }) {
    setMessage(`已将“${asset.name}”移入回收站，可在回收站恢复`);
    void Promise.all([loadTrash(true), loadProjects()]);
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
    if (lockedAssetIdsRef.current.includes(assetId)) return;
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

  async function markOneAssetDimensions(
    target: Asset,
    options: { dimensionIds: string[]; mode: "all" | "zero" },
  ) {
    if (readOnly || !workspace || !currentPreviewPage) return;
    const projectId = workspace.project.id;
    const pageId = currentPreviewPage.id;
    setAiDimensionBusyAssetId(target.id);
    try {
      await dimSync.flush();
      if (dimSync.hasPending()) {
        setMessage("坐标正在保存，请稍后再试");
        return;
      }
      const data = await apiFetch<{
        updates?: Array<{ dimensionId: string; value: number; lastRev: number }>;
        skipped?: Array<{ dimensionId: string; reason: string }>;
        revision?: number;
      }>("/api/preview-pages/ai-dimensions/single", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          pageId,
          assetId: target.id,
          dimensionIds: options.dimensionIds,
          mode: options.mode,
        }),
      });
      const updates = data.updates ?? [];
      const revision = typeof data.revision === "number" ? data.revision : 0;
      if (updates.length) {
        setPreviewPage((current) => {
          if (!current || current.id !== pageId) return current;
          return {
            ...current,
            revision: Math.max(current.revision ?? 0, revision),
            assets: current.assets.map((asset) => {
              if (asset.assetId !== target.id) return asset;
              const dimensionValues = { ...asset.dimensionValues };
              const valueRevs = { ...(asset.valueRevs ?? {}) };
              for (const update of updates) {
                dimensionValues[update.dimensionId] = update.value;
                valueRevs[update.dimensionId] = update.lastRev;
              }
              return { ...asset, dimensionValues, valueRevs };
            }),
          };
        });
      }
      const skipped = data.skipped?.length ?? 0;
      const skippedText = skipped ? `，跳过 ${skipped} 个已修改项` : "";
      setMessage(updates.length
        ? `AI 已标记这张图的 ${updates.length} 个维度${skippedText}`
        : `AI 没有可应用的维度${skipped ? `（${skipped} 个已修改或已删除）` : ""}`);
    } catch (error) {
      setMessage(`AI 标记维度失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setAiDimensionBusyAssetId((current) => current === target.id ? null : current);
    }
  }

  async function savePreviewDimensionValues(assetId: string, values: Record<string, number>): Promise<boolean> {
    if (!workspace || !currentPreviewPage) return false;
    if (lockedAssetIdsRef.current.includes(assetId)) return false;
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
    if (readOnly) return; // 游客只读
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

  /** 项目内收藏：先本地生效，失败回滚；每个项目各存各的。 */
  async function toggleProjectFavorite(asset: Asset) {
    if (!workspace) return;
    const favorite = !asset.favorite;
    const projectId = workspace.project.id;
    const apply = (value: boolean) => setWorkspace((current) => current && current.project.id === projectId ? {
      ...current,
      assets: current.assets.map((item) => item.id === asset.id ? { ...item, favorite: value } : item),
    } : current);
    apply(favorite);
    try {
      await apiFetch("/api/project-assets", {
        method: "PATCH",
        body: JSON.stringify({ projectId, assetId: asset.id, favorite }),
      });
    } catch (error) {
      apply(!favorite);
      setMessage(error instanceof Error ? error.message : (favorite ? "收藏失败" : "取消收藏失败"));
    }
  }

  async function removeAssetFromProject(asset: Asset) {
    if (!workspace) return;
    try {
      await apiFetch(`/api/project-assets?projectId=${encodeURIComponent(workspace.project.id)}&assetId=${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      setSelectedAssetId(null);
      setDetailNav(null);
      await Promise.all([loadProjects(workspace.project.id), loadWorkspace(workspace.project.id)]);
      setMessage("素材已从当前项目移除，可在全部素材重新导入");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移除失败");
    }
  }

  function enterProjectSelectMode() {
    setProjectSelectedIds([]);
    setProjectSelectMode(true);
  }

  function exitProjectSelectMode() {
    setProjectSelectMode(false);
    setProjectSelectedIds([]);
  }

  function toggleProjectAssetSelection(assetId: string, checked: boolean) {
    setProjectSelectedIds((current) => checked
      ? (current.includes(assetId) ? current : [...current, assetId])
      : current.filter((id) => id !== assetId));
  }

  /** 全选/取消全选只作用于当前筛选结果（收藏分类、搜索词、标签筛选都会生效）。 */
  function toggleAllProjectAssets(checked: boolean) {
    setProjectSelectedIds((current) => {
      const visibleIds = filteredAssets.map((asset) => asset.id);
      if (checked) return [...new Set([...current, ...visibleIds])];
      return current.filter((id) => !visibleIds.includes(id));
    });
  }

  /** 批量从当前项目移除素材：只删除项目引用，全局素材保留。 */
  async function removeSelectedAssetsFromProject() {
    if (!workspace || !projectSelectedIds.length) return;
    const projectId = workspace.project.id;
    const ids = [...projectSelectedIds];
    setBusy(true);
    try {
      const results = await Promise.allSettled(ids.map((assetId) =>
        apiFetch(`/api/project-assets?projectId=${encodeURIComponent(projectId)}&assetId=${encodeURIComponent(assetId)}`, { method: "DELETE" }),
      ));
      const failedIds = ids.filter((_, index) => results[index]?.status === "rejected");
      const ok = ids.length - failedIds.length;
      try {
        await Promise.all([loadProjects(), loadWorkspace(projectId), loadLibrary(true)]);
      } catch {
        // 删除已生效；刷新失败不改变结果提示，下一次进入页面会重新拉取
      }
      if (failedIds.length) {
        // 失败项保留选中，方便直接重试
        setProjectSelectedIds(failedIds);
        setMessage(`已从当前项目移除 ${ok} 个素材，${failedIds.length} 个失败，可重试`);
      } else {
        setProjectSelectedIds([]);
        setProjectSelectMode(false);
        setMessage(`已从当前项目移除 ${ok} 个素材`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "批量移除失败");
    } finally {
      setBusy(false);
    }
  }

  /** 打开导入面板前先刷新全局素材，避免拿到过期的素材列表。 */
  async function openImportModal() {
    if (importLoading) return;
    setImportLoading(true);
    try {
      await loadLibrary(true);
      setImportOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "全部素材载入失败");
    } finally {
      setImportLoading(false);
    }
  }

  /** 从全部素材导入到当前项目素材库：逐个建立项目引用（不复制素材）。 */
  async function importAssetsFromLibrary(assetIds: string[]): Promise<number> {
    if (!workspace) throw new Error("项目尚未载入，请刷新后重试");
    const projectId = workspace.project.id;
    const results = await Promise.allSettled(assetIds.map((assetId) =>
      apiFetch("/api/project-assets", { method: "POST", body: JSON.stringify({ assetId, projectIds: [projectId] }) }),
    ));
    const ok = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - ok;
    await Promise.all([loadProjects(), loadWorkspace(projectId), loadLibrary(true)]);
    if (failed) throw new Error(`已导入 ${ok} 个素材，${failed} 个失败，请重试`);
    return ok;
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

  /** 永久删除：立即从回收站隐藏，5 秒撤销窗口结束后才提交服务端删除。 */
  function purgeTrashAssets(assetsToPurge: TrashedAsset[]) {
    if (!assetsToPurge.length) return;
    const ids = new Set(assetsToPurge.map((asset) => asset.id));
    for (const id of ids) pendingTrashIds.current.add(id);
    setMessage(null);
    setTrashAssets((current) => current.filter((asset) => !ids.has(asset.id)));
    const pending: Extract<PendingDeletion, { kind: "trash" }> = {
      token: `trash:${Date.now()}`,
      kind: "trash",
      assets: assetsToPurge,
      seconds: 5,
    };
    setPendingDeletion(pending);
    startDeletionTimer(pending.token, () => { void commitTrashPurge(pending); });
  }

  async function commitTrashPurge(pending: Extract<PendingDeletion, { kind: "trash" }>) {
    const results = await Promise.allSettled(pending.assets.map((asset) =>
      apiFetch(`/api/assets?id=${encodeURIComponent(asset.id)}&mode=permanent&force=true`, { method: "DELETE" }),
    ));
    const failed = pending.assets.filter((_, index) => results[index]?.status === "rejected");
    for (const asset of pending.assets) pendingTrashIds.current.delete(asset.id);
    await Promise.all([loadTrash(true), loadLibrary(), loadProjects()]);
    if (failed.length) {
      setTrashAssets((current) => [...failed, ...current.filter((asset) => !failed.some((item) => item.id === asset.id))]);
      setMessage(`已永久删除 ${pending.assets.length - failed.length} 个素材，${failed.length} 个失败`);
    } else {
      setMessage(pending.assets.length === 1 ? "素材已永久删除" : `已永久删除 ${pending.assets.length} 个素材`);
    }
  }

  function undoTrashPurge(pending: Extract<PendingDeletion, { kind: "trash" }>) {
    cancelDeletionTimer(pending.token);
    for (const asset of pending.assets) pendingTrashIds.current.delete(asset.id);
    setTrashAssets((current) => {
      const existing = new Set(current.map((asset) => asset.id));
      return [...pending.assets.filter((asset) => !existing.has(asset.id)), ...current];
    });
    setPendingDeletion((current) => current?.token === pending.token ? null : current);
    setMessage("已撤销删除");
  }

  function pendingDeletionLabel(pending: PendingDeletion): string {
    if (pending.kind === "dimension") return `维度“${pending.dimension.leftLabel} — ${pending.dimension.rightLabel}”`;
    if (pending.kind === "trash") {
      return pending.assets.length === 1 ? `素材“${pending.assets[0].name}”` : `回收站中的 ${pending.assets.length} 个素材`;
    }
    return `项目“${pending.project.name}”`;
  }

  function undoPendingDeletion(pending: PendingDeletion) {
    if (pending.kind === "dimension") undoDimensionDeletion(pending);
    else if (pending.kind === "trash") undoTrashPurge(pending);
    else undoProjectDeletion(pending);
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
              subtitle={`${activeProjects.length} 个独立空间`}
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
            {!readOnly ? (
              <SidebarNavItem
                icon={<Tags size={16} aria-hidden />}
                title="标签管理"
                subtitle="词库与标签维护"
                onClick={() => {
                  setSidebarOpen(false);
                  setTagManagerOpen(true);
                }}
              />
            ) : null}
          </nav>

          <div className="mt-6 flex items-center justify-between px-2.5 pb-2 pt-1 text-2xs uppercase tracking-[.12em] text-white/50">
            <span>项目</span>
            <span>{activeProjects.length}</span>
          </div>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-2.5 flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-white/25 text-sm text-white/70 transition-colors hover:border-white/40 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Plus size={17} aria-hidden /> 新建项目
            </button>
          ) : null}

          {!readOnly ? (
            <>
              <SidebarNavItem
                className="mt-auto"
                icon={<Archive size={16} aria-hidden />}
                title="已归档项目"
                subtitle={`${archivedProjects.length} 个已归档`}
                active={activeArea === "archived"}
                onClick={() => {
                  setActiveArea("archived");
                  setSelectedAssetId(null);
                  setSidebarOpen(false);
                  void loadProjects();
                }}
              />
              <SidebarNavItem
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
            </>
          ) : null}
        </aside>
      ) : null}

      <section
        className={`workspace ${activeArea === "project" && surface === "preview" ? "preview-active" : activeArea === "project" && surface === "board" ? "board-active" : ""}`}
        onDragOver={(event) => { if (!readOnly && activeArea === "project" && Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setDragActive(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
        onDrop={(event) => { event.preventDefault(); setDragActive(false); if (!readOnly) acceptUpload(event.dataTransfer.files[0]); }}
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
                  {!readOnly ? (
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
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-2 max-sm:hidden">
                  <span className="truncate text-sm text-muted">{workspace.project.description || "还没有项目说明"}</span>
                  <span className="flex-none rounded-full bg-surface-sunken px-2 py-0.5 text-sm text-muted">{workspace.assets.length} 素材</span>
                </div>
              </div>
            ) : activeArea === "home" ? (
              <TopbarTitle title="项目" count={filteredProjects.length} />
            ) : activeArea === "archived" ? (
              <TopbarTitle title="已归档项目" count={filteredArchivedProjects.length} />
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
            {activeArea === "library" && !readOnly ? (
              <Button variant="secondary" size="sm" icon={<Tags size={14} aria-hidden />} onClick={() => setTagManagerOpen(true)}>
                标签管理
              </Button>
            ) : null}
            {activeArea !== "components" ? (
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder={activeArea === "home" || activeArea === "archived" ? "搜索项目名称或说明" : "搜索名称、文件或标签"}
                aria-label={activeArea === "home" || activeArea === "archived" ? "搜索项目" : "搜索素材"}
                className="w-[min(205px,27.5vw)] max-sm:w-auto max-sm:flex-1"
              />
            ) : null}
            {activeArea === "project" && workspace && surface === "assets" && !readOnly ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<FolderInput size={14} aria-hidden />}
                loading={importLoading}
                onClick={() => void openImportModal()}
              >
                从全部素材导入
              </Button>
            ) : null}
            {activeArea === "project" && workspace && !readOnly ? (
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
                else if (action === "loginAnnouncement") openAnnouncementPanel("login");
                else if (action === "announcement") openAnnouncementPanel("global");
                else if (action === "components") {
                  setActiveArea("components");
                  setSelectedAssetId(null);
                  setSidebarOpen(false);
                } else if (action === "logout") onLogout();
              }}
            />
          </div>
        </header>

        {announcement?.enabled && announcement.text.trim() && !announcementDismissed ? (
          <AnnouncementBanner
            text={announcement.text}
            canEdit={currentUser.role === "admin"}
            onEdit={() => setAnnouncementPanel({ scope: "global", readOnly: false })}
            onDismiss={dismissAnnouncement}
          />
        ) : null}

        {activeArea === "archived" ? (
          <ArchivedProjectsView
            projects={filteredArchivedProjects}
            search={search}
            loading={loading}
            busy={busy}
            onRestore={(project) => void unarchiveProject(project)}
            onDelete={(project) => deleteProject(project)}
          />
        ) : activeArea === "trash" ? (
          <TrashView
            assets={trashAssets}
            search={search}
            loading={trashLoading}
            busy={busy}
            onRestore={(asset) => void restoreTrashAsset(asset)}
            onPurge={(asset) => purgeTrashAssets([asset])}
            onRestoreMany={(assets) => void restoreTrashAssets(assets)}
            onPurgeMany={(assets) => purgeTrashAssets(assets)}
          />
        ) : activeArea === "components" ? (
          <VisualComponentsPage />
        ) : activeArea === "library" ? (
          <AllAssetsView
            assets={libraryAssets}
            projects={activeProjects}
            search={search}
            view={view}
            loading={libraryLoading}
            onViewChange={setView}
            onRefresh={async () => { await Promise.all([loadLibrary(), loadProjects()]); }}
            onMessage={setMessage}
            onAssetTrashed={handleAssetTrashed}
            readOnly={readOnly}
          />
        ) : activeArea === "home" ? (
          <HomeView
            projects={filteredProjects}
            search={search}
            loading={loading}
            readOnly={readOnly}
            onEnter={openProject}
            onNewProject={() => setCreateOpen(true)}
            onRename={(project) => { setEditingProject(project); setEditOpen(true); }}
            onArchive={(project) => void archiveProject(project)}
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
                <p className="mt-1 text-sm text-muted">{search || projectTagFilter.length || projectAssetCategory === "favorites" ? `找到 ${filteredAssets.length} 项` : "按维度整理与比较你的视觉参考"}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                {projectSelectMode ? (
                  <>
                    <label className="flex flex-none cursor-pointer items-center gap-2 text-sm text-muted">
                      <input
                        ref={projectCheckAllRef}
                        type="checkbox"
                        checked={allProjectAssetsSelected}
                        disabled={busy || !filteredAssets.length}
                        onChange={(event) => toggleAllProjectAssets(event.target.checked)}
                        className="accent-sage"
                      />
                      全选
                    </label>
                    <span className="text-sm font-semibold text-success">已选 {projectSelectedIds.length} 项</span>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={13} aria-hidden />}
                      disabled={busy || !projectSelectedIds.length}
                      onClick={() => void removeSelectedAssetsFromProject()}
                    >
                      从当前项目移除
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={exitProjectSelectMode}>
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    {!readOnly && filteredAssets.length ? <Button variant="secondary" size="sm" icon={<ListChecks size={14} aria-hidden />} onClick={enterProjectSelectMode}>批量选择</Button> : null}
                    {!readOnly ? <Button variant="secondary" size="sm" icon={<Tags size={14} aria-hidden />} onClick={() => setProjectTagManagerOpen(true)}>标签管理</Button> : null}
                  </>
                )}
                <ViewToggle value={view} onChange={setView} />
              </div>
            </div>

            <div className="mx-[42px] mb-[18px] mt-0 border border-line bg-surface max-md:mx-6">
              <Tabs
                variant="underline"
                ariaLabel="素材分类"
                value={projectAssetCategory}
                onChange={setProjectAssetCategory}
                className="px-3.5"
                items={[
                  { value: "all", label: "全部素材", count: workspace.assets.length },
                  { value: "favorites", label: "收藏", icon: <Star size={13} aria-hidden />, count: favoriteAssetCount },
                ]}
              />
              <div className="px-3.5 py-3">
                <TagFilterBar
                  tags={projectTags}
                  selected={projectTagFilter}
                  label="标签"
                  onToggle={(tag) => setProjectTagFilter((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
                />
              </div>
            </div>

            {filteredAssets.length ? (
              <div className={cn("asset-collection", view === "list" ? "asset-list" : "asset-grid")}>
                {filteredAssets.map((asset, index) => {
                  const checked = projectSelectMode && projectSelectedIds.includes(asset.id);
                  return (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      variant={view}
                      selected={checked}
                      selectable={projectSelectMode}
                      checked={checked}
                      onCheckedChange={(next) => toggleProjectAssetSelection(asset.id, next)}
                      busy={busy}
                      favorite={!projectSelectMode && asset.favorite}
                      thumbnailLoading={index > 3 ? "lazy" : "eager"}
                      onOpen={() => projectSelectMode ? toggleProjectAssetSelection(asset.id, !checked) : openLibraryAsset(asset.id)}
                    />
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={projectAssetCategory === "favorites" ? <Star size={25} aria-hidden /> : <Grid2X2 size={25} aria-hidden />}
                title={search || projectTagFilter.length ? "没有匹配的素材" : projectAssetCategory === "favorites" ? "还没有收藏素材" : "项目还是空的"}
                description={search || projectTagFilter.length
                  ? "换一个关键词或标签试试。"
                  : projectAssetCategory === "favorites"
                    ? "在素材详情点“收藏”，素材会出现在这里。"
                    : readOnly ? "当前项目还没有素材。" : "拖入、粘贴或选择图片/视频开始，也可以从全部素材导入。"}
                className="mx-[42px] max-md:mx-6"
                action={readOnly ? undefined : (
                  <Button variant="primary" icon={<Upload size={15} aria-hidden />} onClick={() => fileInputRef.current?.click()}>
                    上传素材
                  </Button>
                )}
              />
            )}</> : surface === "preview" ? <DimensionPages key={workspace.project.id} projectId={workspace.project.id} assets={workspace.assets} page={currentPreviewPage} onPageChange={setPreviewPage} onReceivePage={receivePreviewPage} revision={previewRevision} syncStatus={dimSync.status} onRetrySync={dimSync.retry} onMessage={setMessage} onSelectAsset={openPreviewAsset} onUpdateAssetDimensions={savePreviewDimensionValues} onAddDimension={() => setDimensionOpen(true)} onEditDimension={(dimension) => setEditingDimensionId(dimension.id)} readOnly={readOnly} lockedAssetIds={lockedAssetIds} onOpenAiBatch={readOnly ? undefined : openBatchAiDialog} aiTag={aiBatch.active ? { status: aiBatch.status === "stopping" ? "stopping" : "running", done: aiBatch.job?.done ?? 0, total: aiBatch.job?.total ?? 0, timedOut: aiBatch.job?.timedOut ?? 0, canStop: aiBatch.canStop, stop: aiBatch.stop } : undefined} /> : <BoardView key={workspace.project.id} projectId={workspace.project.id} assets={workspace.assets} onMessage={setMessage} onSelectAsset={(assetId) => { setDetailNav(null); setSelectedAssetId(assetId); }} readOnly={readOnly} />}
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
            {detailNavIndex >= 0 && detailNavigation && detailNavigation.length > 1 ? (
              <>
                <button
                  type="button"
                  className="drawer-nav drawer-nav-prev"
                  aria-label="上一张"
                  title="上一张"
                  disabled={detailNavIndex <= 0}
                  onClick={(event) => { event.stopPropagation(); void switchDetailAsset(-1); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
                >
                  <ChevronLeft size={22} aria-hidden />
                </button>
                <button
                  type="button"
                  className="drawer-nav drawer-nav-next"
                  aria-label="下一张"
                  title="下一张"
                  disabled={detailNavIndex >= detailNavigation.length - 1}
                  onClick={(event) => { event.stopPropagation(); void switchDetailAsset(1); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
                >
                  <ChevronRight size={22} aria-hidden />
                </button>
              </>
            ) : null}
          </div>
          <div className="drawer-panel">
            <div className="drawer-heading">
              <div><p className="mb-1 text-2xs font-bold uppercase tracking-[.15em] text-accent">ASSET DETAIL</p><h2>素材详情</h2></div>
              <div className="flex items-center gap-1">
                {!readOnly ? (
                  <IconButton
                    label={selectedAsset.favorite ? "取消收藏" : "收藏"}
                    title={selectedAsset.favorite ? "取消收藏" : "收藏"}
                    className={selectedAsset.favorite ? "text-accent" : undefined}
                    onClick={() => void toggleProjectFavorite(selectedAsset)}
                  >
                    <Star size={18} aria-hidden fill={selectedAsset.favorite ? "currentColor" : "none"} />
                  </IconButton>
                ) : null}
                <IconButton label="关闭素材详情" onClick={() => void closeAssetDetail()}><X size={18} aria-hidden /></IconButton>
              </div>
            </div>
            <div key={selectedAsset.id} className="drawer-scroll">
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
              {!readOnly ? (
                <AssetImageReplacement
                  asset={selectedAsset}
                  busy={busy}
                  onBusyChange={setBusy}
                  onComplete={async () => { await Promise.all([loadWorkspace(workspace.project.id), loadLibrary()]); }}
                  onMessage={setMessage}
                />
              ) : null}
              <AssetMetadataEditor
                ref={metadataEditorRef}
                asset={selectedAsset}
                busy={busy}
                availableTags={availableTags}
                aiTagBusy={aiTagBusy}
                readOnly={readOnly}
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
                      readOnly={readOnly}
                      locked={lockedAssetIds.includes(selectedAsset.id)}
                      aiTagBusy={aiDimensionBusyAssetId === selectedAsset.id}
                      aiTagDisabled={aiBatch.active || lockedAssetIds.some((id) => id !== selectedAsset.id)}
                      onAiTag={!readOnly && (selectedAsset.mimeType ?? "").startsWith("image/")
                        ? () => setAiDimensionTarget(selectedAsset)
                        : undefined}
                      onChangeValue={setLocalDimensionValue}
                      onSaveValue={saveDimensionValue}
                    />
                  ) : (
                    <p className="text-sm text-muted">先为当前 Page 添加维度，再给素材定位。</p>
                  )}
                  {!readOnly ? (
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
                  ) : null}
                </>
              ) : null}
              {!readOnly && !(selectedPageAsset && currentPreviewPage) ? (
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-4 w-full"
                  icon={<Trash2 size={14} aria-hidden />}
                  onClick={() => void removeAssetFromProject(selectedAsset)}
                >
                  从当前项目移除
                </Button>
              ) : null}
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
              <Button variant="secondary" size="sm" icon={<Archive size={15} aria-hidden />} onClick={() => void archiveProject(editingProject)} disabled={busy}>
                归档项目
              </Button>
              <Button variant="danger" size="sm" icon={<Trash2 size={15} aria-hidden />} onClick={() => void deleteProject()} disabled={busy}>
                删除项目
              </Button>
              <span className="text-xs text-muted">归档不会删除内容；删除会清空项目数据，素材原文件不会被删除</span>
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

      {importOpen && workspace ? (
        <ImportFromLibraryModal
          projectName={workspace.project.name}
          assets={libraryAssets}
          existingIds={new Set(workspace.assets.map((asset) => asset.id))}
          onClose={() => setImportOpen(false)}
          onImport={importAssetsFromLibrary}
          onMessage={setMessage}
        />
      ) : null}

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

      {announcementPanel ? (
        announcementPanel.readOnly ? (
          <AnnouncementViewerModal onClose={() => setAnnouncementPanel(null)} />
        ) : (
          <AnnouncementModal
            scope={announcementPanel.scope}
            onClose={() => setAnnouncementPanel(null)}
            onSaved={() => { if (announcementPanel.scope === "global") void refreshAnnouncement(); }}
          />
        )
      ) : null}

      {aiDimensionTarget && currentPreviewPage ? (
        <AiDimensionDialog
          key={aiDimensionTarget.id}
          open
          dimensions={currentPreviewPage.dimensions}
          assets={[aiDimensionTarget]}
          busy={aiDimensionBusyAssetId !== null}
          onClose={() => { if (aiDimensionBusyAssetId === null) setAiDimensionTarget(null); }}
          onConfirm={(options) => {
            const target = aiDimensionTarget;
            if (!target || aiDimensionBusyAssetId !== null) return;
            setAiDimensionTarget(null);
            void markOneAssetDimensions(target, options);
          }}
        />
      ) : null}

      {aiBatchDialogAssets && currentPreviewPage ? (
        <AiDimensionDialog
          open
          dimensions={currentPreviewPage.dimensions}
          assets={aiBatchDialogAssets}
          busy={false}
          onClose={() => setAiBatchDialogAssets(null)}
          onConfirm={(options) => {
            setAiBatchDialogAssets(null);
            void aiBatch.start(options);
          }}
        />
      ) : null}

      {message ? <Toast open>{message}</Toast> : null}
      {pendingDeletion ? (
        <DeletionToast
          label={pendingDeletionLabel(pendingDeletion)}
          seconds={pendingDeletion.seconds}
          onUndo={() => undoPendingDeletion(pendingDeletion)}
        />
      ) : null}
    </main>
  );
}
