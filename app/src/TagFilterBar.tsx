"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
    <div className="global-tag-area">
      <div ref={filterRef} className={`global-tag-filter library-tag-filter ${tagsExpanded ? "expanded" : ""}`} aria-label={`按${label}筛选`}>
        <strong>{label}</strong>
        {sortedTags.map((tag) => (
          <button type="button" className={selected.includes(tag) ? "active" : ""} key={tag} onClick={() => onToggle(tag)}>
            {tag}
          </button>
        ))}
        {!tags.length ? <span>暂无标签</span> : null}
      </div>
      {(tagsOverflow || tagsExpanded) ? (
        <button className="tag-filter-expand" type="button" onClick={() => setTagsExpanded((current) => !current)}>
          {tagsExpanded ? "收起全部标签" : "展开全部标签"}
        </button>
      ) : null}
    </div>
  );
}
