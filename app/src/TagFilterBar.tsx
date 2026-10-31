"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Tag, cn } from "./ui";

/**
 * 素材标签筛选模块（全部素材页与项目素材页共用）：
 * - 已选中的标签排最前，其余按拼音排序；
 * - 默认只展示 2 行，内容溢出时提供展开/收起全部标签入口。
 */
export function TagFilterBar({
  tags,
  selected,
  onToggle,
  label = "全局标签",
}: {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  label?: string;
}) {
  const [tagsOverflow, setTagsOverflow] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => (
      Number(selected.includes(b)) - Number(selected.includes(a)) || a.localeCompare(b, "zh-CN")
    )),
    [tags, selected],
  );

  // 仅在折叠态测量内容是否溢出（展开时保持入口可点，不重新判定）
  useEffect(() => {
    if (tagsExpanded) return;
    const element = filterRef.current;
    if (!element) return;
    const update = () => setTagsOverflow(element.scrollHeight > element.clientHeight + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tags, tagsExpanded]);

  return (
    <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
      <div
        ref={filterRef}
        aria-label={`按${label}筛选`}
        className={cn("flex min-w-0 flex-wrap items-center gap-[7px] overflow-hidden", !tagsExpanded && "max-h-[63px]")}
      >
        <strong className="mr-0.5 text-sm font-semibold text-ink-label">{label}</strong>
        {sortedTags.map((tag) => (
          <Tag key={tag} active={selected.includes(tag)} onClick={() => onToggle(tag)}>
            {tag}
          </Tag>
        ))}
        {!tags.length ? <span className="text-sm text-muted">暂无标签</span> : null}
      </div>
      {tagsOverflow || tagsExpanded ? (
        <Button variant="ghost" size="xs" className="px-1 text-sage-deep" onClick={() => setTagsExpanded((current) => !current)}>
          {tagsExpanded ? "收起全部标签" : "展开全部标签"}
        </Button>
      ) : null}
    </div>
  );
}
