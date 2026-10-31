"use client";

import { RotateCcw, Trash, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssetCard } from "./components/library/AssetCard";
import { Button, EmptyState, Spinner } from "./ui";

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
    return (
      <div className="flex min-h-[65vh] items-center justify-center gap-2 text-md text-muted">
        <Spinner size={22} />
        正在载入回收站…
      </div>
    );
  }

  return (
    <>
      <div className="mx-[42px] mb-[18px] mt-[26px] flex flex-wrap items-center justify-between gap-4 border border-line bg-surface px-3.5 py-3 max-md:mx-6 max-sm:flex-col max-sm:items-stretch">
        <div className="flex min-w-0 items-center gap-3">
          <label className="flex flex-none cursor-pointer items-center gap-2 text-sm text-muted">
            <input
              ref={checkAllRef}
              type="checkbox"
              checked={allChecked}
              disabled={busy || !filtered.length}
              onChange={(event) => toggleAll(event.target.checked)}
              className="accent-sage"
            />
            全选
          </label>
          {selectedIds.length ? (
            <span className="text-sm font-semibold text-success">已选 {selectedIds.length} 项</span>
          ) : (
            <span className="text-sm leading-relaxed text-muted">
              软删除的素材会保留在这里；恢复后回到原来的项目，永久删除会同时移除所有项目引用和图片文件。
            </span>
          )}
        </div>
        <div className="flex flex-none items-center gap-2.5">
          {search ? <span className="text-xs text-muted">找到 {filtered.length} 项</span> : null}
          {selectedIds.length ? (
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<RotateCcw size={13} aria-hidden />} disabled={busy} onClick={() => onRestoreMany(selectedAssets)}>
                恢复所选
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 size={13} aria-hidden />} disabled={busy} onClick={() => onPurgeMany(selectedAssets)}>
                永久删除所选
              </Button>
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
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  variant="grid"
                  selected={selected}
                  selectable
                  checked={selected}
                  onCheckedChange={(checked) => toggleOne(asset.id, checked)}
                  busy={busy}
                  showProjectCount
                  showDuration
                  metaExtra={<small className="mt-1 block text-xs text-faint">删除于 {formatDeletedAt(asset.deletedAt)}</small>}
                  actions={
                    <>
                      <Button size="xs" icon={<RotateCcw size={13} aria-hidden />} disabled={busy} onClick={() => onRestore(asset)}>
                        恢复
                      </Button>
                      <Button size="xs" variant="danger" icon={<Trash2 size={13} aria-hidden />} disabled={busy} onClick={() => onPurge(asset)}>
                        永久删除
                      </Button>
                    </>
                  }
                />
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<Trash size={28} aria-hidden />}
          title={search ? "没有匹配的已删除素材" : "回收站是空的"}
          description={search ? "换一个关键词试试。" : "删除素材后会先进入这里，随时可以恢复或彻底清除。"}
          className="mx-[42px] max-md:mx-6"
        />
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
