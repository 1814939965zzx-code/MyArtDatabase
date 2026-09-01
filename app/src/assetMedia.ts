"use client";

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
