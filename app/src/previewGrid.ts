// All public divisions use the displayed -100…100 scale; cell coordinates use storage units.
const MIN_DIVISIONS = 1;
const MAX_DIVISIONS = 256;
export const PREVIEW_ASSET_WIDTH = 90;
/** 收起堆最多展示的缩略图数量：2×2 矩阵。 */
export const PREVIEW_STACK_VISIBLE = 4;

type AssetSize = { width?: number; height?: number };

/**
 * 收起堆的缩略图只取成员队列的前 4 个。
 * 顺序必须保持调用方传入的稳定顺序（页面素材列表顺序），不能按当前视角的深度重排：
 * 旋转视角时深度会连续变化，按深度取前几张会让缩略图在堆里来回跳动。
 */
export function stackPreviewMembers<T>(members: readonly T[]): T[] {
  return members.slice(0, PREVIEW_STACK_VISIBLE);
}

/**
 * 展开平面在打开瞬间按当前视角从前往后排序；展开期间不再重算，所以不会跳动。
 * 深度相同的成员保持原顺序（稳定排序）。
 */
export function orderByViewDepth<T>(items: readonly T[], depthOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, depth: depthOf(item) }))
    .sort((left, right) => right.depth - left.depth || left.index - right.index)
    .map(({ item }) => item);
}

export function previewAssetAspectRatio(asset: AssetSize): string {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > 0 && height > 0 && width !== height) return height > width ? "3 / 4" : "4 / 3";
  return "1 / 1";
}

export function gridMinimumSpacing(assets: readonly AssetSize[], mode: number, assetScale: number, sceneZoom = 1): number {
  // A collapsed stack keeps one image's square footprint; its count badge overhangs the top-right by 8px.
  // Keep the existing 16px allowance so density stays consistent with the previous stack rendering.
  // Measure the normal footprint only; hover and drop-target enlargement are temporary.
  // Card width is compensated for scene zoom; CSS offsets and the badge are not.
  let footprint = PREVIEW_ASSET_WIDTH * assetScale + 16 * sceneZoom;
  if (mode >= 2 && assets.some((asset) => previewAssetAspectRatio(asset) === "3 / 4")) {
    footprint = Math.max(footprint, PREVIEW_ASSET_WIDTH * 4 / 3 * assetScale);
  }
  return footprint + 24;
}

/**
 * 收起堆的成员顺序：
 * - 1D：按唯一维度值升序，小值在前；
 * - 2D：先按 y 升序成行，行内按 x 升序（由 orderStackGrid 按实际列数切行）；
 * - 3D：保持页面素材顺序，展开平面仍在打开时按深度排序。
 */
export function orderStackMembers<T>(members: readonly T[], mode: number, xOf: (member: T) => number, yOf: (member: T) => number): T[] {
  if (mode === 1) return [...members].sort((left, right) => xOf(left) - xOf(right));
  if (mode === 2) return [...members].sort((left, right) => yOf(left) - yOf(right));
  return [...members];
}

/**
 * 2D 网格排序：y 小的在上方行，x 小的在行内左侧。
 * 先按 y 稳定排序并每 columns 个切成一行，再对行内按 x 升序。
 */
export function orderStackGrid<T>(members: readonly T[], columns: number, xOf: (member: T) => number, yOf: (member: T) => number): T[] {
  if (!(columns > 1) || members.length <= 1) return [...members];
  const sorted = [...members].sort((left, right) => yOf(left) - yOf(right));
  const result: T[] = [];
  for (let index = 0; index < sorted.length; index += columns) {
    const row = sorted.slice(index, index + columns);
    row.sort((left, right) => xOf(left) - xOf(right));
    result.push(...row);
  }
  return result;
}

/**
 * 选择每半轴的等分格数 n：n = 1/2/3/4/5… 按 +1 递增，整轴格数 2n 始终为偶数。
 * 首次按当前像素间距直接取能保持格距不小于 M 的最大 n；之后格距超出 2.4M 时 n+1、
 * 小于 M 时 n-1，保持等分并按单格递增/递减。max n=256（格距 0.390625）。
 */
export function gridDivisionsFor(pixelsPerUnit: number, minimumSpacing: number, previous?: number): number {
  const spacing = Math.max(1, minimumSpacing);
  if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit)) return previous ?? 5;
  const initial = Math.max(MIN_DIVISIONS, Math.min(MAX_DIVISIONS, Math.floor((100 * pixelsPerUnit) / spacing)));
  let divisions = Math.max(MIN_DIVISIONS, Math.min(MAX_DIVISIONS, previous ?? initial));
  const max = spacing * (previous === undefined ? 2 : 2.4);
  let guard = 0;
  while ((100 / divisions) * pixelsPerUnit > max && divisions < MAX_DIVISIONS && guard++ < MAX_DIVISIONS) divisions += 1;
  while ((100 / divisions) * pixelsPerUnit < spacing && divisions > MIN_DIVISIONS && guard++ < MAX_DIVISIONS) divisions -= 1;
  return divisions;
}

/** 格子边界固定经过 0；正负两半分别从 0 向 ±100 等分 n 格。 */
export function gridCell(value: number, divisionsInput: number) {
  const divisions = Math.max(MIN_DIVISIONS, Math.min(MAX_DIVISIONS, Math.round(divisionsInput)));
  const width = 500 / divisions;
  const clamped = Math.max(0, Math.min(1000 - 1e-9, value));
  if (clamped < 500) {
    const index = Math.max(0, Math.min(divisions - 1, Math.floor(clamped / width)));
    const min = index * width;
    const max = Math.min(500, min + width);
    return { index, min, max, center: (min + max) / 2 };
  }
  const index = Math.max(0, Math.min(divisions - 1, Math.floor((clamped - 500) / width)));
  const min = 500 + index * width;
  const max = index === divisions - 1 ? 1000 : Math.min(1000, min + width);
  return { index, min, max, center: (min + max) / 2 };
}

export function gridTicksFor(divisionsInput: number): number[] {
  const divisions = Math.max(MIN_DIVISIONS, Math.min(MAX_DIVISIONS, Math.round(divisionsInput)));
  const width = 500 / divisions;
  const ticks = Array.from({ length: divisions * 2 + 1 }, (_, index) => index * width);
  ticks[divisions] = 500;
  ticks[ticks.length - 1] = 1000;
  return ticks;
}

/** 格子键带方向，保证 0 两侧的格子不会因为索引相同而被当成同一格。 */
export function gridCellKey(values: number[], divisions: number): string {
  return values
    .map((value) => `${value < 500 ? "-" : "+"}:${gridCell(value, divisions).index}`)
    .join(":");
}

/** Clustering partitions each visible grid cell by sign; the grid lines stay unchanged. */
export function gridClusterCell(value: number, divisions: number) {
  const cell = gridCell(value, divisions);
  const sign = value < 500 ? "-" : value > 500 ? "+" : "0";
  const min = value < 500 ? cell.min : Math.max(500, cell.min);
  const max = value > 500 ? cell.max : Math.min(500, cell.max);
  return { ...cell, min, max, center: (min + max) / 2, key: `${cell.index}:${sign}` };
}

export function gridClusterKey(values: number[], divisions: number): string {
  return values.map((value) => gridClusterCell(value, divisions).key).join("|");
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
