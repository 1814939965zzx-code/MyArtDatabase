import type { ReactNode } from "react";
import { ImageIcon, Star, Video } from "lucide-react";
import { formatDuration, isVideoMime, transcodePercent } from "../../assetMedia";
import { cn } from "../../ui";
import { TagRow } from "./TagRow";

export type AssetCardAsset = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  tags: string[];
  mimeType: string;
  duration?: number;
  transcodeStatus?: string | null;
  transcodeProgress?: number;
  projects?: Array<{ id: string; name: string }>;
};

export type AssetCardProps = {
  asset: AssetCardAsset;
  selected?: boolean;
  selectable?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  busy?: boolean;
  onOpen?: () => void;
  /** 项目内收藏标记（全局库/回收站不传） */
  favorite?: boolean;
  showProjectCount?: boolean;
  showDuration?: boolean;
  roundedThumb?: boolean;
  thumbnailLoading?: "eager" | "lazy";
  metaExtra?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * 素材卡：网格布局，支持转码进度、项目引用数、选择态与底部动作。
 * 卡片宽度由素材库工具栏的滑块控制（240～400px）；
 * hover 保留投影 + 图片轻微放大；只对 transform 做过渡，不做卡片位移，
 * 也不再给图片加 filter/对比度过渡（filter 与 transform 同时动画会产生重影/像换了一张缩略图）。
 */
export function AssetCard({
  asset,
  selected = false,
  selectable = false,
  checked = false,
  onCheckedChange,
  busy = false,
  onOpen,
  favorite = false,
  showProjectCount = false,
  showDuration = false,
  roundedThumb = false,
  thumbnailLoading = "lazy",
  metaExtra,
  actions,
  className,
}: AssetCardProps) {
  const video = isVideoMime(asset.mimeType);
  const processing = video && asset.transcodeStatus === "processing";
  const percent = transcodePercent(asset.transcodeProgress ?? 0);

  const content = (
    <>
      <span
        className={cn(
          "asset-thumb relative block aspect-[1.18] overflow-hidden bg-surface-sunken",
          roundedThumb && "rounded-[5px]",
        )}
      >
        {asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt=""
            loading={thumbnailLoading}
            className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.025]"
          />
        ) : (
          <span className="grid size-full place-items-center text-faint">
            <ImageIcon size={28} aria-hidden />
          </span>
        )}

        {/* 素材类型标签（图片/视频）固定在左上角，替代没有语义的数字编号 */}
        <span
          role="img"
          className="absolute left-2 top-2 z-10 grid size-6 place-items-center rounded-full bg-ink-panel/75 text-white"
          aria-label={video ? "视频素材" : "图片素材"}
          title={video ? "视频" : "图片"}
        >
          {video ? <Video size={12} aria-hidden /> : <ImageIcon size={12} aria-hidden />}
        </span>

        {favorite ? (
          <span className="absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-full bg-ink-panel/75 text-white" aria-label="已收藏" title="已收藏">
            <Star size={12} fill="currentColor" aria-hidden />
          </span>
        ) : null}

        {selectable ? (
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            aria-label={`选择 ${asset.name}`}
            onChange={(event) => onCheckedChange?.(event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            className="absolute right-2 top-2 z-10 size-4 cursor-pointer accent-success disabled:cursor-not-allowed"
          />
        ) : null}

        {processing ? (
          <span className="absolute bottom-2 left-2 flex min-w-[76px] flex-col gap-1 rounded-sm bg-ink-panel/80 px-2 py-1 text-2xs text-white">
            <span>转码中 {percent}%</span>
            <span className="h-[3px] overflow-hidden rounded-full bg-white/20">
              <span className="block h-full bg-success transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </span>
          </span>
        ) : null}

        {!processing && showDuration && video && asset.transcodeStatus === "ready" ? (
          <span className="absolute bottom-2 left-2 rounded-sm bg-ink-panel/75 px-1.5 py-1 text-2xs text-white">{formatDuration(asset.duration ?? 0)}</span>
        ) : null}

        {showProjectCount && asset.projects ? (
          <span className="absolute bottom-2 right-2 bg-surface/90 px-1.5 py-1 text-2xs text-ink-label shadow-sm">{asset.projects.length} 个项目</span>
        ) : null}
      </span>

      <span className="asset-meta block p-[13px]">
        <strong className="block truncate text-md font-semibold text-ink">{asset.name}</strong>
        {metaExtra}
        <TagRow tags={asset.tags} />
        {actions ? <span className="mt-3 flex gap-2 border-t border-line-soft pt-2.5">{actions}</span> : null}
      </span>
    </>
  );

  const rootClass = cn(
    "asset-card group relative w-full overflow-hidden border border-line bg-surface text-left transition-shadow duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    onOpen && "cursor-pointer hover:shadow-md",
    selected && "border-sage shadow-[0_0_0_1px_var(--color-sage)]",
    className,
  );

  if (onOpen) {
    // 选择态卡片内部会放 checkbox（交互元素不能嵌在 button 里），改用 role=button 容器。
    if (selectable) {
      return (
        <div
          role="button"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen();
            }
          }}
          className={rootClass}
        >
          {content}
        </div>
      );
    }
    return (
      <button type="button" onClick={onOpen} className={rootClass}>
        {content}
      </button>
    );
  }

  return <article className={rootClass}>{content}</article>;
}
