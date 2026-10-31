import { Sparkles } from "lucide-react";
import { cn } from "../../ui";

/** 品牌方块：登录页、侧栏共用。尺寸由调用方决定。 */
export function BrandMark({ size = 34, radius = 8, className }: { size?: number; radius?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid flex-none place-items-center bg-accent text-white", className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Sparkles size={Math.round(size * 0.5)} />
    </span>
  );
}
