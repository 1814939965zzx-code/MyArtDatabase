import { Archive, RotateCcw, Trash2 } from "lucide-react";
import type { HomeProject } from "./HomeView";
import { Button, EmptyState, Spinner, cn } from "./ui";

type ArchivedProject = HomeProject & { archivedAt?: string | null };

/** 已归档项目：只保留查看、恢复与删除，不进入项目工作区。 */
export function ArchivedProjectsView({
  projects,
  search,
  loading,
  busy,
  onRestore,
  onDelete,
}: {
  projects: ArchivedProject[];
  search: string;
  loading: boolean;
  busy: boolean;
  onRestore: (project: ArchivedProject) => void;
  onDelete: (project: ArchivedProject) => void;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center gap-2 text-md text-muted">
        <Spinner size={22} />
        正在载入已归档项目…
      </div>
    );
  }

  return (
    <div className="px-[42px] pb-[42px] pt-[34px] max-md:px-6 max-md:pb-[34px] max-md:pt-[30px]">
      <div className="mb-[26px] flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-start">
        <div>
          <p className="mb-1 text-2xs font-bold uppercase tracking-[.15em] text-accent">ARCHIVED</p>
          <h2 className="m-0 font-display text-2xl font-medium text-ink">已归档项目</h2>
          <p className="mt-2 text-sm text-muted">归档项目不会出现在主页；恢复后回到项目列表，删除会清空该项目相关的维度、画板与项目引用。</p>
        </div>
        <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-muted">{projects.length} 个已归档项目</span>
      </div>

      {!projects.length ? (
        <EmptyState
          icon={<Archive size={28} aria-hidden />}
          title={search.trim() ? "没有匹配的已归档项目" : "还没有已归档项目"}
          description={search.trim() ? "换一个关键词试试。" : "在项目卡的「归档」操作中归档项目，之后会出现在这里。"}
          className="mx-[18px] max-md:mx-0"
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-5">
          {projects.map((project) => {
            const thumbs = project.thumbnails?.slice(0, 4) ?? [];
            const single = thumbs.length === 1;
            return (
              <article key={project.id} className="group relative min-w-0 overflow-hidden rounded-[10px] border border-line bg-surface">
                <div className="relative overflow-hidden bg-surface-sunken pt-[75%]">
                  {thumbs.length ? (
                    <div className={cn(
                      "absolute inset-0 grid gap-0.5 opacity-80",
                      single ? "grid-cols-1 grid-rows-1" : "grid-cols-2 grid-rows-2",
                    )}>
                      {thumbs.map((url) => (
                        <img key={url} src={url} alt="" loading="lazy" className={cn("size-full object-cover", single && "col-span-full row-span-full")} />
                      ))}
                    </div>
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-faint">
                      <Archive size={30} aria-hidden />
                    </span>
                  )}
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-white/35 bg-ink-panel/80 px-2 py-0.5 text-2xs font-medium text-white backdrop-blur">
                    <Archive size={11} aria-hidden />
                    已归档
                  </span>
                </div>

                <div className="flex flex-col gap-1 px-3.5 pb-3 pt-3">
                  <strong className="truncate text-md font-semibold text-ink">{project.name}</strong>
                  {project.description ? <p className="line-clamp-2 text-sm leading-relaxed text-muted">{project.description}</p> : null}
                  <span className="text-xs text-faint">
                    {project.assetCount} 个素材 · {project.dimensionCount} 个维度
                  </span>
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="xs" icon={<RotateCcw size={13} aria-hidden />} disabled={busy} onClick={() => onRestore(project)}>
                      恢复
                    </Button>
                    <Button size="xs" variant="danger" icon={<Trash2 size={13} aria-hidden />} disabled={busy} onClick={() => onDelete(project)}>
                      删除项目
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
