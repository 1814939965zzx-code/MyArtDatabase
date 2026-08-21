"use client";

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { ArrowDownToLine, ArrowUpToLine, Check, Frame, ImagePlus, LoaderCircle, Plus, RotateCw, Trash2 } from "lucide-react";
import { KeyboardEvent, MouseEvent, PointerEvent, useEffect, useRef, useState } from "react";

type Asset = { id: string; name: string; thumbnailUrl: string | null };
type CanvasSummary = { id: string; projectId: string; name: string; revision: number; itemCount: number };
type CanvasItem = {
  id: string; canvasId: string; assetId: string; x: number; y: number;
  width: number; height: number; zIndex: number; rotation: number;
  name: string; thumbnailUrl: string | null;
};
type CanvasData = { canvas: CanvasSummary; items: CanvasItem[] };
type PageFrame = { id: string; name: string; x: number; y: number; width: number; height: number };
type Interaction = {
  itemId: string; pointerId: number; mode: "move" | "resize";
  startX: number; startY: number; x: number; y: number; width: number; height: number;
  itemStarts: Record<string, { x: number; y: number }>;
};
type PanState = { pointerId: number; startX: number; startY: number; originX: number; originY: number };
type FrameMoveState = { pointerId: number; frameId: string; startX: number; startY: number; x: number; y: number };
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type FrameResizeState = { pointerId: number; frameId: string; direction: ResizeDirection; startX: number; startY: number; frame: PageFrame };
type MarqueeState = { pointerId: number; startX: number; startY: number; currentX: number; currentY: number; preservedIds: string[] };
type SnapGuides = { vertical: number[]; horizontal: number[] };
type LegacyFrameSettings = { name: string; width: number; height: number };

const DEFAULT_FRAME_WIDTH = 1920;
const DEFAULT_FRAME_HEIGHT = 1080;
const MIN_FRAME_WIDTH = 480;
const MIN_FRAME_HEIGHT = 320;
const INITIAL_ZOOM = .72;
const MIN_ZOOM = .2;
const MAX_ZOOM = 4;
const FRAME_GAP = 160;
const SNAP_DISTANCE_PX = 7;
const RESIZE_DIRECTIONS: ResizeDirection[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function defaultFrame(canvasId: string): PageFrame {
  return { id: `frame-${canvasId}-1`, name: "Frame 1", x: 0, y: 0, width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT };
}

export function BoardView({ projectId, assets, onMessage, onSelectAsset }: { projectId: string; assets: Asset[]; onMessage: (message: string) => void; onSelectAsset: (assetId: string) => void }) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [canvasId, setCanvasId] = useState("");
  const [canvas, setCanvas] = useState<CanvasSummary | null>(null);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [framesByCanvas, setFramesByCanvas] = useState<Record<string, PageFrame[]>>({});
  const [itemFramesByCanvas, setItemFramesByCanvas] = useState<Record<string, Record<string, string>>>({});
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
  const interaction = useRef<Interaction | null>(null);
  const panRef = useRef<PanState | null>(null);
  const frameMoveRef = useRef<FrameMoveState | null>(null);
  const frameResizeRef = useRef<FrameResizeState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const creatingDefaultPage = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const frameStorageKey = `artdatabase:frames:v2:${projectId}`;
  const legacyFrameStorageKey = `artdatabase:frame-settings:v1:${projectId}`;
  const itemFrameStorageKey = `artdatabase:frame-items:v2:${projectId}`;
  const frames = canvasId ? framesByCanvas[canvasId] ?? [defaultFrame(canvasId)] : [];
  const itemFrameMap = canvasId ? itemFramesByCanvas[canvasId] ?? {} : {};
  const selectedFrame = frames.find((entry) => entry.id === selectedFrameId) ?? null;

  function selectItems(ids: string[], primaryId: string | null = ids.at(-1) ?? null) {
    const unique = [...new Set(ids)];
    setSelectedItemIds(unique);
    setSelectedItemId(primaryId && unique.includes(primaryId) ? primaryId : unique.at(-1) ?? null);
  }

  function itemWorldBounds(item: CanvasItem) {
    const frame = frameForItem(item.id);
    return { left: (frame?.x ?? 0) + item.x, top: (frame?.y ?? 0) + item.y, right: (frame?.x ?? 0) + item.x + item.width, bottom: (frame?.y ?? 0) + item.y + item.height };
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

  function persistItemFrames(next: Record<string, Record<string, string>>) {
    setItemFramesByCanvas(next);
    try { window.localStorage.setItem(itemFrameStorageKey, JSON.stringify(next)); } catch { /* Local preferences are optional. */ }
  }

  function updateFrame(frameId: string, changes: Partial<PageFrame>) {
    if (!canvasId) return;
    persistFrames({ ...framesByCanvas, [canvasId]: frames.map((entry) => entry.id === frameId ? { ...entry, ...changes } : entry) });
  }

  function frameForItem(itemId: string) {
    return frames.find((entry) => entry.id === itemFrameMap[itemId]) ?? frames[0];
  }

  async function loadCanvases(preferredId?: string) {
    const data = await json<{ canvases: CanvasSummary[] }>(`/api/canvases?projectId=${encodeURIComponent(projectId)}`);
    if (!data.canvases.length && !creatingDefaultPage.current) {
      creatingDefaultPage.current = true;
      try {
        const created = await json<{ canvas: CanvasSummary }>("/api/canvases", { method: "POST", body: JSON.stringify({ projectId, name: "Page 1" }) });
        setCanvases([created.canvas]);
        setCanvasId(created.canvas.id);
        setSelectedFrameId(defaultFrame(created.canvas.id).id);
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
      const storedItemFrames = window.localStorage.getItem(itemFrameStorageKey);
      setItemFramesByCanvas(storedItemFrames ? JSON.parse(storedItemFrames) as Record<string, Record<string, string>> : {});
    } catch { setFramesByCanvas({}); setItemFramesByCanvas({}); }
  }, [frameStorageKey, itemFrameStorageKey, legacyFrameStorageKey]);

  useEffect(() => { void loadCanvases().catch((error) => { onMessage(error instanceof Error ? error.message : "Page 载入失败"); setLoading(false); }); }, [projectId]);

  useEffect(() => {
    setSelectedFrameId(null); selectItems([]);
    void loadCanvas(canvasId).catch((error) => onMessage(error instanceof Error ? error.message : "Page 载入失败"));
  }, [canvasId]);

  useEffect(() => {
    if (!canvasId) return;
    const timer = window.setInterval(() => {
      if (!interaction.current && !panRef.current && !frameMoveRef.current && !frameResizeRef.current) void loadCanvas(canvasId, true).catch(() => undefined);
    }, 900);
    return () => window.clearInterval(timer);
  }, [canvasId, canvas?.revision]);

  useEffect(() => {
    if (!canvasId || !items.length || !frames.length) return;
    let changed = false;
    const expanded = frames.map((frame) => {
      const frameItems = items.filter((item) => frameForItem(item.id)?.id === frame.id);
      if (!frameItems.length) return frame;
      const width = Math.max(frame.width, ...frameItems.map((item) => item.x + item.width + 24));
      const height = Math.max(frame.height, ...frameItems.map((item) => item.y + item.height + 24));
      if (width !== frame.width || height !== frame.height) changed = true;
      return { ...frame, width, height };
    });
    if (changed) persistFrames({ ...framesByCanvas, [canvasId]: expanded });
  }, [canvasId, items]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || !frames.length) return;
    const left = Math.min(...frames.map((frame) => frame.x));
    const top = Math.min(...frames.map((frame) => frame.y));
    const right = Math.max(...frames.map((frame) => frame.x + frame.width));
    const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
    const fittedZoom = Math.max(MIN_ZOOM, Math.min(INITIAL_ZOOM, (element.clientWidth - 120) / (right - left), (element.clientHeight - 120) / (bottom - top)));
    setView({ zoom: fittedZoom, x: (element.clientWidth - (right - left) * fittedZoom) / 2 - left * fittedZoom, y: (element.clientHeight - (bottom - top) * fittedZoom) / 2 - top * fittedZoom });
  }, [canvas?.id]);

  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space" && !editable(event.target)) { event.preventDefault(); setSpaceHeld(true); }
      if (event.key === "Escape") { setFrameMenu(null); setItemMenu(null); }
    };
    const up = (event: globalThis.KeyboardEvent) => { if (event.code === "Space") setSpaceHeld(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

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
      await loadCanvases(data.canvas.id); setSelectedFrameId(defaultFrame(data.canvas.id).id);
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
    onMessage(`${frame.name} 已创建`);
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

  async function addAsset(asset: Asset) {
    if (!canvas || !selectedFrame) { onMessage("请先选择一个 Frame，再放入素材"); return; }
    const targetFrame = selectedFrame;
    try {
      const frameItems = items.filter((item) => frameForItem(item.id)?.id === targetFrame.id);
      const offset = (frameItems.length % 7) * 34;
      const data = await json<{ item: CanvasItem; revision: number }>("/api/canvas-items", { method: "POST", body: JSON.stringify({ canvasId: canvas.id, assetId: asset.id, x: Math.min(targetFrame.width - 240, 160 + offset), y: Math.min(targetFrame.height - 180, 130 + offset), width: 240, height: 180, zIndex: items.length + 1 }) });
      persistItemFrames({ ...itemFramesByCanvas, [canvasId]: { ...itemFrameMap, [data.item.id]: targetFrame.id } });
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
      await loadCanvas(canvas.id); setSelectedFrameId(targetFrame.id); selectItems([data.item.id], data.item.id);
      onMessage(`素材已放入 ${targetFrame.name}`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "添加失败"); }
  }

  function isPanGesture(event: PointerEvent<Element>) {
    return event.button === 1 || (event.button === 0 && spaceHeld);
  }

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
      const hitIds = items.filter((item) => { const bounds = itemWorldBounds(item); return bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom; }).map((item) => item.id);
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

  function startFrameMove(event: PointerEvent<HTMLElement>, frame: PageFrame) {
    if (isPanGesture(event)) return;
    event.stopPropagation(); selectItems([]);
    if (selectedFrameId !== frame.id) { setSelectedFrameId(frame.id); return; }
    if (event.button !== 0 || spaceHeld || editingFrameId === frame.id) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    frameMoveRef.current = { pointerId: event.pointerId, frameId: frame.id, startX: event.clientX, startY: event.clientY, x: frame.x, y: frame.y };
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
    updateFrame(active.frameId, { x: Math.round(x), y: Math.round(y) });
  }
  function endFrameMove(event: PointerEvent<HTMLElement>) { if (frameMoveRef.current?.pointerId === event.pointerId) { frameMoveRef.current = null; setSnapGuides({ vertical: [], horizontal: [] }); } }

  function frameContentBounds(frameId: string) {
    const frameItems = items.filter((item) => frameForItem(item.id)?.id === frameId);
    return { width: Math.max(MIN_FRAME_WIDTH, ...frameItems.map((item) => item.x + item.width + 24)), height: Math.max(MIN_FRAME_HEIGHT, ...frameItems.map((item) => item.y + item.height + 24)) };
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
    const bounds = frameContentBounds(active.frameId); let { x, y, width, height } = active.frame;
    if (active.direction.includes("e")) width = Math.max(bounds.width, Math.round(active.frame.width + dx));
    if (active.direction.includes("s")) height = Math.max(bounds.height, Math.round(active.frame.height + dy));
    if (active.direction.includes("w")) { width = Math.max(bounds.width, Math.round(active.frame.width - dx)); x = active.frame.x + active.frame.width - width; }
    if (active.direction.includes("n")) { height = Math.max(bounds.height, Math.round(active.frame.height - dy)); y = active.frame.y + active.frame.height - height; }
    const targets = frames.filter((entry) => entry.id !== active.frameId); const threshold = SNAP_DISTANCE_PX / view.zoom;
    let snapX: { delta: number; guide: number } | null = null; let snapY: { delta: number; guide: number } | null = null;
    if (!event.altKey && active.direction.includes("e")) snapX = nearestSnap([x + width], targets.flatMap((entry) => [entry.x, entry.x + entry.width / 2, entry.x + entry.width]), threshold);
    if (!event.altKey && active.direction.includes("w")) snapX = nearestSnap([x], targets.flatMap((entry) => [entry.x, entry.x + entry.width / 2, entry.x + entry.width]), threshold);
    if (!event.altKey && active.direction.includes("s")) snapY = nearestSnap([y + height], targets.flatMap((entry) => [entry.y, entry.y + entry.height / 2, entry.y + entry.height]), threshold);
    if (!event.altKey && active.direction.includes("n")) snapY = nearestSnap([y], targets.flatMap((entry) => [entry.y, entry.y + entry.height / 2, entry.y + entry.height]), threshold);
    if (snapX) { if (active.direction.includes("w")) { x += snapX.delta; width -= snapX.delta; } else width += snapX.delta; }
    if (snapY) { if (active.direction.includes("n")) { y += snapY.delta; height -= snapY.delta; } else height += snapY.delta; }
    setSnapGuides({ vertical: snapX ? [snapX.guide] : [], horizontal: snapY ? [snapY.guide] : [] });
    updateFrame(active.frameId, { x, y, width, height });
  }
  function endFrameResize(event: PointerEvent<HTMLButtonElement>) { if (frameResizeRef.current?.pointerId === event.pointerId) { frameResizeRef.current = null; setSnapGuides({ vertical: [], horizontal: [] }); } }

  function openFrameMenu(event: MouseEvent<HTMLDivElement>, frame: PageFrame) {
    event.preventDefault(); event.stopPropagation();
    selectItems([]); setSelectedFrameId(frame.id);
    setItemMenu(null);
    setFrameMenu({ frameId: frame.id, x: event.clientX, y: event.clientY });
  }

  function openItemMenu(event: MouseEvent<HTMLElement>, item: CanvasItem) {
    event.preventDefault(); event.stopPropagation();
    setSelectedFrameId(frameForItem(item.id)?.id ?? null);
    if (!selectedItemIds.includes(item.id)) selectItems([item.id], item.id);
    setFrameMenu(null);
    setItemMenu({ itemId: item.id, x: event.clientX, y: event.clientY });
  }

  function requestFrameDeletion(frameId: string) {
    const hasItems = items.some((item) => frameForItem(item.id)?.id === frameId);
    setFrameMenu(null);
    if (hasItems) setConfirmFrameDeleteId(frameId);
    else void deleteFrame(frameId);
  }

  async function deleteFrame(frameId: string) {
    if (!canvasId || !canvas) return;
    const frame = frames.find((entry) => entry.id === frameId);
    if (!frame) return;
    const frameItems = items.filter((item) => frameForItem(item.id)?.id === frameId);
    try {
      let latestRevision = canvas.revision;
      for (const item of frameItems) {
        const data = await json<{ revision: number }>(`/api/canvas-items?id=${encodeURIComponent(item.id)}&canvasId=${encodeURIComponent(canvas.id)}`, { method: "DELETE" });
        latestRevision = data.revision;
      }
      const removedIds = new Set(frameItems.map((item) => item.id));
      const remainingMappings = Object.fromEntries(Object.entries(itemFrameMap).filter(([itemId]) => !removedIds.has(itemId)));
      persistItemFrames({ ...itemFramesByCanvas, [canvasId]: remainingMappings });
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
    const topZ = Math.max(0, ...items.map((entry) => entry.zIndex));
    interaction.current = { itemId: item.id, pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, width: item.width, height: item.height, itemStarts: Object.fromEntries(items.filter((entry) => movingIds.includes(entry.id)).map((entry) => [entry.id, { x: entry.x, y: entry.y }])) };
    setSelectedFrameId(frameForItem(item.id)?.id ?? null);
    if (item.zIndex < topZ) setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, zIndex: topZ + 1 } : entry));
  }
  function moveInteraction(event: PointerEvent<HTMLElement>) {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    const frame = frameForItem(active.itemId); if (!frame) return;
    let dx = (event.clientX - active.startX) / view.zoom; let dy = (event.clientY - active.startY) / view.zoom;
    const movingIds = Object.keys(active.itemStarts);
    if (active.mode === "move" && movingIds.length) {
      const movingItems = items.filter((item) => movingIds.includes(item.id));
      const startBounds = movingItems.map((item) => {
        const owner = frameForItem(item.id); const start = active.itemStarts[item.id];
        return { left: (owner?.x ?? 0) + start.x, top: (owner?.y ?? 0) + start.y, right: (owner?.x ?? 0) + start.x + item.width, bottom: (owner?.y ?? 0) + start.y + item.height };
      });
      const left = Math.min(...startBounds.map((entry) => entry.left)) + dx; const right = Math.max(...startBounds.map((entry) => entry.right)) + dx;
      const top = Math.min(...startBounds.map((entry) => entry.top)) + dy; const bottom = Math.max(...startBounds.map((entry) => entry.bottom)) + dy;
      const otherBounds = items.filter((item) => !movingIds.includes(item.id)).map(itemWorldBounds);
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
        const owner = frameForItem(item.id); if (!owner) return item;
        return { ...item, x: Math.max(0, Math.min(owner.width - item.width, Math.round(start.x + dx))), y: Math.max(0, Math.min(owner.height - item.height, Math.round(start.y + dy))) };
      }
      if (item.id !== active.itemId) return item;
      if (event.shiftKey) {
        const useWidth = Math.abs(dx) >= Math.abs(dy);
        let scale = useWidth ? (active.width + dx) / active.width : (active.height + dy) / active.height;
        const minScale = Math.max(80 / active.width, 60 / active.height);
        const maxScale = Math.min(900 / active.width, 900 / active.height, (frame.width - item.x) / active.width, (frame.height - item.y) / active.height);
        scale = Math.max(minScale, Math.min(maxScale, scale));
        return { ...item, width: Math.round(active.width * scale), height: Math.round(active.height * scale) };
      }
      return { ...item, width: Math.max(80, Math.min(900, frame.width - item.x, Math.round(active.width + dx))), height: Math.max(60, Math.min(900, frame.height - item.y, Math.round(active.height + dy))) };
    }));
  }
  async function endInteraction(event: PointerEvent<HTMLElement>) {
    const active = interaction.current; if (!active || active.pointerId !== event.pointerId) return;
    interaction.current = null; setSnapGuides({ vertical: [], horizontal: [] });
    const changedItems = items.filter((entry) => active.mode === "move" ? Boolean(active.itemStarts[entry.id]) : entry.id === active.itemId);
    if (!changedItems.length || !canvas) return;
    try {
      let revision = canvas.revision;
      for (const item of changedItems) {
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
    if (uniqueIds.length > 1 && !window.confirm(`从画板删除选中的 ${uniqueIds.length} 张图片？素材原文件仍会保留。`)) return;
    try {
      let revision = canvas.revision;
      for (const itemId of uniqueIds) {
        const data = await json<{ revision: number }>(`/api/canvas-items?id=${encodeURIComponent(itemId)}&canvasId=${encodeURIComponent(canvas.id)}`, { method: "DELETE" });
        revision = data.revision;
      }
      const removedIds = new Set(uniqueIds);
      setItems((current) => current.filter((item) => !removedIds.has(item.id)));
      const remainingItemFrames = Object.fromEntries(Object.entries(itemFrameMap).filter(([itemId]) => !removedIds.has(itemId)));
      persistItemFrames({ ...itemFramesByCanvas, [canvasId]: remainingItemFrames });
      selectItems(selectedItemIds.filter((id) => !removedIds.has(id))); setItemMenu(null); setCanvas((current) => current ? { ...current, revision } : current);
      onMessage(`已从画板删除 ${uniqueIds.length} 张图片，素材原文件仍保留在项目素材中`);
    } catch (error) { onMessage(error instanceof Error ? error.message : "删除失败"); }
  }

  async function deleteCanvasItem(itemId: string) { await deleteCanvasItems([itemId]); }

  async function deleteSelected() { if (selectedItemIds.length) await deleteCanvasItems(selectedItemIds); }

  const selected = items.find((item) => item.id === selectedItemId) ?? null;
  const topZ = Math.max(0, ...items.map((item) => item.zIndex));
  const bottomZ = Math.min(0, ...items.map((item) => item.zIndex));
  const placementCounts = items.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.assetId]: (counts[item.assetId] ?? 0) + 1 }), {});
  const controlSize = Math.max(9, 10 / view.zoom);
  const titleScale = Math.max(1, 1 / view.zoom);

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
      {loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} />载入 Page…</div> : canvas ? (
        <div className="board-body">
          <aside className={`asset-tray ${assetTrayOpen ? "open" : ""}`}><button className="asset-tray-toggle" type="button" onClick={() => setAssetTrayOpen((open) => !open)}><ImagePlus size={15} />项目素材<span>{assets.length}</span></button>{assetTrayOpen ? <div className="asset-tray-list">{assets.map((asset) => <button type="button" key={asset.id} onClick={() => void addAsset(asset)} title={selectedFrame ? `添加到 ${selectedFrame.name}` : "请先选择一个 Frame"}>{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <span /> }<b>{asset.name}</b><em className="asset-placement-count">×{placementCounts[asset.id] ?? 0}</em><Plus size={13} /></button>)}</div> : null}</aside>
          <div ref={viewportRef} className={`board-viewport ${panning ? "panning" : ""} ${spaceHeld ? "space-held" : ""}`} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
            <div className="board-page" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
              {frames.map((frame) => {
                const frameSelected = selectedFrameId === frame.id && !selectedItemIds.length;
                return <div className={`board-frame ${frameSelected ? "selected" : ""}`} key={frame.id} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }} onPointerDown={(event) => startFrameMove(event, frame)} onPointerMove={moveFrame} onPointerUp={endFrameMove} onPointerCancel={endFrameMove} onContextMenu={(event) => openFrameMenu(event, frame)}>
                  <div className="board-frame-title" style={{ transform: `scale(${titleScale})` }} onPointerDown={(event) => startFrameMove(event, frame)} onPointerMove={moveFrame} onPointerUp={endFrameMove}>
                    {editingFrameId === frame.id ? <input value={frameNameDraft} maxLength={50} autoFocus aria-label="修改 Frame 名称" onPointerDown={(event) => { if (!isPanGesture(event)) event.stopPropagation(); }} onChange={(event) => setFrameNameDraft(event.target.value)} onBlur={() => finishFrameNameEdit(frame)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setFrameNameDraft(frame.name); setEditingFrameId(null); } }} /> : <button type="button" onPointerDown={(event) => { if (!isPanGesture(event)) event.stopPropagation(); }} onClick={() => { if (panning || spaceHeld) return; selectItems([]); setSelectedFrameId(frame.id); }} onDoubleClick={(event) => { event.stopPropagation(); startFrameNameEdit(frame); }} title={frame.name}>{frame.name}</button>}
                    <span>{frame.width} × {frame.height}</span>
                  </div>
                  <div className="board-grid" />
                  {items.filter((item) => frameForItem(item.id)?.id === frame.id).map((item) => <article key={item.id} className={`canvas-item ${selectedItemIds.includes(item.id) ? "selected" : ""}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.zIndex, transform: `rotate(${item.rotation}deg)` }} onPointerDown={(event) => startInteraction(event, item, "move")} onPointerMove={moveInteraction} onPointerUp={(event) => void endInteraction(event)} onDoubleClick={(event) => { event.stopPropagation(); onSelectAsset(item.assetId); }} onContextMenu={(event) => openItemMenu(event, item)} title="双击查看素材详情">
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.name} draggable={false} /> : <div className="canvas-item-empty">{item.name}</div>}
                    <span className="canvas-caption">{item.name}</span>
                    <button className="resize-handle" type="button" aria-label="调整素材大小" onPointerDown={(event) => startInteraction(event, item, "resize")} onPointerMove={moveInteraction} onPointerUp={(event) => void endInteraction(event)} />
                  </article>)}
                  {frameSelected ? RESIZE_DIRECTIONS.map((direction) => <button key={direction} className={`frame-selection-handle frame-handle-${direction}`} style={{ width: controlSize, height: controlSize }} type="button" aria-label={`从 ${direction} 方向调整 Frame 大小`} onPointerDown={(event) => startFrameResize(event, frame, direction)} onPointerMove={moveFrameResize} onPointerUp={endFrameResize} onPointerCancel={endFrameResize} />) : null}
                </div>;
              })}
              {snapGuides.vertical.map((position) => <span key={`v-${position}`} className="board-snap-guide vertical" style={{ left: position }} />)}
              {snapGuides.horizontal.map((position) => <span key={`h-${position}`} className="board-snap-guide horizontal" style={{ top: position }} />)}
            </div>
            {marquee ? <div className="board-selection-marquee" style={{ left: Math.min(marquee.startX, marquee.currentX), top: Math.min(marquee.startY, marquee.currentY), width: Math.abs(marquee.currentX - marquee.startX), height: Math.abs(marquee.currentY - marquee.startY) }} /> : null}
          </div>
          {selectedItemIds.length ? <div className="canvas-selection-tools">{selectedItemIds.length === 1 && selected ? <><button type="button" onClick={() => void updateSelected({ zIndex: topZ + 1 })} title="置于顶层"><ArrowUpToLine size={15} /></button><button type="button" onClick={() => void updateSelected({ zIndex: bottomZ - 1 })} title="置于底层"><ArrowDownToLine size={15} /></button><button type="button" onClick={() => void updateSelected({ rotation: selected.rotation >= 180 ? -165 : selected.rotation + 15 })} title="旋转 15 度"><RotateCw size={15} /></button></> : <span className="selection-count">已选 {selectedItemIds.length} 张</span>}<button className="danger" type="button" onClick={() => void deleteSelected()} title="从画板删除"><Trash2 size={15} /></button></div> : null}
          {frameMenu ? <div className="frame-context-menu" role="menu" style={{ left: frameMenu.x, top: frameMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => requestFrameDeletion(frameMenu.frameId)}><Trash2 size={14} />删除 Frame</button></div> : null}
          {itemMenu ? <div className="frame-context-menu item-context-menu" role="menu" style={{ left: itemMenu.x, top: itemMenu.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => void deleteCanvasItems(selectedItemIds.includes(itemMenu.itemId) ? selectedItemIds : [itemMenu.itemId])}><Trash2 size={14} />{selectedItemIds.length > 1 && selectedItemIds.includes(itemMenu.itemId) ? `删除选中的 ${selectedItemIds.length} 张图片` : "从画板删除图片"}</button></div> : null}
          <div className="board-navigation-hint">拖动空白处框选 · Shift 增减选择 · Alt 临时关闭吸附 · 空格 + 拖动移动 Page · 滚轮缩放</div>
          {confirmFrameDeleteId ? (() => {
            const frame = frames.find((entry) => entry.id === confirmFrameDeleteId);
            const count = items.filter((item) => frameForItem(item.id)?.id === confirmFrameDeleteId).length;
            return frame ? <div className="frame-delete-backdrop" role="presentation" onPointerDown={() => setConfirmFrameDeleteId(null)}><section className="frame-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="frame-delete-title" onPointerDown={(event) => event.stopPropagation()}><Trash2 size={22} /><h3 id="frame-delete-title">删除“{frame.name}”？</h3><p>其中 {count} 个素材的画板布局会被移除。</p><strong>素材原文件不会删除，仍会保留在左侧项目素材中。</strong><div><button type="button" onClick={() => setConfirmFrameDeleteId(null)}>取消</button><button className="danger" type="button" onClick={() => void deleteFrame(frame.id)}>确认删除</button></div></section></div> : null;
          })() : null}
        </div>
      ) : <div className="board-empty"><ImagePlus size={29} /><h3>正在创建默认 Page</h3><p>默认 Page 会包含一个空的 1920 × 1080 Frame。</p></div>}
    </section>
  );
}
