"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  ImageIcon,
  Images,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AssetMetadataEditor, type AssetMetadataEditorHandle, type AssetMetadataUpdate } from "./AssetMetadataEditor";
import { AssetImageReplacement } from "./AssetImageReplacement";
import { notifyUnauthorized } from "./api";
import { formatDuration, isVideoMime, transcodePercent, useTranscodePolling, videoStatusOf } from "./assetMedia";
import { TagFilterBar } from "./TagFilterBar";
import type { TagEntry } from "./TagManager";
import { useProgressiveImage } from "./useProgressiveImage";
import { AssetCard } from "./components/library/AssetCard";
import { AssetCardWidthControl, useAssetCardWidth } from "./components/library/AssetCardWidthControl";
import { AssetDetailInfoTrigger } from "./components/library/AssetDetailInfoTrigger";
import { Button, EmptyState, IconButton, InlineMessage, Modal, Spinner, cn } from "./ui";

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
  duration: number;
  transcodeStatus: string | null;
  transcodeProgress: number;
  createdAt: string;
  projects: Array<{ id: string; name: string }>;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 401) notifyUnauthorized();
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

export function AllAssetsView({
  assets,
  projects,
  search,
  loading,
  onRefresh,
  onMessage,
  onAssetTrashed,
  readOnly = false,
}: {
  assets: LibraryAsset[];
  projects: LibraryProject[];
  search: string;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
  /** 删除已生效后通知上层刷新回收站；软删除可随时在回收站恢复，不显示倒计时撤销。 */
  onAssetTrashed?: (asset: { id: string; name: string }) => void;
  /** 游客只读：隐藏替换/删除/AI/添加项目等写入口，Metadata 只读展示。 */
  readOnly?: boolean;
}) {
  const [cardWidth, setCardWidth] = useAssetCardWidth();
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  // 素材详情“i”信息卡的开关：打开时在面板内容上铺一层遮罩（scrim）
  const [assetInfoOpen, setAssetInfoOpen] = useState(false);
  // 全部素材库详情里左右切换的顺序：打开时按当前筛选结果快照，切换前先保存当前素材
  const [detailNav, setDetailNav] = useState<string[] | null>(null);
  const [assignAssetId, setAssignAssetId] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tagDict, setTagDict] = useState<TagEntry[]>([]);
  const [aiTagBusy, setAiTagBusy] = useState(false);
  const metadataEditorRef = useRef<AssetMetadataEditorHandle>(null);

  const globalTags = useMemo(
    () => [...new Set(assets.flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [assets],
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
  const detailNavIndex = detailNav && selectedAssetId ? detailNav.indexOf(selectedAssetId) : -1;
  const detailImage = useProgressiveImage(selectedAsset?.thumbnailUrl ?? null, selectedAsset?.originalUrl ?? null);
  const assignAsset = assets.find((asset) => asset.id === assignAssetId) ?? null;
  const assignedIds = new Set(assignAsset?.projects.map((project) => project.id) ?? []);

  // 有视频在转码时每 2 秒刷新列表，驱动"转码中 X%"进度
  useTranscodePolling(assets, onRefresh);

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
    if (saved !== false) {
      setSelectedAssetId(null);
      setDetailNav(null);
      setAssetInfoOpen(false);
    }
  }

  /** 打开详情：记录当前筛选结果顺序，供左右箭头切换素材。 */
  function openAssetDetail(assetId: string) {
    setDetailNav(filteredAssets.map((asset) => asset.id));
    setSelectedAssetId(assetId);
    setAssetInfoOpen(false);
  }

  /** 详情左右箭头：先保存当前素材的未提交修改，再切换到相邻素材。 */
  async function switchAsset(offset: -1 | 1) {
    if (!detailNav || detailNavIndex < 0) return;
    const nextId = detailNav[detailNavIndex + offset];
    if (!nextId) return;
    if (await metadataEditorRef.current?.save() === false) return;
    setError("");
    setSelectedAssetId(nextId);
    setAssetInfoOpen(false);
  }

  /** 转码失败后重新转码（原文件仍在，服务端置回 processing 并入队）。 */
  async function retranscodeVideo(asset: LibraryAsset) {
    setBusy(true);
    setError("");
    try {
      await request("/api/assets/retranscode", { method: "POST", body: JSON.stringify({ id: asset.id }) });
      await onRefresh();
      onMessage("已开始重新转码，完成后自动可播放");
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "重新转码失败");
    } finally {
      setBusy(false);
    }
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
      setDetailNav(null);
      setAssignAssetId(null);
      await onRefresh();
      onAssetTrashed?.({ id: asset.id, name: asset.name });
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
    return (
      <div className="flex min-h-[65vh] items-center justify-center gap-2 text-md text-muted">
        <Spinner size={22} />
        正在载入全部素材…
      </div>
    );
  }

  return (
    <>
      <div className="mx-[42px] mb-[18px] mt-[26px] flex items-start justify-between gap-[18px] border border-line bg-surface px-3.5 py-3 max-md:mx-6 max-sm:flex-col max-sm:items-stretch">
        <TagFilterBar
          tags={globalTags}
          selected={selectedTags}
          label="全局标签"
          onToggle={(tag) => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
        />
        <div className="flex flex-none items-center gap-2.5">
          {(search || selectedTags.length) ? <span className="text-xs text-muted">找到 {filteredAssets.length} 项</span> : null}
        </div>
      </div>

      <div className="mx-[42px] mb-[18px] flex items-center justify-end gap-2.5 max-md:mx-6">
        <AssetCardWidthControl value={cardWidth} onChange={setCardWidth} />
      </div>

      {filteredAssets.length ? (
        <div className="asset-collection library-collection asset-grid" style={{ "--asset-card-min": `${cardWidth}px` } as CSSProperties}>
          {filteredAssets.map((asset, index) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              roundedThumb
              thumbnailLoading={index > 7 ? "lazy" : "eager"}
              showProjectCount
              onOpen={() => openAssetDetail(asset.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Images size={28} aria-hidden />}
          title={search || selectedTags.length ? "没有匹配的素材" : "数据库里还没有素材"}
          description={search || selectedTags.length ? "换一个名称、文件、标签或项目关键词试试。" : "请先进入一个项目上传图片。"}
          className="mx-[42px] max-md:mx-6"
        />
      )}

      {selectedAsset ? (
        <aside className="asset-drawer" aria-label="全局素材详情">
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
                      ? <><AlertTriangle size={30} /><small>转码失败，原文件已保留</small>{!readOnly ? <Button size="sm" icon={<RotateCcw size={13} aria-hidden />} onClick={(event) => { event.stopPropagation(); void retranscodeVideo(selectedAsset); }}>重新转码</Button> : null}</>
                      : <><Spinner size={30} /><small>视频转码中 {transcodePercent(selectedAsset.transcodeProgress)}%</small><span className="drawer-progress"><span style={{ width: `${transcodePercent(selectedAsset.transcodeProgress)}%` }} /></span></>}
                  </span>
                );
              }
              return detailImage ? <span className="drawer-image-frame"><img key={detailImage} className="drawer-image" src={detailImage} alt={selectedAsset.name} onClick={(event) => event.stopPropagation()} /></span> : <span className="drawer-image-fallback" onClick={(event) => event.stopPropagation()}><ImageIcon size={40} /></span>;
            })()}
            {detailNavIndex >= 0 && detailNav && detailNav.length > 1 ? (
              <>
                <button
                  type="button"
                  className="drawer-nav drawer-nav-prev"
                  aria-label="上一张"
                  title="上一张"
                  disabled={detailNavIndex <= 0}
                  onClick={(event) => { event.stopPropagation(); void switchAsset(-1); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
                >
                  <ChevronLeft size={22} aria-hidden />
                </button>
                <button
                  type="button"
                  className="drawer-nav drawer-nav-next"
                  aria-label="下一张"
                  title="下一张"
                  disabled={detailNavIndex >= detailNav.length - 1}
                  onClick={(event) => { event.stopPropagation(); void switchAsset(1); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
                >
                  <ChevronRight size={22} aria-hidden />
                </button>
              </>
            ) : null}
          </div>
          <div className="drawer-panel">
            {assetInfoOpen ? <div className="asset-info-scrim" /> : null}
            <div className="drawer-heading"><div><p className="mb-1 text-2xs font-bold uppercase tracking-[.15em] text-accent">GLOBAL ASSET</p><h2>素材详情</h2></div><div className="flex items-center gap-1"><AssetDetailInfoTrigger asset={selectedAsset} open={assetInfoOpen} onOpenChange={setAssetInfoOpen} /><IconButton label="关闭素材详情" onClick={() => void closeAssetDetail()}><X size={18} aria-hidden /></IconButton></div></div>
            <div key={selectedAsset.id} className="drawer-scroll">
              {error ? <InlineMessage tone="error" className="mb-3">{error}</InlineMessage> : null}
              {!readOnly ? (
                <AssetImageReplacement
                  asset={selectedAsset}
                  busy={busy}
                  onBusyChange={setBusy}
                  onComplete={onRefresh}
                  onMessage={onMessage}
                />
              ) : null}
              <AssetMetadataEditor
                ref={metadataEditorRef}
                asset={selectedAsset}
                busy={busy}
                availableTags={availableTags}
                aiTagBusy={aiTagBusy}
                readOnly={readOnly}
                onAiTag={() => void runAiTag()}
                onSave={(update) => saveAssetMetadata(selectedAsset, update)}
              />
              <div className="mb-2 mt-4 flex items-center gap-2 text-sm">
                <Images size={16} aria-hidden />
                <strong>已引用项目</strong>
                <em className="ml-auto text-2xs not-italic text-muted">{selectedAsset.projects.length}</em>
              </div>
              {selectedAsset.projects.length ? (
                <div className="flex flex-col gap-1.5">
                  {selectedAsset.projects.map((project) => (
                    <span key={project.id} className="flex min-h-[31px] items-center gap-1.5 rounded-sm border border-line-soft bg-white px-2.5 text-sm text-ink-label">
                      <Check size={12} aria-hidden className="text-sage" />
                      {project.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">当前没有项目引用这项素材。</p>
              )}
              {!readOnly ? (
                <>
                  <Button variant="secondary" size="sm" className="mt-4 w-full" icon={<FolderPlus size={14} aria-hidden />} onClick={() => openAssign(selectedAsset)}>
                    添加到其他项目
                  </Button>
                  <Button variant="danger" size="sm" className="mt-2 w-full" disabled={busy} icon={<Trash2 size={14} aria-hidden />} onClick={() => void deleteToTrash(selectedAsset)}>
                    删除素材
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}

      {assignAsset ? (
        <Modal
          open
          onClose={() => setAssignAssetId(null)}
          eyebrow="PROJECT REFERENCES"
          title="添加到其他项目"
          description={`“${assignAsset.name}”只保留一份原文件，项目中创建的是引用。`}
          footer={
            <>
              <Button onClick={() => setAssignAssetId(null)}>取消</Button>
              <Button variant="primary" disabled={busy || !selectedProjectIds.length} onClick={() => void assignToProjects()}>
                {busy ? "添加中…" : `添加到 ${selectedProjectIds.length || 0} 个项目`}
              </Button>
            </>
          }
        >
          {error ? <InlineMessage tone="error">{error}</InlineMessage> : null}
          <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
            {projects.map((project) => {
              const alreadyAssigned = assignedIds.has(project.id);
              const checked = alreadyAssigned || selectedProjectIds.includes(project.id);
              return (
                <label
                  key={project.id}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md border border-line px-3 py-2",
                    alreadyAssigned ? "bg-surface-muted" : "cursor-pointer hover:bg-surface-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择项目 ${project.name}`}
                    checked={checked}
                    disabled={alreadyAssigned || busy}
                    onChange={(event) => setSelectedProjectIds((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))}
                    className="accent-sage"
                  />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-medium text-ink">{project.name}</strong>
                    <small className="block text-xs text-muted">{alreadyAssigned ? "已在项目中" : `${project.assetCount} 个素材`}</small>
                  </span>
                </label>
              );
            })}
            {!projects.length ? <p className="py-2 text-sm text-muted">还没有可添加的项目。</p> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
