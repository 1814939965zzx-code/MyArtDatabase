import { ImagePlus, LayoutGrid, SlidersHorizontal } from "lucide-react";
import { Tabs } from "../../ui";

export type ProjectSurface = "preview" | "board" | "assets";

/** 顶栏里的三个项目视图页签。 */
export function TopbarTabs({ value, onChange }: { value: ProjectSurface; onChange: (value: ProjectSurface) => void }) {
  return (
    <Tabs
      variant="topbar"
      ariaLabel="项目视图"
      value={value}
      onChange={onChange}
      className="shrink-0 self-stretch overflow-x-auto border-l border-line pl-3"
      items={[
        { value: "preview", label: "维度预览", icon: <SlidersHorizontal size={16} aria-hidden /> },
        { value: "board", label: "自由画板", icon: <ImagePlus size={16} aria-hidden /> },
        { value: "assets", label: "素材库", icon: <LayoutGrid size={16} aria-hidden /> },
      ]}
    />
  );
}
