"use client";

import { Aperture, Box, Bug, Check, Maximize2, Minimize2, Minus, MousePointer2, Pencil, Plus, RotateCcw } from "lucide-react";
import { CSSProperties, PointerEvent, useEffect, useMemo, useRef, useState, WheelEvent } from "react";
import { displayDimensionValue } from "./dimensionScale";

type Dimension = { id: string; leftLabel: string; rightLabel: string };
type Asset = { id: string; name: string; thumbnailUrl: string | null; dimensionValues: Record<string, number>; width?: number; height?: number };
type CameraDrag = { pointerId: number; startX: number; startY: number; rotateX: number; rotateZ: number; assetId?: string; moved: boolean };
type ViewPan = { pointerId: number; startX: number; startY: number; panX: number; panY: number };
type AxisSign = -1 | 1;
type Octant = { x: AxisSign; y: AxisSign; z: AxisSign };
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

const clampValue = (value: number) => Math.max(0, Math.min(1000, Math.round(value)));
const wrapRotation = (value: number) => ((value % 360) + 360) % 360;
const SCENE_PERSPECTIVE = 2200;
// 合并半径：坐标空间距离（存储单位），1D / 2D / 3D 各自独立，按缩放档位取值；低倍档逐档变大，高倍档（≥125%）按 70÷档位 递减
const CLUSTER_RADIUS = 70;
const ZOOM_LEVELS = [0.35, 0.5, 0.7, 0.95, 1.25, 1.6, 2.05, 2.8];
const RADIUS_BY_LEVEL_1D: Record<number, number> = {
  0.35: 40,
  0.5: 40,
  0.7: 40,
  0.95: 40,
};
const RADIUS_BY_LEVEL_2D: Record<number, number> = {
  0.35: 80,
  0.5: 70,
  0.7: 50,
  0.95: 40,
};
const RADIUS_BY_LEVEL_3D: Record<number, number> = {
  0.35: 120,
  0.5: 110,
  0.7: 100,
  0.95: 70,
};
const clusterRadiusFor = (level: number, mode: number) => {
  const table = mode === 3 ? RADIUS_BY_LEVEL_3D : mode === 2 ? RADIUS_BY_LEVEL_2D : RADIUS_BY_LEVEL_1D;
  return table[level] ?? CLUSTER_RADIUS / Math.max(1, level);
};
const PLANE_CARD_SIZE = 90;
const PLANE_CARD_GAP = 12;

/** 展开平面的网格列数/行数与平面尺寸（与渲染共用）。 */
function planeDimensions(count: number) {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return {
    columns,
    rows,
    width: columns * PLANE_CARD_SIZE + (columns - 1) * PLANE_CARD_GAP + 56,
    height: rows * PLANE_CARD_SIZE + (rows - 1) * PLANE_CARD_GAP + 34,
  };
}

// 景深：以原点（0,0,0，即 worldZ=0）为焦点，深度在其之后的图片开始模糊
const DOF_MAX_BLUR = 50;
const DOF_BLUR_DEPTH = 30;
function depthBlurStyle(worldZ: number): CSSProperties | undefined {
  if (worldZ >= 0) return undefined;
  const raw = Math.min(DOF_MAX_BLUR, -worldZ / DOF_BLUR_DEPTH);
  const blur = Math.round(raw * 2) / 2; // 0.5px 步进，减少旋转时的每帧抖动
  return blur > 0 ? { filter: `blur(${blur}px)` } : undefined;
}

type Cluster = {
  key: string;
  members: Asset[];
  x: number;
  y: number;
  z: number;
  meanDepth: number;
  screenX: number;
  screenY: number;
};
const aspectRatioFor = (asset: Asset) => {
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  if (width > 0 && height > 0) {
    if (width === height) return "1 / 1";
    return height > width ? "3 / 4" : "4 / 3";
  }
  return "1 / 1";
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
}: {
  dimensions: Dimension[];
  assets: Asset[];
  onSelectAsset: (assetId: string) => void;
  onUpdateAssetDimensions: (assetId: string, values: Record<string, number>) => Promise<void>;
  onAddDimension: () => void;
  onEditDimension: (dimension: Dimension) => void;
}) {
  const [selectedIds, setSelectedIds] = useState(() => dimensions.slice(0, 3).map((dimension) => dimension.id));
  const [zoom, setZoom] = useState(1);
  const [rotateX, setRotateX] = useState(52);
  const [rotateZ, setRotateZ] = useState(352);
  const [cameraMoving, setCameraMoving] = useState(false);
  const [viewPanning, setViewPanning] = useState(false);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [isolatedOctant, setIsolatedOctant] = useState<Octant | null>(null);
  const [octantTransitioning, setOctantTransitioning] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [draggingAssetId, setDraggingAssetId] = useState<string | null>(null);
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hiddenAssetIds, setHiddenAssetIds] = useState<string[]>([]);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({});
  const [sceneSize, setSceneSize] = useState(0);
  // 开发调试开关：绘制聚簇范围（生产构建中该分支被构建期剔除）
  const debugEnabled = import.meta.env.DEV;
  const [showClusterDebug, setShowClusterDebug] = useState(false);
  const [dofEnabled, setDofEnabled] = useState(true);
  const scenePlaneRef = useRef<HTMLDivElement>(null);
  const sceneViewportRef = useRef<HTMLDivElement>(null);
  const cameraDrag = useRef<CameraDrag | null>(null);
  const viewPanDrag = useRef<ViewPan | null>(null);
  const assetDrag = useRef<AssetDrag | null>(null);
  const dragValues = useRef<Record<string, number>>({});
  const spaceHeldRef = useRef(false);
  const hoveredAssetIdRef = useRef<string | null>(null);
  const hiddenAssetIdsRef = useRef(new Set<string>());
  const [planeCluster, setPlaneCluster] = useState<Cluster | null>(null);
  const [closingCluster, setClosingCluster] = useState<Cluster | null>(null);
  const [draggingPlaneAssetId, setDraggingPlaneAssetId] = useState<string | null>(null);
  const [planeDragDelta, setPlaneDragDelta] = useState({ x: 0, y: 0 });
  const [dropTargetClusterKey, setDropTargetClusterKey] = useState<string | null>(null);
  const planeClusterRef = useRef<Cluster | null>(null);
  const planeDrag = useRef<{ pointerId: number; assetId: string; startX: number; startY: number; startValues: Record<string, number>; moved: boolean } | null>(null);
  const planeDragJustMoved = useRef(false);
  const planeCloseTimer = useRef<number | null>(null);

  const selected = useMemo(
    () => selectedIds.map((id) => dimensions.find((dimension) => dimension.id === id)).filter(Boolean) as Dimension[],
    [dimensions, selectedIds],
  );
  const mode = selected.length;
  const gridTicks = useMemo(() => Array.from({ length: 11 }, (_, index) => index), []);
  const sceneRotateX = ((rotateX + 180) % 360 + 360) % 360 - 180;
  const sceneRotateZ = ((rotateZ + 180) % 360 + 360) % 360 - 180;
  const planeSize = scenePlaneRef.current?.offsetWidth ?? 0;
  const scenePivot = isolatedOctant
    ? {
        x: isolatedOctant.x * planeSize / 4,
        y: -isolatedOctant.y * planeSize / 4,
        z: isolatedOctant.z * planeSize / 4,
      }
    : { x: 0, y: 0, z: 0 };

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

  const { clusters, clusterOf, radius: clusterRadius } = useMemo(() => {
    const empty = { clusters: [] as Cluster[], clusterOf: new Map<string, string>(), radius: 0 };
    if (!mode || !selected.length) return empty;
    const planeSize = sceneSize || scenePlaneRef.current?.offsetWidth || 0;
    if (!planeSize) return empty;
    // 按维度坐标空间距离聚簇：半径随缩放档位调整（≤100% 固定，≥125% 逐档变精细），旋转不改变分组
    const level = [...ZOOM_LEVELS].reverse().find((candidate) => zoom >= candidate) ?? ZOOM_LEVELS[0];
    const radius = clusterRadiusFor(level, mode);
    type ProjectedEntry = { id: string; x: number; y: number; z: number; worldZ: number };
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const entries: ProjectedEntry[] = [];
    for (const asset of assets) {
      if (asset.id === draggingAssetId || asset.id === draggingPlaneAssetId) continue;
      const values = { ...asset.dimensionValues, ...overrides[asset.id] };
      if (!assetBelongsToIsolatedOctant(values)) continue;
      const x = values[selected[0].id] ?? 500;
      const y = mode >= 2 ? 1000 - (values[selected[1].id] ?? 500) : 500;
      const z = mode === 3 ? (values[selected[2].id] ?? 500) - 500 : 0;
      const projected = projectValuePoint(x, y, z);
      if (!projected) continue;
      entries.push({ id: asset.id, x, y, z, worldZ: projected.worldZ });
    }
    // 坐标空间并查集聚簇（100～500 张素材，O(n²) 仅在跨档重组时执行，开销可忽略）
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root) ?? root;
      let node = id;
      while (parent.get(node) !== root) {
        const next = parent.get(node) ?? root;
        parent.set(node, root);
        node = next;
      }
      return root;
    };
    const union = (a: string, b: string) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent.set(rootA, rootB);
    };
    for (const entry of entries) parent.set(entry.id, entry.id);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const distance = mode === 1
          ? Math.abs(a.x - b.x)
          : mode === 2
            ? Math.hypot(a.x - b.x, a.y - b.y)
            : Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (distance < radius) union(a.id, b.id);
      }
    }
    const groups = new Map<string, ProjectedEntry[]>();
    for (const entry of entries) {
      const root = find(entry.id);
      const group = groups.get(root);
      if (group) group.push(entry);
      else groups.set(root, [entry]);
    }
    const clusters: Cluster[] = [];
    const clusterOf = new Map<string, string>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const key = `s:${group.map((entry) => entry.id).sort().join(",")}`;
      const members = group
        .slice()
        .sort((a, b) => b.worldZ - a.worldZ)
        .flatMap((entry) => {
          const asset = byId.get(entry.id);
          return asset ? [asset] : [];
        });
      const x = group.reduce((sum, entry) => sum + entry.x, 0) / group.length;
      const y = group.reduce((sum, entry) => sum + entry.y, 0) / group.length;
      const z = group.reduce((sum, entry) => sum + entry.z, 0) / group.length;
      const meanDepth = group.reduce((sum, entry) => sum + entry.worldZ, 0) / group.length;
      const projected = projectValuePoint(x, y, z);
      clusters.push({
        key,
        members,
        x,
        y,
        z,
        meanDepth,
        screenX: projected?.screenX ?? 0,
        screenY: projected?.screenY ?? 0,
      });
      for (const entry of group) clusterOf.set(entry.id, key);
    }
    return { clusters, clusterOf, radius };
  }, [assets, mode, selected, zoom, sceneSize, scenePivot.x, scenePivot.y, scenePivot.z, isolatedOctant, overrides, draggingAssetId, draggingPlaneAssetId]);

  function octantName(octant: Octant) {
    return [
      octant.x === 1 ? selected[0].rightLabel : selected[0].leftLabel,
      octant.y === 1 ? selected[1].rightLabel : selected[1].leftLabel,
      octant.z === 1 ? selected[2].rightLabel : selected[2].leftLabel,
    ].join("、");
  }

  function computeNearestOctant(): Octant {
    const size = sceneSize;
    const pitch = rotateX * Math.PI / 180;
    const yaw = rotateZ * Math.PI / 180;
    const signs: AxisSign[] = [-1, 1];
    let nearest: Octant = { x: 1, y: 1, z: 1 };
    let nearestDepth = Number.NEGATIVE_INFINITY;
    for (const x of signs) {
      for (const y of signs) {
        for (const z of signs) {
          const localX = x * size / 4;
          const localY = -y * size / 4;
          const localZ = z * size / 4;
          const alongY = Math.sin(yaw) * localX + Math.cos(yaw) * localY;
          const depth = Math.sin(pitch) * alongY + Math.cos(pitch) * localZ;
          if (depth > nearestDepth) {
            nearestDepth = depth;
            nearest = { x, y, z };
          }
        }
      }
    }
    return nearest;
  }

  const isolatedOctantLabel = isolatedOctant && mode === 3 ? octantName(isolatedOctant) : null;
  const nearestOctantLabel = mode === 3 && !isolatedOctant ? octantName(computeNearestOctant()) : null;
  const cornerLabels = useMemo(() => {
    if (mode < 2 || !selected.length) return [];
    const signs: AxisSign[] = [-1, 1];
    const corners: Array<{ key: string; x: number; y: number; z: number; label: string }> = [];
    const pick = (ends: string[], sign: number) => ends[sign === 1 ? 1 : 0];
    const xEnds = [selected[0].leftLabel, selected[0].rightLabel];
    const yEnds = [selected[1].leftLabel, selected[1].rightLabel];

    if (mode === 2) {
      for (const x of signs) {
        for (const y of signs) {
          corners.push({ key: `xy-${x}${y}`, x, y, z: 0, label: `${pick(xEnds, x)}、${pick(yEnds, y)}` });
        }
      }
      return corners;
    }

    const zEnds = [selected[2].leftLabel, selected[2].rightLabel];
    for (const x of signs) {
      for (const y of signs) {
        corners.push({ key: `xy-${x}${y}`, x, y, z: 0, label: `${pick(xEnds, x)}、${pick(yEnds, y)}` });
      }
    }
    for (const x of signs) {
      for (const z of signs) {
        corners.push({ key: `xz-${x}${z}`, x, y: 0, z, label: `${pick(xEnds, x)}、${pick(zEnds, z)}` });
      }
    }
    for (const y of signs) {
      for (const z of signs) {
        corners.push({ key: `yz-${y}${z}`, x: 0, y, z, label: `${pick(yEnds, y)}、${pick(zEnds, z)}` });
      }
    }
    for (const x of signs) {
      for (const y of signs) {
        for (const z of signs) {
          corners.push({ key: `xyz-${x}${y}${z}`, x, y, z, label: `${pick(xEnds, x)}、${pick(yEnds, y)}、${pick(zEnds, z)}` });
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
    const plane = scenePlaneRef.current;
    if (!plane) return;
    const measure = () => setSceneSize(plane.offsetWidth);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(plane);
      return () => observer.disconnect();
    }
  }, []);

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

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => dimensions.some((dimension) => dimension.id === id)));
  }, [dimensions]);

  useEffect(() => {
    if (!modeTransitioning) return;
    const timer = window.setTimeout(() => setModeTransitioning(false), 1050);
    return () => window.clearTimeout(timer);
  }, [modeTransitioning, mode]);

  useEffect(() => {
    if (mode === 3 || !isolatedOctant) return;
    clearFan();
    setIsolatedOctant(null);
  }, [mode, isolatedOctant]);

  useEffect(() => {
    if (!octantTransitioning) return;
    const timer = window.setTimeout(() => setOctantTransitioning(false), 480);
    return () => window.clearTimeout(timer);
  }, [octantTransitioning, isolatedOctant]);

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

  function toggleDimension(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  function toggleFocusMode() {
    setFocusMode((active) => !active);
  }

  function zoomWithWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    clearFan();
    const factor = Math.exp(-event.deltaY * .0014);
    setZoom((current) => Math.max(.35, Math.min(2.8, current * factor)));
  }

  function toggleOctantIsolation() {
    if (mode !== 3) return;
    clearFan();
    setOctantTransitioning(true);
    if (isolatedOctant) {
      setIsolatedOctant(null);
      return;
    }
    setIsolatedOctant(computeNearestOctant());
  }

  function assetBelongsToIsolatedOctant(values: Record<string, number>) {
    if (!isolatedOctant || mode !== 3) return true;
    const matchesSide = (value: number, side: AxisSign) => value === 500 || (side === 1 ? value > 500 : value < 500);
    return matchesSide(values[selected[0].id] ?? 500, isolatedOctant.x)
      && matchesSide(values[selected[1].id] ?? 500, isolatedOctant.y)
      && matchesSide(values[selected[2].id] ?? 500, isolatedOctant.z);
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
    if (event.button !== 0) return;
    clearFan();
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

  function assetAtPoint(clientX: number, clientY: number) {
    const plane = scenePlaneRef.current;
    if (!plane) return null;
    const candidates = Array.from(plane.querySelectorAll<HTMLElement>(".preview-asset:not(.octant-hidden)"))
      .map((asset, order) => {
        if (hiddenAssetIdsRef.current.has(asset.dataset.assetId ?? "")) return null;
        const face = asset.querySelector<HTMLElement>(".preview-asset-face");
        // 命中检测跟随图片实际视觉大小：hover 放大时用放大后的 img/占位符 rect，平时用原始 rect
        const visual = asset.querySelector<HTMLElement>(".preview-asset-face img, .preview-asset-face > i");
        const rect = (visual ?? face)?.getBoundingClientRect();
        if (!rect || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
        return {
          id: asset.dataset.assetId ?? null,
          stackKey: asset.dataset.stackKey ?? null,
          depth: Number(asset.dataset.screenDepth ?? 0),
          order,
        };
      })
      .filter((candidate): candidate is { id: string | null; stackKey: string | null; depth: number; order: number } => Boolean(candidate?.id || candidate?.stackKey))
      .sort((a, b) => b.depth - a.depth || b.order - a.order);
    const top = candidates[0];
    return top ? { id: top.id, stackKey: top.stackKey } : null;
  }

  function computeOccluders(targetId: string, expanded: { left: number; right: number; top: number; bottom: number }): string[] {
    const plane = scenePlaneRef.current;
    if (!plane) return [];
    const candidates = Array.from(plane.querySelectorAll<HTMLElement>(".preview-asset:not(.octant-hidden)"));
    const target = candidates.find((asset) => asset.dataset.assetId === targetId);
    if (!target) return [];
    const targetOrder = candidates.indexOf(target);
    const targetDepth = Number(target.dataset.screenDepth ?? 0);
    return candidates
      .filter((candidate, candidateOrder) => {
        const candidateDepth = Number(candidate.dataset.screenDepth ?? 0);
        const isInFront = candidateDepth > targetDepth
          || (Math.abs(candidateDepth - targetDepth) < .001 && candidateOrder > targetOrder);
        if (candidate === target || !isInFront) return false;
        const face = candidate.querySelector<HTMLElement>(".preview-asset-face");
        const visual = candidate.querySelector<HTMLElement>(".preview-asset-face img, .preview-asset-face > i");
        const rect = (visual ?? face)?.getBoundingClientRect();
        return Boolean(rect && expanded.left < rect.right && expanded.right > rect.left && expanded.top < rect.bottom && expanded.bottom > rect.top);
      })
      .map((candidate) => candidate.dataset.assetId)
      .filter((id): id is string => Boolean(id));
  }

  function visualRectOf(targetId: string) {
    const plane = scenePlaneRef.current;
    if (!plane) return null;
    const target = Array.from(plane.querySelectorAll<HTMLElement>(".preview-asset:not(.octant-hidden)"))
      .find((asset) => asset.dataset.assetId === targetId);
    if (!target) return null;
    const face = target.querySelector<HTMLElement>(".preview-asset-face");
    const visual = target.querySelector<HTMLElement>(".preview-asset-face img, .preview-asset-face > i");
    return (visual ?? face)?.getBoundingClientRect() ?? null;
  }

  function setAssetHover(assetId: string | null) {
    if (hoveredAssetIdRef.current === assetId) return;
    hoveredAssetIdRef.current = assetId;
    let hiddenIds: string[] = [];
    if (assetId) {
      const rect = visualRectOf(assetId);
      if (rect) {
        const hoverScale = 2.475;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        hiddenIds = computeOccluders(assetId, {
          left: centerX - (rect.width * hoverScale) / 2,
          right: centerX + (rect.width * hoverScale) / 2,
          top: centerY - (rect.height * hoverScale) / 2,
          bottom: centerY + (rect.height * hoverScale) / 2,
        });
      }
    }
    hiddenAssetIdsRef.current = new Set(hiddenIds);
    setHiddenAssetIds(hiddenIds);
    setHoveredAssetId(assetId);
  }

  function setStackOccluders(key: string) {
    const rect = visualRectOf(key);
    const count = planeClusterRef.current?.members.length ?? 0;
    if (!rect) {
      hiddenAssetIdsRef.current = new Set();
      setHiddenAssetIds([]);
      return;
    }
    const { width: planeWidth, height: planeHeight } = planeDimensions(count);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hiddenIds = computeOccluders(key, {
      left: centerX - planeWidth / 2,
      right: centerX + planeWidth / 2,
      top: centerY - planeHeight / 2,
      bottom: centerY + planeHeight / 2,
    });
    hiddenAssetIdsRef.current = new Set(hiddenIds);
    setHiddenAssetIds(hiddenIds);
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
    hiddenAssetIdsRef.current = new Set();
    setHiddenAssetIds([]);
    setAssetHover(null);
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
    hiddenAssetIdsRef.current = new Set();
    setHiddenAssetIds([]);
    setAssetHover(null);
    planeCloseTimer.current = window.setTimeout(() => {
      planeCloseTimer.current = null;
      setClosingCluster(null);
    }, 160);
  }

  function computeDropTarget(values: Record<string, number>): string | null {
    if (!mode || !selected.length) return null;
    const x = values[selected[0].id] ?? 500;
    const y = mode >= 2 ? 1000 - (values[selected[1].id] ?? 500) : 500;
    const z = mode === 3 ? (values[selected[2].id] ?? 500) - 500 : 0;
    for (const cluster of clusters) {
      const distance = mode === 1
        ? Math.abs(x - cluster.x)
        : mode === 2
          ? Math.hypot(x - cluster.x, y - cluster.y)
          : Math.hypot(x - cluster.x, y - cluster.y, z - cluster.z);
      if (distance < clusterRadius) return cluster.key;
    }
    return null;
  }

  function setStackHover(key: string | null) {
    if (key === null) {
      if (planeClusterRef.current === null) return;
      closePlane();
      return;
    }
    if (planeClusterRef.current?.key === key) return;
    const cluster = clusters.find((candidate) => candidate.key === key);
    if (!cluster) return;
    planeClusterRef.current = cluster;
    setPlaneCluster(cluster);
    setStackOccluders(key);
  }

  function updateAssetHover(event: PointerEvent<HTMLDivElement>) {
    if (assetDrag.current || cameraDrag.current || viewPanDrag.current) {
      setAssetHover(null);
      setStackHover(null);
      return;
    }
    const hit = assetAtPoint(event.clientX, event.clientY);
    if (hit?.stackKey) {
      setAssetHover(null);
      setStackHover(hit.stackKey);
      return;
    }
    setAssetHover(hit?.id ?? null);
    setStackHover(null);
  }

  function startPlaneCardDrag(event: PointerEvent<HTMLButtonElement>, member: Asset) {
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
      await onUpdateAssetDimensions(active.assetId, changedValues);
    }
    setOverrides((current) => {
      const next = { ...current };
      delete next[active.assetId];
      return next;
    });
  }

  function startSceneMove(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (spaceHeldRef.current) {
      startViewPan(event);
      return;
    }
    const hit = assetAtPoint(event.clientX, event.clientY);
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
    if (active.assetId && !active.moved) onSelectAsset(active.assetId);
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
    setDraggingAssetId(asset.id);
  }

  function moveAsset(event: PointerEvent<HTMLElement>) {
    const active = assetDrag.current;
    const plane = scenePlaneRef.current;
    if (!active || active.pointerId !== event.pointerId || !plane || !selected.length) return;
    event.preventDefault();
    event.stopPropagation();
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
      onSelectAsset(active.assetId);
      return;
    }
    const changedValues = Object.fromEntries(
      selected
        .map((dimension) => [dimension.id, dragValues.current[dimension.id] ?? 500] as const)
        .filter(([id, value]) => value !== (active.startValues[id] ?? 500)),
    );
    if (Object.keys(changedValues).length) {
      await onUpdateAssetDimensions(active.assetId, changedValues);
    }
    setOverrides((current) => {
      const next = { ...current };
      delete next[active.assetId];
      return next;
    });
  }

  return (
    <section className={`preview-layout ${focusMode ? "focus-mode" : ""}`}>
      <aside className="preview-settings">
        <div className="preview-settings-heading"><Box size={17} /><div><strong>选择预览维度</strong><span>最多同时使用 3 个</span></div></div>
        <div className="preview-dimension-options">
          {dimensions.map((dimension, index) => {
            const active = selectedIds.includes(dimension.id);
            const disabled = !active && selectedIds.length >= 3;
            return (
              <div
                className={`preview-dimension-option ${active ? "active" : ""} ${disabled ? "disabled" : ""}`}
                key={dimension.id}
                role="button"
                tabIndex={0}
                onClick={() => { if (!disabled) toggleDimension(dimension.id); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!disabled) toggleDimension(dimension.id); } }}
              >
                <span className="preview-dimension-index">{active ? <Check size={13} /> : index + 1}</span>
                <div className="preview-dimension-labels"><strong>{dimension.leftLabel}</strong><i>—</i><strong>{dimension.rightLabel}</strong></div>
                <button className="preview-dimension-delete" type="button" onClick={(event) => { event.stopPropagation(); if (!disabled) onEditDimension(dimension); }} aria-label={`编辑${dimension.leftLabel}到${dimension.rightLabel}维度`} title="编辑维度名称"><Pencil size={13} /></button>
              </div>
            );
          })}
          <button className="preview-dimension-add" type="button" onClick={onAddDimension}><Plus size={14} /> 添加维度</button>
        </div>
      </aside>
      <div className="preview-workspace">
        <div className="preview-toolbar">
          <span>{mode ? `${mode}D 预览` : "未选择维度"} · {mode === 1 ? "左右拖动图片改变维度值" : mode === 2 ? "在平面中拖动图片改变两项维度" : mode === 3 ? "左键拖动旋转视角；点击图片查看详情" : "选择 1～3 个维度开始预览"}</span>
          <div className="preview-tools">
            <span className="camera-hint"><MousePointer2 size={13} />空格 + 左键平移视图</span>
            <div className="preview-zoom"><button type="button" onClick={() => { clearFan(); setZoom((value) => Math.max(.35, value - .1)); }} aria-label="缩小"><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => { clearFan(); setZoom((value) => Math.min(2.8, value + .1)); }} aria-label="放大"><Plus size={14} /></button></div>
            <button className="fullscreen-button" type="button" onClick={resetView} aria-label="重置视角" title="重置视角"><RotateCcw size={15} /></button>
            <button className="fullscreen-button" type="button" onClick={toggleFocusMode} aria-label={focusMode ? "退出专注模式" : "专注显示视图"}>{focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
            <button className={`fullscreen-button ${dofEnabled ? "dof-active" : ""}`} type="button" onClick={() => setDofEnabled((active) => !active)} aria-label={dofEnabled ? "关闭景深" : "开启景深"} title={dofEnabled ? "关闭景深" : "开启景深"}><Aperture size={15} /></button>
            {debugEnabled ? <button
              className="fullscreen-button"
              type="button"
              onClick={() => setShowClusterDebug((active) => !active)}
              aria-label="调试：显示聚簇范围"
              title="调试：显示聚簇范围"
              style={showClusterDebug ? { borderColor: "#c23d2e", background: "#fff3f0", color: "#c23d2e" } : undefined}
            ><Bug size={15} /></button> : null}
          </div>
        </div>
        {mode ? (
          <div className={`dimension-scene mode-${mode} ${cameraMoving ? "camera-moving" : ""} ${viewPanning ? "view-panning" : ""} ${draggingAssetId ? "asset-dragging" : ""} ${hoveredAssetId ? "asset-hovered" : ""} ${planeCluster ? "stack-hovered" : ""} ${modeTransitioning ? "mode-transitioning" : ""} ${octantTransitioning ? "octant-transitioning" : ""} ${isolatedOctant ? "octant-isolated" : ""} ${spaceHeld ? "space-held" : ""}`}>
            <div
              ref={sceneViewportRef}
              className="scene-viewport"
              onPointerDown={startSceneMove}
              onPointerMove={moveInScene}
              onPointerUp={endSceneMove}
              onPointerCancel={endSceneMove}
              onPointerLeave={() => { setAssetHover(null); setStackHover(null); }}
              onAuxClick={(event) => event.preventDefault()}
              onWheel={zoomWithWheel}
            >
              <div className="scene-scale" style={{ left: `calc(50% + ${viewPan.x}px)`, top: `calc(50% + ${viewPan.y}px)`, "--scene-scale": zoom, "--asset-size": `${60 / zoom}px` } as CSSProperties}>
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
                  {gridTicks.map((tick) => <span className="grid-line grid-line-x" style={{ left: `${tick * 10}%` }} key={`grid-x-${tick}`} />)}
                  {gridTicks.map((tick) => <span className="grid-line grid-line-y" style={{ top: `${tick * 10}%` }} key={`grid-y-${tick}`} />)}
                </div> : null}
                <div className="axis-bar axis-bar-x" aria-hidden="true">
                  <div className={`axis-half axis-half-x-pos ${isolatedOctant && isolatedOctant.x !== 1 ? "octant-hidden" : ""}`}><AxisFaces /></div>
                  <div className={`axis-half axis-half-x-neg ${isolatedOctant && isolatedOctant.x !== -1 ? "octant-hidden" : ""}`}><AxisFaces /></div>
                </div>
                {mode >= 2 ? <div className="axis-bar axis-bar-y" aria-hidden="true">
                  <div className={`axis-half axis-half-y-pos ${isolatedOctant && isolatedOctant.y !== 1 ? "octant-hidden" : ""}`}><AxisFaces /></div>
                  <div className={`axis-half axis-half-y-neg ${isolatedOctant && isolatedOctant.y !== -1 ? "octant-hidden" : ""}`}><AxisFaces /></div>
                </div> : null}
                {mode === 3 ? <div className="axis-bar axis-bar-z" aria-hidden="true">
                  <div className={`axis-half axis-half-z-pos ${isolatedOctant && isolatedOctant.z !== 1 ? "octant-hidden" : ""}`}><AxisFaces /></div>
                  <div className={`axis-half axis-half-z-neg ${isolatedOctant && isolatedOctant.z !== -1 ? "octant-hidden" : ""}`}><AxisFaces /></div>
                </div> : null}
                <span className="axis-origin" />
                <span className={`axis-label axis-label-x-start ${isolatedOctant && isolatedOctant.x === 1 ? "octant-hidden" : ""}`}><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[0].leftLabel}</i></span>
                <span className={`axis-label axis-label-x-end ${isolatedOctant && isolatedOctant.x === -1 ? "octant-hidden" : ""}`}><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[0].rightLabel}</i></span>
                {mode >= 2 ? <><span className={`axis-label axis-label-y-start ${isolatedOctant && isolatedOctant.y === -1 ? "octant-hidden" : ""}`}><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[1].rightLabel}</i></span><span className={`axis-label axis-label-y-end ${isolatedOctant && isolatedOctant.y === 1 ? "octant-hidden" : ""}`}><i style={{ "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`, "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg` } as CSSProperties}>{selected[1].leftLabel}</i></span></> : null}
                {mode === 3 ? <><span className={`axis-label axis-label-z-start ${isolatedOctant && isolatedOctant.z === 1 ? "octant-hidden" : ""}`}><i style={{ "--billboard-rx": `${-sceneRotateX}deg`, "--billboard-rz": `${-sceneRotateZ}deg` } as CSSProperties}>{selected[2].leftLabel}</i></span><span className={`axis-label axis-label-z-end ${isolatedOctant && isolatedOctant.z === -1 ? "octant-hidden" : ""}`}><i style={{ "--billboard-rx": `${-sceneRotateX}deg`, "--billboard-rz": `${-sceneRotateZ}deg` } as CSSProperties}>{selected[2].rightLabel}</i></span></> : null}
                {cornerLabels.map((corner) => {
                  const octantHidden = isolatedOctant && !(
                    (corner.x === 0 || corner.x === isolatedOctant.x) &&
                    (corner.y === 0 || corner.y === isolatedOctant.y) &&
                    (corner.z === 0 || corner.z === isolatedOctant.z)
                  );
                  return (
                    <span
                      className={`corner-label ${octantHidden ? "octant-hidden" : ""}`}
                      key={corner.key}
                      style={{
                        left: corner.x === 1 ? "100%" : corner.x === -1 ? "0" : "50%",
                        top: corner.y === 1 ? "0" : corner.y === -1 ? "100%" : "50%",
                        "--corner-tz": `calc(var(--scene-size) / 2 * ${corner.z})`,
                        "--corner-dx": corner.x === 0 ? "0px" : corner.x === 1 ? "-12px" : "12px",
                        "--corner-dy": corner.y === 0 ? "0px" : corner.y === 1 ? "12px" : "-12px",
                        "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
                        "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
                      } as CSSProperties}
                    >
                      <i>{corner.label}</i>
                    </span>
                  );
                })}
                {debugEnabled && showClusterDebug ? clusters.map((cluster) => {
                  const planeSize = scenePlaneRef.current?.offsetWidth ?? 0;
                  const radiusPx = clusterRadius * planeSize / 1000;
                  if (mode === 3) {
                    // 3D：三个正交圆盘构成球体，半径即当前档位聚簇半径
                    const disc: CSSProperties = {
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      background: "rgba(227, 44, 44, .2)",
                      border: "1px solid rgba(227, 44, 44, .6)",
                    };
                    return (
                      <span
                        key={`debug-${cluster.key}`}
                        style={{
                          position: "absolute",
                          left: `${cluster.x / 10}%`,
                          top: `${cluster.y / 10}%`,
                          width: radiusPx * 2,
                          height: radiusPx * 2,
                          pointerEvents: "none",
                          zIndex: 2,
                          transform: `translate(-50%, -50%) translateZ(${cluster.z * planeSize / 1000}px)`,
                          transformStyle: "preserve-3d",
                        }}
                      >
                        <i style={disc} />
                        <i style={{ ...disc, transform: "rotateY(90deg)" }} />
                        <i style={{ ...disc, transform: "rotateX(90deg)" }} />
                      </span>
                    );
                  }
                  return (
                    <span
                      key={`debug-${cluster.key}`}
                      style={{
                        position: "absolute",
                        left: `${cluster.x / 10}%`,
                        top: `${cluster.y / 10}%`,
                        width: radiusPx * 2,
                        height: radiusPx * 2,
                        borderRadius: "50%",
                        background: "rgba(227, 44, 44, .5)",
                        pointerEvents: "none",
                        zIndex: 2,
                        transform: `translate(-50%, -50%) translateZ(${cluster.z * planeSize / 1000}px)`,
                      }}
                    />
                  );
                }) : null}
                {clusters.map((cluster) => {
                  if (planeCluster?.key === cluster.key || closingCluster?.key === cluster.key) return null;
                  const planeSize = scenePlaneRef.current?.offsetWidth ?? 0;
                  const stackWorldZ = projectValuePoint(cluster.x, cluster.y, cluster.z)?.worldZ ?? cluster.meanDepth;
                  const stackPersp = 1 - stackWorldZ / SCENE_PERSPECTIVE;
                  const stackBlur = !dofEnabled || isolatedOctant ? undefined : depthBlurStyle(stackWorldZ);
                  const isDropTarget = dropTargetClusterKey === cluster.key;
                  return (
                    <button
                      type="button"
                      className={`preview-asset preview-stack ${isDropTarget ? "drop-target" : ""} ${hiddenAssetIds.includes(cluster.key) ? "hover-occluder" : ""}`}
                      key={cluster.key}
                      data-asset-id={cluster.key}
                      data-stack-key={cluster.key}
                      data-screen-depth={stackWorldZ}
                      aria-hidden={hiddenAssetIds.includes(cluster.key)}
                      style={{
                        left: `${cluster.x / 10}%`,
                        top: `${cluster.y / 10}%`,
                        "--asset-size": `${(isDropTarget ? 132 : 90) / zoom}px`,
                        "--asset-z": `${cluster.z * planeSize / 1000}px`,
                        "--asset-ratio": "1 / 1",
                        "--persp": stackPersp,
                        "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
                        "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
                      } as CSSProperties}
                      title={`${cluster.members.length} 张素材 · hover 展开查看`}
                    >
                      <span className="preview-asset-face">
                        {cluster.members.slice(0, 3).map((member) => (
                          <span className="stack-card" key={member.id}>
                            {member.thumbnailUrl ? <img src={member.thumbnailUrl} alt="" draggable={false} style={stackBlur} /> : <i style={stackBlur}>{member.name.slice(0, 1)}</i>}
                          </span>
                        ))}
                        <b className="stack-count" style={stackBlur}>{cluster.members.length}</b>
                      </span>
                    </button>
                  );
                })}
                {assets.map((asset) => {
                  if (clusterOf.has(asset.id)) return null;
                  const values = { ...asset.dimensionValues, ...overrides[asset.id] };
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
                  const blurStyle = !dofEnabled || isolatedOctant || hoveredAssetId === asset.id ? undefined : depthBlurStyle(worldZ);
                  return (
                    <button
                      type="button"
                      className={`preview-asset ${draggingAssetId === asset.id ? "dragging" : ""} ${hoveredAssetId === asset.id ? "hovered" : ""} ${hiddenAssetIds.includes(asset.id) ? "hover-occluder" : ""} ${octantHidden ? "octant-hidden" : ""}`}
                      key={asset.id}
                      data-asset-id={asset.id}
                      data-screen-depth={worldZ}
                      aria-hidden={octantHidden || hiddenAssetIds.includes(asset.id)}
                      style={{
                        left: `${x / 10}%`,
                        top: `${y / 10}%`,
                        "--asset-size": `${90 / zoom}px`,
                        "--asset-z": `${z * planeSize / 1000}px`,
                        "--asset-ratio": aspectRatioFor(asset),
                        "--persp": persp,
                        "--billboard-rx": `${mode === 3 ? -sceneRotateX : 0}deg`,
                        "--billboard-rz": `${mode === 3 ? -sceneRotateZ : 0}deg`,
                      } as CSSProperties}
                      title={mode === 3 ? `${asset.name} · 点击查看详情 · 拖动旋转视角` : `${asset.name} · 拖动修改维度`}
                    >
                      <span className="preview-asset-face">
                        {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" draggable={false} style={blurStyle} /> : <i style={blurStyle}>{asset.name.slice(0, 1)}</i>}
                        {(draggingAssetId === asset.id || hoveredAssetId === asset.id) ? <em>{selected.map((dimension) => {
                          const value = values[dimension.id] ?? 500;
                          const label = value > 500 ? dimension.rightLabel : dimension.leftLabel;
                          return `${label} ${Math.abs(displayDimensionValue(value))}`;
                        }).join(" · ")}</em> : null}
                      </span>
                    </button>
                  );
                })}
                </div>
              </div>
              {(planeCluster || closingCluster) ? (() => {
                const cluster = (planeCluster ?? closingCluster)!;
                const isClosing = !planeCluster && closingCluster !== null;
                const viewport = sceneViewportRef.current;
                const members = cluster.members;
                const count = members.length;
                const { columns, rows, width: planeWidth, height: planeHeight } = planeDimensions(count);
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
                    onPointerDown={(event) => event.stopPropagation()}
                    onPointerMove={(event) => { event.stopPropagation(); movePlaneCardDrag(event); }}
                    onPointerUp={(event) => { event.stopPropagation(); void endPlaneCardDrag(event); }}
                    onPointerCancel={(event) => { event.stopPropagation(); void endPlaneCardDrag(event); }}
                  >
                    <div className="stack-plane-surface">
                      {members.map((member, index) => {
                        const col = index % columns;
                        const row = Math.floor(index / columns);
                        const offsetX = (col - (columns - 1) / 2) * (PLANE_CARD_SIZE + PLANE_CARD_GAP);
                        const offsetY = (row - (rows - 1) / 2) * (PLANE_CARD_SIZE + PLANE_CARD_GAP);
                        return (
                          <button
                            type="button"
                            className={`stack-plane-card ${draggingPlaneAssetId === member.id ? "dragging" : ""}`}
                            key={member.id}
                            style={{
                              "--card-offset-x": `${offsetX}px`,
                              "--card-offset-y": `${offsetY}px`,
                              "--drag-dx": `${planeDragDelta.x}px`,
                              "--drag-dy": `${planeDragDelta.y}px`,
                            } as CSSProperties}
                            onPointerDown={(event) => startPlaneCardDrag(event, member)}
                            onClick={() => {
                              if (planeDragJustMoved.current) {
                                planeDragJustMoved.current = false;
                                return;
                              }
                              clearFan();
                              onSelectAsset(member.id);
                            }}
                          >
                            {member.thumbnailUrl ? <img src={member.thumbnailUrl} alt="" draggable={false} /> : <i>{member.name.slice(0, 1)}</i>}
                            <em>{selected.map((dimension) => {
                              const value = { ...member.dimensionValues, ...overrides[member.id] }[dimension.id] ?? 500;
                              const label = value > 500 ? dimension.rightLabel : dimension.leftLabel;
                              return `${label} ${Math.abs(displayDimensionValue(value))}`;
                            }).join(" · ")}</em>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })() : null}
            </div>
            {mode === 3 ? <div className="octant-isolation-controls">
              <button className={`octant-isolation-button ${isolatedOctant ? "active" : ""}`} type="button" onClick={toggleOctantIsolation}>{isolatedOctant ? "退出象限隔离" : "隔离当前象限"}</button>
              {isolatedOctantLabel ? <span className="octant-isolation-label" aria-label={`当前隔离象限：${isolatedOctantLabel}`}>{isolatedOctantLabel}</span> : nearestOctantLabel ? <span className="octant-isolation-label" aria-label={`即将隔离象限：${nearestOctantLabel}`}>{nearestOctantLabel}</span> : null}
            </div> : null}
          </div>
        ) : <div className="preview-empty"><Box size={28} /><h3>选择预览维度</h3><p>项目可以拥有任意数量的维度，每次预览最多选择 3 个。</p></div>}
      </div>
    </section>
  );
}
