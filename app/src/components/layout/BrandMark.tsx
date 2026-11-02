import { cn } from "../../ui";

/** 品牌图标：登录页、侧栏共用，与浏览器标签页图标保持一致。 */
export function BrandMark({ size = 34, radius = 8, className }: { size?: number; radius?: number; className?: string }) {
  return (
    <img
      src="/favicon.svg"
      alt=""
      aria-hidden
      draggable={false}
      className={cn("flex-none select-none", className)}
      style={{ width: size, height: size, borderRadius: radius }}
    />
  );
}
