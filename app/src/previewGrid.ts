// All public steps use the displayed -100…100 scale; cell coordinates use storage units.
const MIN_STEP = 20 / 64;
// 320 covers the whole 200-unit domain with one clipped cell at very low density.
const MAX_STEP = 320;
export const PREVIEW_ASSET_WIDTH = 90;

type AssetSize = { width?: number; height?: number };

export function previewAssetAspectRatio(asset: AssetSize): string {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > 0 && height > 0 && width !== height) return height > width ? "3 / 4" : "4 / 3";
  return "1 / 1";
}

export function gridMinimumSpacing(assets: readonly AssetSize[], mode: number, assetScale: number, sceneZoom = 1): number {
  // The stack reaches 8px beyond each horizontal edge (offset cards + count badge).
  // Measure the normal footprint only; hover and drop-target enlargement are temporary.
  // Card width is compensated for scene zoom; CSS offsets and the badge are not.
  let footprint = PREVIEW_ASSET_WIDTH * assetScale + 16 * sceneZoom;
  if (mode >= 2 && assets.some((asset) => previewAssetAspectRatio(asset) === "3 / 4")) {
    footprint = Math.max(footprint, PREVIEW_ASSET_WIDTH * 4 / 3 * assetScale);
  }
  return footprint + 24;
}

export function gridStepFor(pixelsPerUnit: number, minimumSpacing: number, previous?: number): number {
  if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) return previous ?? 20;
  let step = previous ?? 20;
  const min = minimumSpacing;
  const max = minimumSpacing * (previous === undefined ? 2 : 2.4);
  while (step * pixelsPerUnit > max && step > MIN_STEP) step /= 2;
  while (step * pixelsPerUnit < min && step < MAX_STEP) step *= 2;
  return step;
}

export function centeredGridStepFor(step: number): number {
  // A complete cell straddles zero. Coarse mode has boundaries at -50/+50,
  // matching the center band; finer levels halve that band's width.
  return Math.min(100, 100 * 2 ** Math.ceil(Math.log2(step / 100)));
}

export function usesCenteredGrid(step: number, sceneZoom: number, assetScale: number): boolean {
  // Coarse cells need a complete central band even when neither zoom control is at its limit.
  return step >= 80 || sceneZoom >= 2.8 || assetScale >= 2;
}

export function gridCell(value: number, step: number, centered = false) {
  const width = (centered ? centeredGridStepFor(step) : step) * 5;
  if (centered) {
    const origin = 500 - width / 2;
    const clamped = Math.max(0, Math.min(1000 - 1e-9, value));
    const index = Math.floor((clamped - origin) / width);
    const min = Math.max(0, origin + index * width);
    const max = Math.min(1000, origin + (index + 1) * width);
    return { index, min, max, center: (min + max) / 2 };
  }
  const count = Math.ceil(1000 / width);
  const index = Math.max(0, Math.min(count - 1, Math.floor(value / width)));
  const min = index * width;
  const max = Math.min(1000, min + width);
  return { index, min, max, center: (min + max) / 2 };
}

export function gridTicksFor(step: number, centered = false): number[] {
  const width = (centered ? centeredGridStepFor(step) : step) * 5;
  if (centered) {
    const origin = 500 - width / 2;
    const ticks = [0];
    for (let index = Math.ceil(-origin / width); index <= Math.floor((1000 - origin) / width); index++) {
      const tick = origin + index * width;
      if (tick > 0 && tick < 1000) ticks.push(tick);
    }
    return [...ticks, 1000];
  }
  const ticks = Array.from({ length: Math.ceil(1000 / width) }, (_, index) => index * width);
  return [...ticks, 1000];
}

export function gridCellKey(values: number[], step: number, centered = false): string {
  return values.map((value) => gridCell(value, step, centered).index).join(":");
}

/** Clustering partitions each visible grid cell by sign; the grid lines stay unchanged. */
export function gridClusterCell(value: number, step: number, centered = false) {
  const cell = gridCell(value, step, centered);
  const sign = value < 500 ? "-" : value > 500 ? "+" : "0";
  const min = value < 500 ? cell.min : Math.max(500, cell.min);
  const max = value > 500 ? cell.max : Math.min(500, cell.max);
  return { ...cell, min, max, center: (min + max) / 2, key: `${cell.index}:${sign}` };
}

export function gridClusterKey(values: number[], step: number, centered = false): string {
  return values.map((value) => gridClusterCell(value, step, centered).key).join("|");
}

export function zoomPanAtPointer(
  pan: { x: number; y: number },
  pointer: { x: number; y: number },
  currentZoom: number,
  nextZoom: number,
) {
  const ratio = nextZoom / currentZoom;
  return {
    x: pointer.x - (pointer.x - pan.x) * ratio,
    y: pointer.y - (pointer.y - pan.y) * ratio,
  };
}
