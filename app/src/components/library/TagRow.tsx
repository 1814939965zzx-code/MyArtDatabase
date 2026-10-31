import { cn } from "../../ui";

/** 素材卡片上的标签行（列表布局在窄屏自动隐藏）。 */
export function TagRow({ tags, className }: { tags: string[]; className?: string }) {
  if (!tags.length) return null;
  return (
    <span className={cn("tag-row mt-2.5 flex flex-wrap gap-1.5", className)}>
      {tags.map((tag) => (
        <i key={tag} className="whitespace-nowrap rounded-xs bg-surface-muted px-1.5 py-0.5 text-2xs not-italic text-muted">
          {tag}
        </i>
      ))}
    </span>
  );
}
