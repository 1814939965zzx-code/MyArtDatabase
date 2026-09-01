"use client";

import { ImageIcon, LoaderCircle, RotateCcw, Trash2, Trash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDuration, isVideoMime } from "./assetMedia";

export type TrashedAsset = {
  id: string;
  name: string;
  fileName: string;
  thumbnailUrl: string | null;
  tags: string[];
  fileSize: number;
  width: number;
  height: number;
  mimeType: string;
  duration: number;
  transcodeStatus: string | null;
  transcodeProgress: number;
  deletedAt: string;
  projects: Array<{ id: string; name: string }>;
};

export function TrashView({
  assets,
  search,
  loading,
  busy,
  onRestore,
  onPurge,
  onRestoreMany,
  onPurgeMany,
}: {
  assets: TrashedAsset[];
  search: string;
  loading: boolean;
  busy: boolean;
  onRestore: (asset: TrashedAsset) => void;
  onPurge: (asset: TrashedAsset) => void;
  onRestoreMany: (assets: TrashedAsset[]) => void;
  onPurgeMany: (assets: TrashedAsset[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const checkAllRef = useRef<HTMLInputElement>(null);

  const keyword = search.trim().toLowerCase();
  const filtered = useMemo(() => assets.filter((asset) =>
    !keyword || [asset.name, asset.fileName, ...asset.tags].some((text) => text.toLowerCase().includes(keyword)),
  ), [assets, keyword]);

  // 素材被恢复或永久删除后，清理已失效的选中项
  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => assets.some((asset) => asset.id === id)));
  }, [assets]);

  const allChecked = filtered.length > 0 && filtered.every((asset) => selectedIds.includes(asset.id));
  const someChecked = selectedIds.length > 0 && !allChecked;
  useEffect(() => {
    if (checkAllRef.current) checkAllRef.current.indeterminate = someChecked;
  }, [someChecked]);

  function toggleAll(checked: boolean) {
    setSelectedIds((current) => {
      const visibleIds = filtered.map((asset) => asset.id);
      if (checked) return [...new Set([...current, ...visibleIds])];
      return current.filter((id) => !visibleIds.includes(id));
    });
  }

  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  }

  const selectedAssets = assets.filter((asset) => selectedIds.includes(asset.id));

  if (loading) {
    return <div className="loading-state"><LoaderCircle className="spin" size={22} /> 正在载入回收站…</div>;
  }

  return (
    <>
      <div className="library-filter-bar trash-toolbar">
        <div className="trash-select-controls">
          <label className="trash-check-all">
            <input
              ref={checkAllRef}
              type="checkbox"
              checked={allChecked}
              disabled={busy || !filtered.length}
              onChange={(event) => toggleAll(event.target.checked)}
            />
            全选
          </label>
          {selectedIds.length ? (
            <span className="trash-selected-count">已选 {selectedIds.length} 项</span>
          ) : (
            <span className="trash-hint">软删除的素材会保留在这里；恢复后回到原来的项目，永久删除会同时移除所有项目引用和图片文件。</span>
          )}
        </div>
        <div className="library-filter-actions">
          {search ? <span>找到 {filtered.length} 项</span> : null}
          {selectedIds.length ? (
            <div className="trash-batch-actions">
              <button type="button" className="trash-restore" disabled={busy} onClick={() => onRestoreMany(selectedAssets)}><RotateCcw size={13} />恢复所选</button>
              <button type="button" className="trash-purge" disabled={busy} onClick={() => onPurgeMany(selectedAssets)}><Trash2 size={13} />永久删除所选</button>
            </div>
          ) : null}
        </div>
      </div>

      {filtered.length ? (
        <div className="asset-collection trash-collection">
          <div className="asset-grid">
            {filtered.map((asset) => {
              const selected = selectedIds.includes(asset.id);
              return (
                <div className={`asset-card trash-card${selected ? " selected" : ""}`} key={asset.id}>
                  <span className="asset-image-wrap">
                    <input
                      className="trash-card-check"
                      type="checkbox"
                      checked={selected}
                      disabled={busy}
                      aria-label={`选择 ${asset.name}`}
                      onChange={(event) => toggleOne(asset.id, event.target.checked)}
                    />
                    {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <span className="asset-fallback"><ImageIcon /></span>}
                    {isVideoMime(asset.mimeType) && asset.transcodeStatus === "ready" ? <span className="trash-duration-badge">{formatDuration(asset.duration)}</span> : null}
                    <span className="project-count-badge">{asset.projects.length} 个项目</span>
                  </span>
                  <span className="asset-meta">
                    <strong>{asset.name}</strong>
                    <small>删除于 {formatDeletedAt(asset.deletedAt)}</small>
                    {asset.tags.length ? <span className="tag-row">{asset.tags.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}
                    <span className="trash-card-actions">
                      <button type="button" className="trash-restore" disabled={busy} onClick={() => onRestore(asset)}><RotateCcw size={13} />恢复</button>
                      <button type="button" className="trash-purge" disabled={busy} onClick={() => onPurge(asset)}><Trash2 size={13} />永久删除</button>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="empty-state"><Trash size={28} /><h3>{search ? "没有匹配的已删除素材" : "回收站是空的"}</h3><p>{search ? "换一个关键词试试。" : "删除素材后会先进入这里，随时可以恢复或彻底清除。"}</p></div>
      )}
    </>
  );
}

function formatDeletedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
