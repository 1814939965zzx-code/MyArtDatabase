"use client";

import { Archive, Grid2X2, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";

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
  onEnter,
  onNewProject,
  onRename,
  onDelete,
}: {
  projects: HomeProject[];
  search: string;
  loading: boolean;
  onEnter: (project: HomeProject) => void;
  onNewProject: () => void;
  onRename: (project: HomeProject) => void;
  onDelete: (project: HomeProject) => void;
}) {
  if (loading) {
    return <div className="loading-state"><LoaderCircle className="spin" size={22} /> 正在载入项目…</div>;
  }

  return (
    <div className="home-view">
      <div className="home-heading">
        <div>
          <p className="eyebrow">PROJECTS</p>
          <h2>项目</h2>
          <p>选择一个项目进入，或新建一个独立空间开始整理素材。</p>
        </div>
        <button className="primary-button" type="button" onClick={onNewProject}><Plus size={16} />新建项目</button>
      </div>

      {!projects.length ? (
        search.trim() ? (
          <div className="empty-state"><Grid2X2 size={25} /><h3>没有匹配的项目</h3><p>换一个关键词试试。</p></div>
        ) : (
          <div className="empty-state project-empty"><Archive size={28} /><h2>建立第一个项目</h2><p>项目用于保存独立的素材集合与分类维度。</p><button className="primary-button" type="button" onClick={onNewProject}><Plus size={16} /> 新建项目</button></div>
        )
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <div
              className="project-card"
              key={project.id}
              role="button"
              tabIndex={0}
              aria-label={`进入项目 ${project.name}`}
              onClick={() => onEnter(project)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onEnter(project);
                }
              }}
            >
              <div className="project-card-cover">
                {project.thumbnails?.length ? (
                  <div className={`project-cover-collage cells-${Math.min(project.thumbnails.length, 4)}`}>
                    {project.thumbnails.slice(0, 4).map((url) => <img key={url} src={url} alt="" loading="lazy" />)}
                  </div>
                ) : <span className="project-cover-empty"><Archive size={30} /></span>}
                <div className="project-card-actions">
                  <button type="button" onClick={(event) => { event.stopPropagation(); onRename(project); }}><Pencil size={13} />重命名</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(project); }}><Trash2 size={13} />删除</button>
                </div>
              </div>
              <div className="project-card-body">
                <strong>{project.name}</strong>
                {project.description ? <p>{project.description}</p> : null}
                <span className="project-card-meta">{project.assetCount} 个素材 · {project.dimensionCount} 个维度</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
