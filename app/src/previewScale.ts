/** 图片缩放系数的取值范围。 */
export const PREVIEW_SCALE_MIN = 0.5;
export const PREVIEW_SCALE_MAX = 2;
/** 自动挡位的上限（手动仍可到 200%）。 */
export const PREVIEW_SCALE_AUTO_MAX = 1.5;

export type PreviewScalePreference = { mode: "auto" | "manual"; value: number };

const SCALE_STORAGE_KEY = "artdatabase:preview-scale:v2";
const LEGACY_SCALE_KEY = "artdatabase:preview-asset-scale:v1";

function clampScale(value: number) {
  return Math.min(PREVIEW_SCALE_MAX, Math.max(PREVIEW_SCALE_MIN, value));
}

/**
 * 自动挡位：按浏览器窗口的 CSS 像素选择图片基准尺寸。
 * 1366×768 一类小屏落到 70%，1600×900 一类落到 100%，1920×1080 及以上到 150%。
 * 用窗口尺寸而不是预览场景尺寸：专注模式、侧栏收起不应改变图片大小。
 */
export function autoAssetScaleForViewport(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  if (width < 1440 || height < 800) return clampScale(0.7);
  if (width < 1920 || height < 900) return clampScale(1);
  return PREVIEW_SCALE_AUTO_MAX;
}

function parseStoredPreference(raw: string | null): PreviewScalePreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const mode = (parsed as { mode?: unknown }).mode;
    if (mode !== "auto" && mode !== "manual") return null;
    if (mode === "auto") return { mode: "auto", value: 1 };
    const rawValue = (parsed as { value?: unknown }).value;
    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(value) || value < PREVIEW_SCALE_MIN || value > PREVIEW_SCALE_MAX) return null;
    return { mode: "manual", value };
  } catch {
    return null;
  }
}

/**
 * 解析偏好：v2 优先；没有 v2 时迁移 v1。
 * 旧版本在挂载时会把默认 100% 写进 v1，所以 v1 为 1 或缺失都视为“没有手动设置过”，走自动；
 * v1 为其他合法值才视为手动。v2 是显式偏好，manual 的 1 也会保持手动。
 */
export function parsePreviewScalePreference(stored: string | null, legacy: string | null): PreviewScalePreference {
  const current = parseStoredPreference(stored);
  if (current) return current;
  if (legacy !== null) {
    const value = Number(legacy);
    if (Number.isFinite(value) && value >= PREVIEW_SCALE_MIN && value <= PREVIEW_SCALE_MAX && Math.abs(value - 1) > 1e-9) {
      return { mode: "manual", value };
    }
  }
  return { mode: "auto", value: 1 };
}

export function readPreviewScalePreference(): PreviewScalePreference {
  try {
    return parsePreviewScalePreference(
      window.localStorage.getItem(SCALE_STORAGE_KEY),
      window.localStorage.getItem(LEGACY_SCALE_KEY),
    );
  } catch {
    return { mode: "auto", value: 1 };
  }
}

export function writePreviewScalePreference(preference: PreviewScalePreference) {
  try {
    window.localStorage.setItem(SCALE_STORAGE_KEY, JSON.stringify({
      mode: preference.mode,
      value: preference.mode === "manual" ? clampScale(preference.value) : 1,
    }));
  } catch {
    // 本地偏好可选，写入失败不影响当前会话。
  }
}
