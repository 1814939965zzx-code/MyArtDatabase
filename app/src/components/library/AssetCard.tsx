import type { ReactNode } from "react";
import { ImageIcon, Star } from "lucide-react";
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
  index?: number;
  variant?: "grid" | "list";
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

/** 素材卡：网格/列表共用，支持转码进度、项目引用数、选择态与底部动作。 */
export function AssetCard({
  asset,
  index,
  variant = "grid",
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
          "asset-thumb relative block overflow-hidden bg-surface-sunken",
          variant === "grid" && "aspect-[1.18]",
          roundedThumb && "rounded-[5px]",
        )}
      >
        {asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt=""
            loading={thumbnailLoading}
            className="size-full object-cover saturate-[.8] transition duration-300 group-hover:scale-[1.025] group-hover:saturate-100"
          />
        ) : (
          <span className="grid size-full place-items-center text-faint">
            <ImageIcon size={28} aria-hidden />
          </span>
        )}

        {favorite ? (
          <span className="absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-full bg-ink-panel/75 text-white" aria-label="已收藏" title="已收藏">
            <Star size={12} fill="currentColor" aria-hidden />
          </span>
        ) : null}

        {typeof index === "number" ? (
          <span className="absolute left-2 top-2 bg-ink-panel/75 px-1.5 py-1 text-2xs tracking-[.08em] text-white">
            {String(index + 1).padStart(2, "0")}
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
            className="absolute left-2 top-2 z-10 size-4 cursor-pointer accent-success disabled:cursor-not-allowed"
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
    "asset-card group relative w-full overflow-hidden border border-line bg-surface text-left transition-[transform,box-shadow,border-color] duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    onOpen && "cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
    selected && "border-sage shadow-[0_0_0_1px_var(--color-sage)]",
    className,
  );

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={rootClass}>
        {content}
      </button>
    );
  }

  return <article className={rootClass}>{content}</article>;
}
