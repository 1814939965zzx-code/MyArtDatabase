"use client";

import { Aperture, Box, Bug, Images, Maximize2, Minimize2, Minus, MousePointer2, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { CSSProperties, PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, IconButton, RangeSlider, SyncStatusDot, TagLabel, cn } from "./ui";
import { useViewportGestures } from "./useViewportGestures";
import { displayDimensionValue } from "./dimensionScale";
import { gridClusterCell, gridClusterKey, gridDivisionsFor, gridMinimumSpacing, gridTicksFor, orderByViewDepth, orderStackGrid, orderStackMembers, PREVIEW_ASSET_WIDTH, previewAssetAspectRatio as aspectRatioFor, stackPreviewMembers, zoomPanAtPointer } from "./previewGrid";

type Dimension = { id: string; leftLabel: string; rightLabel: string };
type Asset = { id: string; name: string; thumbnailUrl: string | null; dimensionValues: Record<string, number>; width?: number; height?: number };
type CameraDrag = { pointerId: number; startX: number; startY: number; rotateX: number; rotateZ: number; assetId?: string; moved: boolean };
type ViewPan = { pointerId: number; startX: number; startY: number; panX: number; panY: number };
type AxisSign = -1 | 1;
type Octant = { x: AxisSign; y: AxisSign; z: AxisSign };
const octantKeyOf = (octant: Octant) => `${octant.x},${octant.y},${octant.z}`;
type OctantAxis = "x" | "y" | "z";
const OCTANT_AXES: OctantAxis[] = ["x", "y", "z"];
/** 选中集合在三维上始终是一个轴对齐的小立方块——1 / 2（棱）/ 4（面）/ 8（整块）格。 */
type OctantBounds = Record<OctantAxis, [AxisSign, AxisSign]>;

function octantBounds(octants: Octant[]): OctantBounds | null {
  if (!octants.length) return null;
  const range = (axis: OctantAxis): [AxisSign, AxisSign] => {
    const values = octants.map((octant) => octant[axis]);
    return [Math.min(...values) as AxisSign, Math.max(...values) as AxisSign];
  };
  return { x: range("x"), y: range("y"), z: range("z") };
}

/** 展开成盒子里的全部格子。 */
function octantsInBounds(bounds: OctantBounds): Octant[] {
  const signs: AxisSign[] = [-1, 1];
  const span = (axis: OctantAxis) => (bounds[axis][0] === bounds[axis][1] ? [bounds[axis][0]] : signs);
  return span("x").flatMap((x) => span("y").flatMap((y) => span("z").map((z) => ({ x, y, z }))));
}

/** 盒子里与基准格相对的远角（收缩后用它作为新的「当前格」，再点它即可回退）。 */
function octantFarCorner(bounds: OctantBounds, anchor: Octant): Octant {
  const pick = (axis: OctantAxis): AxisSign =>
    bounds[axis][0] !== bounds[axis][1] ? (anchor[axis] === 1 ? -1 : 1) : bounds[axis][0];
  return { x: pick("x"), y: pick("y"), z: pick("z") };
}
/** 选中象限并集的中心：单选=该格中心，选两格=两格中点，选满 8 格=回到原点。 */
function octantPivotCenter(octants: Octant[], planeSize: number) {
  if (!octants.length || !planeSize) return { x: 0, y: 0, z: 0 };
  const centerOf = (values: AxisSign[]) => (Math.min(...values) + Math.max(...values)) / 2;
  return {
    x: centerOf(octants.map((octant) => octant.x)) * planeSize / 4,
    y: -centerOf(octants.map((octant) => octant.y)) * planeSize / 4,
    z: centerOf(octants.map((octant) => octant.z)) * planeSize / 4,
  };
}
// Ctrl/Cmd+Z 撤销：记录一次拖动前实际变化的维度值
type DimensionUndoEntry = { assetId: string; before: Record<string, number> };
type AssetDrag = {
  pointerId: number;
  assetId: string;
  startX: number;
  startY: number;
  startValues: Record<string, number>;
  startLocalX: number;
  startLocalY: number;
  startLocalZ: number;
  grabOffsetX: number;
  grabOffsetY: number;
  moved: boolean;
};
// Tab 切换焦点的目标：单张图片或堆（堆展开为悬浮平面）
type FocusTarget = { id: string; stack: boolean };
const sameTarget = (a: FocusTarget | null, b: FocusTarget | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.stack === b.stack);
// hover 单张图片时渲染在 3D 场景之外的前景层：坐标相对 scene-viewport，不参与深度排序
type HoverPreview = {
  asset: Asset;
  values: Record<string, number>;
  left: number;
  top: number;
  width: number;
  height: number;
  closing?: boolean;
};
// 缩放导致聚堆重组时的 FLIP 快照：按素材记录当前屏幕位置与可见表示
type FlipLayoutEntry = {
  left: number;
  top: number;
  width: number;
  height: number;
  x: number;
  y: number;
  key: string;
  element: HTMLElement | null;
  src: string | null;
  text: string | null;
};
type FlipLayout = Map<string, FlipLayoutEntry>;
const CLUSTER_FLIP_DURATION = 200;

/** 顶部浮层（素材详情、弹窗、确认框）打开时，Esc 优先关闭浮层，不退出专注模式。 */
function hasOpenOverlay() {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], .modal-backdrop, .dimension-editor-backdrop, .asset-drawer, .frame-delete-backdrop'));
}

/** 弹窗/确认框打开时把撤销快捷键让给浮层（素材详情抽屉不阻塞撤销）。 */
function hasBlockingOverlay() {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"], .modal-backdrop, .dimension-editor-backdrop, .frame-delete-backdrop'));
}

const clampValue = (value: number) => Math.max(0, Math.min(1000, Math.round(value)));
const wrapRotation = (value: number) => ((value % 360) + 360) % 360;
const SCENE_PERSPECTIVE = 2200;
const PLANE_CARD_SIZE = PREVIEW_ASSET_WIDTH;
const PLANE_CARD_GAP = 12;
// hover 时其余图层统一退后：没有景深模糊的对象加统一模糊，所有非 hover 对象叠加 50% 画布底色
const HOVER_FOCUS_BLUR = 4;
const HOVER_FOCUS_SCRIM = "0.5";

/** 展开平面的网格列数/行数与平面尺寸（与渲染共用）；cardSize 随图片缩放系数调整。 */
function planeDimensions(count: number, cardSize = PLANE_CARD_SIZE) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return {
    columns,
    rows,
    width: columns * cardSize + (columns - 1) * PLANE_CARD_GAP + 56,
    height: rows * cardSize + (rows - 1) * PLANE_CARD_GAP + 34,
  };
}

// 景深：以原点（0,0,0，即 worldZ=0）为焦点，更远离摄像机的目标同时得到两种表现：
// 1) 模糊；2) 叠加一层画布底色，深度越大越不透明（远处目标逐渐融进背景）。
const DOF_MAX_BLUR = 50;
const DOF_BLUR_DEPTH = 30;
const DOF_MAX_FOG = 0.55;
const DOF_FOG_DEPTH = 400;
function depthDefocus(worldZ: number): { blur: number; fog: number } {
  if (worldZ >= 0) return { blur: 0, fog: 0 };
  return {
    blur: Math.round(Math.min(DOF_MAX_BLUR, -worldZ / DOF_BLUR_DEPTH) * 2) / 2, // 0.5px 步进，减少旋转时的每帧抖动
    fog: Math.min(DOF_MAX_FOG, Math.round((-worldZ / DOF_FOG_DEPTH) * 100) / 100), // 1% 步进
  };
}
function depthBlurStyle(worldZ: number): CSSProperties | undefined {
  const { blur } = depthDefocus(worldZ);
  return blur > 0 ? { filter: `blur(${blur}px)` } : undefined;
}
/** 供 `.preview-asset-face::after` / `.preview-scene-tag::after` 读取的雾化强度。 */
function depthFogStyle(worldZ: number): CSSProperties | undefined {
  const { fog } = depthDefocus(worldZ);
  return fog > 0 ? ({ "--dof-fog": `${fog}` } as CSSProperties) : undefined;
}

type Cluster = {
  key: string;
  cellKey: string;
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
  members: Asset[];
  x: number;
  y: number;
  z: number;
  meanDepth: number;
  screenX: number;
  screenY: number;
};

function AxisFaces() {
  return (
    <>
      <i className="axis-face face-front" />
      <i className="axis-face face-back" />
      <i className="axis-face face-top" />
      <i className="axis-face face-bottom" />
    </>
  );
}

export function DimensionPreview({
  dimensions,
  assets,
  onSelectAsset,
  onUpdateAssetDimensions,
  onAddDimension,
  onEditDimension,
  selectedIds,
  onSelectedIdsChange,
  onMessage,
  syncStatus = "synced",
  onRetrySync,
  readOnly = false,
}: {
  dimensions: Dimension[];
  assets: Asset[];
  onSelectAsset: (assetId: string, navigation?: string[] | null) => void;
  onUpdateAssetDimensions: (assetId: string, values: Record<string, number>) => Promise<boolean>;
  onAddDimension: () => void;
  onEditDimension: (dimension: Dimension) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onMessage?: (message: string) => void;
  syncStatus?: "synced" | "saving" | "offline";
  onRetrySync?: () => void;
  /** 游客只读：可切换维度轴、缩放/平移与打开详情，但不能拖动改坐标或增删维度。 */
  readOnly?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const gestureZoomRef = useRef(zoom);
  gestureZoomRef.current = zoom;
  const [rotateX, setRotateX] = useState(52);
  const [rotateZ, setRotateZ] = useState(352);
  const [cameraMoving, setCameraMoving] = useState(false);
  const [viewPanning, setViewPanning] = useState(false);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [isolatedOctants, setIsolatedOctants] = useState<Octant[]>([]);
  // 立方体选择器：首次点选的格子作为基准，后续点击与它的连线决定 棱 / 面 / 整块
  const [octantAnchor, setOctantAnchor] = useState<Octant | null>(null);
  // 当前盒子的「操作格」：最后一次改变盒子的格子；再点它 = 沿历史回退
  const [octantHandle, setOctantHandle] = useState<Octant | null>(null);
  // 每次盒子变化前的快照，用于「沿历史路径回退」
  const octantHistory = useRef<Array<{ octants: Octant[]; handle: Octant }>>([]);
  const [hoverOctant, setHoverOctant] = useState<Octant | null>(null);
  const [octantTransitioning, setOctantTransitioning] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({});
  const [sceneSize, setSceneSize] = useState(0);
  const [gridDivisions, setGridDivisions] = useState<number | undefined>(undefined);
  // 图片缩放系数：作用于预览场景内所有图片（单张/堆/展开平面卡片），100% 为默认 90px；localStorage 记住
  const [assetScale, setAssetScale] = useState<number>(() => {
    try {
      const stored = window.localStorage.getItem("artdatabase:preview-asset-scale:v1");
      if (stored) {
        const value = Number(stored);
        if (Number.isFinite(value) && value >= 0.5 && value <= 2) return value;
      }
    } catch { /* 本地偏好可选 */ }
    return 1;
  });
  // 开发调试开关：绘制聚簇范围（生产构建中该分支被构建期剔除）
  const debugEnabled = import.meta.env.DEV;
  const [showClusterDebug, setShowClusterDebug] = useState(false);
  const [blurEnabled, setBlurEnabled] = useState(true);
  const scenePlaneRef = useRef<HTMLDivElement>(null);
  const sceneViewportRef = useRef<HTMLDivElement>(null);
  const cameraDrag = useRef<CameraDrag | null>(null);
  const viewPanDrag = useRef<ViewPan | null>(null);
  const assetDrag = useRef<AssetDrag | null>(null);
  const dragValues = useRef<Record<string, number>>({});
  const spaceHeldRef = useRef(false);
  const hoveredAssetIdRef = useRef<string | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);
  // Tab 切换前后遮挡图片焦点：hover 锚点（鼠标实际所指的图片/堆）、按深度排序的循环列表与当前下标
  const hoverAnchorRef = useRef<FocusTarget | null>(null);
  const focusCycleRef = useRef<FocusTarget[]>([]);
  const focusIndexRef = useRef(0);
  // 鼠标当前是否在预览画布（scene-viewport）内，用于拦截默认 Tab 焦点切换
  const pointerInSceneRef = useRef(false);
  // 缩放聚堆 FLIP：屏幕空间幽灵层、上一帧布局与缩放/档位状态
  const flipGhostLayerRef = useRef<HTMLDivElement>(null);
  const flipStateRef = useRef<{ map: FlipLayout; at: number } | null>(null);
  const flipAnimationsRef = useRef(new WeakMap<HTMLElement, Animation>());
  const lastScaleRef = useRef({ zoom, assetScale });
  const lastGridDivisionsRef = useRef<number | null>(null);
  const lastScaleChangeAtRef = useRef(0);
  const [planeCluster, setPlaneCluster] = useState<Cluster | null>(null);
  const [closingCluster, setClosingCluster] = useState<Cluster | null>(null);
  const [draggingPlaneAssetId, setDraggingPlaneAssetId] = useState<string | null>(null);
  const [planeDragDelta, setPlaneDragDelta] = useState({ x: 0, y: 0 });
  const [dropTargetClusterKey, setDropTargetClusterKey] = useState<string | null>(null);
  const planeClusterRef = useRef<Cluster | null>(null);
  const planeDrag = useRef<{ pointerId: number; assetId: string; startX: number; startY: number; startValues: Record<string, number>; moved: boolean } | null>(null);
  const planeDragJustMoved = useRef(false);
  const planeCloseTimer = useRef<number | null>(null);
  // ---- 撤销 / 平移手势状态 ----
  const undoStack = useRef<DimensionUndoEntry[]>([]);
  const onUpdateRef = useRef(onUpdateAssetDimensions);
  onUpdateRef.current = onUpdateAssetDimensions;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  // 中键 / 空格+左键平移：移动过视图后抑制随后的点击，避免误触平面卡片
  const panMovedRef = useRef(false);
  const suppressClickAfterPan = useRef(false);

  const selected = useMemo(
    () => selectedIds.map((id) => dimensions.find((dimension) => dimension.id === id)).filter(Boolean) as Dimension[],
    [dimensions, selectedIds],
  );
  const mode = selected.length;
  // hover 单张/堆期间，其余图片、堆与坐标 tag 统一失焦、压暗，网格与坐标线降透明度
  const hoverFocusActive = (hoverPreview !== null && !hoverPreview.closing) || hoveredAssetId !== null || planeCluster !== null || closingCluster !== null;
  const effectiveDimensionValue = (asset: Asset, dimensionId: string) => overrides[asset.id]?.[dimensionId] ?? asset.dimensionValues[dimensionId] ?? 500;
  const minimumGridSpacing = useMemo(() => gridMinimumSpacing(
    assets.filter((asset) => assetBelongsToIsolatedOctant(asset.dimensionValues)),
    mode,
    assetScale,
    zoom,
  ), [assets, mode, assetScale, zoom, selected, isolatedOctants]);
  useEffect(() => {
    if (sceneSize > 0) setGridDivisions((previous) => gridDivisionsFor(sceneSize * zoom / 200, minimumGridSpacing, previous));
  }, [sceneSize, zoom, minimumGridSpacing]);
  useEffect(() => () => {
    if (hoverCloseTimer.current !== null) window.clearTimeout(hoverCloseTimer.current);
  }, []);
  const densityGridDivisions = gridDivisions ?? gridDivisionsFor(sceneSize * zoom / 200, minimumGridSpacing);
  // 每个半轴等分：0 始终是格子边界，正负两半各分成 n 格（n 按 +1 序列）。
  const activeGridDivisions = densityGridDivisions;
  const gridTicks = useMemo(() => gridTicksFor(activeGridDivisions), [activeGridDivisions]);
  const sceneRotateX = ((rotateX + 180) % 360 + 360) % 360 - 180;
  const sceneRotateZ = ((rotateZ + 180) % 360 + 360) % 360 - 180;
  // 轴端点与角落组合的 tag 始终朝向摄像机：反向抵消场景旋转
  const billboardStyle = {
    "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
    "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
  } as CSSProperties;
  const planeSize = scenePlaneRef.current?.offsetWidth ?? 0;
  const scenePivot = octantPivotCenter(isolatedOctants, planeSize);

  // 右上角 8 格立方体：与场景共用同一组俯仰/水平角度做正交投影，只负责选中象限，不改变主视图。
  // 8 个格子 = 空间八个象限；每个格子只画朝外的三个面，背面按法线深度剔除，再按远近排序保证近处在上层。
  const octantCubeFacets = useMemo(() => {
    if (mode !== 3) return [];
    const radius = 30;
    const pitch = rotateX * Math.PI / 180;
    const yaw = rotateZ * Math.PI / 180;
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const project = (x: number, y: number, z: number) => {
      const alongX = cosYaw * x - sinYaw * y;
      const alongY = sinYaw * x + cosYaw * y;
      return {
        x: alongX * radius,
        y: (cosPitch * alongY - sinPitch * z) * radius,
        depth: sinPitch * alongY + cosPitch * z,
      };
    };
    const facets: Array<{ key: string; octant: Octant; points: string; depth: number }> = [];
    for (const signX of [-1, 1] as AxisSign[]) {
      for (const signY of [-1, 1] as AxisSign[]) {
        for (const signZ of [-1, 1] as AxisSign[]) {
          // 场景中 y=1 是屏幕上方（世界 y 为负），立方体沿用同一朝向
          const y = -signY;
          const faces: Array<{ normal: [number, number, number]; corners: Array<[number, number, number]> }> = [
            { normal: [signX, 0, 0], corners: [[signX, 0, 0], [signX, y, 0], [signX, y, signZ], [signX, 0, signZ]] },
            { normal: [0, y, 0], corners: [[0, y, 0], [signX, y, 0], [signX, y, signZ], [0, y, signZ]] },
            { normal: [0, 0, signZ], corners: [[0, 0, signZ], [signX, 0, signZ], [signX, y, signZ], [0, y, signZ]] },
          ];
          for (const face of faces) {
            const [normalX, normalY, normalZ] = face.normal;
            // 面法线在投影深度方向上的分量 > 0 才朝向摄像机，否则是背面
            const facing = sinPitch * (sinYaw * normalX + cosYaw * normalY) + cosPitch * normalZ;
            if (facing <= 0) continue;
            const projected = face.corners.map(([x, cornerY, z]) => project(x, cornerY, z));
            // 正对某条轴时会出现零面积退化面，跳过以免 SVG 描边画出一条多余细线
            const area = Math.abs(projected.reduce((sum, point, index) => {
              const next = projected[(index + 1) % projected.length];
              return sum + point.x * next.y - next.x * point.y;
            }, 0)) / 2;
            if (area < 0.6) continue;
            facets.push({
              key: `${signX},${signY},${signZ}|${normalX},${normalY},${normalZ}`,
              octant: { x: signX, y: signY, z: signZ },
              points: projected.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "),
              depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length,
            });
          }
        }
      }
    }
    facets.sort((a, b) => a.depth - b.depth);
    return facets;
  }, [mode, rotateX, rotateZ]);

  // 与渲染管线同源的投影：由 unprojectPointerToPlane 反解，屏幕坐标相对平面中心；用于深度与堆屏幕定位等展示用途
  const projectValuePoint = (xValue: number, yValue: number, zValue: number) => {
    const planeSize = sceneSize || scenePlaneRef.current?.offsetWidth || 0;
    if (!planeSize) return null;
    const pitch = (mode === 3 ? rotateX : 0) * Math.PI / 180;
    const yaw = (mode === 3 ? rotateZ : 0) * Math.PI / 180;
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const localX = (xValue / 1000 - .5) * planeSize;
    const localY = (yValue / 1000 - .5) * planeSize;
    const localZ = zValue * planeSize / 1000;
    const centeredX = localX - scenePivot.x;
    const centeredY = localY - scenePivot.y;
    const centeredZ = localZ - scenePivot.z;
    const alongX = cosYaw * centeredX - sinYaw * centeredY;
    const alongY = sinYaw * centeredX + cosYaw * centeredY;
    const worldZ = sinPitch * alongY + cosPitch * centeredZ;
    const denominator = SCENE_PERSPECTIVE - zoom * worldZ;
    if (denominator < 1) return null;
    const worldAlongY = cosPitch * alongY - sinPitch * centeredZ;
    return {
      screenX: zoom * SCENE_PERSPECTIVE * alongX / denominator,
      screenY: zoom * SCENE_PERSPECTIVE * worldAlongY / denominator,
      worldZ,
    };
  };

  const { clusters, clusterOf } = useMemo(() => {
    const clusters: Cluster[] = [];
    const clusterOf = new Map<string, string>();
    if (!mode || !sceneSize) return { clusters, clusterOf };
    type Entry = { asset: Asset; worldZ: number; values: number[] };
    const groups = new Map<string, Entry[]>();
    for (const asset of assets) {
      if (asset.id === draggingAssetId || asset.id === draggingPlaneAssetId) continue;
      const values = { ...asset.dimensionValues, ...overrides[asset.id] };
      if (!assetBelongsToIsolatedOctant(values)) continue;
      const coordinates = selected.map((dimension) => values[dimension.id] ?? 500);
      const projected = projectValuePoint(coordinates[0], mode >= 2 ? 1000 - coordinates[1] : 500, mode === 3 ? coordinates[2] - 500 : 0);
      if (!projected) continue;
      const cellKey = gridClusterKey(coordinates, activeGridDivisions);
      const group = groups.get(cellKey) ?? [];
      group.push({ asset, worldZ: projected.worldZ, values: coordinates });
      groups.set(cellKey, group);
    }
    for (const [cellKey, group] of groups) {
      if (group.length < 2) continue;
      // 边缘格裁切到定义域；隔离时再按该堆自身所属象限裁切到可见半空间（多选时不同堆属于不同象限）
      const cells = group[0].values.map((value) => {
        const cell = gridClusterCell(value, activeGridDivisions);
        const sign = isolatedOctants.length ? (value > 500 ? 1 : value < 500 ? -1 : 0) : null;
        const min = sign === 1 ? Math.max(500, cell.min) : cell.min;
        const max = sign === -1 ? Math.min(500, cell.max) : cell.max;
        return { min, max, center: (min + max) / 2 };
      });
      const x = cells[0].center;
      const y = mode >= 2 ? 1000 - cells[1].center : 500;
      const z = mode === 3 ? cells[2].center - 500 : 0;
      const key = `s:axis:${activeGridDivisions}:${cellKey}:${group.map((entry) => entry.asset.id).sort().join(",")}`;
      const projected = projectValuePoint(x, y, z);
      const ordered = orderStackMembers(group, mode, (entry) => entry.values[0], (entry) => entry.values[1] ?? 500);
      clusters.push({
        key, cellKey,
        // 1D/2D 按维度值排成列表/网格；3D 保持页面素材顺序，展开平面再按深度排序
        members: ordered.map((entry) => entry.asset),
        x, y, z,
        bounds: {
          x: [cells[0].min, cells[0].max],
          y: mode >= 2 ? [1000 - cells[1].max, 1000 - cells[1].min] : [500, 500],
          z: mode === 3 ? [cells[2].min - 500, cells[2].max - 500] : [0, 0],
        },
        meanDepth: group.reduce((sum, entry) => sum + entry.worldZ, 0) / group.length,
        screenX: projected?.screenX ?? 0,
        screenY: projected?.screenY ?? 0,
      });
      for (const entry of group) clusterOf.set(entry.asset.id, key);
    }
    return { clusters, clusterOf };
  }, [assets, mode, selected, activeGridDivisions, sceneSize, scenePivot.x, scenePivot.y, scenePivot.z, isolatedOctants, overrides, draggingAssetId, draggingPlaneAssetId, rotateX, rotateZ]);
  /**
   * 详情页左右切换的顺序：
   * - 1D：Page 内全部素材按该维度值升序（同值保持 Page 顺序），任何单张/堆内成员都能前后切换；
   * - 2D/3D：只有处于堆中的素材可切换，顺序沿用堆内顺序（2D 按 y 行、行内按 x；3D 保持 Page 顺序）；
   * - 未选维度或 2D/3D 的单张素材返回 null，详情页不显示左右箭头。
   */
  function previewNavigationFor(assetId: string): string[] | null {
    if (!mode || !selected.length) return null;
    if (mode === 1) {
      const dimensionId = selected[0].id;
      return [...assets]
        .sort((left, right) => effectiveDimensionValue(left, dimensionId) - effectiveDimensionValue(right, dimensionId))
        .map((asset) => asset.id);
    }
    const clusterKey = clusterOf.get(assetId);
    const cluster = clusterKey ? clusters.find((candidate) => candidate.key === clusterKey) : null;
    if (!cluster || cluster.members.length < 2) return null;
    const members = mode === 2
      ? orderStackGrid(
        cluster.members,
        planeDimensions(cluster.members.length).columns,
        (member) => effectiveDimensionValue(member, selected[0].id),
        (member) => effectiveDimensionValue(member, selected[1].id),
      )
      : cluster.members;
    return members.map((member) => member.id);
  }
  function octantNames(octant: Octant): string[] {
    // 切回 1D/2D 时可能还残留 3D 的选中象限，缺少第三个维度就退回空名，避免读取 undefined
    if (!selected[0] || !selected[1] || !selected[2]) return [];
    return [
      octant.x === 1 ? selected[0].rightLabel : selected[0].leftLabel,
      octant.y === 1 ? selected[1].rightLabel : selected[1].leftLabel,
      octant.z === 1 ? selected[2].rightLabel : selected[2].leftLabel,
    ];
  }

  // 立方体：点击格子即隔离（可多选，取消到空集合即退出隔离）
  const isolatedOctantKeys = isolatedOctants.map(octantKeyOf);
  const isOctantIsolated = isolatedOctants.length > 0;
  const isOctantSideVisible = (axis: number, side: AxisSign) =>
    isolatedOctants.some((octant) => [octant.x, octant.y, octant.z][axis] === side);
  const octantLabel = isolatedOctants.map((octant) => octantNames(octant).join("、")).filter(Boolean).join(" / ") || null;
  // 立方体下方与三维视图一致用 tag 展示；同一维度同时包含左右两端时合并为一个「左 ↔ 右」标签
  // 单一端点 tag 在前，合并 tag 在后
  const octantTags = (() => {
    if (!isolatedOctants.length) return [];
    const singleTags: string[] = [];
    const mergedTags: string[] = [];
    selected.forEach((dimension, axis) => {
      let hasLeft = false;
      let hasRight = false;
      for (const octant of isolatedOctants) {
        if ([octant.x, octant.y, octant.z][axis] === 1) hasRight = true;
        else hasLeft = true;
      }
      if (hasLeft && hasRight) {
        const label = `${dimension.leftLabel} ↔ ${dimension.rightLabel}`;
        if (!mergedTags.includes(label)) mergedTags.push(label);
        return;
      }
      const label = hasRight ? dimension.rightLabel : hasLeft ? dimension.leftLabel : null;
      if (label && !singleTags.includes(label)) singleTags.push(label);
    });
    return [...new Set([...singleTags, ...mergedTags])];
  })();
  // 坐标轴端点与角落坐标 tag 不参与景深模糊/白色叠加，也不参与 hover 聚焦滤镜
  // 每个角落按维度拆成独立 tag（两词组合 = 两个 tag，三词组合 = 三个 tag），不合并不同坐标
  const cornerLabels = useMemo(() => {
    if (mode < 2 || !selected.length) return [];
    const signs: AxisSign[] = [-1, 1];
    const corners: Array<{ key: string; x: number; y: number; z: number; labels: string[] }> = [];
    const pick = (ends: string[], sign: number) => ends[sign === 1 ? 1 : 0];
    const xEnds = [selected[0].leftLabel, selected[0].rightLabel];
    const yEnds = [selected[1].leftLabel, selected[1].rightLabel];

    if (mode === 2) {
      for (const x of signs) {
        for (const y of signs) {
          corners.push({ key: `xy-${x}${y}`, x, y, z: 0, labels: [pick(xEnds, x), pick(yEnds, y)] });
        }
      }
      return corners;
    }

    const zEnds = [selected[2].leftLabel, selected[2].rightLabel];
    for (const x of signs) {
      for (const y of signs) {
        corners.push({ key: `xy-${x}${y}`, x, y, z: 0, labels: [pick(xEnds, x), pick(yEnds, y)] });
      }
    }
    for (const x of signs) {
      for (const z of signs) {
        corners.push({ key: `xz-${x}${z}`, x, y: 0, z, labels: [pick(xEnds, x), pick(zEnds, z)] });
      }
    }
    for (const y of signs) {
      for (const z of signs) {
        corners.push({ key: `yz-${y}${z}`, x: 0, y, z, labels: [pick(yEnds, y), pick(zEnds, z)] });
      }
    }
    for (const x of signs) {
      for (const y of signs) {
        for (const z of signs) {
          corners.push({ key: `xyz-${x}${y}${z}`, x, y, z, labels: [pick(xEnds, x), pick(yEnds, y), pick(zEnds, z)] });
        }
      }
    }
    return corners;
  }, [mode, selected]);
  const [modeTransitioning, setModeTransitioning] = useState(false);
  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    setModeTransitioning(true);
  }

  useEffect(() => {
    document.body.classList.toggle("preview-focus-active", focusMode);
    return () => document.body.classList.remove("preview-focus-active");
  }, [focusMode]);

  useEffect(() => {
    try { window.localStorage.setItem("artdatabase:preview-asset-scale:v1", String(assetScale)); } catch { /* 本地偏好可选 */ }
  }, [assetScale]);

  // 场景平面随所选维度数挂载/卸载（mode=0 时整个场景卸载）：依赖 mode 使每次平面重建后都重新测量并重挂观察器。
  // 否则 sceneSize 会停留在 0（挂载时无平面、或卸载时 ResizeObserver 以 0×0 回调清零），导致隔离象限检测失效。
  useEffect(() => {
    const plane = scenePlaneRef.current;
    if (!plane) return;
    const measure = () => {
      if (!plane.isConnected) return; // 平面已卸载（mode=0），忽略 0×0 回调，避免把 sceneSize 清零
      setSceneSize(plane.offsetWidth);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(plane);
      return () => observer.disconnect();
    }
  }, [mode]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement
      && (target.matches("input, textarea, select") || target.isContentEditable);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!mode || event.code !== "Space" || event.isComposing || isEditableTarget(event.target)) return;
      spaceHeldRef.current = true;
      setSpaceHeld(true);
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spaceHeldRef.current) return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      if (mode) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const clearSpace = () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", clearSpace);
    return () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", clearSpace);
    };
  }, [mode]);

  // Ctrl/Cmd+Z 撤销维度值修改；Esc 退出专注模式（顶部有抽屉/弹窗时让浮层优先处理）
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement
      && (target.matches("input, textarea, select") || target.isContentEditable);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // Esc：即使焦点在工具栏滑杆等控件上也退出专注模式；文本编辑与浮层打开时除外
      if (event.key === "Escape" && focusMode
        && !(event.target instanceof HTMLElement && event.target.isContentEditable)
        && !hasOpenOverlay()) {
        event.preventDefault();
        event.stopPropagation();
        clearFan();
        setFocusMode(false);
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (!event.altKey && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.code === "KeyZ") {
        // 拖动过程中不撤销历史操作；弹窗打开时把快捷键让给浮层（如撤销待替换图片）
        if (!undoStack.current.length || assetDrag.current || planeDrag.current || hasBlockingOverlay()) return;
        event.preventDefault();
        event.stopPropagation();
        void undoLastDimensionChange();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focusMode]);

  // Tab / Shift+Tab：鼠标在画布内时拦截浏览器默认焦点切换，并循环切换遮挡图片/堆的焦点
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLElement
      && (target.matches("input, textarea, select") || target.isContentEditable);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Tab" || event.isComposing || isEditableTarget(event.target)) return;
      // 鼠标位于预览画布内时，一律阻止默认 Tab 焦点切换（避免跳到侧栏/工具栏等元素）
      if (!pointerInSceneRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      // 有 hover 锚点（单张或堆）且存在遮挡循环列表时才切换焦点
      const anchor = hoverAnchorRef.current;
      if (!anchor) return;
      const cycle = focusCycleRef.current;
      if (cycle.length < 2) return;
      // 循环列表按“前→后”排序；Tab 向更靠前（遮挡者）方向切换，Shift+Tab 反向
      const direction = event.shiftKey ? 1 : -1;
      const next = (focusIndexRef.current + direction + cycle.length) % cycle.length;
      focusIndexRef.current = next;
      applyCycleFocus(cycle[next]);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [clusters]);

  useEffect(() => {
    if (!modeTransitioning) return;
    const timer = window.setTimeout(() => setModeTransitioning(false), 1050);
    return () => window.clearTimeout(timer);
  }, [modeTransitioning, mode]);

  useEffect(() => {
    if (mode === 3 || !isolatedOctants.length) return;
    clearFan();
    octantHistory.current = [];
    setIsolatedOctants([]);
    setOctantAnchor(null);
    setOctantHandle(null);
  }, [mode, isolatedOctants]);

  // 退出 3D 时清掉立方体的 hover 预览，避免下次进入残留高亮
  useEffect(() => {
    setHoverOctant(null);
  }, [mode]);

  useEffect(() => {
    if (!octantTransitioning) return;
    const timer = window.setTimeout(() => setOctantTransitioning(false), 480);
    return () => window.clearTimeout(timer);
  }, [octantTransitioning, isolatedOctants.length]);

  useEffect(() => {
    if (!planeCluster) return;
    if (planeDrag.current) return;
    if (!clusters.some((cluster) => cluster.key === planeCluster.key)) {
      clearFan();
    }
  }, [clusters, planeCluster]);

  useEffect(() => () => {
    if (planeCloseTimer.current !== null) window.clearTimeout(planeCloseTimer.current);
  }, []);

  // 窗口尺寸变化时场景矩形会变；hover 前景层按屏幕坐标定位，直接清掉避免残留错位
  useEffect(() => {
    const clearOnResize = () => clearFan();
    window.addEventListener("resize", clearOnResize);
    return () => window.removeEventListener("resize", clearOnResize);
  }, []);

  // 缩放视图或图片缩放系数变化导致聚堆重组时，用 200ms FLIP 让素材滑入/滑出堆；
  // 旋转、平移、拖动改维度不会触发。
  useLayoutEffect(() => {
    if (lastGridDivisionsRef.current === null) {
      lastGridDivisionsRef.current = activeGridDivisions;
      return;
    }
    const now = performance.now();
    const scaleChanged = zoom !== lastScaleRef.current.zoom || assetScale !== lastScaleRef.current.assetScale;
    const divisionsChanged = activeGridDivisions !== lastGridDivisionsRef.current;
    if (scaleChanged) {
      lastScaleRef.current = { zoom, assetScale };
      lastScaleChangeAtRef.current = now;
      const predictedDivisions = sceneSize > 0
        ? gridDivisionsFor(sceneSize * zoom / 200, minimumGridSpacing, gridDivisions)
        : gridDivisions;
      const predictedActive = predictedDivisions ?? activeGridDivisions;
      if (predictedActive !== activeGridDivisions || divisionsChanged) {
        const previous = flipStateRef.current;
        const next = captureFlipLayout();
        if (divisionsChanged && previous && now - previous.at < 500) animateFlipLayout(previous.map, next);
        flipStateRef.current = { map: next, at: now };
      }
      lastGridDivisionsRef.current = activeGridDivisions;
      return;
    }
    if (divisionsChanged) {
      const previous = flipStateRef.current;
      const next = captureFlipLayout();
      if (previous && now - lastScaleChangeAtRef.current < 600 && now - previous.at < 600) {
        animateFlipLayout(previous.map, next);
      }
      flipStateRef.current = { map: next, at: now };
      lastGridDivisionsRef.current = activeGridDivisions;
    }
  });

  function toggleDimension(id: string) {
    clearFan();
    if (selectedIds.includes(id)) onSelectedIdsChange(selectedIds.filter((value) => value !== id));
    else if (selectedIds.length < 3) onSelectedIdsChange([...selectedIds, id]);
  }

  function toggleFocusMode() {
    clearFan();
    setFocusMode((active) => !active);
  }

  function zoomWithGesture(factor: number, clientX: number, clientY: number) {
    clearFan();
    const currentZoom = gestureZoomRef.current;
    const nextZoom = Math.max(.35, Math.min(2.8, currentZoom * factor));
    if (nextZoom === currentZoom) return;
    gestureZoomRef.current = nextZoom;
    const viewport = sceneViewportRef.current;
    if ((mode === 1 || mode === 2) && viewport) {
      const rect = viewport.getBoundingClientRect();
      const pointer = { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
      setViewPan((current) => zoomPanAtPointer(current, pointer, currentZoom, nextZoom));
    }
    setZoom(nextZoom);
  }

  useViewportGestures(sceneViewportRef, mode, {
    onZoom: zoomWithGesture,
    onPan: (dx, dy) => {
      setViewPan((current) => ({ x: current.x - dx, y: current.y - dy }));
      setAssetHover(null);
    },
  });

  function toggleOctant(octant: Octant) {
    if (mode !== 3) return;
    clearFan();
    setHoverOctant(octant);
    // 还没有基准格：第一次点选 = 基准格，选中 1 格
    if (!octantAnchor) {
      octantHistory.current = [];
      setOctantTransitioning(true);
      setOctantAnchor(octant);
      setOctantHandle(octant);
      setIsolatedOctants([octant]);
      return;
    }
    // 点基准格本身 = 直接退出隔离
    if (octantKeyOf(octant) === octantKeyOf(octantAnchor)) {
      exitOctantIsolation();
      return;
    }
    // 优先沿历史回退：再点「当前操作格」就退回上一个盒子（1 格时即退出）
    if (octantHandle && octantKeyOf(octant) === octantKeyOf(octantHandle)) {
      const previous = octantHistory.current.pop();
      setOctantTransitioning(true);
      if (previous) {
        setIsolatedOctants(previous.octants);
        setOctantHandle(previous.handle);
      } else {
        setIsolatedOctants([octantAnchor]);
        setOctantHandle(octantAnchor);
      }
      return;
    }
    const snapshot = { octants: isolatedOctants, handle: octantHandle ?? octantAnchor };
    const isSelected = isolatedOctants.some((item) => octantKeyOf(item) === octantKeyOf(octant));
    setOctantTransitioning(true);
    if (!isSelected) {
      // 点到盒子外：按「基准格 ↔ 该格」的轴差扩展成 棱 / 面 / 整块
      octantHistory.current.push(snapshot);
      setIsolatedOctants(octantsInBounds(octantBounds([octantAnchor, octant])!));
      setOctantHandle(octant);
      return;
    }
    // 点到盒子内、但不是历史路径上的操作格：逐层收缩一级，保留基准格那一侧
    const currentBounds = octantBounds([octantAnchor, octantHandle ?? octantAnchor])!;
    const shrinkable = OCTANT_AXES.filter((axis) => currentBounds[axis][0] !== currentBounds[axis][1]);
    const axis = shrinkable.find((value) => octant[value] !== octantAnchor[value]) ?? shrinkable[0];
    if (!axis) {
      exitOctantIsolation();
      return;
    }
    const keep: [AxisSign, AxisSign] = [octantAnchor[axis], octantAnchor[axis]];
    const nextBounds: OctantBounds = axis === "x"
      ? { ...currentBounds, x: keep }
      : axis === "y"
        ? { ...currentBounds, y: keep }
        : { ...currentBounds, z: keep };
    octantHistory.current.push(snapshot);
    setIsolatedOctants(octantsInBounds(nextBounds));
    setOctantHandle(octantFarCorner(nextBounds, octantAnchor));
  }

  /** 一键退出隔离：清空选中象限，恢复全部图片与全局原点。 */
  function exitOctantIsolation() {
    if (!isolatedOctants.length) return;
    clearFan();
    octantHistory.current = [];
    setOctantTransitioning(true);
    setIsolatedOctants([]);
    setOctantAnchor(null);
    setOctantHandle(null);
    setHoverOctant(null);
  }

  function assetBelongsToIsolatedOctant(values: Record<string, number>) {
    if (!isolatedOctants.length || mode !== 3) return true;
    const matchesSide = (value: number, side: AxisSign) => value === 500 || (side === 1 ? value > 500 : value < 500);
    return isolatedOctants.some((octant) =>
      matchesSide(values[selected[0].id] ?? 500, octant.x)
      && matchesSide(values[selected[1].id] ?? 500, octant.y)
      && matchesSide(values[selected[2].id] ?? 500, octant.z));
  }

  function unprojectPointerToPlane(clientX: number, clientY: number, localZ: number) {
    const viewport = sceneViewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const screenX = clientX - (rect.left + rect.width / 2) - viewPan.x;
    const screenY = clientY - (rect.top + rect.height / 2) - viewPan.y;
    const pitch = (mode === 3 ? rotateX : 0) * Math.PI / 180;
    const yaw = (mode === 3 ? rotateZ : 0) * Math.PI / 180;
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const perspective = SCENE_PERSPECTIVE;
    const centeredZ = localZ - scenePivot.z;
    const denominator = zoom * (perspective * cosPitch + screenY * sinPitch);
    if (Math.abs(denominator) < 1) return null;
    const localAlongY = (
      screenY * perspective
      - screenY * zoom * cosPitch * centeredZ
      + zoom * perspective * sinPitch * centeredZ
    ) / denominator;
    const perspectiveDenominator = perspective - zoom * (sinPitch * localAlongY + cosPitch * centeredZ);
    const localAlongX = screenX * perspectiveDenominator / (zoom * perspective);
    return {
      x: cosYaw * localAlongX + sinYaw * localAlongY + scenePivot.x,
      y: -sinYaw * localAlongX + cosYaw * localAlongY + scenePivot.y,
    };
  }

  /** 记录一次拖动前实际变化的维度值；Ctrl/Cmd+Z 时按修改前数值写回。 */
  function pushDimensionUndo(assetId: string, startValues: Record<string, number>) {
    const before: Record<string, number> = {};
    for (const dimension of selected) {
      const start = startValues[dimension.id] ?? 500;
      const current = dragValues.current[dimension.id] ?? 500;
      if (start !== current) before[dimension.id] = start;
    }
    if (!Object.keys(before).length) return;
    undoStack.current.push({ assetId, before });
    if (undoStack.current.length > 50) undoStack.current.shift();
  }

  async function undoLastDimensionChange() {
    const entry = undoStack.current.pop();
    if (!entry) return;
    try {
      const ok = await onUpdateRef.current(entry.assetId, entry.before);
      // 保存失败时放回撤销栈（保存函数自身已 toast 错误原因），成功后由撤销提示覆盖保存提示
      if (ok === false) { undoStack.current.push(entry); return; }
      onMessageRef.current?.("已撤销维度值修改");
    } catch (error) {
      undoStack.current.push(entry);
      onMessageRef.current?.(error instanceof Error ? error.message : "撤销失败");
    }
  }

  function startCameraMove(event: PointerEvent<HTMLDivElement>, assetId?: string) {
    if (mode !== 3 || event.button !== 0) return;
    clearFan();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cameraDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rotateX,
      rotateZ,
      assetId,
      moved: false,
    };
    setCameraMoving(true);
  }

  function startViewPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    // hover 展开的堆时开始平移：保留展开平面（平移优先，卡片不进入坐标拖动），其余情况保持原有收起行为
    if (planeClusterRef.current === null) clearFan();
    panMovedRef.current = false;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    viewPanDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: viewPan.x,
      panY: viewPan.y,
    };
    setViewPanning(true);
  }

  function moveViewPan(event: PointerEvent<HTMLDivElement>) {
    const active = viewPanDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) > 3) panMovedRef.current = true;
    setViewPan({
      x: active.panX + event.clientX - active.startX,
      y: active.panY + event.clientY - active.startY,
    });
  }

  function moveCamera(event: PointerEvent<HTMLDivElement>) {
    const active = cameraDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) <= 3) return;
    active.moved = true;
    setRotateZ(wrapRotation(active.rotateZ - dx * .24));
    setRotateX(Math.max(0, Math.min(180, active.rotateX - dy * .24)));
  }

  /** 图片的实际可见矩形：堆按整块 2×2 缩略图矩阵命中，单张按 hover 放大后的图片矩形命中。 */
  function assetVisualElement(asset: HTMLElement): HTMLElement | null {
    if (asset.dataset.stackKey) {
      return asset.querySelector<HTMLElement>(".stack-grid") ?? asset.querySelector<HTMLElement>(".preview-asset-face");
    }
    return asset.querySelector<HTMLElement>(".preview-asset-face img, .preview-art-flip > i, .preview-asset-face > i")
      ?? asset.querySelector<HTMLElement>(".preview-asset-face");
  }

  /** 单张图片未放大的 face 矩形，用作前景层的屏幕定位基准。 */
  function faceRectOf(targetId: string): DOMRect | null {
    const plane = scenePlaneRef.current;
    if (!plane) return null;
    const target = Array.from(plane.querySelectorAll<HTMLElement>(".preview-asset:not([data-stack-key])"))
      .find((asset) => asset.dataset.assetId === targetId);
    return target?.querySelector<HTMLElement>(".preview-asset-face")?.getBoundingClientRect() ?? null;
  }

  /** 记录所有可见素材表示的屏幕位置；堆内未展示的成员回落到堆网格中心。 */
  function captureFlipLayout(): FlipLayout {
    const plane = scenePlaneRef.current;
    const viewport = sceneViewportRef.current;
    const layout: FlipLayout = new Map();
    if (!plane || !viewport) return layout;
    const viewportRect = viewport.getBoundingClientRect();
    const measure = (rect: DOMRect) => ({
      left: rect.left - viewportRect.left,
      top: rect.top - viewportRect.top,
      width: rect.width,
      height: rect.height,
      x: rect.left - viewportRect.left + rect.width / 2,
      y: rect.top - viewportRect.top + rect.height / 2,
    });
    plane.querySelectorAll<HTMLElement>(".preview-asset").forEach((element) => {
      if (element.classList.contains("octant-hidden")) return;
      const stackKey = element.dataset.stackKey;
      if (!stackKey) {
        const id = element.dataset.assetId;
        const wrapper = element.querySelector<HTMLElement>(".preview-art-flip");
        if (!id || !wrapper) return;
        const measureRect = measure(wrapper.getBoundingClientRect());
        layout.set(id, {
          ...measureRect,
          key: `single:${id}`,
          element: wrapper,
          src: wrapper.querySelector("img")?.getAttribute("src") ?? null,
          text: wrapper.querySelector("i")?.textContent ?? null,
        });
        return;
      }
      const grid = element.querySelector<HTMLElement>(".stack-grid") ?? element.querySelector<HTMLElement>(".preview-asset-face");
      if (!grid) return;
      const fallback = measure(grid.getBoundingClientRect());
      const members = (element.dataset.memberIds ?? "").split(/\s+/).filter(Boolean);
      const cards = new Map<string, HTMLElement>();
      element.querySelectorAll<HTMLElement>(".stack-card[data-asset-id]").forEach((card) => {
        const id = card.dataset.assetId;
        if (id) cards.set(id, card);
      });
      members.forEach((memberId) => {
        const card = cards.get(memberId) ?? null;
        const measureRect = card ? measure(card.getBoundingClientRect()) : fallback;
        layout.set(memberId, {
          ...measureRect,
          key: `stack:${stackKey}`,
          element: card,
          src: card?.querySelector("img")?.getAttribute("src") ?? null,
          text: card?.querySelector("i")?.textContent ?? null,
        });
      });
    });
    return layout;
  }

  function createFlipGhost(source: FlipLayoutEntry): HTMLElement | null {
    if (!source.src && !source.text) return null;
    let ghost: HTMLElement;
    if (source.src) {
      const image = document.createElement("img");
      image.src = source.src;
      image.alt = "";
      ghost = image;
    } else {
      const text = document.createElement("span");
      text.textContent = source.text;
      ghost = text;
    }
    ghost.className = "flip-ghost";
    ghost.style.left = `${source.left}px`;
    ghost.style.top = `${source.top}px`;
    ghost.style.width = `${source.width}px`;
    ghost.style.height = `${source.height}px`;
    return ghost;
  }

  /** 新布局素材从旧屏幕位置滑到新位置；堆内第 5 张之后的隐藏成员用幽灵滑入新堆中心。 */
  function animateFlipLayout(previous: FlipLayout, next: FlipLayout) {
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ghostLayer = flipGhostLayerRef.current;
    next.forEach((target, assetId) => {
      const source = previous.get(assetId);
      if (!source) return;
      const element = target.element;
      if (element) {
        if (source.key === target.key) return;
        const dx = source.x - target.x;
        const dy = source.y - target.y;
        if (Math.hypot(dx, dy) < 0.5) return;
        flipAnimationsRef.current.get(element)?.cancel();
        element.getAnimations().forEach((animation) => animation.cancel());
        element.style.transform = `translate(${dx}px, ${dy}px)`;
        const animation = element.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          { duration: CLUSTER_FLIP_DURATION, easing: "ease" },
        );
        flipAnimationsRef.current.set(element, animation);
        void animation.finished.then(() => {
          if (flipAnimationsRef.current.get(element) === animation) {
            element.style.transform = "";
            flipAnimationsRef.current.delete(element);
          }
        }).catch(() => { /* 被下一段动画接管 */ });
        return;
      }
      // 新表示是堆里未展示的成员：从旧位置滑向新堆中心
      if (!ghostLayer || !source.element) return;
      const ghost = createFlipGhost(source);
      if (!ghost) return;
      ghostLayer.append(ghost);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const animation = ghost.animate(
        [
          { transform: "translate(0, 0)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
        ],
        { duration: CLUSTER_FLIP_DURATION, easing: "ease-out" },
      );
      void animation.finished.then(() => ghost.remove()).catch(() => ghost.remove());
    });
  }

  function hoverOverlayRect(): DOMRect | null {
    const overlay = document.querySelector<HTMLElement>(".hover-preview .preview-asset-face > img, .hover-preview .preview-asset-face > i");
    const rect = overlay?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function assetAtPoint(clientX: number, clientY: number, includeBlurred = false) {
    const plane = scenePlaneRef.current;
    if (!plane) return null;
    // 单张 hover 的前景层永远绘制在最前，命中也要优先它，避免放大区域盖住的其它图片抢走点击/拖动
    const hoveredId = hoveredAssetIdRef.current;
    if (hoveredId) {
      const hoveredRect = hoverOverlayRect() ?? visualRectOf(hoveredId);
      if (hoveredRect && clientX >= hoveredRect.left && clientX <= hoveredRect.right && clientY >= hoveredRect.top && clientY <= hoveredRect.bottom) {
        return { id: hoveredId, stackKey: null, blurred: false };
      }
    }
    const candidates = Array.from(plane.querySelectorAll<HTMLElement>(".preview-asset:not(.octant-hidden)"))
      .map((asset, order) => {
        const blurred = asset.dataset.hoverDisabled === "true";
        if (!includeBlurred && blurred) return null;
        // 命中检测跟随图片实际视觉大小：hover 放大时用放大后的 img/占位符 rect，平时用原始 rect
        const rect = assetVisualElement(asset)?.getBoundingClientRect();
        if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
        return {
          id: asset.dataset.assetId ?? null,
          stackKey: asset.dataset.stackKey ?? null,
          depth: Number(asset.dataset.screenDepth ?? 0),
          order,
          blurred,
        };
      })
      .filter((candidate): candidate is { id: string | null; stackKey: string | null; depth: number; order: number; blurred: boolean } => Boolean(candidate?.id || candidate?.stackKey))
      .sort((a, b) => b.depth - a.depth || b.order - a.order);
    const top = candidates[0];
    return top ? { id: top.id, stackKey: top.stackKey, blurred: top.blurred } : null;
  }

  function visualRectOf(targetId: string) {
    // hover 时源图已从场景中移除，用前景层记录的未放大屏幕矩形参与 Tab 焦点循环
    if (hoverPreview?.asset.id === targetId) {
      const viewport = sceneViewportRef.current?.getBoundingClientRect();
      if (viewport) return new DOMRect(viewport.left + hoverPreview.left, viewport.top + hoverPreview.top, hoverPreview.width, hoverPreview.height);
    }
    const plane = scenePlaneRef.current;
    if (!plane) return null;
    const target = Array.from(plane.querySelectorAll<HTMLElement>(".preview-asset:not(.octant-hidden)"))
      .find((asset) => asset.dataset.assetId === targetId);
    if (!target) return null;
    return assetVisualElement(target)?.getBoundingClientRect() ?? null;
  }

  /** 计算以 anchorId 为中心的焦点循环列表：所有与放大区域屏幕重叠的图片（单张 + 堆），按投影深度从前往后排序。 */
  function computeFocusCycle(anchor: FocusTarget, rect: DOMRect): FocusTarget[] {
    const plane = scenePlaneRef.current;
    if (!plane) return [anchor];
    const hoverScale = 2.475;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const expanded = {
      left: centerX - (rect.width * hoverScale) / 2,
      right: centerX + (rect.width * hoverScale) / 2,
      top: centerY - (rect.height * hoverScale) / 2,
      bottom: centerY + (rect.height * hoverScale) / 2,
    };
    const entries: Array<{ id: string; stack: boolean; depth: number; order: number }> = [];
    Array.from(plane.querySelectorAll<HTMLElement>(".preview-asset:not(.octant-hidden)")).forEach((candidate, order) => {
      const id = candidate.dataset.assetId;
      if (!id) return;
      const stack = Boolean(candidate.dataset.stackKey);
      const candidateRect = assetVisualElement(candidate)?.getBoundingClientRect();
      if (!candidateRect) return;
      const overlaps = expanded.left < candidateRect.right && expanded.right > candidateRect.left
        && expanded.top < candidateRect.bottom && expanded.bottom > candidateRect.top;
      if (!overlaps) return;
      entries.push({ id, stack, depth: Number(candidate.dataset.screenDepth ?? 0), order });
    });
    entries.sort((a, b) => b.depth - a.depth || b.order - a.order);
    const cycle = entries.map(({ id, stack }) => ({ id, stack }));
    return cycle.some((target) => sameTarget(target, anchor)) ? cycle : [anchor, ...cycle];
  }

  /** 图片上方的坐标 tag：与坐标轴端点 tag 同款，每个选中维度独立一个。 */
  function valueTagsOf(values: Record<string, number>) {
    return (
      <span className="preview-value-tags">
        {selected.map((dimension) => {
          const value = values[dimension.id] ?? 500;
          const label = value > 500 ? dimension.rightLabel : dimension.leftLabel;
          return <TagLabel key={dimension.id}>{`${label} ${Math.abs(displayDimensionValue(value))}`}</TagLabel>;
        })}
      </span>
    );
  }

  /** 取消 hover 缩回计时。 */
  function cancelHoverClose() {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }

  function dropHoverPreview() {
    cancelHoverClose();
    setHoverPreview(null);
  }

  /** 指针离开单图时保留前景层，按尺寸动画缩回源图大小后再卸载。 */
  function closeHoverPreview() {
    if (!hoverPreview || hoverPreview.closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dropHoverPreview();
      return;
    }
    cancelHoverClose();
    setHoverPreview({ ...hoverPreview, closing: true });
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null;
      setHoverPreview(null);
    }, 200);
  }

  /** 将焦点应用到指定图片：在 3D 场景外的前景层展示，遮挡物保持原位、不再隐藏。 */
  function applyFocus(assetId: string) {
    cancelHoverClose();
    // 缩回过程中重新进入同一张图：直接恢复为完整前景层，不再重新取源图矩形
    if (hoverPreview?.asset.id === assetId && hoverPreview.closing) {
      hoveredAssetIdRef.current = assetId;
      setHoveredAssetId(assetId);
      setHoverPreview({ ...hoverPreview, closing: false });
      return;
    }
    if (hoverPreview?.asset.id === assetId) return;
    hoveredAssetIdRef.current = assetId;
    setHoveredAssetId(assetId);
    const asset = assets.find((candidate) => candidate.id === assetId);
    const rect = faceRectOf(assetId);
    const viewport = sceneViewportRef.current?.getBoundingClientRect();
    if (!asset || !rect || !viewport) {
      dropHoverPreview();
      return;
    }
    setHoverPreview({
      asset,
      values: { ...asset.dimensionValues, ...overrides[asset.id] },
      left: rect.left - viewport.left,
      top: rect.top - viewport.top,
      width: rect.width,
      height: rect.height,
    });
  }

  /** 立即收起可能展开的堆平面，但不重置 hover 锚点与焦点循环（供 Tab 切换复用）。 */
  function dismissPlane() {
    if (planeCloseTimer.current !== null) {
      window.clearTimeout(planeCloseTimer.current);
      planeCloseTimer.current = null;
    }
    setClosingCluster(null);
    planeClusterRef.current = null;
    setPlaneCluster(null);
    const activePlaneDrag = planeDrag.current;
    planeDrag.current = null;
    setDraggingPlaneAssetId(null);
    setPlaneDragDelta({ x: 0, y: 0 });
    setDropTargetClusterKey(null);
    if (activePlaneDrag) {
      setOverrides((current) => {
        const next = { ...current };
        delete next[activePlaneDrag.assetId];
        return next;
      });
    }
  }

  /** 将焦点应用到循环中的某个目标（单张放大 / 堆展开平面），保持锚点与循环不变。 */
  function applyCycleFocus(target: FocusTarget) {
    dismissPlane();
    if (target.stack) {
      hoveredAssetIdRef.current = null;
      setHoveredAssetId(null);
      dropHoverPreview();
      openPlane(target.id);
      return;
    }
    applyFocus(target.id);
  }

  function setAssetHover(assetId: string | null) {
    // 锚点未变时保持当前焦点（含 Tab 切换后的焦点），避免指针微小移动重置循环
    const nextAnchor: FocusTarget | null = assetId ? { id: assetId, stack: false } : null;
    if (sameTarget(hoverAnchorRef.current, nextAnchor)) return;
    hoverAnchorRef.current = nextAnchor;
    focusCycleRef.current = [];
    focusIndexRef.current = 0;
    if (!nextAnchor) {
      hoveredAssetIdRef.current = null;
      setHoveredAssetId(null);
      closeHoverPreview();
      return;
    }
    const rect = visualRectOf(nextAnchor.id);
    const cycle = rect ? computeFocusCycle(nextAnchor, rect) : [nextAnchor];
    focusCycleRef.current = cycle;
    focusIndexRef.current = Math.max(0, cycle.findIndex((target) => !target.stack && target.id === nextAnchor.id));
    applyFocus(nextAnchor.id);
  }

  function clearFan() {
    // 取消进行中的收拢动画并立即卸载
    if (planeCloseTimer.current !== null) {
      window.clearTimeout(planeCloseTimer.current);
      planeCloseTimer.current = null;
    }
    setClosingCluster(null);
    planeClusterRef.current = null;
    setPlaneCluster(null);
    const activePlaneDrag = planeDrag.current;
    planeDrag.current = null;
    setDraggingPlaneAssetId(null);
    setPlaneDragDelta({ x: 0, y: 0 });
    setDropTargetClusterKey(null);
    if (activePlaneDrag) {
      // 平面被收起时丢弃未保存的平面拖动
      setOverrides((current) => {
        const next = { ...current };
        delete next[activePlaneDrag.assetId];
        return next;
      });
    }
    setAssetHover(null);
    dropHoverPreview();
  }

  function closePlane() {
    const cluster = planeClusterRef.current;
    if (!cluster) return;
    if (planeCloseTimer.current !== null) {
      window.clearTimeout(planeCloseTimer.current);
      planeCloseTimer.current = null;
    }
    planeClusterRef.current = null;
    setPlaneCluster(null);
    setClosingCluster(cluster);
    const activePlaneDrag = planeDrag.current;
    planeDrag.current = null;
    setDraggingPlaneAssetId(null);
    setPlaneDragDelta({ x: 0, y: 0 });
    setDropTargetClusterKey(null);
    if (activePlaneDrag) {
      setOverrides((current) => {
        const next = { ...current };
        delete next[activePlaneDrag.assetId];
        return next;
      });
    }
    setAssetHover(null);
    dropHoverPreview();
    planeCloseTimer.current = window.setTimeout(() => {
      planeCloseTimer.current = null;
      setClosingCluster(null);
    }, 160);
  }

  function computeDropTarget(values: Record<string, number>): string | null {
    if (!mode || !selected.length) return null;
    const cellKey = gridClusterKey(selected.map((dimension) => values[dimension.id] ?? 500), activeGridDivisions);
    return clusters.find((cluster) => cluster.cellKey === cellKey)?.key ?? null;
  }

  /** 仅展开指定堆的悬浮平面（不改变锚点与循环，供 Tab 切换复用）。 */
  function openPlane(key: string) {
    if (planeClusterRef.current?.key === key) return;
    const cluster = clusters.find((candidate) => candidate.key === key);
    if (!cluster) return;
    // 3D 在打开瞬间按当前视角从前往后排序；1D 使用按维度值排好的稳定顺序；
    // 2D 按展开平面的实际列数重新切成 y 行、行内按 x 排序。
    let members = cluster.members;
    if (mode === 3) {
      members = orderByViewDepth(cluster.members, (member) => {
        const values = { ...member.dimensionValues, ...overrides[member.id] };
        const x = values[selected[0].id] ?? 500;
        const y = 1000 - (values[selected[1].id] ?? 500);
        const z = (values[selected[2].id] ?? 500) - 500;
        return projectValuePoint(x, y, z)?.worldZ ?? cluster.meanDepth;
      });
    } else if (mode === 2) {
      const columns = planeDimensions(cluster.members.length).columns;
      members = orderStackGrid(
        cluster.members,
        columns,
        (member) => effectiveDimensionValue(member, selected[0].id),
        (member) => effectiveDimensionValue(member, selected[1].id),
      );
    }
    const ordered = { ...cluster, members };
    planeClusterRef.current = ordered;
    setPlaneCluster(ordered);
    // 堆平面本身就是最前层：只展示平面，不隐藏周围的图片与堆
    dropHoverPreview();
  }

  function setStackHover(key: string | null) {
    if (key === null) {
      // closePlane 内部会调用 setAssetHover(null) 一并重置锚点与循环
      if (planeClusterRef.current === null) return;
      closePlane();
      return;
    }
    // 鼠标 hover 到堆：把堆设为 Tab 循环锚点，并展开其平面
    const nextAnchor: FocusTarget = { id: key, stack: true };
    if (!sameTarget(hoverAnchorRef.current, nextAnchor)) {
      hoverAnchorRef.current = nextAnchor;
      const rect = visualRectOf(key);
      const cycle = rect ? computeFocusCycle(nextAnchor, rect) : [nextAnchor];
      focusCycleRef.current = cycle;
      focusIndexRef.current = Math.max(0, cycle.findIndex((target) => target.stack && target.id === key));
    }
    openPlane(key);
  }

  function updateAssetHover(event: PointerEvent<HTMLDivElement>) {
    if (assetDrag.current || cameraDrag.current || viewPanDrag.current) {
      setAssetHover(null);
      setStackHover(null);
      return;
    }
    const hit = assetAtPoint(event.clientX, event.clientY, true);
    // 模糊对象不参与 hover：既不会成为新目标，也不会清除当前 hover；指针移到空白处才结束
    if (hit?.blurred) return;
    if (hit?.stackKey) {
      setAssetHover(null);
      setStackHover(hit.stackKey);
      return;
    }
    setAssetHover(hit?.id ?? null);
    setStackHover(null);
  }

  function startPlaneCardDrag(event: PointerEvent<HTMLButtonElement>, member: Asset) {
    // 游客只读：卡片只响应点击（打开详情），不进入拖动
    if (readOnly) return;
    // 平移优先：中键 / 空格+左键不进入卡片拖动，事件继续冒泡给场景开始平移
    if (event.button === 1 || (event.button === 0 && spaceHeldRef.current)) return;
    if (mode === 3 || event.button !== 0) {
      // 3D 下平面卡片只点击、不可拖动；事件不外溢，场景不旋转
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    planeDragJustMoved.current = false;
    const currentValues = { ...member.dimensionValues, ...overrides[member.id] };
    planeDrag.current = {
      pointerId: event.pointerId,
      assetId: member.id,
      startX: event.clientX,
      startY: event.clientY,
      startValues: currentValues,
      moved: false,
    };
    dragValues.current = currentValues;
    setDraggingPlaneAssetId(member.id);
  }

  function movePlaneCardDrag(event: PointerEvent<HTMLDivElement>) {
    const active = planeDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) > 3) active.moved = true;
    const planeSize = sceneSize || scenePlaneRef.current?.offsetWidth || 0;
    if (!planeSize || !selected.length) return;
    const valuePerPx = 1000 / (planeSize * zoom);
    const next = { ...active.startValues };
    next[selected[0].id] = clampValue((active.startValues[selected[0].id] ?? 500) + dx * valuePerPx);
    if (mode === 2) {
      next[selected[1].id] = clampValue((active.startValues[selected[1].id] ?? 500) - dy * valuePerPx);
    }
    dragValues.current = next;
    setPlaneDragDelta({ x: dx, y: dy });
    setOverrides((current) => ({ ...current, [active.assetId]: next }));
    setDropTargetClusterKey(computeDropTarget(next));
  }

  async function endPlaneCardDrag(event: PointerEvent<HTMLDivElement>) {
    const active = planeDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    planeDrag.current = null;
    planeDragJustMoved.current = active.moved;
    setDraggingPlaneAssetId(null);
    setPlaneDragDelta({ x: 0, y: 0 });
    setDropTargetClusterKey(null);
    if (!active.moved) return;
    const changedValues = Object.fromEntries(
      selected
        .map((dimension) => [dimension.id, dragValues.current[dimension.id] ?? 500] as const)
        .filter(([id, value]) => value !== (active.startValues[id] ?? 500)),
    );
    if (Object.keys(changedValues).length) {
      pushDimensionUndo(active.assetId, active.startValues);
      // 乐观值已在父组件的 previewPage 里：入队后立即清掉临时覆盖，不再等网络回来。
      void onUpdateAssetDimensions(active.assetId, changedValues);
    }
    setOverrides((current) => {
      const next = { ...current };
      delete next[active.assetId];
      return next;
    });
  }

  function startSceneMove(event: PointerEvent<HTMLDivElement>) {
    // 空格 + 左键、鼠标中键都优先平移视图（hover 展开的堆平面同样生效）
    if (event.button === 1 || (event.button === 0 && spaceHeldRef.current)) {
      startViewPan(event);
      return;
    }
    if (event.button !== 0) return;
    const hit = assetAtPoint(event.clientX, event.clientY, true);
    const assetId = hit && !hit.stackKey ? hit.id : null;
    const asset = assetId ? assets.find((candidate) => candidate.id === assetId) : null;
    if (asset) {
      if (mode === 3) {
        startCameraMove(event, asset.id);
        return;
      }
      startAssetMove(event, asset);
      return;
    }
    startCameraMove(event);
  }

  function moveInScene(event: PointerEvent<HTMLDivElement>) {
    if (viewPanDrag.current) {
      moveViewPan(event);
      return;
    }
    if (assetDrag.current) {
      moveAsset(event);
      return;
    }
    moveCamera(event);
    updateAssetHover(event);
  }

  function endSceneMove(event: PointerEvent<HTMLDivElement>) {
    if (viewPanDrag.current?.pointerId === event.pointerId) {
      viewPanDrag.current = null;
      setViewPanning(false);
      if (panMovedRef.current) {
        panMovedRef.current = false;
        // 平移松手后浏览器仍可能派发 click，抑制一次避免误触平面卡片/详情
        suppressClickAfterPan.current = true;
        window.setTimeout(() => { suppressClickAfterPan.current = false; }, 0);
      }
      return;
    }
    if (assetDrag.current?.pointerId === event.pointerId) {
      void endAssetMove(event);
      return;
    }
    endCameraMove(event);
  }

  function endCameraMove(event: PointerEvent<HTMLDivElement>) {
    const active = cameraDrag.current;
    if (active?.pointerId !== event.pointerId) return;
    cameraDrag.current = null;
    setCameraMoving(false);
    if (active.assetId && !active.moved) {
      // 单击打开详情：先撤掉 hover 前景层，避免详情打开后场景里残留一张放大图
      setAssetHover(null);
      dropHoverPreview();
      onSelectAsset(active.assetId, previewNavigationFor(active.assetId));
    }
  }

  function resetView() {
    cameraDrag.current = null;
    viewPanDrag.current = null;
    assetDrag.current = null;
    setCameraMoving(false);
    setViewPanning(false);
    setDraggingAssetId(null);
    clearFan();
    setRotateX(52);
    setRotateZ(352);
    setViewPan({ x: 0, y: 0 });
    setZoom(1);
  }

  function startAssetMove(event: PointerEvent<HTMLElement>, asset: Asset) {
    if (event.button !== 0 || mode === 3) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const currentValues = { ...asset.dimensionValues, ...overrides[asset.id] };
    const plane = scenePlaneRef.current;
    if (!plane || !selected.length) return;
    const startLocalX = ((currentValues[selected[0].id] ?? 500) / 1000 - .5) * plane.offsetWidth;
    const startLocalY = mode >= 2
      ? (.5 - (currentValues[selected[1].id] ?? 500) / 1000) * plane.offsetHeight
      : 0;
    const startLocalZ = mode === 3 ? ((currentValues[selected[2].id] ?? 500) - 500) * plane.offsetWidth / 1000 : 0;
    const pointerOnPlane = unprojectPointerToPlane(event.clientX, event.clientY, startLocalZ);
    assetDrag.current = {
      pointerId: event.pointerId,
      assetId: asset.id,
      startX: event.clientX,
      startY: event.clientY,
      startValues: currentValues,
      startLocalX,
      startLocalY,
      startLocalZ,
      grabOffsetX: startLocalX - (pointerOnPlane?.x ?? startLocalX),
      grabOffsetY: startLocalY - (pointerOnPlane?.y ?? startLocalY),
      moved: false,
    };
    dragValues.current = currentValues;
    clearFan();
    if (!readOnly) setDraggingAssetId(asset.id);
  }

  function moveAsset(event: PointerEvent<HTMLElement>) {
    const active = assetDrag.current;
    const plane = scenePlaneRef.current;
    if (!active || active.pointerId !== event.pointerId || !plane || !selected.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) return; // 游客只读：按下不移动坐标，松手仍按单击打开详情
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.hypot(dx, dy) > 3) active.moved = true;

    const next = { ...active.startValues };
    const pointerOnPlane = unprojectPointerToPlane(event.clientX, event.clientY, active.startLocalZ);
    if (pointerOnPlane) {
      const localX = pointerOnPlane.x + active.grabOffsetX;
      const localY = pointerOnPlane.y + active.grabOffsetY;
      next[selected[0].id] = clampValue((localX / plane.offsetWidth + .5) * 1000);
      if (mode >= 2) {
        next[selected[1].id] = clampValue((.5 - localY / plane.offsetHeight) * 1000);
      }
    }
    dragValues.current = next;
    setOverrides((current) => ({ ...current, [active.assetId]: next }));
    setDropTargetClusterKey(computeDropTarget(next));
  }

  async function endAssetMove(event: PointerEvent<HTMLElement>) {
    const active = assetDrag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    assetDrag.current = null;
    setDraggingAssetId(null);
    setDropTargetClusterKey(null);
    if (!active.moved) {
      setOverrides((current) => {
        const next = { ...current };
        delete next[active.assetId];
        return next;
      });
      onSelectAsset(active.assetId, previewNavigationFor(active.assetId));
      return;
    }
    const changedValues = Object.fromEntries(
      selected
        .map((dimension) => [dimension.id, dragValues.current[dimension.id] ?? 500] as const)
        .filter(([id, value]) => value !== (active.startValues[id] ?? 500)),
    );
    if (Object.keys(changedValues).length) {
      pushDimensionUndo(active.assetId, active.startValues);
      // 乐观值已在父组件的 previewPage 里：入队后立即清掉临时覆盖，不再等网络回来。
      void onUpdateAssetDimensions(active.assetId, changedValues);
    }
    setOverrides((current) => {
      const next = { ...current };
      delete next[active.assetId];
      return next;
    });
  }

  return (
    <section className={`preview-layout ${focusMode ? "focus-mode" : ""}`}>
      <aside className="min-h-0 overflow-y-auto border-r border-line p-[17px] max-sm:border-r-0 max-sm:border-b">
        <div className="flex items-start gap-2.5 border-b border-line-soft pb-3.5">
          <Box size={17} aria-hidden className="mt-0.5 flex-none text-muted" />
          <div>
            <strong className="block text-md font-semibold text-ink">选择预览维度</strong>
            <span className="mt-0.5 block text-sm text-muted">最多同时使用 3 个</span>
          </div>
        </div>
        <div className="flex max-h-[410px] flex-col gap-1.5 overflow-y-auto py-3 max-sm:max-h-[180px]">
          {dimensions.map((dimension, index) => {
            const active = selectedIds.includes(dimension.id);
            const disabled = !active && selectedIds.length >= 3;
            // 选中项按选中顺序标记对应轴：第 1 项 x（横轴）、第 2 项 y（纵轴）、第 3 项 z（第三轴）；未选中显示列表序号
            const axisLetter = active ? "xyz"[selectedIds.indexOf(dimension.id)] : null;
            return (
              <div
                className={cn(
                  "group relative flex min-h-[42px] w-full cursor-pointer items-center gap-2 border bg-white py-[7px] pl-[7px] pr-[30px] text-left transition-colors",
                  active ? "border-sage bg-sage-wash" : "border-line-soft hover:border-line-strong",
                  disabled && "cursor-not-allowed",
                )}
                key={dimension.id}
                role="button"
                tabIndex={0}
                title={axisLetter ? (axisLetter === "x" ? "此维度对应预览的横轴 X" : axisLetter === "y" ? "此维度对应预览的纵轴 Y" : "此维度对应预览的第三轴 Z") : undefined}
                onClick={() => { if (!disabled) toggleDimension(dimension.id); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) toggleDimension(dimension.id); } }}
              >
                <span className={cn("grid size-[23px] flex-none place-items-center rounded-full text-2xs", active ? "bg-sage text-xs font-bold text-white" : "bg-line-soft text-muted", disabled && "opacity-40")}>
                  {axisLetter ?? index + 1}
                </span>
                <div className={cn("grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-1 text-sm", disabled && "opacity-40")}>
                  <strong className="truncate text-left font-medium">{dimension.leftLabel}</strong>
                  <i className="not-italic text-faint">—</i>
                  <strong className="truncate text-right font-medium">{dimension.rightLabel}</strong>
                </div>
                {!readOnly ? (
                  <IconButton
                    size="sm"
                    label={`编辑${dimension.leftLabel}到${dimension.rightLabel}维度`}
                    title="编辑维度名称"
                    className="absolute right-[5px] top-[5px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={(event) => { event.stopPropagation(); if (!disabled) onEditDimension(dimension); }}
                  >
                    <Pencil size={13} aria-hidden />
                  </IconButton>
                ) : null}
              </div>
            );
          })}
          {!readOnly ? (
            <Button
              variant="secondary"
              className="mt-1 w-full flex-none border-dashed"
              icon={<Plus size={14} aria-hidden />}
              onClick={onAddDimension}
            >
              添加维度
            </Button>
          ) : null}
        </div>
      </aside>
      <div className="preview-workspace">
        <div className="flex min-h-[52px] items-center justify-between gap-2.5 border-b border-line px-[13px] py-2.5 max-sm:overflow-x-auto">
          <span className="min-w-0 flex-1 truncate text-sm text-muted">{mode ? `${mode}D 预览` : "未选择维度"} · {mode === 1 ? "左右拖动图片改变维度值" : mode === 2 ? "在平面中拖动图片改变两项维度" : mode === 3 ? "左键拖动旋转视角；点击图片查看详情" : "选择 1～3 个维度开始预览"}</span>
          <div className="flex flex-none items-center gap-2.5">
            <span className="flex items-center gap-1 whitespace-nowrap text-2xs text-sage" title="双指滑动平移，鼠标滚轮或触控板捏合缩放；也可用空格 + 左键或中键拖动平移">
              <MousePointer2 size={13} aria-hidden />双指平移 · 捏合缩放
            </span>
            <div className="flex h-[29px] items-center rounded-md border border-line bg-white">
              <IconButton size="sm" label="缩小" className="size-[27px] rounded-none border-0" onClick={() => { clearFan(); setZoom((value) => Math.max(.35, value - .1)); }}>
                <Minus size={14} aria-hidden />
              </IconButton>
              <span className="min-w-[42px] text-center text-2xs text-muted">{Math.round(zoom * 100)}%</span>
              <IconButton size="sm" label="放大" className="size-[27px] rounded-none border-0" onClick={() => { clearFan(); setZoom((value) => Math.min(2.8, value + .1)); }}>
                <Plus size={14} aria-hidden />
              </IconButton>
            </div>
            <div className="flex h-[29px] items-center gap-1.5 rounded-md border border-line bg-white px-2 text-muted" role="group" aria-label="图片缩放系数" title="图片缩放系数：作用于预览内所有图片（50%～200%）">
              <Images size={13} aria-hidden />
              <RangeSlider
                min={50}
                max={200}
                step={5}
                value={Math.round(assetScale * 100)}
                onValueChange={(value) => { clearFan(); setAssetScale(value / 100); }}
                aria-label="图片缩放系数"
                className="h-1 w-[76px]"
              />
              <span className="min-w-[34px] text-center text-2xs">{Math.round(assetScale * 100)}%</span>
            </div>
            <IconButton size="sm" variant="solid" label="重置视角" title="重置视角" className="size-[31px]" onClick={resetView}>
              <RotateCcw size={15} aria-hidden />
            </IconButton>
            <IconButton size="sm" variant="solid" label={focusMode ? "退出专注模式" : "专注显示视图"} className="size-[31px]" onClick={toggleFocusMode}>
              {focusMode ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
            </IconButton>
            <IconButton
              size="sm"
              variant="solid"
              active={blurEnabled}
              label={blurEnabled ? "关闭模糊" : "开启模糊"}
              title={blurEnabled ? "关闭模糊" : "开启模糊"}
              className="size-[31px]"
              onClick={() => setBlurEnabled((active) => !active)}
            >
              <Aperture size={15} aria-hidden />
            </IconButton>
            {debugEnabled ? (
              <IconButton
                size="sm"
                variant="solid"
                active={showClusterDebug}
                label="调试：显示聚簇范围"
                title="调试：显示聚簇范围"
                className="size-[31px]"
                onClick={() => setShowClusterDebug((active) => !active)}
              >
                <Bug size={15} aria-hidden />
              </IconButton>
            ) : null}
          </div>
        </div>
        {mode ? (
          <div className={`dimension-scene mode-${mode} ${cameraMoving ? "camera-moving" : ""} ${viewPanning ? "view-panning" : ""} ${draggingAssetId ? "asset-dragging" : ""} ${hoveredAssetId ? "asset-hovered" : ""} ${planeCluster ? "stack-hovered" : ""} ${hoverFocusActive ? "hover-focus" : ""} ${modeTransitioning ? "mode-transitioning" : ""} ${octantTransitioning ? "octant-transitioning" : ""} ${isOctantIsolated ? "octant-isolated" : ""} ${spaceHeld ? "space-held" : ""}`}>
            <div
              ref={sceneViewportRef}
              className="scene-viewport"
              onPointerDown={startSceneMove}
              onPointerMove={moveInScene}
              onPointerUp={endSceneMove}
              onPointerCancel={endSceneMove}
              onPointerEnter={() => { pointerInSceneRef.current = true; }}
              onPointerLeave={() => { pointerInSceneRef.current = false; setAssetHover(null); setStackHover(null); }}
              onAuxClick={(event) => event.preventDefault()}
              onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
            >
              <div className="scene-scale" style={{ left: `calc(50% + ${viewPan.x}px)`, top: `calc(50% + ${viewPan.y}px)`, "--scene-scale": zoom, "--asset-size": `${(60 * assetScale) / zoom}px` } as CSSProperties}>
                <div
                  ref={scenePlaneRef}
                  className="scene-plane"
                  style={{
                    "--scene-rx": `${mode === 3 ? sceneRotateX : 0}deg`,
                    "--scene-rz": `${mode === 3 ? sceneRotateZ : 0}deg`,
                    "--scene-pivot-x": `${-scenePivot.x}px`,
                    "--scene-pivot-y": `${-scenePivot.y}px`,
                    "--scene-pivot-z": `${-scenePivot.z}px`,
                  } as CSSProperties}
                >
                {mode >= 2 ? <div className="xy-grid-plane" aria-hidden="true">
                  {gridTicks.map((tick) => <span className="grid-line grid-line-x" style={{ left: `${tick / 10}%` }} key={`grid-x-${tick}`} />)}
                  {gridTicks.map((tick) => <span className="grid-line grid-line-y" style={{ top: `${100 - tick / 10}%` }} key={`grid-y-${tick}`} />)}
                </div> : null}
                <div className="axis-bar axis-bar-x" aria-hidden="true">
                  <div className={`axis-half axis-half-x-pos ${isOctantIsolated && !isOctantSideVisible(0, 1) ? "octant-hidden" : ""}`}><AxisFaces /></div>
                  <div className={`axis-half axis-half-x-neg ${isOctantIsolated && !isOctantSideVisible(0, -1) ? "octant-hidden" : ""}`}><AxisFaces /></div>
                </div>
                {mode >= 2 ? <div className="axis-bar axis-bar-y" aria-hidden="true">
                  <div className={`axis-half axis-half-y-pos ${isOctantIsolated && !isOctantSideVisible(1, 1) ? "octant-hidden" : ""}`}><AxisFaces /></div>
                  <div className={`axis-half axis-half-y-neg ${isOctantIsolated && !isOctantSideVisible(1, -1) ? "octant-hidden" : ""}`}><AxisFaces /></div>
                </div> : null}
                {mode === 3 ? <div className="axis-bar axis-bar-z" aria-hidden="true">
                  <div className={`axis-half axis-half-z-pos ${isOctantIsolated && !isOctantSideVisible(2, 1) ? "octant-hidden" : ""}`}><AxisFaces /></div>
                  <div className={`axis-half axis-half-z-neg ${isOctantIsolated && !isOctantSideVisible(2, -1) ? "octant-hidden" : ""}`}><AxisFaces /></div>
                </div> : null}
                <span className="axis-origin" />
                {selected.map((dimension, axis) => gridTicks.map((tick) => {
                  // 隔离时只保留选中象限涉及的半轴刻度（多选时任一选中格涉及的都显示）
                  if (isOctantIsolated) {
                    const needed = tick === 500 ? null : tick > 500 ? 1 : -1;
                    if (needed && !isOctantSideVisible(axis, needed)) return null;
                  }
                  return (
                    <span className={`preview-axis-tick tick-axis-${axis}`} key={`${dimension.id}:${tick}`} aria-hidden="true" style={{
                      left: axis === 0 ? `${tick / 10}%` : "50%",
                      top: axis === 1 ? `${100 - tick / 10}%` : "50%",
                      transform: `translate(-50%, -50%) translateZ(${axis === 2 ? (tick - 500) * sceneSize / 1000 : 0}px)`,
                    }}>
                      <i style={{ transform: `rotateZ(${mode === 3 ? -sceneRotateZ : 0}deg) rotateX(${mode === 3 ? -sceneRotateX : 0}deg) scale(${1 / zoom})` }} />
                    </span>
                  );
                }))}
                <span className={cn("axis-label axis-label-x-start", isOctantIsolated && !isOctantSideVisible(0, -1) && "octant-hidden")}>
                  <TagLabel className="preview-scene-tag" style={billboardStyle}>{selected[0].leftLabel}</TagLabel>
                </span>
                <span className={cn("axis-label axis-label-x-end", isOctantIsolated && !isOctantSideVisible(0, 1) && "octant-hidden")}>
                  <TagLabel className="preview-scene-tag" style={billboardStyle}>{selected[0].rightLabel}</TagLabel>
                </span>
                {mode >= 2 ? <>
                  <span className={cn("axis-label axis-label-y-start", isOctantIsolated && !isOctantSideVisible(1, 1) && "octant-hidden")}>
                    <TagLabel className="preview-scene-tag" style={billboardStyle}>{selected[1].rightLabel}</TagLabel>
                  </span>
                  <span className={cn("axis-label axis-label-y-end", isOctantIsolated && !isOctantSideVisible(1, -1) && "octant-hidden")}>
                    <TagLabel className="preview-scene-tag" style={billboardStyle}>{selected[1].leftLabel}</TagLabel>
                  </span>
                </> : null}
                {mode === 3 ? <>
                  <span className={cn("axis-label axis-label-z-start", isOctantIsolated && !isOctantSideVisible(2, -1) && "octant-hidden")}>
                    <TagLabel className="preview-scene-tag" style={billboardStyle}>{selected[2].leftLabel}</TagLabel>
                  </span>
                  <span className={cn("axis-label axis-label-z-end", isOctantIsolated && !isOctantSideVisible(2, 1) && "octant-hidden")}>
                    <TagLabel className="preview-scene-tag" style={billboardStyle}>{selected[2].rightLabel}</TagLabel>
                  </span>
                </> : null}
                {cornerLabels.map((corner) => {
                  const octantHidden = isOctantIsolated && !isolatedOctants.some((octant) =>
                    (corner.x === 0 || corner.x === octant.x) &&
                    (corner.y === 0 || corner.y === octant.y) &&
                    (corner.z === 0 || corner.z === octant.z));
                  // 2D 的角落 tag 贴到平面外侧：内边缘距平面 7px，和轴端点 tag 的端距一致，
                  // 整组的内侧边因此与相邻轴端点 tag 对齐，不再以角落为中心压住象限内容；
                  // 3D 的角落是空间的顶点，旋转后仍以该顶点为中心才不会被视角拉偏。
                  const anchoredOutside = mode === 2;
                  return (
                    <span
                      className={`corner-label ${octantHidden ? "octant-hidden" : ""}`}
                      key={corner.key}
                      style={{
                        left: corner.x === 1 ? "100%" : corner.x === -1 ? "0" : "50%",
                        top: corner.y === 1 ? "0" : corner.y === -1 ? "100%" : "50%",
                        "--corner-tz": `calc(var(--scene-size) / 2 * ${corner.z})`,
                        // 3D 保留以顶点为中心的内缩偏移；2D 用外侧对齐变量覆盖它（见下面的 --corner-tx/ty）
                        "--corner-dx": corner.x === 0 ? "0px" : corner.x === 1 ? "-12px" : "12px",
                        "--corner-dy": corner.y === 0 ? "0px" : corner.y === 1 ? "12px" : "-12px",
                        "--corner-tx": anchoredOutside ? (corner.x === 1 ? "7px" : "calc(-100% - 7px)") : undefined,
                        "--corner-ty": anchoredOutside ? (corner.y === 1 ? "calc(-100% - 7px)" : "7px") : undefined,
                        "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
                        "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
                      } as CSSProperties}
                    >
                      {/* 同一角落的多个坐标作为一个整体朝向摄像机，避免各自 billboard 后错位 */}
                      <span className="preview-tag-group">
                        {corner.labels.map((label, index) => (
                          <TagLabel className="preview-scene-tag" key={`${corner.key}-${index}`}>{label}</TagLabel>
                        ))}
                      </span>
                    </span>
                  );
                })}
                {debugEnabled && showClusterDebug ? clusters.map((cluster) => {
                  const size = sceneSize / 1000;
                  const width = (cluster.bounds.x[1] - cluster.bounds.x[0]) * size;
                  const height = mode >= 2 ? (cluster.bounds.y[1] - cluster.bounds.y[0]) * size : 12 / zoom;
                  const depth = (cluster.bounds.z[1] - cluster.bounds.z[0]) * size;
                  const face: CSSProperties = {
                    position: "absolute", inset: 0,
                    background: "rgba(227, 44, 44, .12)", border: "1px solid rgba(227, 44, 44, .5)",
                  };
                  return (
                    <span key={cluster.key} style={{
                      position: "absolute", left: `${cluster.x / 10}%`, top: `${cluster.y / 10}%`,
                      width, height, pointerEvents: "none", transformStyle: "preserve-3d",
                      transform: `translate(-50%, -50%) translateZ(${cluster.z * size}px)`,
                    }}>
                      <i style={{ ...face, transform: `translateZ(${depth / 2}px)` }} />
                      {mode === 3 ? <>
                        <i style={{ ...face, transform: `translateZ(${-depth / 2}px)` }} />
                        <i style={{ ...face, width: depth, left: (width - depth) / 2, transform: `translateX(${width / 2}px) rotateY(90deg)` }} />
                        <i style={{ ...face, width: depth, left: (width - depth) / 2, transform: `translateX(${-width / 2}px) rotateY(90deg)` }} />
                        <i style={{ ...face, height: depth, top: (height - depth) / 2, transform: `translateY(${height / 2}px) rotateX(90deg)` }} />
                        <i style={{ ...face, height: depth, top: (height - depth) / 2, transform: `translateY(${-height / 2}px) rotateX(90deg)` }} />
                      </> : null}
                    </span>
                  );
                }) : null}
                {clusters.map((cluster) => {
                  if (planeCluster?.key === cluster.key || closingCluster?.key === cluster.key) return null;
                  const planeSize = scenePlaneRef.current?.offsetWidth ?? 0;
                  const stackWorldZ = projectValuePoint(cluster.x, cluster.y, cluster.z)?.worldZ ?? cluster.meanDepth;
                  const stackPersp = 1 - stackWorldZ / SCENE_PERSPECTIVE;
                  const stackDofOn = blurEnabled && !isOctantIsolated;
                  // hover 聚焦：模糊受总开关控制，白色叠加始终保留
                  const stackBaseBlur = stackDofOn ? depthBlurStyle(stackWorldZ) : undefined;
                  const stackBlur = hoverFocusActive
                    ? (stackBaseBlur ?? (blurEnabled ? { filter: `blur(${HOVER_FOCUS_BLUR}px)` } : undefined))
                    : stackBaseBlur;
                  const stackFocusFog = hoverFocusActive
                    ? ({ "--dof-fog": HOVER_FOCUS_SCRIM } as CSSProperties)
                    : (isOctantIsolated ? undefined : depthFogStyle(stackWorldZ));
                  const previewMembers = mode === 2
                    ? stackPreviewMembers(orderStackGrid(
                      cluster.members,
                      2,
                      (member) => effectiveDimensionValue(member, selected[0].id),
                      (member) => effectiveDimensionValue(member, selected[1].id),
                    ))
                    : stackPreviewMembers(cluster.members);
                  const isDropTarget = dropTargetClusterKey === cluster.key;
                  return (
                    <button
                      type="button"
                      className={`preview-asset preview-stack ${isDropTarget ? "drop-target" : ""}`}
                      key={cluster.key}
                      data-asset-id={cluster.key}
                      data-stack-key={cluster.key}
                      data-member-ids={cluster.members.map((member) => member.id).join(" ")}
                      data-screen-depth={stackWorldZ}
                      data-hover-disabled={stackBlur ? "true" : undefined}
                      style={{
                        left: `${cluster.x / 10}%`,
                        top: `${cluster.y / 10}%`,
                        "--asset-size": `${((isDropTarget ? 132 : PREVIEW_ASSET_WIDTH) * assetScale) / zoom}px`,
                        "--asset-z": `${cluster.z * planeSize / 1000}px`,
                        "--asset-ratio": "1 / 1",
                        "--persp": stackPersp,
                        "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
                        "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
                        ...stackFocusFog,
                      } as CSSProperties}
                      title={`${cluster.members.length} 张素材 · hover 展开查看`}
                    >
                      {/* 模糊加在整张脸上：图片与雾化底色一起虚化，避免底色被裁出一个硬边框 */}
                      <span className="preview-asset-face" style={stackBlur}>
                        <span className="stack-grid">
                          {previewMembers.map((member) => (
                            <span className="stack-card" key={member.id} data-asset-id={member.id}>
                              {member.thumbnailUrl ? <img src={member.thumbnailUrl} alt="" draggable={false} /> : <i>{member.name.slice(0, 1)}</i>}
                            </span>
                          ))}
                          <b className="stack-count">{cluster.members.length}</b>
                        </span>
                      </span>
                    </button>
                  );
                })}
                {assets.map((asset) => {
                  if (clusterOf.has(asset.id)) return null;
                  const values = { ...asset.dimensionValues, ...overrides[asset.id] };
                  const isHoverSource = hoverPreview?.asset.id === asset.id;
                  const octantHidden = !assetBelongsToIsolatedOctant(values);
                  const x = values[selected[0].id] ?? 500;
                  const y = mode >= 2 ? 1000 - (values[selected[1].id] ?? 500) : 500;
                  const z = mode === 3 ? (values[selected[2].id] ?? 500) - 500 : 0;
                  const planeSize = scenePlaneRef.current?.offsetWidth ?? 0;
                  const pitch = (mode === 3 ? rotateX : 0) * Math.PI / 180;
                  const yaw = (mode === 3 ? rotateZ : 0) * Math.PI / 180;
                  const localX = (x / 1000 - 0.5) * planeSize;
                  const localY = (y / 1000 - 0.5) * planeSize;
                  const localZ = z * planeSize / 1000;
                  const centeredX = localX - scenePivot.x;
                  const centeredY = localY - scenePivot.y;
                  const centeredZ = localZ - scenePivot.z;
                  const alongY = Math.sin(yaw) * centeredX + Math.cos(yaw) * centeredY;
                  const worldZ = Math.sin(pitch) * alongY + Math.cos(pitch) * centeredZ;
                  const persp = 1 - worldZ / SCENE_PERSPECTIVE;
                  const assetDofOn = blurEnabled && !isOctantIsolated && hoveredAssetId !== asset.id && !isHoverSource;
                  const focusDimmed = hoverFocusActive && hoveredAssetId !== asset.id && !isHoverSource;
                  // hover 聚焦：模糊受总开关控制，白色叠加始终保留
                  const baseBlur = assetDofOn ? depthBlurStyle(worldZ) : undefined;
                  const blurStyle = focusDimmed
                    ? (baseBlur ?? (blurEnabled ? { filter: `blur(${HOVER_FOCUS_BLUR}px)` } : undefined))
                    : baseBlur;
                  const fogStyle = isHoverSource
                    ? undefined
                    : focusDimmed
                      ? ({ "--dof-fog": HOVER_FOCUS_SCRIM } as CSSProperties)
                      : (isOctantIsolated ? undefined : depthFogStyle(worldZ));
                  return (
                    <button
                      type="button"
                      className={`preview-asset ${draggingAssetId === asset.id ? "dragging" : ""} ${hoveredAssetId === asset.id ? "hovered" : ""} ${hoverPreview?.asset.id === asset.id ? "hover-foreground-source" : ""} ${octantHidden ? "octant-hidden" : ""}`}
                      key={asset.id}
                      data-asset-id={asset.id}
                      data-screen-depth={worldZ}
                      data-hover-disabled={blurStyle ? "true" : undefined}
                      aria-hidden={octantHidden}
                      style={{
                        left: `${x / 10}%`,
                        top: `${y / 10}%`,
                        "--asset-size": `${(PREVIEW_ASSET_WIDTH * assetScale) / zoom}px`,
                        "--asset-z": `${z * planeSize / 1000}px`,
                        "--asset-ratio": aspectRatioFor(asset),
                        "--persp": persp,
                        "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
                        "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
                        ...fogStyle,
                      } as CSSProperties}
                      title={mode === 3 ? `${asset.name} · 点击查看详情 · 拖动旋转视角` : `${asset.name} · 拖动修改维度`}
                    >
                      {/* 模糊加在整张脸上：图片与雾化底色一起虚化，避免底色被裁出一个硬边框 */}
                      <span className="preview-asset-face" style={blurStyle}>
                        {isHoverSource ? null : (
                          <span className="preview-art-flip">
                            {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" draggable={false} /> : <i>{asset.name.slice(0, 1)}</i>}
                          </span>
                        )}
                      </span>
                      {draggingAssetId === asset.id ? (
                        <span className="preview-value-tag-layer">{valueTagsOf(values)}</span>
                      ) : null}
                    </button>
                  );
                })}
                </div>
              </div>
              <div ref={flipGhostLayerRef} className="flip-ghost-layer" aria-hidden="true" />
              {hoverPreview ? (
                // 单张 hover 的前景层：脱离 3D 深度排序，永远显示在最前；遮挡物保持原位
                <div
                  className={`hover-preview ${hoverPreview.closing ? "closing" : ""}`}
                  key={hoverPreview.asset.id}
                  style={{
                    left: hoverPreview.left,
                    top: hoverPreview.top,
                    width: hoverPreview.width,
                    height: hoverPreview.height,
                  }}
                  aria-hidden="true"
                >
                  <span className="preview-asset-face">
                    {hoverPreview.asset.thumbnailUrl
                      ? <img src={hoverPreview.asset.thumbnailUrl} alt="" draggable={false} />
                      : <i>{hoverPreview.asset.name.slice(0, 1)}</i>}
                    {hoverPreview.closing ? null : valueTagsOf(hoverPreview.values)}
                  </span>
                </div>
              ) : null}
              {(planeCluster || closingCluster) ? (() => {
                const cluster = (planeCluster ?? closingCluster)!;
                const isClosing = !planeCluster && closingCluster !== null;
                const viewport = sceneViewportRef.current;
                const members = cluster.members;
                const count = members.length;
                const cardSize = PLANE_CARD_SIZE * assetScale;
                const { columns, rows, width: planeWidth, height: planeHeight } = planeDimensions(count, cardSize);
                const projected = projectValuePoint(cluster.x, cluster.y, cluster.z);
                let left = 0;
                let top = 0;
                if (viewport) {
                  const vw = viewport.offsetWidth;
                  const vh = viewport.offsetHeight;
                  const screenX = vw / 2 + viewPan.x + (projected?.screenX ?? cluster.screenX);
                  const screenY = vh / 2 + viewPan.y + (projected?.screenY ?? cluster.screenY);
                  // 平面与原堆完全重合：以堆的屏幕位置为中心
                  left = Math.max(8, Math.min(vw - planeWidth - 8, screenX - planeWidth / 2));
                  top = Math.max(8, Math.min(vh - planeHeight - 8, screenY - planeHeight / 2));
                }
                return (
                  <div
                    className={`stack-plane mode-${mode} ${isClosing ? "closing" : ""}`}
                    style={{ left, top, width: planeWidth, height: planeHeight }}
                    onPointerDown={(event) => {
                      // 中键 / 空格+左键：平移优先，冒泡给场景开始平移；其余事件继续由平面独占
                      if (event.button === 1 || (event.button === 0 && spaceHeldRef.current)) return;
                      event.stopPropagation();
                    }}
                    onPointerMove={(event) => { event.stopPropagation(); movePlaneCardDrag(event); }}
                    onPointerUp={(event) => { event.stopPropagation(); void endPlaneCardDrag(event); }}
                    onPointerCancel={(event) => { event.stopPropagation(); void endPlaneCardDrag(event); }}
                  >
                    <div className="stack-plane-surface">
                      {members.map((member, index) => {
                        const col = index % columns;
                        const row = Math.floor(index / columns);
                        const offsetX = (col - (columns - 1) / 2) * (cardSize + PLANE_CARD_GAP);
                        const offsetY = (row - (rows - 1) / 2) * (cardSize + PLANE_CARD_GAP);
                        return (
                          <button
                            type="button"
                            className={`stack-plane-card ${draggingPlaneAssetId === member.id ? "dragging" : ""}`}
                            key={member.id}
                            style={{
                              "--plane-card-size": `${cardSize}px`,
                              "--card-offset-x": `${offsetX}px`,
                              "--card-offset-y": `${offsetY}px`,
                              "--drag-dx": `${planeDragDelta.x}px`,
                              "--drag-dy": `${planeDragDelta.y}px`,
                            } as CSSProperties}
                            onPointerDown={(event) => startPlaneCardDrag(event, member)}
                            onClick={() => {
                              if (suppressClickAfterPan.current) {
                                suppressClickAfterPan.current = false;
                                return;
                              }
                              if (planeDragJustMoved.current) {
                                planeDragJustMoved.current = false;
                                return;
                              }
                              clearFan();
                              onSelectAsset(member.id, previewNavigationFor(member.id));
                            }}
                          >
                            {member.thumbnailUrl ? <img src={member.thumbnailUrl} alt="" draggable={false} /> : <i>{member.name.slice(0, 1)}</i>}
                            {valueTagsOf({ ...member.dimensionValues, ...overrides[member.id] })}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })() : null}
            </div>
            {mode === 3 ? <div className="octant-isolation-controls">
              <div
                className="octant-cube-wrap"
                data-isolated-octants={isolatedOctants.length}
                data-isolated-keys={isolatedOctants.map(octantKeyOf).join(" ")}
              >
                <svg
                  className="octant-cube"
                  viewBox="-48 -48 96 96"
                  role="group"
                  aria-label="空间象限选择：首次点选为基准格，再点其它格子按与基准点的轴差选中棱 / 面 / 整块；再点当前操作格沿历史回退，点盒子内其它格逐层收缩，点基准格或右上角叉子退出隔离"
                  onPointerLeave={() => setHoverOctant(null)}
                >
                  <title>首次点选为基准格；再点格子按轴差选中棱 / 面 / 整块；再点当前操作格回退一步，点盒内其它格收缩一层；点基准格或右上角叉子退出</title>
                  {octantCubeFacets.map((facet) => {
                    const facetKey = octantKeyOf(facet.octant);
                    const isHovered = hoverOctant ? octantKeyOf(hoverOctant) === facetKey : false;
                    const isIsolated = isolatedOctantKeys.includes(facetKey);
                    return (
                      <polygon
                        key={facet.key}
                        data-octant={facetKey}
                        className={`octant-cube-face${isHovered ? " is-hover" : ""}${isIsolated ? " is-isolated" : ""}`}
                        points={facet.points}
                        onPointerEnter={() => setHoverOctant(facet.octant)}
                        onClick={() => toggleOctant(facet.octant)}
                      />
                    );
                  })}
                </svg>
                {isOctantIsolated ? (
                  <button type="button" className="octant-exit" onClick={exitOctantIsolation} aria-label="退出象限隔离" title="退出隔离">
                    <X size={13} aria-hidden />
                  </button>
                ) : null}
              </div>
              {octantTags.length ? (
                <span className="octant-isolation-labels" aria-label={`当前隔离象限：${octantLabel}`}>
                  {octantTags.map((label) => <TagLabel key={label}>{label}</TagLabel>)}
                </span>
              ) : null}
            </div> : null}
            <div className="absolute bottom-3 right-3 z-[30] flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface/90 shadow-sm">
              <SyncStatusDot status={syncStatus} onRetry={onRetrySync} />
            </div>
          </div>
        ) : (
          <EmptyState
            className="flex-1"
            compact
            icon={<Box size={28} aria-hidden />}
            title="选择预览维度"
            description="项目可以拥有任意数量的维度，每次预览最多选择 3 个。"
          />
        )}
      </div>
    </section>
  );
}
