import { useEffect, useState } from "react";

/**
 * 素材详情大图渐进加载：
 * 先展示缩略图占位，同时后台预加载原图，原图下载完成后自动替换，避免打开详情时长时间空白。
 * 素材切换时立即回到缩略图，并丢弃上一个素材的未完成请求。
 */
export function useProgressiveImage(thumbnailUrl: string | null, originalUrl: string | null): string | null {
  const [src, setSrc] = useState<string | null>(thumbnailUrl);

  useEffect(() => {
    setSrc(thumbnailUrl);
    if (!originalUrl) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setSrc(originalUrl);
    };
    image.src = originalUrl;
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [thumbnailUrl, originalUrl]);

  return src;
}
