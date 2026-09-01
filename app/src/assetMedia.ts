"use client";

import { useEffect, useMemo, useRef } from "react";

/** 视频素材判定与时长格式化（图片素材 duration 恒为 0，transcodeStatus 为 null）。 */

export function isVideoMime(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("video/");
}

export function formatDuration(ms: number | null | undefined): string {
  const totalSeconds = Math.max(0, Math.round((ms ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 视频转码状态判断（图片素材视为始终可展示）。 */
export type VideoStatus = "ready" | "processing" | "failed" | null;

export function videoStatusOf(mimeType: string | null | undefined, transcodeStatus: string | null | undefined): VideoStatus {
  if (!isVideoMime(mimeType)) return null;
  return transcodeStatus === "ready" || transcodeStatus === "processing" || transcodeStatus === "failed"
    ? (transcodeStatus as VideoStatus)
    : "processing";
}

/** 转码进度百分比（0～100，非转码中返回 0）。 */
export function transcodePercent(progress: number | null | undefined): number {
  const value = Math.round(progress ?? 0);
  return Math.max(0, Math.min(100, value));
}

/**
 * 转码进度轮询：只要素材列表里存在转码中的视频，就每 2 秒调用一次 refresh，
 * 直到全部完成/失败；refresh 用 ref 持有，避免外部函数引用变化导致定时器反复重建。
 */
export function useTranscodePolling<T extends { mimeType: string; transcodeStatus: string | null }>(
  assets: T[] | undefined,
  refresh: () => void,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const hasProcessing = useMemo(
    () => (assets ?? []).some((asset) => isVideoMime(asset.mimeType) && asset.transcodeStatus === "processing"),
    [assets],
  );
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => refreshRef.current(), 2000);
    return () => clearInterval(timer);
  }, [hasProcessing]);
}
