import { LayoutGrid, List } from "lucide-react";
import { cn } from "../../ui";

/** 网格/列表切换：与旧版一样是一个 3px 内边距的浅色分段控件。 */
export function ViewToggle({ value, onChange }: { value: "grid" | "list"; onChange: (value: "grid" | "list") => void }) {
  return (
    <div className="flex rounded-md border border-line bg-surface p-[3px]" aria-label="显示方式">
      {[
        { value: "grid" as const, label: "网格显示", Icon: LayoutGrid },
        { value: "list" as const, label: "列表显示", Icon: List },
      ].map(({ value: item, label, Icon }) => (
        <button
          key={item}
          type="button"
          aria-label={label}
          aria-pressed={value === item}
          onClick={() => onChange(item)}
          className={cn(
            "grid size-[27px] place-items-center rounded-[5px] transition-colors",
            value === item ? "bg-ink-panel text-white" : "text-faint hover:text-ink",
          )}
        >
          <Icon size={item === "grid" ? 16 : 17} aria-hidden />
        </button>
      ))}
    </div>
  );
}
