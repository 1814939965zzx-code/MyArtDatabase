import { useState } from "react";
import { Archive, Grid2X2, Plus, Tags, Trash2, Upload } from "lucide-react";
import { Button, SearchInput, Tag, Tabs } from "../../ui";
import { BrandMark } from "../../components/layout/BrandMark";
import { SidebarNavItem } from "../../components/layout/SidebarNavItem";
import { TopbarTabs } from "../../components/layout/TopbarTabs";
import type { ProjectSurface } from "../../components/layout/TopbarTabs";
import { TopbarTitle } from "../../components/layout/TopbarTitle";
import { UserMenu } from "../../components/layout/UserMenu";
import { TagFilterBar } from "../../TagFilterBar";

/** B3 · 侧栏：真实 SidebarNavItem / BrandMark。 */
export function SidebarSpecimen() {
  return (
    <div className="inline-flex w-[272px] flex-col bg-ink-panel px-4 pb-[18px] pt-[22px] text-white">
      <div className="flex items-center gap-2.5 border-b border-ink-soft px-[7px] pb-[23px]">
        <BrandMark />
        <div className="min-w-0">
          <strong className="block truncate text-md font-semibold">Art Database</strong>
          <span className="mt-0.5 block truncate text-xs text-white/60">视觉素材工作台</span>
        </div>
      </div>
      <nav className="mt-4 flex flex-col gap-1">
        <SidebarNavItem icon={<Archive size={16} aria-hidden />} title="项目" subtitle="4 个独立空间" active onClick={() => {}} />
        <SidebarNavItem icon={<Grid2X2 size={16} aria-hidden />} title="全部素材" subtitle="128 个数据库素材" onClick={() => {}} />
        <SidebarNavItem icon={<Tags size={16} aria-hidden />} title="标签管理" subtitle="词库与标签维护" onClick={() => {}} />
      </nav>
      <div className="mt-6 flex items-center justify-between px-2.5 pb-2 pt-1 text-2xs uppercase tracking-[.12em] text-white/50">
        <span>项目</span>
        <span>4</span>
      </div>
      <button
        type="button"
        className="mt-2.5 flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-white/25 text-sm text-white/70 transition-colors hover:border-white/40 hover:text-white"
      >
        <Plus size={17} aria-hidden /> 新建项目
      </button>
      <SidebarNavItem className="mt-8" icon={<Trash2 size={16} aria-hidden />} title="回收站" subtitle="3 个已删除素材" onClick={() => {}} />
    </div>
  );
}

/** B3 · 顶栏：真实 TopbarTitle / TopbarTabs / SearchInput / Button / UserMenu。 */
export function TopbarSpecimen() {
  const [surface, setSurface] = useState<ProjectSurface>("preview");
  const [search, setSearch] = useState("");
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-paper">
      <div className="flex min-w-[720px] items-center justify-between gap-[18px] border-b border-line px-[34px] py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TopbarTitle title="品牌视觉" count={12} />
          <TopbarTabs value={surface} onChange={setSurface} />
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <SearchInput value={search} onValueChange={setSearch} className="w-[190px]" placeholder="搜索名称、文件或标签" aria-label="搜索素材" />
          <Button variant="primary" size="lg" icon={<Upload size={15} aria-hidden />}>
            上传素材
          </Button>
          <UserMenu displayName="张三" role="admin" onAction={() => {}} />
        </div>
      </div>
    </div>
  );
}

/** B3 · 标签筛选：真实 TagFilterBar。 */
export function TagFilterSpecimen() {
  const [selected, setSelected] = useState<string[]>(["摄影"]);
  const tags = ["摄影", "材质", "暖色", "三维", "品牌视觉", "编辑精选", "留白", "工业", "自然光", "胶片"];
  return (
    <TagFilterBar
      tags={tags}
      selected={selected}
      onToggle={(tag) => setSelected((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
    />
  );
}

/** B3 · 用户菜单：真实 UserMenu（点击头像展开）。 */
export function UserMenuSpecimen() {
  return (
    <div className="flex min-h-[220px] items-start justify-end rounded-lg bg-paper p-4">
      <UserMenu displayName="张三" role="admin" onAction={() => {}} />
    </div>
  );
}

/** B3 · 标签与页签原语：Tag / Tabs 的静态组合。 */
export function TagAndTabsSpecimen() {
  const [tab, setTab] = useState("all");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {[false, true].map((active) => (
          <Tag key={String(active)} active={active}>
            {active ? "已选中" : "未选中"}
          </Tag>
        ))}
        <Tag disabled>禁用</Tag>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        ariaLabel="示例页签"
        items={[
          { value: "all", label: "全部", count: 12 },
          { value: "mine", label: "我的" },
        ]}
      />
    </div>
  );
}
