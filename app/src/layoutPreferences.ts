/** 素材库卡片宽度：拖动范围 240～400px，默认 400px（窗口宽度不变时列数随卡片宽度变化）。 */

export const ASSET_CARD_WIDTH_MIN = 240;
export const ASSET_CARD_WIDTH_MAX = 400;
export const ASSET_CARD_WIDTH_DEFAULT = 400;

const STORAGE_KEY = "artdatabase:asset-card-width:v1";

export function clampAssetCardWidth(value: number) {
  if (!Number.isFinite(value)) return ASSET_CARD_WIDTH_DEFAULT;
  return Math.min(ASSET_CARD_WIDTH_MAX, Math.max(ASSET_CARD_WIDTH_MIN, Math.round(value)));
}

export function readAssetCardWidth() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? clampAssetCardWidth(Number(stored)) : ASSET_CARD_WIDTH_DEFAULT;
  } catch {
    return ASSET_CARD_WIDTH_DEFAULT;
  }
}

export function writeAssetCardWidth(width: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clampAssetCardWidth(width)));
  } catch {
    // 本地偏好可选，写入失败不影响当前会话内的布局调整。
  }
}
