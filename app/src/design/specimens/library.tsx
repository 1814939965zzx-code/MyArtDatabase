import { ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import { Button, EmptyState, Tag } from "../../ui";
import { AssetCard } from "../../components/library/AssetCard";
import { ProjectCard } from "../../components/home/ProjectCard";
import { ViewToggle } from "../../components/library/ViewToggle";

const swatch = (color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="${color}"/></svg>`)}`;

const thumbs = [swatch("tan"), swatch("cadetblue"), swatch("darkseagreen"), swatch("lightsteelblue")];

const demoAsset = {
  id: "asset-1",
  name: "秋季品牌主视觉",
  thumbnailUrl: thumbs[0],
  tags: ["摄影", "暖色", "品牌视觉"],
  mimeType: "image/jpeg",
  transcodeStatus: null,
  transcodeProgress: 0,
  projects: [{ id: "p1", name: "品牌视觉" }, { id: "p2", name: "秋季 campaign" }],
};

/** B4 · 项目卡：空封面与 4 图拼贴。 */
export function ProjectCardSpecimen() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ProjectCard
        project={{ id: "p1", name: "品牌视觉 2026", description: "品牌升级期间的视觉参考与方向探索。", assetCount: 42, dimensionCount: 6, thumbnails: thumbs }}
        onEnter={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />
      <ProjectCard
        project={{ id: "p2", name: "新建项目", description: "", assetCount: 0, dimensionCount: 1 }}
        onEnter={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />
    </div>
  );
}

/** B4 · 素材卡：网格（正常 / 转码 / 无图）与列表。 */
export function AssetCardSpecimen() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <AssetCard asset={demoAsset} roundedThumb showProjectCount />
        <AssetCard
          asset={{ ...demoAsset, id: "asset-2", name: "转码中的视频", mimeType: "video/mp4", transcodeStatus: "processing", transcodeProgress: 64, projects: [] }}
          roundedThumb
        />
        <AssetCard asset={{ ...demoAsset, id: "asset-3", name: "无缩略图素材", thumbnailUrl: null, tags: [] }} roundedThumb />
      </div>
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="asset-list">
          <AssetCard asset={demoAsset} variant="list" roundedThumb showProjectCount />
          <AssetCard asset={{ ...demoAsset, id: "asset-4", name: "列表中的第二个素材" }} variant="list" roundedThumb />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted">视图切换</span>
        <ViewToggle value="grid" onChange={() => {}} />
      </div>
    </div>
  );
}

/** B4 · 回收站：选中态、操作按钮与空态。 */
export function TrashSpecimen() {
  return (
    <div className="flex flex-col gap-4">
      <div className="asset-grid">
        <AssetCard
          asset={{ ...demoAsset, id: "trash-1" }}
          selected
          selectable
          checked
          showProjectCount
          showDuration
          metaExtra={<small className="mt-1 block text-xs text-faint">删除于 2026/10/30 14:20</small>}
          actions={
            <>
              <Button size="xs" icon={<RotateCcw size={13} aria-hidden />}>恢复</Button>
              <Button size="xs" variant="danger" icon={<Trash2 size={13} aria-hidden />}>永久删除</Button>
            </>
          }
        />
        <AssetCard asset={{ ...demoAsset, id: "trash-2", name: "待确认素材", thumbnailUrl: null, tags: [] }} />
      </div>
      <EmptyState compact icon={<ImageIcon size={24} aria-hidden />} title="回收站是空的" description="删除素材后会先进入这里，随时可以恢复或彻底清除。" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">筛选标签：</span>
        <Tag active>摄影</Tag>
        <Tag>材质</Tag>
        <Tag>暖色</Tag>
      </div>
    </div>
  );
}
