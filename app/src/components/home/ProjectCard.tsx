import { Archive, Pencil, Trash2 } from "lucide-react";
import type { HomeProject } from "../../HomeView";
import { cn } from "../../ui";

/** 主页项目卡：封面拼图（最多 4 张）、hover 操作、元信息。 */
export function ProjectCard({
  project,
  onEnter,
  onRename,
  onArchive,
  onDelete,
  readOnly = false,
}: {
  project: HomeProject;
  onEnter: () => void;
  onRename: () => void;
  onArchive?: () => void;
  onDelete: () => void;
  readOnly?: boolean;
}) {
  const thumbs = project.thumbnails?.slice(0, 4) ?? [];
  const single = thumbs.length === 1;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`进入项目 ${project.name}`}
      onClick={onEnter}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEnter();
        }
      }}
      className="group relative min-w-0 cursor-pointer overflow-hidden rounded-[10px] border border-line bg-surface transition-[box-shadow,border-color] duration-150 hover:border-line-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="relative overflow-hidden bg-surface-sunken pt-[75%]">
        {thumbs.length ? (
          <div className={cn(
            "absolute inset-0 grid gap-0.5 transition-transform duration-300 ease-out group-hover:scale-[1.025]",
            single ? "grid-cols-1 grid-rows-1" : "grid-cols-2 grid-rows-2",
          )}>
            {thumbs.map((url) => (
              <img
                key={url}
                src={url}
                alt=""
                loading="lazy"
                className={cn("size-full object-cover", single && "col-span-full row-span-full")}
              />
            ))}
          </div>
        ) : (
          <span className="absolute inset-0 grid place-items-center text-faint">
            <Archive size={30} aria-hidden />
          </span>
        )}

        {!readOnly ? (
          <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRename();
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/35 bg-ink-panel/80 px-2 text-xs text-white backdrop-blur transition-colors hover:bg-ink-panel"
            >
              <Pencil size={13} aria-hidden />
              重命名
            </button>
            {onArchive ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive();
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/35 bg-ink-panel/80 px-2 text-xs text-white backdrop-blur transition-colors hover:bg-ink-panel"
              >
                <Archive size={13} aria-hidden />
                归档
              </button>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/35 bg-ink-panel/80 px-2 text-xs text-white backdrop-blur transition-colors hover:bg-ink-panel"
            >
              <Trash2 size={13} aria-hidden />
              删除
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 px-3.5 pb-3.5 pt-3">
        <strong className="truncate text-md font-semibold text-ink">{project.name}</strong>
        {project.description ? <p className="line-clamp-2 text-sm leading-relaxed text-muted">{project.description}</p> : null}
        <span className="text-xs text-faint">
          {project.assetCount} 个素材 · {project.dimensionCount} 个维度
        </span>
      </div>
    </div>
  );
}
