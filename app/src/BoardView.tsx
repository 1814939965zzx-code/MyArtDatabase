"use client";

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { ArrowDownToLine, ArrowUpToLine, Check, ChevronDown, Circle, Eye, EyeOff, Frame, ImagePlus, LoaderCircle, Minus, MousePointer2, MoveUpRight, Pencil, Plus, Search, Square, Tag, Trash2, Type } from "lucide-react";
import { DragEvent, KeyboardEvent, MouseEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { notifyUnauthorized } from "./api";

type Asset = { id: string; name: string; thumbnailUrl: string | null; tags: string[]; width: number; height: number };
type CanvasSummary = { id: string; projectId: string; name: string; revision: number; itemCount: number };
type Point = { x: number; y: number };
type ShapeKind = "freehand" | "rect" | "ellipse" | "arrow" | "line";
type ShapePayload = { kind: ShapeKind; stroke: string; strokeWidth: number; points?: Point[] };
type TextPayload = { text: string; color: string; fontSize: number };
type ItemPayload = ShapePayload | TextPayload;
type CanvasItem = {
  id: string; canvasId: string; assetId: string | null; type: "image" | "shape" | "text";
  parentFrameId: string | null; x: number; y: number; width: number; height: number;
  zIndex: number; rotation: number; name: string | null; thumbnailUrl: string | null;
  payload: ItemPayload | null;
};
type CanvasData = { canvas: CanvasSummary; items: CanvasItem[] };
type PageFrame = { id: string; name: string; x: number; y: number; width: number; height: number };
type Tool = "pointer" | "text" | "pen" | "rect" | "ellipse" | "arrow" | "line";
type Interaction = {
  itemId: string; pointerId: number; mode: "move" | "resize";
  startX: number; startY: number; x: number; y: number; width: number; height: number;
  itemStarts: Record<string, { x: number; y: number }>;
};
type PanState = { pointerId: number; startX: number; startY: number; originX: number; originY: number };
type FrameMoveState = { pointerId: number; frameId: string; startX: number; startY: number; x: number; y: number; itemStarts: Record<string, { x: number; y: number }> };
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type FrameResizeState = { pointerId: number; frameId: string; direction: ResizeDirection; startX: number; startY: number; frame: PageFrame };
type MarqueeState = { pointerId: number; startX: number; startY: number; currentX: number; currentY: number; preservedIds: string[] };
type SnapGuides = { vertical: number[]; horizontal: number[] };
type LegacyFrameSettings = { name: string; width: number; height: number };
type DrawState = { pointerId: number; tool: Tool; start: Point; current: Point; points: Point[] };

const DEFAULT_FRAME_WIDTH = 1920;
const DEFAULT_FRAME_HEIGHT = 1080;
const MIN_FRAME_WIDTH = 1;
const MIN_FRAME_HEIGHT = 1;
const INITIAL_ZOOM = .72;
const MIN_ZOOM = .2;
const MAX_ZOOM = 4;
const FRAME_GAP = 160;
const SNAP_DISTANCE_PX = 7;
const RESIZE_DIRECTIONS: ResizeDirection[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const TOOLS: { id: Tool; icon: typeof MousePointer2; label: string; shortcut?: string }[] = [
  { id: "pointer", icon: MousePointer2, label: "选择", shortcut: "V" },
  { id: "text", icon: Type, label: "文本", shortcut: "T" },
  { id: "pen", icon: Pencil, label: "手绘" },
  { id: "rect", icon: Square, label: "矩形", shortcut: "R" },
  { id: "ellipse", icon: Circle, label: "椭圆", shortcut: "O" },
  { id: "arrow", icon: MoveUpRight, label: "箭头" },
  { id: "line", icon: Minus, label: "直线" },
];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (response.status === 401) notifyUnauthorized();
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function defaultFrame(canvasId: string): PageFrame {
  return { id: `frame-${canvasId}-1`, name: "Frame 1", x: 0, y: 0, width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT };
}

/** 按素材原图宽高比计算插入尺寸；缺失尺寸时退回 3:4。 */
function aspectSize(asset: Asset, targetWidth: number) {
  const w = asset.width || 0; const h = asset.height || 0;
  if (w > 0 && h > 0) return { width: targetWidth, height: Math.max(2, Math.round(targetWidth * h / w)) };
  return { width: targetWidth, height: Math.round(targetWidth * 3 / 4) };
}

export function BoardView({ projectId, assets, onMessage, onSelectAsset }: { projectId: string; assets: Asset[]; onMessage: (message: string) => void; onSelectAsset: (assetId: string) => void }) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [canvasId, setCanvasId] = useState("");
  const [canvas, setCanvas] = useState<CanvasSummary | null>(null);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [framesByCanvas, setFramesByCanvas] = useState<Record<string, PageFrame[]>>({});
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>({ vertical: [], horizontal: [] });
  const [view, setView] = useState({ zoom: INITIAL_ZOOM, x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [assetTrayOpen, setAssetTrayOpen] = useState(true);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
  const [frameNameDraft, setFrameNameDraft] = useState("");
  const [frameMenu, setFrameMenu] = useState<{ frameId: string; x: number; y: number } | null>(null);
  const [itemMenu, setItemMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const [confirmFrameDeleteId, setConfirmFrameDeleteId] = useState<string | null>(null);
  // ---- 标记元素（与图片混排，仅有一键隐藏开关） ----
  const [markupHidden, setMarkupHidden] = useState(false);
  const [tool, setTool] = useState<Tool>("pointer");
  const [strokeColor, setStrokeColor] = useState("#292d29");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(18);
  const [drawPreview, setDrawPreview] = useState<{ kind: ShapeKind; start: Point; current: Point; points: Point[]; stroke: string; strokeWidth: number } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  // ---- 托盘搜索 / 标签 ----
  const [searchInput, setSearchInput] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [dragHint, setDragHint] = useState<{ x: number; y: number; text: string } | null>(null);
  // ---- 持久化 refs ----
  const interaction = useRef<Interaction | null>(null);
  const panRef = useRef<PanState | null>(null);
  const frameMoveRef = useRef<FrameMoveState | null>(null);
  const frameResizeRef = useRef<FrameResizeState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  const creatingDefaultPage = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const frameStorageKey = `artdatabase:frames:v2:${projectId}`;
  const legacyFrameStorageKey = `artdatabase:frame-settings:v1:${projectId}`;
  const itemFrameStorageKey = `artdatabase:frame-items:v2:${projectId}`;
  const migratedKey = `artdatabase:board-abs-coords:${projectId}`;
  const frames = canvasId ? framesByCanvas[canvasId] ?? [] : [];

  const imageItems = items.filter((item) => item.type === "image");
  const annotationItems = items.filter((item) => item.type !== "image");
  const drawingTool = tool !== "pointer" && tool !== "text";

  function selectItems(ids: string[], primaryId: string | null = ids.at(-1) ?? null) {
    const unique = [...new Set(ids)];
    setSelectedItemIds(unique);
    setSelectedItemId(primaryId && unique.includes(primaryId) ? primaryId : unique.at(-1) ?? null);
  }

  function nearestSnap(moving: number[], targets: number[], threshold: number) {
    let best: { delta: number; guide: number } | null = null;
    for (const source of moving) for (const target of targets) {
      const delta = target - source;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guide: target };
    }
    return best;
  }

  function persistFrames(next: Record<string, PageFrame[]>) {
    setFramesByCanvas(next);
    try { window.localStorage.setItem(frameStorageKey, JSON.stringify(next)); } catch { /* Local preferences are optional. */ }
  }

  function updateFrame(frameId: string, changes: Partial<PageFrame>) {
    if (!canvasId) return;
    persistFrames({ ...framesByCanvas, [canvasId]: frames.map((entry) => entry.id === frameId ? { ...entry, ...changes } : entry) });
  }

  function toCanvas(clientX: number, clientY: number): Point {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: (clientX - (rect?.left ?? 0) - view.x) / view.zoom, y: (clientY - (rect?.top ?? 0) - view.y) / view.zoom };
  }

  async function loadCanvases(preferredId?: string) {
    const data = await json<{ canvases: CanvasSummary[] }>(`/api/canvases?projectId=${encodeURIComponent(projectId)}`);
    if (!data.canvases.length && !creatingDefaultPage.current) {
      creatingDefaultPage.current = true;
      try {
        const created = await json<{ canvas: CanvasSummary }>("/api/canvases", { method: "POST", body: JSON.stringify({ projectId, name: "Page 1" }) });
        setCanvases([created.canvas]);
        setCanvasId(created.canvas.id);
        return;
      } finally { creatingDefaultPage.current = false; }
    }
    setCanvases(data.canvases);
    setCanvasId((current) => {
      const candidate = preferredId || current;
      return data.canvases.some((entry) => entry.id === candidate) ? candidate : data.canvases[0]?.id || "";
    });
  }

  async function loadCanvas(id: string, onlyIfNewer = false) {
    if (!id) { setCanvas(null); setItems([]); setLoading(false); return; }
    const data = await json<CanvasData>(`/api/canvas?canvasId=${encodeURIComponent(id)}`);
    if (!onlyIfNewer || !canvas || data.canvas.revision > canvas.revision) { setCanvas(data.canvas); setItems(data.items); }
    setLoading(false);
  }

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(frameStorageKey);
      if (stored) setFramesByCanvas(JSON.parse(stored) as Record<string, PageFrame[]>);
      else {
        const legacy = window.localStorage.getItem(legacyFrameStorageKey);
        if (legacy) {
          const legacySettings = JSON.parse(legacy) as Record<string, LegacyFrameSettings>;
          const migrated = Object.fromEntries(Object.entries(legacySettings).map(([id, settings]) => [id, [{ ...defaultFrame(id), ...settings }]]));
          setFramesByCanvas(migrated);
          window.localStorage.setItem(frameStorageKey, JSON.stringify(migrated));
        } else setFramesByCanvas({});
      }
    } catch { setFramesByCanvas({}); }
  }, [frameStorageKey, legacyFrameStorageKey]);

  // 旧数据一次性迁移：把旧的“相对 Frame”坐标换算为自由画布绝对坐标，并标记 parentFrameId。
  // 另：始终按“真实几何与 Frame 相交”归一化元素的归属（跟随 Frame 位移/删除）。
  useEffect(() => {
    if (!canvasId || !items.length || !frames.length) return;
    const frameIndex = Object.fromEntries(frames.map((frame) => [frame.id, frame]));
    const changedIds = new Set<string>();
    let next = items;
    let migrated = false;
    try { migrated = Boolean(window.localStorage.getItem(migratedKey)); } catch { migrated = false; }
    if (!migrated) {
      let itemFrameMap: Record<string, string> = {};
      try { itemFrameMap = JSON.parse(window.localStorage.getItem(itemFrameStorageKey) ?? "{}") as Record<string, string>; } catch { itemFrameMap = {}; }
      next = items.map((item) => {
        const frameId = itemFrameMap[item.id];
        const frame = frameId ? frameIndex[frameId] : undefined;
        if (item.type !== "image" || !frame) return item;
        changedIds.add(item.id);
        return { ...item, x: frame.x + item.x, y: frame.y + item.y, parentFrameId: frame.id };
      });
      try { window.localStorage.setItem(migratedKey, "1"); } catch { /* ignore */ }
    }
    let normalized = next;
    const normalizedNext = next.map((item) => {
      const frameId = itemFrameId(item);
      if (item.parentFrameId !== frameId) { changedIds.add(item.id); return { ...item, parentFrameId: frameId }; }
      return item;
    });
    if (normalizedNext !== next) normalized = normalizedNext;
    if (!changedIds.size) return;
    setItems(normalized);
    void (async () => {
      try {
        let revision = canvas?.revision ?? 0;
        const pending = normalized.filter((item) => changedIds.has(item.id));
        for (const item of pending) {
          const data = await json<{ revision: number }>("/api/canvas-items", { method: "PATCH", body: JSON.stringify(item) });
          revision = data.revision;
        }
        setCanvas((current) => current ? { ...current, revision } : current);
      } catch { /* 归一化失败可忽略，下次加载仍会重试 */ }
    })();
  }, [canvasId, items.length, frames.length]);

  useEffect(() => { void loadCanvases().catch((error) => { onMessage(error instanceof Error ? error.message : "Page 载入失败"); setLoading(false); }); }, [projectId]);

  useEffect(() => {
    setSelectedFrameId(null); selectItems([]); setMarkupHidden(false); setEditingTextId(null); setDrawPreview(null);
    void loadCanvas(canvasId).catch((error) => onMessage(error instanceof Error ? error.message : "Page 载入失败"));
  }, [canvasId]);

  useEffect(() => {
    if (!canvasId) return;
    const timer = window.setInterval(() => {
      if (!interaction.current && !panRef.current && !frameMoveRef.current && !frameResizeRef.current && !drawRef.current) void loadCanvas(canvasId, true).catch(() => undefined);
    }, 900);
    return () => window.clearInterval(timer);
  }, [canvasId, canvas?.revision]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const refs = frames.length ? frames : (items.length ? [{ x: Math.min(...items.map((i) => i.x)), y: Math.min(...items.map((i) => i.y)), width: Math.max(...items.map((i) => i.x + i.width)) - Math.min(...items.map((i) => i.x)), height: Math.max(...items.map((i) => i.y + i.height)) - Math.min(...items.map((i) => i.y)) }] : []);
    if (!refs.length) return;
    const left = Math.min(...refs.map((frame) => frame.x));
    const top = Math.min(...refs.map((frame) => frame.y));
    const right = Math.max(...refs.map((frame) => frame.x + frame.width));
    const bottom = Math.max(...refs.map((frame) => frame.y + frame.height));
    const fittedZoom = Math.max(MIN_ZOOM, Math.min(INITIAL_ZOOM, (element.clientWidth - 120) / Math.max(1, right - left), (element.clientHeight - 120) / Math.max(1, bottom - top)));
    setView({ zoom: fittedZoom, x: (element.clientWidth - (right - left) * fittedZoom) / 2 - left * fittedZoom, y: (element.clientHeight - (bottom - top) * fittedZoom) / 2 - top * fittedZoom });
  }, [canvas?.id]);

  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
    const toolByKey: Record<string, Tool> = { v: "pointer", t: "text", r: "rect", o: "ellipse" };
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space" && !editable(event.target)) { event.preventDefault(); setSpaceHeld(true); }
      if (event.key === "Escape") { setFrameMenu(null); setItemMenu(null); if (drawRef.current) drawRef.current = null; setDrawPreview(null); setTool("pointer"); }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (editable(event.target)) return;
        if (selectedItemIds.length) { event.preventDefault(); void deleteCanvasItems(selectedItemIds); }
      }
      if (!editable(event.target)) {
        const tool = toolByKey[event.key.toLowerCase()];
        if (tool) { setTool(tool); if (tool !== "pointer") setMarkupHidden(false); }
      }
    };
    const up = (event: globalThis.KeyboardEvent) => { if (event.code === "Space") setSpaceHeld(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [selectedItemIds]);

  useEffect(() => {
    if (!frameMenu && !itemMenu) return;
    const close = () => { setFrameMenu(null); setItemMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, [frameMenu, itemMenu]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left; const cursorY = event.clientY - rect.top;
      const factor = Math.exp(-(event.deltaY || event.deltaX) * .0015);
      setView((current) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom * factor));
        const ratio = nextZoom / current.zoom;
        return { zoom: nextZoom, x: cursorX - (cursorX - current.x) * ratio, y: cursorY - (cursorY - current.y) * ratio };
      });
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [canvas?.id]);

  async function createCanvas() {
    const name = `Page ${canvases.length + 1}`;
    try {
      const data = await json<{ canvas: CanvasSummary }>("/api/canvases", { method: "POST", body: JSON.stringify({ projectId, name }) });
      await loadCanvases(data.canvas.id);
      onMessage("Page 已创建，双击名称可以修改");
    } catch (error) { onMessage(error instanceof Error ? error.message : "创建失败"); }
  }

  function createFrame() {
    if (!canvasId) return;
    const right = Math.max(0, ...frames.map((entry) => entry.x + entry.width));
    const frame: PageFrame = { id: `frame-${canvasId}-${Date.now()}`, name: `Frame ${frames.length + 1}`, x: right + (frames.length ? FRAME_GAP : 0), y: 0, width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT };
    persistFrames({ ...framesByCanvas, [canvasId]: [...frames, frame] });
    selectItems([]); setSelectedFrameId(frame.id);
    const element = viewportRef.current;
    if (element) {
      const zoom = Math.max(MIN_ZOOM, Math.min(INITIAL_ZOOM, (element.clientWidth - 120) / frame.width, (element.clientHeight - 120) / frame.height));
      setView({ zoom, x: (element.clientWidth - frame.width * zoom) / 2 - frame.x * zoom, y: (element.clientHeight - frame.height * zoom) / 2 - frame.y * zoom });
    }
    onMessage(`${frame.name} 已创建，把素材拖进去即可归属该 Frame`);
  }

  async function renameCanvas(id: string, currentName: string, nextName: string) {
    const name = nextName.trim(); setEditingPageId(null);
    if (!name || name === currentName) return;
    try {
      await json("/api/canvases", { method: "PATCH", body: JSON.stringify({ id, name }) });
      await Promise.all([loadCanvases(id), loadCanvas(id)]); onMessage("Page 名称已保存");
    } catch (error) { onMessage(error instanceof Error ? error.message : "保存失败"); }
  }

  async function deleteCanvas() {
    if (!canvas || !window.confirm(`删除 Page“${canvas.name}”？其中的画板布局也会删除。`)) return;
    try {
      await json(`/api/canvases?id=${encodeURIComponent(canvas.id)}`, { method: "DELETE" });
      setCanvas(null); setItems([]); setCanvasId(""); setSelectedFrameId(null);
      await loadCanvases(); onMessage("Page 已删除");
    } catch (error) { onMessage(error instanceof Error ? error.message : "删除失败"); }
  }

  function startPageRename(entry: CanvasSummary) { setEditingPageId(entry.id); setPageNameDraft(entry.name); }
  function handlePageNameKeyDown(event: KeyboardEvent<HTMLInputElement>, entry: CanvasSummary) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { setEditingPageId(null); setPageNameDraft(entry.name); }
  }
  function startFrameNameEdit(frame: PageFrame) { setFrameNameDraft(frame.name); setEditingFrameId(frame.id); }
  function finishFrameNameEdit(frame: PageFrame) {
    const name = frameNameDraft.trim();
    if (name && name !== frame.name) updateFrame(frame.id, { name });
    setEditingFrameId(null);
  }

  function handleFontSizeChange(value: number) {
    const v = Math.max(8, Math.min(120, Math.round(value) || 8));
    setFontSize(v);
    if (!selectedItemId) return;
    const item = items.find((entry) => entry.id === selectedItemId);
    if (item?.type === "text" && item.payload && "fontSize" in item.payload) {
      void updateSelected({ payload: { ...item.payload, fontSize: v } });
    }
  }

  // 选中文本元素时，工具条字号输入跟随其当前字号。
  useEffect(() => {
    const item = items.find((entry) => entry.id === selectedItemId);
    if (item?.type === "text" && item.payload && "fontSize" in item.payload) setFontSize(item.payload.fontSize);
  }, [selectedItemId]);

  function isPanGesture(event: PointerEvent<Element>) {
    return event.button === 1 || (event.button === 0 && spaceHeld);
  }

  // ---- 视图平移与框选 ----
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button === 0 && !spaceHeld) {
      const rect = event.currentTarget.getBoundingClientRect();
      const next = { pointerId: event.pointerId, startX: event.clientX - rect.left, startY: event.clientY - rect.top, currentX: event.clientX - rect.left, currentY: event.clientY - rect.top, preservedIds: event.shiftKey ? selectedItemIds : [] };
      marqueeRef.current = next; setMarquee(next); setSelectedFrameId(null);
      if (!event.shiftKey) selectItems([]);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 1 && !(event.button === 0 && spaceHeld)) return;
    event.preventDefault();
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
    event.currentTarget.setPointerCapture(event.pointerId); setPanning(true);
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const selection = marqueeRef.current;
    if (selection?.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const currentX = event.clientX - rect.left; const currentY = event.clientY - rect.top;
      const next = { ...selection, currentX, currentY }; marqueeRef.current = next; setMarquee(next);
      const left = (Math.min(next.startX, currentX) - view.x) / view.zoom;
      const right = (Math.max(next.startX, currentX) - view.x) / view.zoom;
      const top = (Math.min(next.startY, currentY) - view.y) / view.zoom;
      const bottom = (Math.max(next.startY, currentY) - view.y) / view.zoom;
      const selectable = markupHidden ? imageItems : items;
      const hitIds = selectable.filter((item) => item.x + item.width >= left && item.x <= right && item.y + item.height >= top && item.y <= bottom).map((item) => item.id);
      selectItems([...next.preservedIds, ...hitIds]);
      return;
    }
    const active = panRef.current; if (!active || active.pointerId !== event.pointerId) return;
    setView((current) => ({ ...current, x: active.originX + event.clientX - active.startX, y: active.originY + event.clientY - active.startY }));
  }
  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (marqueeRef.current?.pointerId === event.pointerId) { marqueeRef.current = null; setMarquee(null); }
    if (panRef.current?.pointerId === event.pointerId) { panRef.current = null; setPanning(false); }
  }

  // ---- Frame 移动 / 缩放 ----
  /** 按“拖动起点坐标 + 绝对位移”移动元素，避免在当前位置上重复叠加位移导致漂移。 */
  function shiftFrameItems(itemStarts: Record<string, { x: number; y: number }>, deltaX: number, deltaY: number) {
    const ids = Object.keys(itemStarts);
    if (!ids.length) return;
    const startOf = (id: string) => itemStarts[id];
    setItems((current) => current.map((item) => {
      const start = startOf(item.id);
      if (!start) return item;
      return { ...item, x: start.x + deltaX, y: start.y + deltaY };
    }));
  }
  async function persistFrameItems(frameId: string, itemStarts: Record<string, { x: number; y: number }>) {
    if (!canvas) return;
    const ids = Object.keys(itemStarts);
    if (!ids.length) return;
    const set = new Set(ids);
    const frameItems = items.filter((item) => set.has(item.id));
    const toPersist = frameItems.map((item) => item.parentFrameId === frameId ? item : { ...item, parentFrameId: frameId });
    setItems((current) => current.map((item) => set.has(item.id) && item.parentFrameId !== frameId ? { ...item, parentFrameId: frameId } : item));
    try {
      let revision = canvas.revision;
      for (const item of toPersist) {
        const data = await json<{ revision: number }>("/api/canvas-items", { method: "PATCH", body: JSON.stringify(item) });
        revision = data.revision;
      }
      setCanvas((current) => current ? { ...current, revision } : current);
    } catch (error) { onMessage(error instanceof Error ? error.message : "布局保存失败"); }
  }

  function startFrameMove(event: PointerEvent<HTMLElement>, frame: PageFrame) {
    if (isPanGesture(event)) return;
    event.stopPropagation(); selectItems([]);
    if (selectedFrameId !== frame.id) { setSelectedFrameId(frame.id); return; }
    if (event.button !== 0 || spaceHeld || editingFrameId === frame.id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // 拖动开始即锁定跟随集合与各自的起点：与 Frame 有交集或已归属该 Frame 的元素一起平移。
    const itemStarts = Object.fromEntries(items.filter((item) => item.parentFrameId === frame.id || itemFrameId(item) === frame.id).map((item) => [item.id, { x: item.x, y: item.y }]));
    frameMoveRef.current = { pointerId: event.pointerId, frameId: frame.id, startX: event.clientX, startY: event.clientY, x: frame.x, y: frame.y, itemStarts };
  }
  function moveFrame(event: PointerEvent<HTMLElement>) {
    const active = frameMoveRef.current; if (!active || active.pointerId !== event.pointerId) return;
    const frame = frames.find((entry) => entry.id === active.frameId); if (!frame) return;
    let x = active.x + (event.clientX - active.startX) / view.zoom; let y = active.y + (event.clientY - active.startY) / view.zoom;
    const targets = frames.filter((entry) => entry.id !== active.frameId);
    const threshold = SNAP_DISTANCE_PX / view.zoom;
    const snapX = event.altKey ? null : nearestSnap([x, x + frame.width / 2, x + frame.width], targets.flatMap((entry) => [entry.x, entry.x + entry.width / 2, entry.x + entry.width]), threshold);
    const snapY = event.altKey ? null : nearestSnap([y, y + frame.height / 2, y + frame.height], targets.flatMap((entry) => [entry.y, entry.y + entry.height / 2, entry.y + entry.height]), threshold);
    if (snapX) x += snapX.delta; if (snapY) y += snapY.delta;
    setSnapGuides({ vertical: snapX ? [snapX.guide] : [], horizontal: snapY ? [snapY.guide] : [] });
    updateFrame(active.frameId, { x, y });
    if (x !== active.x || y !== active.y) shiftFrameItems(active.itemStarts, x - active.x, y - active.y);
  }
  function endFrameMove(event: PointerEvent<HTMLElement>) {
    if (frameMoveRef.current?.pointerId === event.pointerId) {
      const { frameId, itemStarts } = frameMoveRef.current;
      frameMoveRef.current = null; setSnapGuides({ vertical: [], horizontal: [] });
      void persistFrameItems(frameId, itemStarts);
    }
  }

  function frameContentBounds() {
    // Frame 无最小大小限制（可缩到 1×1），也不随内容撑大；图片可溢出显示。
    return { width: MIN_FRAME_WIDTH, height: MIN_FRAME_HEIGHT };
  }
  function startFrameResize(event: PointerEvent<HTMLButtonElement>, frame: PageFrame, direction: ResizeDirection) {
    if (isPanGesture(event)) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    selectItems([]); setSelectedFrameId(frame.id);
    frameResizeRef.current = { pointerId: event.pointerId, frameId: frame.id, direction, startX: event.clientX, startY: event.clientY, frame };
  }
  function moveFrameResize(event: PointerEvent<HTMLButtonElement>) {
    const active = frameResizeRef.current; if (!active || active.pointerId !== event.pointerId) return;
    const dx = (event.clientX - active.startX) / view.zoom; const dy = (event.clientY - active.startY) / view.zoom;
    const bounds = frameContentBounds(); let { x, y, width, height } = active.frame;
    if (active.direction.includes("e")) width = Math.max(bounds.width, Math.round(active.frame.width + dx));
    if (active.direction.includes("s")) height = Math.max(bounds.height, Math.round(active.frame.height + dy));
    if (active.direction.includes("w")) { width = Math.max(bounds.width, Math.round(active.frame.width - dx)); x = active.frame.x + active.frame.width - width; }
    if (active.direction.includes("n")) { height = Math.max(bounds.height, Math.round(active.frame.height - dy)); y = active.frame.y + active.frame.height - height; }
    updateFrame(active.frameId, { x, y, width, height });
  }
  function endFrameResize(event: PointerEvent<HTMLButtonElement>) { if (frameResizeRef.current?.pointerId === event.pointerId) { frameResizeRef.current = null; } }

  function openFrameMenu(event: MouseEvent<HTMLDivElement>, frame: PageFrame) {
    event.preventDefault(); event.stopPropagation();
    selectItems([]); setSelectedFrameId(frame.id);
    setItemMenu(null);
    setFrameMenu({ frameId: frame.id, x: event.clientX, y: event.clientY });
  }

  function openItemMenu(event: MouseEvent<HTMLElement>, item: CanvasItem) {
    event.preventDefault(); event.stopPropagation();
    setSelectedFrameId(null);
    if (!selectedItemIds.includes(item.id)) selectItems([item.id], item.id);
    setFrameMenu(null);
    setItemMenu({ itemId: item.id, x: event.clientX, y: event.clientY });
  }

  function requestFrameDeletion(frameId: string) {
    const hasItems = items.some((item) => item.parentFrameId === frameId);
    setFrameMenu(null);
    if (hasItems) setConfirmFrameDeleteId(frameId);
    else void deleteFrame(frameId);
  }

  async function deleteFrame(frameId: string) {
    if (!canvasId || !canvas) return;
    const frame = frames.find((entry) => entry.id === frameId);
    if (!frame) return;
    const frameItems = items.filter((item) => item.parentFrameId === frameId);
    try {
      let latestRevision = canvas.revision;
      for (const item of frameItems) {
        const data = await json<{ revision: number }>(`/api/canvas-items?id=${encodeURIComponent(item.id)}&canvasId=${encodeURIComponent(canvas.id)}`, { method: "DELETE" });
        latestRevision = data.revision;
      }
      const removedIds = new Set(frameItems.map((item) => item.id));
      persistFrames({ ...framesByCanvas, [canvasId]: frames.filter((entry) => entry.id !== frameId) });
      setItems((current) => current.filter((item) => !removedIds.has(item.id)));
      setCanvas((current) => current ? { ...current, revision: latestRevision } : current);
      setSelectedFrameId(null); selectItems([]); setFrameMenu(null); setConfirmFrameDeleteId(null);
      if (frameItems.length) await loadCanvases(canvasId);
      onMessage(frameItems.length ? `Frame 已删除，${frameItems.length} 个素材仍保留在项目素材中` : "空 Frame 已删除");
    } catch (error) {
      setFrameMenu(null); setConfirmFrameDeleteId(null);
      onMessage(error instanceof Error ? error.message : "删除 Frame 失败");
      await loadCanvas(canvas.id);
    }
  }

  // ---- 图片元素移动 / 缩放 ----
  function startInteraction(event: PointerEvent<HTMLElement>, item: CanvasItem, mode: "move" | "resize") {
    if (isPanGesture(event)) return;
    event.stopPropagation();
    if (event.button !== 0) return;
    let movingIds: string[];
    if (mode === "resize") {
      movingIds = [item.id]; selectItems(movingIds, item.id);
    } else if (event.shiftKey) {
      if (selectedItemIds.includes(item.id)) { selectItems(selectedItemIds.filter((id) => id !== item.id)); return; }
      movingIds = [...selectedItemIds, item.id]; selectItems(movingIds, item.id);
    } else if (selectedItemIds.includes(item.id)) movingIds = selectedItemIds;
    else { movingIds = [item.id]; selectItems(movingIds, item.id); }
    event.currentTarget.setPointerCapture(event.pointerId);
    const topZ = Math.max(0, ...imageItems.map((entry) => entry.zIndex));
    interaction.current = { itemId: item.id, pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, width: item.width, height: item.height, itemStarts: Object.fromEntries(imageItems.filter((entry) => movingIds.includes(entry.id)).map((entry) => [entry.id, { x: entry.x, y: entry.y }])) };
    setSelectedFrameId(null);
    if (item.zIndex < topZ) setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, zIndex: topZ + 1 } : entry));
  }
  function moveInteraction(event: PointerEvent<HTMLElement>) {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    let dx = (event.clientX - active.startX) / view.zoom; let dy = (event.clientY - active.startY) / view.zoom;
    const movingIds = Object.keys(active.itemStarts);
    if (active.mode === "move" && movingIds.length) {
      const movingItems = imageItems.filter((item) => movingIds.includes(item.id));
      const startBounds = movingItems.map((item) => {
        const start = active.itemStarts[item.id];
        return { left: start.x, top: start.y, right: start.x + item.width, bottom: start.y + item.height };
      });
      const left = Math.min(...startBounds.map((entry) => entry.left)) + dx; const right = Math.max(...startBounds.map((entry) => entry.right)) + dx;
      const top = Math.min(...startBounds.map((entry) => entry.top)) + dy; const bottom = Math.max(...startBounds.map((entry) => entry.bottom)) + dy;
      const otherBounds = imageItems.filter((item) => !movingIds.includes(item.id)).map((item) => ({ left: item.x, top: item.y, right: item.x + item.width, bottom: item.y + item.height }));
      const xTargets = [...frames.flatMap((entry) => [entry.x, entry.x + entry.width / 2, entry.x + entry.width]), ...otherBounds.flatMap((entry) => [entry.left, (entry.left + entry.right) / 2, entry.right])];
      const yTargets = [...frames.flatMap((entry) => [entry.y, entry.y + entry.height / 2, entry.y + entry.height]), ...otherBounds.flatMap((entry) => [entry.top, (entry.top + entry.bottom) / 2, entry.bottom])];
      const threshold = SNAP_DISTANCE_PX / view.zoom;
      const snapX = event.altKey ? null : nearestSnap([left, (left + right) / 2, right], xTargets, threshold);
      const snapY = event.altKey ? null : nearestSnap([top, (top + bottom) / 2, bottom], yTargets, threshold);
      if (snapX) dx += snapX.delta; if (snapY) dy += snapY.delta;
      setSnapGuides({ vertical: snapX ? [snapX.guide] : [], horizontal: snapY ? [snapY.guide] : [] });
    }
    setItems((current) => current.map((item) => {
      if (active.mode === "move") {
        const start = active.itemStarts[item.id]; if (!start) return item;
        return { ...item, x: start.x + dx, y: start.y + dy };
      }
      if (item.id !== active.itemId) return item;
      return { ...item, width: Math.max(2, Math.round(active.width + dx)), height: Math.max(2, Math.round(active.height + dy)) };
    }));
  }
  async function endInteraction(event: PointerEvent<HTMLElement>) {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    interaction.current = null; setSnapGuides({ vertical: [], horizontal: [] });
    const changedItems = imageItems.filter((entry) => active.mode === "move" ? Boolean(active.itemStarts[entry.id]) : entry.id === active.itemId);
    if (!changedItems.length || !canvas) return;
    // 移动结束后按“与 Frame 是否有交集”重新归属：有交集则跟随该 Frame，否则回到自由画布。
    let updatedItems = changedItems;
    if (active.mode === "move") {
      updatedItems = changedItems.map((item) => {
        const frameId = itemFrameId(item);
        return item.parentFrameId === frameId ? item : { ...item, parentFrameId: frameId };
      });
      if (updatedItems.some((item, index) => item.parentFrameId !== changedItems[index].parentFrameId)) {
        setItems((current) => current.map((entry) => updatedItems.find((u) => u.id === entry.id) ?? entry));
      }
    }
    try {
      let revision = canvas.revision;
      for (const item of updatedItems) {
        const data = await json<{ revision: number }>("/api/canvas-items", { method: "PATCH", body: JSON.stringify(item) });
        revision = data.revision;
      }
      setCanvas((current) => current ? { ...current, revision } : current);
    } catch (error) { onMessage(error instanceof Error ? error.message : "布局保存失败"); await loadCanvas(canvas.id); }
  }

  async function updateSelected(changes: Partial<CanvasItem>) {
    if (!selectedItemId || !canvas) return;
    const item = items.find((entry) => entry.id === selectedItemId); if (!item) return;
    const updated = { ...item, ...changes }; setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
    try {
      const data = await json<{ revision: number }>("/api/canvas-items", { method: "PATCH", body: JSON.stringify(updated) });
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
    } catch (error) { onMessage(error instanceof Error ? error.message : "保存失败"); }
  }
  async function deleteCanvasItems(itemIds: string[]) {
    if (!canvas) return;
    const uniqueIds = [...new Set(itemIds)];
    try {
      let revision = canvas.revision;
      for (const itemId of uniqueIds) {
        const data = await json<{ revision: number }>(`/api/canvas-items?id=${encodeURIComponent(itemId)}&canvasId=${encodeURIComponent(canvas.id)}`, { method: "DELETE" });
        revision = data.revision;
      }
      const removedIds = new Set(uniqueIds);
      setItems((current) => current.filter((item) => !removedIds.has(item.id)));
      selectItems(selectedItemIds.filter((id) => !removedIds.has(id))); setItemMenu(null); setCanvas((current) => current ? { ...current, revision } : current);
      onMessage(uniqueIds.some((id) => annotationItems.some((item) => item.id === id)) ? `已删除 ${uniqueIds.length} 个元素` : `已从画板删除 ${uniqueIds.length} 张图片，素材原文件仍保留在项目素材中`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "删除失败"); }
  }

  async function deleteCanvasItem(itemId: string) { await deleteCanvasItems([itemId]); }
  async function deleteSelected() { if (selectedItemIds.length) await deleteCanvasItems(selectedItemIds); }

  // ---- 标记元素：绘制 / 文本 ----
  function beginDraw(event: PointerEvent<HTMLDivElement>) {
    if (tool === "text") {
      const point = toCanvas(event.clientX, event.clientY);
      void createTextItem(point);
      return;
    }
    if (!drawingTool) return;
    event.preventDefault();
    const point = toCanvas(event.clientX, event.clientY);
    const kind = tool === "pen" ? "freehand" : tool;
    drawRef.current = { pointerId: event.pointerId, tool, start: point, current: point, points: tool === "pen" ? [point] : [] };
    setDrawPreview({ kind: kind as ShapeKind, start: point, current: point, points: tool === "pen" ? [point] : [], stroke: strokeColor, strokeWidth });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDraw(event: PointerEvent<HTMLDivElement>) {
    const active = drawRef.current; if (!active || active.pointerId !== event.pointerId) return;
    const point = toCanvas(event.clientX, event.clientY);
    const points = active.tool === "pen" ? [...active.points, point] : active.points;
    drawRef.current = { ...active, current: point, points };
    const kind = active.tool === "pen" ? "freehand" : active.tool;
    setDrawPreview({ kind: kind as ShapeKind, start: active.start, current: point, points, stroke: strokeColor, strokeWidth });
  }
  function endDraw(event: PointerEvent<HTMLDivElement>) {
    const active = drawRef.current; if (!active || active.pointerId !== event.pointerId) return;
    drawRef.current = null; setDrawPreview(null);
    void finalizeDraw(active);
  }

  function bboxOf(points: Point[]) {
    const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  async function finalizeDraw(active: DrawState) {
    if (!canvas) return;
    const start = active.start; const current = active.current;
    const left = Math.min(start.x, current.x); const top = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x); const height = Math.abs(current.y - start.y);
    let points: Point[] | undefined;
    let frameId: string | null = null;
    if (active.tool === "pen") {
      const box = bboxOf(active.points);
      points = active.points.map((p) => ({ x: p.x - box.left, y: p.y - box.top }));
      const penW = Math.max(0.1, box.right - box.left); const penH = Math.max(0.1, box.bottom - box.top);
      frameId = itemFrameId({ x: box.left, y: box.top, width: penW, height: penH, type: "shape", payload: { kind: "freehand", stroke: strokeColor, strokeWidth, points } });
      try {
        const data = await json<{ item: CanvasItem; revision: number }>("/api/canvas-items", { method: "POST", body: JSON.stringify({ canvasId: canvas.id, type: "shape", parentFrameId: frameId, x: box.left, y: box.top, width: penW, height: penH, zIndex: items.length + 1, rotation: 0, payload: { kind: "freehand", stroke: strokeColor, strokeWidth, points } }) });
        addAnnotatedItem(data.item, data.revision);
      } catch (error) { onMessage(error instanceof Error ? error.message : "绘制失败"); }
      return;
    }
    if (active.tool === "arrow" || active.tool === "line") {
      points = [{ x: start.x - left, y: start.y - top }, { x: current.x - left, y: current.y - top }];
    }
    frameId = itemFrameId({ x: left, y: top, width: Math.max(0.1, width), height: Math.max(0.1, height), type: "shape", payload: { kind: active.tool as ShapeKind, stroke: strokeColor, strokeWidth, points } });
    try {
      const data = await json<{ item: CanvasItem; revision: number }>("/api/canvas-items", { method: "POST", body: JSON.stringify({ canvasId: canvas.id, type: "shape", parentFrameId: frameId, x: left, y: top, width: Math.max(0.1, width), height: Math.max(0.1, height), zIndex: items.length + 1, rotation: 0, payload: { kind: active.tool as ShapeKind, stroke: strokeColor, strokeWidth, points } }) });
      addAnnotatedItem(data.item, data.revision);
    } catch (error) { onMessage(error instanceof Error ? error.message : "绘制失败"); }
  }

  function addAnnotatedItem(item: CanvasItem, revision: number) {
    setItems((current) => [...current, item]);
    setCanvas((current) => current ? { ...current, revision } : current);
    selectItems([item.id], item.id);
  }

  async function createTextItem(point: Point) {
    if (!canvas) return;
    const width = 180; const height = 40;
    const frameId = itemFrameId({ x: point.x, y: point.y, width, height, type: "text", payload: { text: "", color: strokeColor, fontSize: 18 } });
    try {
      const data = await json<{ item: CanvasItem; revision: number }>("/api/canvas-items", { method: "POST", body: JSON.stringify({ canvasId: canvas.id, type: "text", parentFrameId: frameId, x: point.x, y: point.y, width, height, zIndex: items.length + 1, rotation: 0, payload: { text: "", color: strokeColor, fontSize } }) });
      const created = { ...data.item, type: "text" as const };
      setItems((current) => [...current, created]);
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
      setEditingTextId(created.id);
      selectItems([created.id], created.id);
    } catch (error) { onMessage(error instanceof Error ? error.message : "创建文本失败"); }
  }

  function commitText(item: CanvasItem, raw: string) {
    setEditingTextId(null);
    const text = raw.trim();
    if (!text) { void deleteCanvasItems([item.id]); return; }
    const payload = { text, color: item.payload && "color" in item.payload ? item.payload.color : strokeColor, fontSize: item.payload && "fontSize" in item.payload ? item.payload.fontSize : 18 };
    void updateSelected({ payload });
  }

  // ---- 标记元素移动 / 缩放 ----
  function startAnnotationInteraction(event: PointerEvent<HTMLElement>, item: CanvasItem, mode: "move" | "resize") {
    if (isPanGesture(event)) return;
    event.stopPropagation();
    if (event.button !== 0) return;
    if (editingTextId === item.id) return;
    if (mode === "resize") selectItems([item.id], item.id);
    else if (event.shiftKey) {
      if (selectedItemIds.includes(item.id)) { selectItems(selectedItemIds.filter((id) => id !== item.id)); return; }
      selectItems([...selectedItemIds, item.id], item.id);
    } else if (!selectedItemIds.includes(item.id)) selectItems([item.id], item.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { itemId: item.id, pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, width: item.width, height: item.height, itemStarts: { [item.id]: { x: item.x, y: item.y } } };
  }
  function moveAnnotation(event: PointerEvent<HTMLElement>) {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    const dx = (event.clientX - active.startX) / view.zoom; const dy = (event.clientY - active.startY) / view.zoom;
    setItems((current) => current.map((item) => {
      if (item.id !== active.itemId) return item;
      if (active.mode === "move") return { ...item, x: active.x + dx, y: active.y + dy };
      const scaleX = Math.max(0.1, (active.width + dx) / active.width);
      const scaleY = Math.max(0.1, (active.height + dy) / active.height);
      const payload = item.payload;
      if (payload && "kind" in payload && payload.kind === "freehand" && payload.points) {
        return { ...item, width: Math.max(2, Math.round(active.width * scaleX)), height: Math.max(2, Math.round(active.height * scaleY)), payload: { ...payload, points: payload.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })) } };
      }
      if (payload && "text" in payload) {
        // 文本：缩放只改变文本框的展示范围（宽高），字号保持不变，文本按新框宽重新换行。
        return { ...item, width: Math.max(20, Math.round(active.width * scaleX)), height: Math.max(16, Math.round(active.height * scaleY)) };
      }
      return { ...item, width: Math.max(2, Math.round(active.width * scaleX)), height: Math.max(2, Math.round(active.height * scaleY)) };
    }));
  }
  async function endAnnotation(event: PointerEvent<HTMLElement>) {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    interaction.current = null;
    if (!canvas) return;
    const item = items.find((entry) => entry.id === active.itemId); if (!item) return;
    const frameId = itemFrameId(item);
    const updated = item.parentFrameId === frameId ? item : { ...item, parentFrameId: frameId };
    if (updated !== item) setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
    try {
      const data = await json<{ revision: number }>("/api/canvas-items", { method: "PATCH", body: JSON.stringify(updated) });
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
    } catch (error) { onMessage(error instanceof Error ? error.message : "布局保存失败"); }
  }

  // ---- 托盘：拖拽插入 / 搜索 / 标签批量 ----
  type FrameRect = { left: number; top: number; right: number; bottom: number };
  function rectsOverlap(ax1: number, ay1: number, ax2: number, ay2: number, r: FrameRect) {
    return ax1 <= r.right && ax2 >= r.left && ay1 <= r.bottom && ay2 >= r.top;
  }
  function pointInRect(px: number, py: number, r: FrameRect) {
    return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  }
  function segmentIntersectsRect(ax: number, ay: number, bx: number, by: number, r: FrameRect) {
    if (Math.max(ax, bx) < r.left || Math.min(ax, bx) > r.right) return false;
    if (Math.max(ay, by) < r.top || Math.min(ay, by) > r.bottom) return false;
    if (pointInRect(ax, ay, r) || pointInRect(bx, by, r)) return true;
    const dx = bx - ax; const dy = by - ay;
    let t0 = 0; let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - r.left, r.right - ax, ay - r.top, r.bottom - ay];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; }
      else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return true;
  }
  function clampToRange(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
  /** 椭圆（绝对坐标）与矩形的相交判定：把矩形仿射变换到单位圆空间，用“圆 vs 矩形”最近点法，精确且覆盖所有相交形态。 */
  function ellipseIntersectsRect(cx: number, cy: number, rx: number, ry: number, r: FrameRect) {
    if (rx <= 0 || ry <= 0) return false;
    const minUx = Math.min((r.left - cx) / rx, (r.right - cx) / rx);
    const maxUx = Math.max((r.left - cx) / rx, (r.right - cx) / rx);
    const minUy = Math.min((r.top - cy) / ry, (r.bottom - cy) / ry);
    const maxUy = Math.max((r.top - cy) / ry, (r.bottom - cy) / ry);
    const px = clampToRange(0, minUx, maxUx);
    const py = clampToRange(0, minUy, maxUy);
    return px * px + py * py <= 1;
  }
  /** 元素与 Frame 是否真实相交：图片/矩形/文本按包围盒；椭圆/直线/箭头/手绘按真实几何。 */
  function shapeIntersectsFrame(item: Pick<CanvasItem, "x" | "y" | "width" | "height" | "type" | "payload">, frame: PageFrame) {
    const r: FrameRect = { left: frame.x, top: frame.y, right: frame.x + frame.width, bottom: frame.y + frame.height };
    if (item.type !== "shape") return rectsOverlap(item.x, item.y, item.x + item.width, item.y + item.height, r);
    const payload = item.payload;
    if (!payload || !("kind" in payload)) return false;
    const kind = payload.kind;
    if (kind === "rect") return rectsOverlap(item.x, item.y, item.x + item.width, item.y + item.height, r);
    if (kind === "ellipse") return ellipseIntersectsRect(item.x + item.width / 2, item.y + item.height / 2, item.width / 2, item.height / 2, r);
    if (kind === "line" || kind === "arrow") {
      const a = payload.points?.[0] ?? { x: 0, y: 0 };
      const b = payload.points?.[1] ?? { x: item.width, y: item.height };
      return segmentIntersectsRect(item.x + a.x, item.y + a.y, item.x + b.x, item.y + b.y, r);
    }
    if (kind === "freehand" && payload.points?.length) {
      for (let i = 1; i < payload.points.length; i++) {
        const prev = payload.points[i - 1]; const cur = payload.points[i];
        if (segmentIntersectsRect(item.x + prev.x, item.y + prev.y, item.x + cur.x, item.y + cur.y, r)) return true;
      }
    }
    return false;
  }
  /** 元素与 Frame 有交集（按真实几何判定）即归属该 Frame，按 bbox 重叠面积取最大者，无交集返回 null。 */
  function itemFrameId(item: Pick<CanvasItem, "x" | "y" | "width" | "height" | "type" | "payload">): string | null {
    let best: { id: string; area: number } | null = null;
    for (const frame of frames) {
      if (!shapeIntersectsFrame(item, frame)) continue;
      const ix = Math.min(item.x + item.width, frame.x + frame.width) - Math.max(item.x, frame.x);
      const iy = Math.min(item.y + item.height, frame.y + frame.height) - Math.max(item.y, frame.y);
      const area = Math.max(0, ix) * Math.max(0, iy);
      if (!best || area > best.area) best = { id: frame.id, area };
    }
    return best?.id ?? null;
  }

  async function insertImage(asset: Asset, point: Point) {
    if (!canvas) { onMessage("请先创建 Page"); return; }
    const size = aspectSize(asset, 220);
    const x = point.x - size.width / 2; const y = point.y - size.height / 2;
    const frameId = itemFrameId({ x, y, width: size.width, height: size.height, type: "image", payload: null });
    try {
      const data = await json<{ item: CanvasItem; revision: number }>("/api/canvas-items", { method: "POST", body: JSON.stringify({ canvasId: canvas.id, assetId: asset.id, type: "image", parentFrameId: frameId, x, y, width: size.width, height: size.height, zIndex: items.length + 1, rotation: 0 }) });
      const created = { ...data.item, name: asset.name, thumbnailUrl: asset.thumbnailUrl, type: "image" as const };
      setItems((current) => [...current, created]);
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
      selectItems([created.id], created.id);
      onMessage(frameId ? `素材已放入 ${frames.find((f) => f.id === frameId)?.name ?? "Frame"}` : "素材已放入画板");
    } catch (error) { onMessage(error instanceof Error ? error.message : "添加失败"); }
  }

  async function insertTagBatch(tag: string, point: Point) {
    if (!canvas) { onMessage("请先创建 Page"); return; }
    const tagAssets = assets.filter((asset) => asset.tags.includes(tag));
    if (!tagAssets.length) { onMessage(`标签“${tag}”下没有素材`); return; }
    const cols = Math.ceil(Math.sqrt(tagAssets.length));
    const gap = 24; const width = 160;
    const sized = tagAssets.map((asset) => ({ asset, ...aspectSize(asset, width) }));
    const gridRows = Math.ceil(tagAssets.length / cols);
    const rowH = Math.max(...sized.map((entry) => entry.height));
    const colWidth = width + gap;
    const totalW = cols * colWidth - gap;
    const totalH = gridRows * (rowH + gap) - gap;
    const startX = point.x - totalW / 2;
    const startY = point.y - totalH / 2;
    const frameId = itemFrameId({ x: startX, y: startY, width: totalW, height: totalH, type: "image", payload: null });
    const created: CanvasItem[] = [];
    let revision = canvas.revision;
    try {
      for (let index = 0; index < sized.length; index++) {
        const { asset, width: w, height: h } = sized[index];
        const col = index % cols; const row = Math.floor(index / cols);
        const data = await json<{ item: CanvasItem; revision: number }>("/api/canvas-items", { method: "POST", body: JSON.stringify({ canvasId: canvas.id, assetId: asset.id, type: "image", parentFrameId: frameId, x: startX + col * colWidth, y: startY + row * (rowH + gap), width: w, height: h, zIndex: items.length + index + 1, rotation: 0 }) });
        revision = data.revision;
        created.push({ ...data.item, name: asset.name, thumbnailUrl: asset.thumbnailUrl, type: "image" });
      }
      setItems((current) => [...current, ...created]);
      setCanvas((current) => current ? { ...current, revision } : current);
      onMessage(`已把标签“${tag}”的 ${tagAssets.length} 个素材批量放入画板`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "批量插入失败"); }
  }

  function handleAssetDragStart(event: DragEvent<HTMLButtonElement>, asset: Asset) {
    event.dataTransfer.setData("application/x-artdb-asset", asset.id);
    event.dataTransfer.effectAllowed = "copy";
  }
  function handleTagDragStart(event: DragEvent<HTMLButtonElement>, tag: string) {
    event.dataTransfer.setData("application/x-artdb-tag", tag);
    event.dataTransfer.effectAllowed = "copy";
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const point = toCanvas(event.clientX, event.clientY);
    const assetId = event.dataTransfer.getData("application/x-artdb-asset");
    const tag = event.dataTransfer.getData("application/x-artdb-tag");
    if (assetId) { const asset = assets.find((entry) => entry.id === assetId); if (asset) void insertImage(asset, point); }
    else if (tag) { void insertTagBatch(tag, point); }
  }

  const projectTags = [...new Set(assets.flatMap((asset) => asset.tags))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const query = searchInput.trim().toLowerCase();
  const filteredAssets = assets.filter((asset) => {
    const matchesTagFilter = !tagFilter || asset.tags.includes(tagFilter);
    const matchesQuery = !query || asset.name.toLowerCase().includes(query) || asset.tags.some((tag) => tag.toLowerCase().includes(query));
    return matchesTagFilter && matchesQuery;
  });

  const topZ = Math.max(0, ...items.map((item) => item.zIndex));
  const bottomZ = Math.min(0, ...items.map((item) => item.zIndex));
  const controlSize = Math.max(9, 10 / view.zoom);
  const titleScale = Math.max(1, 1 / view.zoom);

  function renderImageItem(item: CanvasItem) {
    return <article key={item.id} className={`canvas-item ${selectedItemIds.includes(item.id) ? "selected" : ""}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.zIndex, transform: `rotate(${item.rotation}deg)` }} onPointerDown={(event) => startInteraction(event, item, "move")} onPointerMove={moveInteraction} onPointerUp={(event) => void endInteraction(event)} onDoubleClick={(event) => { event.stopPropagation(); onSelectAsset(item.assetId!); }} onContextMenu={(event) => openItemMenu(event, item)} title="双击查看素材详情">
      {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.name ?? ""} draggable={false} /> : <div className="canvas-item-empty">{item.name ?? "图片"}</div>}
      <button className="resize-handle" type="button" aria-label="调整素材大小" onPointerDown={(event) => startInteraction(event, item, "resize")} onPointerMove={moveInteraction} onPointerUp={(event) => void endInteraction(event)} />
    </article>;
  }

  function renderShape(payload: ShapePayload, boxWidth: number, boxHeight: number) {
    const stroke = payload.stroke || strokeColor;
    const width = payload.strokeWidth || strokeWidth;
    const sx = Math.max(0.25, width / view.zoom);
    if (payload.kind === "freehand" && payload.points?.length) {
      const d = payload.points.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
      return <svg className="annotation-shape" viewBox={`0 0 ${Math.max(1, boxWidth)} ${Math.max(1, boxHeight)}`} preserveAspectRatio="none" width="100%" height="100%"><path d={d} fill="none" stroke={stroke} strokeWidth={sx} strokeLinecap="round" strokeLinejoin="round" /></svg>;
    }
    if (payload.kind === "line" || payload.kind === "arrow") {
      const a = payload.points?.[0] ?? { x: 0, y: 0 }; const b = payload.points?.[1] ?? { x: boxWidth, y: boxHeight };
      return <svg className="annotation-shape" viewBox={`0 0 ${Math.max(1, boxWidth)} ${Math.max(1, boxHeight)}`} preserveAspectRatio="none" width="100%" height="100%"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={sx} strokeLinecap="round" />{payload.kind === "arrow" ? <g transform={`translate(${b.x},${b.y}) rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI})`}><path d={`M ${-sx * 2} ${-sx * 1.6} L 0 0 L ${-sx * 2} ${sx * 1.6}`} fill="none" stroke={stroke} strokeWidth={sx} strokeLinejoin="round" /></g> : null}</svg>;
    }
    return <svg className="annotation-shape" viewBox={`0 0 ${Math.max(1, boxWidth)} ${Math.max(1, boxHeight)}`} preserveAspectRatio="none" width="100%" height="100%">{payload.kind === "rect" ? <rect x={sx / 2} y={sx / 2} width={Math.max(1, boxWidth - sx)} height={Math.max(1, boxHeight - sx)} fill="none" stroke={stroke} strokeWidth={sx} /> : <ellipse cx={boxWidth / 2} cy={boxHeight / 2} rx={Math.max(1, (boxWidth - sx) / 2)} ry={Math.max(1, (boxHeight - sx) / 2)} fill="none" stroke={stroke} strokeWidth={sx} />}</svg>;
  }

  function renderAnnotation(item: CanvasItem) {
    const selected = selectedItemIds.includes(item.id);
    const payload = item.payload;
    const isText = item.type === "text";
    const itemWidth = Math.max(1, item.width); const itemHeight = Math.max(1, item.height);
    if (isText) {
      const text = payload && "text" in payload ? (payload as TextPayload).text : "";
      const color = payload && "color" in payload ? (payload as TextPayload).color : strokeColor;
      const fontSize = payload && "fontSize" in payload ? (payload as TextPayload).fontSize : 18;
      return <article key={item.id} className={`canvas-item annotation-item ${selected ? "selected" : ""}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.zIndex }} onPointerDown={(event) => startAnnotationInteraction(event, item, "move")} onPointerMove={moveAnnotation} onPointerUp={(event) => void endAnnotation(event)} onContextMenu={(event) => openItemMenu(event, item)} onDoubleClick={(event) => { event.stopPropagation(); setEditingTextId(item.id); }}>
        {editingTextId === item.id
          ? <div className="annotation-text-editor" contentEditable suppressContentEditableWarning autoFocus style={{ color, fontSize }} ref={(el) => { if (el && !el.textContent) el.focus(); }} onBlur={(event) => commitText(item, event.currentTarget.textContent ?? "")} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); (event.currentTarget as HTMLElement).blur(); } if (event.key === "Escape") { setTool("pointer"); (event.currentTarget as HTMLElement).blur(); } }} />
          : <div className="annotation-text" style={{ color, fontSize, lineHeight: 1.35 }}>{text}</div>}
        {!editingTextId && selected && <button className="resize-handle" type="button" aria-label="调整大小" onPointerDown={(event) => startAnnotationInteraction(event, item, "resize")} onPointerMove={moveAnnotation} onPointerUp={(event) => void endAnnotation(event)} />}
      </article>;
    }
    return <article key={item.id} className={`canvas-item annotation-item ${selected ? "selected" : ""}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.zIndex }} onPointerDown={(event) => startAnnotationInteraction(event, item, "move")} onPointerMove={moveAnnotation} onPointerUp={(event) => void endAnnotation(event)} onContextMenu={(event) => openItemMenu(event, item)}>
      {payload && "kind" in payload ? renderShape(payload as ShapePayload, itemWidth, itemHeight) : null}
      {selected && <button className="resize-handle" type="button" aria-label="调整大小" onPointerDown={(event) => startAnnotationInteraction(event, item, "resize")} onPointerMove={moveAnnotation} onPointerUp={(event) => void endAnnotation(event)} />}
    </article>;
  }

  function renderPreviewShape() {
    if (!drawPreview) return null;
    const box = drawPreview.kind === "freehand" ? bboxOf(drawPreview.points.length ? drawPreview.points : [drawPreview.start, drawPreview.current]) : { left: Math.min(drawPreview.start.x, drawPreview.current.x), top: Math.min(drawPreview.start.y, drawPreview.current.y), right: Math.max(drawPreview.start.x, drawPreview.current.x), bottom: Math.max(drawPreview.start.y, drawPreview.current.y) };
    const width = Math.max(1, box.right - box.left); const height = Math.max(1, box.bottom - box.top);
    const payload: ShapePayload = { kind: drawPreview.kind, stroke: drawPreview.stroke, strokeWidth: drawPreview.strokeWidth, points: drawPreview.kind === "freehand" ? drawPreview.points.map((p) => ({ x: p.x - box.left, y: p.y - box.top })) : (drawPreview.kind === "arrow" || drawPreview.kind === "line" ? [{ x: drawPreview.start.x - box.left, y: drawPreview.start.y - box.top }, { x: drawPreview.current.x - box.left, y: drawPreview.current.y - box.top }] : undefined) };
    return <div className="annotation-preview" style={{ left: box.left, top: box.top, width, height, zIndex: 100000 }}>{renderShape(payload, width, height)}</div>;
  }

  return (
    <section className="board-shell">
      <div className="board-toolbar">
        <div className="board-pages" aria-label="Pages">
          <span className="board-pages-label">Pages</span>
          <div className="board-tabs">{canvases.map((entry) => editingPageId === entry.id ? (
            <input key={entry.id} className="board-page-name-input" value={pageNameDraft} maxLength={50} autoFocus aria-label="修改 Page 名称" onChange={(event) => setPageNameDraft(event.target.value)} onBlur={() => void renameCanvas(entry.id, entry.name, pageNameDraft)} onKeyDown={(event) => handlePageNameKeyDown(event, entry)} />
          ) : <button type="button" className={entry.id === canvasId ? "active" : ""} key={entry.id} onClick={() => setCanvasId(entry.id)} onDoubleClick={() => startPageRename(entry)} title="双击修改 Page 名称">{entry.name}<span>{entry.itemCount}</span></button>)}<button className="board-add" type="button" onClick={() => void createCanvas()}><Plus size={14} />新建 Page</button></div>
        </div>
        <div className="board-actions">{canvas ? <><button className="add-frame-button" type="button" onClick={createFrame}><Frame size={14} /><Plus size={11} />Frame</button><span className="sync-state"><Check size={13} />素材布局已同步</span><button type="button" onClick={() => void deleteCanvas()} aria-label="删除 Page"><Trash2 size={15} /></button></> : null}</div>
      </div>
      <div className="board-toolbar board-annotate-toolbar">
        <div className="annotate-tools" role="toolbar" aria-label="标记工具">
          {TOOLS.map((entry) => { const Icon = entry.icon; return <button key={entry.id} type="button" title={entry.shortcut ? `${entry.label}（${entry.shortcut}）` : entry.label} className={tool === entry.id ? "active" : ""} onClick={() => { setTool(entry.id); if (entry.id !== "pointer") setMarkupHidden(false); }}><Icon size={15} /></button>; })}
        </div>
        <label className="annotate-color" title="描边颜色"><input type="color" value={strokeColor} onChange={(event) => setStrokeColor(event.target.value)} /></label>
        <label className="annotate-width" title="描边粗细"><input type="range" min={1} max={12} value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} /></label>
        <label className="annotate-fontsize" title="字号（选中文本时调整当前文本，否则作为新建文本默认字号）"><Type size={13} /><input type="number" min={8} max={120} value={fontSize} onChange={(event) => handleFontSizeChange(Number(event.target.value))} aria-label="字号" /></label>
        <button type="button" className={`annotate-hide-toggle ${markupHidden ? "on" : ""}`} onClick={() => setMarkupHidden((hidden) => !hidden)} title={markupHidden ? "显示标记" : "隐藏全部标记"}>
          {markupHidden ? <EyeOff size={14} /> : <Eye size={14} />}{markupHidden ? "标记已隐藏" : "隐藏标记"}
        </button>
      </div>
      {loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} />载入 Page…</div> : canvas ? (
        <div className="board-body">
          <aside className={`asset-tray ${assetTrayOpen ? "open" : ""}`}>
            <button className="asset-tray-toggle" type="button" onClick={() => setAssetTrayOpen((open) => !open)}><ImagePlus size={15} />项目素材<span>{assets.length}</span></button>
            {assetTrayOpen ? <div className="asset-tray-inner">
              <div className="asset-tray-search">
                <Search size={13} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索名称或标签" aria-label="搜索项目素材" />
              </div>
              {projectTags.length ? <><button type="button" className={`asset-tray-tags-toggle ${tagsExpanded ? "expanded" : ""}`} onClick={() => setTagsExpanded((open) => !open)}><Tag size={13} />标签<span>{projectTags.length}</span><ChevronDown size={13} /></button>{tagsExpanded || searchInput.trim() !== "" ? <div className="asset-tray-tags">{projectTags.filter((tag) => !query || tag.toLowerCase().includes(query)).map((tag) => <button key={tag} type="button" className={tagFilter === tag ? "active" : ""} draggable title={`点击筛选 · 拖到画板批量插入该标签全部素材`} onClick={() => setTagFilter((current) => current === tag ? "" : tag)} onDragStart={(event) => handleTagDragStart(event, tag)}>#{tag}</button>)}</div> : null}</> : null}
              <div className="asset-tray-grid">{filteredAssets.map((asset) => <button key={asset.id} type="button" draggable title={asset.name} onDragStart={(event) => handleAssetDragStart(event, asset)}>{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" draggable={false} /> : <span />}</button>)}</div>
            </div> : null}
          </aside>
          <div ref={viewportRef} className={`board-viewport ${panning ? "panning" : ""} ${spaceHeld ? "space-held" : ""} ${tool !== "pointer" ? "tool-active" : ""}`} onPointerDown={(event) => { if (isPanGesture(event)) startPan(event); else if (tool !== "pointer") beginDraw(event); else startPan(event); }} onPointerMove={(event) => { movePan(event); moveDraw(event); }} onPointerUp={(event) => { endPan(event); endDraw(event); }} onPointerCancel={(event) => { endPan(event); endDraw(event); }} onDragOver={(event) => { const types = Array.from(event.dataTransfer.types); if (types.includes("application/x-artdb-asset") || types.includes("application/x-artdb-tag")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragHint({ x: event.clientX, y: event.clientY, text: types.includes("application/x-artdb-tag") ? "松开批量插入同标签素材" : "松开放入画板" }); } }} onDragLeave={() => setDragHint(null)} onDrop={(event) => { setDragHint(null); handleDrop(event); }}>
            <div className="board-page" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
              {frames.map((frame) => {
                const frameSelected = selectedFrameId === frame.id && !selectedItemIds.length;
                return <div className={`board-frame ${frameSelected ? "selected" : ""}`} key={frame.id} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }} onPointerDown={(event) => startFrameMove(event, frame)} onPointerMove={moveFrame} onPointerUp={endFrameMove} onPointerCancel={endFrameMove} onContextMenu={(event) => openFrameMenu(event, frame)}>
                  <div className="board-frame-title" style={{ transform: `scale(${titleScale})` }} onPointerDown={(event) => startFrameMove(event, frame)} onPointerMove={moveFrame} onPointerUp={endFrameMove}>
                    {editingFrameId === frame.id ? <input value={frameNameDraft} maxLength={50} autoFocus aria-label="修改 Frame 名称" onPointerDown={(event) => { if (!isPanGesture(event)) event.stopPropagation(); }} onChange={(event) => setFrameNameDraft(event.target.value)} onBlur={() => finishFrameNameEdit(frame)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setFrameNameDraft(frame.name); setEditingFrameId(null); } }} /> : <button type="button" onPointerDown={(event) => { if (!isPanGesture(event)) event.stopPropagation(); }} onClick={() => { if (panning || spaceHeld) return; selectItems([]); setSelectedFrameId(frame.id); }} onDoubleClick={(event) => { event.stopPropagation(); startFrameNameEdit(frame); }} title={frame.name}>{frame.name}</button>}
                    <span>{frame.width} × {frame.height}</span>
                  </div>
                  <div className="board-grid" />
                  {frameSelected ? RESIZE_DIRECTIONS.map((direction) => <button key={direction} className={`frame-selection-handle frame-handle-${direction}`} style={{ width: controlSize, height: controlSize }} type="button" aria-label={`从 ${direction} 方向调整 Frame 大小`} onPointerDown={(event) => startFrameResize(event, frame, direction)} onPointerMove={moveFrameResize} onPointerUp={endFrameResize} onPointerCancel={endFrameResize} />) : null}
                </div>;
              })}
              {[...items].sort((a, b) => a.zIndex - b.zIndex).map((item) => {
                if (markupHidden && item.type !== "image") return null;
                return item.type === "image" ? renderImageItem(item) : renderAnnotation(item);
              })}
              {!markupHidden && drawPreview ? renderPreviewShape() : null}
            </div>
            {marquee ? <div className="board-selection-marquee" style={{ left: Math.min(marquee.startX, marquee.currentX), top: Math.min(marquee.startY, marquee.currentY), width: Math.abs(marquee.currentX - marquee.startX), height: Math.abs(marquee.currentY - marquee.startY) }} /> : null}
            {dragHint ? <div className="board-drag-hint" style={{ left: dragHint.x + 12, top: dragHint.y + 14 }}>{dragHint.text}</div> : null}
          </div>
          {selectedItemIds.length ? <div className="canvas-selection-tools"><span className="selection-count">已选 {selectedItemIds.length} 个</span><button type="button" onClick={() => void updateSelected({ zIndex: topZ + 1 })} title="置于顶层"><ArrowUpToLine size={15} /></button><button type="button" onClick={() => void updateSelected({ zIndex: Math.max(0, bottomZ - 1) })} title="置于底层"><ArrowDownToLine size={15} /></button><button className="danger" type="button" onClick={() => void deleteSelected()} title="删除"><Trash2 size={15} /></button></div> : null}
          {frameMenu ? <div className="frame-context-menu" role="menu" style={{ left: frameMenu.x, top: frameMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => requestFrameDeletion(frameMenu.frameId)}><Trash2 size={14} />删除 Frame</button></div> : null}
          {itemMenu ? <div className="frame-context-menu item-context-menu" role="menu" style={{ left: itemMenu.x, top: itemMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => void deleteCanvasItems(selectedItemIds.includes(itemMenu.itemId) ? selectedItemIds : [itemMenu.itemId])}><Trash2 size={14} />删除</button></div> : null}
          <div className="board-navigation-hint">V 选择 · T 文本 · R 矩形 · O 椭圆 · 隐藏标记 · 拖左侧素材到画板放置 · 拖标签批量插入 · 框选 · 空格 + 拖动移动 Page · 滚轮缩放</div>
          {confirmFrameDeleteId ? (() => {
            const frame = frames.find((entry) => entry.id === confirmFrameDeleteId);
            const count = items.filter((item) => item.parentFrameId === confirmFrameDeleteId).length;
            return frame ? <div className="frame-delete-backdrop" role="presentation" onPointerDown={() => setConfirmFrameDeleteId(null)}><section className="frame-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="frame-delete-title" onPointerDown={(event) => event.stopPropagation()}><Trash2 size={22} /><h3 id="frame-delete-title">删除“{frame.name}”？</h3><p>其中 {count} 个素材的画板布局会被移除。</p><strong>素材原文件不会删除，仍会保留在左侧项目素材中。</strong><div><button type="button" onClick={() => setConfirmFrameDeleteId(null)}>取消</button><button className="danger" type="button" onClick={() => void deleteFrame(frame.id)}>确认删除</button></div></section></div> : null;
          })() : null}
        </div>
      ) : <div className="board-empty"><ImagePlus size={29} /><h3>正在创建默认 Page</h3><p>默认 Page 是一块空白无限画布，可从左侧把素材拖入。</p></div>}
    </section>
  );
}
