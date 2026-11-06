"use client";

import { Check, ImageIcon, Video } from "lucide-react";
import { useMemo, useState } from "react";
import { isVideoMime } from "../../assetMedia";
import { TagFilterBar } from "../../TagFilterBar";
import { Button, EmptyState, Modal, SearchInput, cn } from "../../ui";

export type ImportableAsset = {
  id: string;
  name: string;
  fileName: string;
  tags: string[];
  thumbnailUrl: string | null;
  mimeType: string;
};

/**
 * 从全部素材导入到当前项目素材库：来源是全局素材库，只建立项目引用，不复制素材。
 * 已经在当前项目里的素材会置灰，避免重复导入。
 */
export function ImportFromLibraryModal({
  projectName,
  assets,
  existingIds,
  onClose,
  onImport,
  onMessage,
}: {
  projectName: string;
  assets: ImportableAsset[];
  existingIds: Set<string>;
  onClose: () => void;
  /** 返回实际导入成功的素材数量；失败时抛出错误由弹窗内提示。 */
  onImport: (assetIds: string[]) => Promise<number>;
  onMessage: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const globalTags = useMemo(
    () => [...new Set(assets.flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [assets],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesTag = selectedTags.length === 0 || selectedTags.some((tag) => asset.tags.includes(tag));
      const matchesKeyword = !keyword || [asset.name, asset.fileName, ...asset.tags]
        .some((text) => text.toLowerCase().includes(keyword));
      return matchesTag && matchesKeyword;
    });
  }, [assets, search, selectedTags]);

  const selectableIds = useMemo(
    () => filtered.filter((asset) => !existingIds.has(asset.id)).map((asset) => asset.id),
    [filtered, existingIds],
  );
  // 部分导入失败后父级会刷新“已在项目中”的集合：这里同步剔除已成功的素材，重试时不会重复计数
  const pendingIds = useMemo(
    () => selected.filter((assetId) => !existingIds.has(assetId)),
    [selected, existingIds],
  );

  function toggle(assetId: string) {
    setSelected((current) => current.includes(assetId)
      ? current.filter((id) => id !== assetId)
      : [...current, assetId]);
  }

  async function submit() {
    if (!pendingIds.length || busy) return;
    setBusy(true);
    try {
      const imported = await onImport(pendingIds);
      onMessage(imported ? `已从全部素材导入 ${imported} 个素材` : "选中的素材都已在当前项目中");
      onClose();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      size="xl"
      className="flex max-h-[85dvh] flex-col overflow-hidden"
      bodyClassName="min-h-0 flex-1"
      eyebrow="IMPORT ASSETS"
      title="从全部素材导入到素材库"
      description={`选择一个或多个全局素材加入“${projectName}”的项目素材库；只建立引用，不复制文件。`}
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" loading={busy} disabled={busy || !pendingIds.length} onClick={() => void submit()}>
            {busy ? "导入中…" : `导入 ${pendingIds.length} 个素材`}
          </Button>
        </>
      }
    >
      <SearchInput value={search} onValueChange={setSearch} placeholder="搜索名称、文件名或标签" aria-label="搜索全部素材" />
      {globalTags.length ? (
        <div className="min-w-0">
          <TagFilterBar
            tags={globalTags}
            selected={selectedTags}
            label="全局标签"
            onToggle={(tag) => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>已选 {pendingIds.length} 个 · 匹配 {filtered.length} 个</span>
        <Button
          variant="ghost"
          size="xs"
          disabled={busy || !selectableIds.length}
          onClick={() => setSelected((current) => [...new Set([...current, ...selectableIds])])}
        >
          选择筛选结果
        </Button>
        <Button variant="ghost" size="xs" disabled={busy || !selected.length} onClick={() => setSelected([])}>
          清空选择
        </Button>
      </div>
      <div className="grid min-h-[140px] grid-cols-[repeat(auto-fill,minmax(120px,1fr))] content-start gap-3 overflow-y-auto p-[3px]">
        {filtered.map((asset) => {
          const already = existingIds.has(asset.id);
          const active = selected.includes(asset.id);
          const video = isVideoMime(asset.mimeType);
          return (
            <button
              type="button"
              key={asset.id}
              disabled={busy || already}
              aria-pressed={active}
              className={cn(
                "relative flex min-w-0 flex-col items-center gap-2 rounded-sm border bg-white p-2 text-ink",
                active ? "border-accent outline outline-1 outline-accent" : "border-line hover:border-line-strong",
                already && "cursor-not-allowed opacity-45",
              )}
              onClick={() => toggle(asset.id)}
            >
              <span className="relative grid h-[100px] w-full place-items-center overflow-hidden bg-surface-sunken">
                {asset.thumbnailUrl ? (
                  <img src={asset.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <ImageIcon size={30} aria-hidden className="text-faint" />
                )}
                <span role="img" className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-ink-panel/75 text-white" aria-label={video ? "视频素材" : "图片素材"} title={video ? "视频" : "图片"}>
                  {video ? <Video size={11} aria-hidden /> : <ImageIcon size={11} aria-hidden />}
                </span>
                {active ? <Check size={16} aria-hidden className="absolute right-1.5 top-1.5 rounded-full bg-accent p-0.5 text-white" /> : null}
              </span>
              <span className="max-w-full truncate text-sm">{asset.name}</span>
              {already ? <small className="text-xs text-muted">已在项目中</small> : null}
            </button>
          );
        })}
        {!filtered.length ? (
          <EmptyState compact className="col-span-full" title="没有匹配的全部素材" description="换一个名称、文件名或标签试试。" />
        ) : null}
      </div>
    </Modal>
  );
}
