import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 className：
 * - clsx 处理条件值（false / null / 数组 / 对象）
 * - tailwind-merge 消除冲突的 utility（后写的覆盖先写的）
 *
 * 原语必须把外部传入的 className 放在最后，保证调用方可覆盖内部默认样式。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
