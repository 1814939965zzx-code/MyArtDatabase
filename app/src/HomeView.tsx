"use client";

import { Archive, Grid2X2, Plus } from "lucide-react";
import { Button, EmptyState, Spinner } from "./ui";
import { ProjectCard } from "./components/home/ProjectCard";

export type HomeProject = {
  id: string;
  name: string;
  description: string;
  assetCount: number;
  dimensionCount: number;
  thumbnails?: string[];
};

export function HomeView({
  projects,
  search,
  loading,
  readOnly = false,
  onEnter,
  onNewProject,
  onRename,
  onArchive,
  onDelete,
}: {
  projects: HomeProject[];
  search: string;
  loading: boolean;
  readOnly?: boolean;
  onEnter: (project: HomeProject) => void;
  onNewProject: () => void;
  onRename: (project: HomeProject) => void;
  onArchive: (project: HomeProject) => void;
  onDelete: (project: HomeProject) => void;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[65vh] items-center justify-center gap-2 text-md text-muted">
        <Spinner size={22} />
        正在载入项目…
      </div>
    );
  }

  return (
    <div className="px-[42px] pb-[42px] pt-[34px] max-md:px-6 max-md:pb-[34px] max-md:pt-[30px]">
      <div className="mb-[26px] flex items-end justify-between gap-6 max-sm:flex-col max-sm:items-start">
        <div>
          <p className="mb-1 text-2xs font-bold uppercase tracking-[.15em] text-accent">PROJECTS</p>
          <h2 className="m-0 font-display text-2xl font-medium text-ink">项目</h2>
          <p className="mt-2 text-sm text-muted">{readOnly ? "选择一个项目进入浏览。" : "选择一个项目进入，或新建一个独立空间开始整理素材。"}</p>
        </div>
        {!readOnly ? (
          <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={onNewProject}>
            新建项目
          </Button>
        ) : null}
      </div>

      {!projects.length ? (
        search.trim() ? (
          <EmptyState icon={<Grid2X2 size={25} aria-hidden />} title="没有匹配的项目" description="换一个关键词试试。" className="mx-0" />
        ) : (
          <EmptyState
            icon={<Archive size={28} aria-hidden />}
            title={readOnly ? "还没有项目" : "建立第一个项目"}
            description={readOnly ? "管理员还没有创建项目。" : "项目用于保存独立的素材集合与分类维度。"}
            className="mx-[18px] max-md:mx-0"
            action={readOnly ? undefined : (
              <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={onNewProject}>
                新建项目
              </Button>
            )}
          />
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-5">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              readOnly={readOnly}
              onEnter={() => onEnter(project)}
              onRename={() => onRename(project)}
              onArchive={() => onArchive(project)}
              onDelete={() => onDelete(project)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
