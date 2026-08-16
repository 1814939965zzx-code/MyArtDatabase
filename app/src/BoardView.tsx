"use client";

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

import { ArrowDownToLine, ArrowUpToLine, Check, ImagePlus, LoaderCircle, Minus, Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { PointerEvent, useEffect, useRef, useState } from "react";

type Asset = { id: string; name: string; thumbnailUrl: string | null };
type CanvasSummary = { id: string; projectId: string; name: string; revision: number; itemCount: number };
type CanvasItem = {
  id: string; canvasId: string; assetId: string; x: number; y: number;
  width: number; height: number; zIndex: number; rotation: number;
  name: string; thumbnailUrl: string | null;
};
type CanvasData = { canvas: CanvasSummary; items: CanvasItem[] };
type Interaction = {
  itemId: string; pointerId: number; mode: "move" | "resize";
  startX: number; startY: number; x: number; y: number; width: number; height: number;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

export function BoardView({ projectId, assets, onMessage }: { projectId: string; assets: Asset[]; onMessage: (message: string) => void }) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [canvasId, setCanvasId] = useState("");
  const [canvas, setCanvas] = useState<CanvasSummary | null>(null);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(.72);
  const [loading, setLoading] = useState(true);
  const [assetTrayOpen, setAssetTrayOpen] = useState(true);
  const interaction = useRef<Interaction | null>(null);

  async function loadCanvases(preferredId?: string) {
    const data = await json<{ canvases: CanvasSummary[] }>(`/api/canvases?projectId=${encodeURIComponent(projectId)}`);
    setCanvases(data.canvases);
    setCanvasId((current) => {
      const candidate = preferredId || current;
      return data.canvases.some((entry) => entry.id === candidate) ? candidate : data.canvases[0]?.id || "";
    });
  }

  async function loadCanvas(id: string, onlyIfNewer = false) {
    if (!id) { setCanvas(null); setItems([]); setLoading(false); return; }
    const data = await json<CanvasData>(`/api/canvas?canvasId=${encodeURIComponent(id)}`);
    if (!onlyIfNewer || !canvas || data.canvas.revision > canvas.revision) {
      setCanvas(data.canvas);
      setItems(data.items);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadCanvases().catch((error) => { onMessage(error instanceof Error ? error.message : "画板载入失败"); setLoading(false); });
  }, [projectId]);

  useEffect(() => {
    void loadCanvas(canvasId).catch((error) => onMessage(error instanceof Error ? error.message : "画板载入失败"));
  }, [canvasId]);

  useEffect(() => {
    if (!canvasId) return;
    const timer = window.setInterval(() => {
      if (!interaction.current) void loadCanvas(canvasId, true).catch(() => undefined);
    }, 900);
    return () => window.clearInterval(timer);
  }, [canvasId, canvas?.revision]);

  async function createCanvas() {
    const name = window.prompt("画板名称", `灵感画板 ${canvases.length + 1}`)?.trim();
    if (!name) return;
    try {
      const data = await json<{ canvas: CanvasSummary }>("/api/canvases", { method: "POST", body: JSON.stringify({ projectId, name }) });
      await loadCanvases(data.canvas.id);
      onMessage("画板已创建");
    } catch (error) { onMessage(error instanceof Error ? error.message : "创建失败"); }
  }

  async function renameCanvas() {
    if (!canvas) return;
    const name = window.prompt("修改画板名称", canvas.name)?.trim();
    if (!name || name === canvas.name) return;
    try {
      await json("/api/canvases", { method: "PATCH", body: JSON.stringify({ id: canvas.id, name }) });
      await Promise.all([loadCanvases(canvas.id), loadCanvas(canvas.id)]);
      onMessage("画板名称已保存");
    } catch (error) { onMessage(error instanceof Error ? error.message : "保存失败"); }
  }

  async function deleteCanvas() {
    if (!canvas || !window.confirm(`删除画板“${canvas.name}”？`)) return;
    try {
      await json(`/api/canvases?id=${encodeURIComponent(canvas.id)}`, { method: "DELETE" });
      setCanvas(null); setItems([]); setCanvasId("");
      await loadCanvases();
      onMessage("画板已删除");
    } catch (error) { onMessage(error instanceof Error ? error.message : "删除失败"); }
  }

  async function addAsset(asset: Asset) {
    if (!canvas) return;
    try {
      const offset = (items.length % 7) * 34;
      const data = await json<{ item: CanvasItem; revision: number }>("/api/canvas-items", {
        method: "POST",
        body: JSON.stringify({ canvasId: canvas.id, assetId: asset.id, x: 160 + offset, y: 130 + offset, width: 240, height: 180, zIndex: items.length + 1 }),
      });
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
      await loadCanvas(canvas.id);
      setSelectedItemId(data.item.id);
      onMessage("素材已放入画板");
    } catch (error) { onMessage(error instanceof Error ? error.message : "添加失败"); }
  }

  function startInteraction(event: PointerEvent<HTMLElement>, item: CanvasItem, mode: "move" | "resize") {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const topZ = Math.max(0, ...items.map((entry) => entry.zIndex));
    interaction.current = { itemId: item.id, pointerId: event.pointerId, mode, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y, width: item.width, height: item.height };
    setSelectedItemId(item.id);
    if (item.zIndex < topZ) setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, zIndex: topZ + 1 } : entry));
  }

  function moveInteraction(event: PointerEvent<HTMLElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = (event.clientX - active.startX) / zoom;
    const dy = (event.clientY - active.startY) / zoom;
    setItems((current) => current.map((item) => item.id !== active.itemId ? item : active.mode === "move"
      ? { ...item, x: Math.max(0, Math.min(1920 - item.width, Math.round(active.x + dx))), y: Math.max(0, Math.min(1120 - item.height, Math.round(active.y + dy))) }
      : { ...item, width: Math.max(80, Math.min(900, Math.round(active.width + dx))), height: Math.max(60, Math.min(900, Math.round(active.height + dy))) }));
  }

  async function endInteraction(event: PointerEvent<HTMLElement>) {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    interaction.current = null;
    const item = items.find((entry) => entry.id === active.itemId);
    if (!item || !canvas) return;
    try {
      const data = await json<{ revision: number }>("/api/canvas-items", { method: "PATCH", body: JSON.stringify(item) });
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
    } catch (error) { onMessage(error instanceof Error ? error.message : "布局保存失败"); await loadCanvas(canvas.id); }
  }

  async function updateSelected(changes: Partial<CanvasItem>) {
    if (!selectedItemId || !canvas) return;
    const item = items.find((entry) => entry.id === selectedItemId);
    if (!item) return;
    const updated = { ...item, ...changes };
    setItems((current) => current.map((entry) => entry.id === item.id ? updated : entry));
    try {
      const data = await json<{ revision: number }>("/api/canvas-items", { method: "PATCH", body: JSON.stringify(updated) });
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
    } catch (error) { onMessage(error instanceof Error ? error.message : "保存失败"); }
  }

  async function deleteSelected() {
    if (!selectedItemId || !canvas) return;
    try {
      const data = await json<{ revision: number }>(`/api/canvas-items?id=${encodeURIComponent(selectedItemId)}&canvasId=${encodeURIComponent(canvas.id)}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== selectedItemId));
      setSelectedItemId(null);
      setCanvas((current) => current ? { ...current, revision: data.revision } : current);
    } catch (error) { onMessage(error instanceof Error ? error.message : "删除失败"); }
  }

  const selected = items.find((item) => item.id === selectedItemId) ?? null;
  const topZ = Math.max(0, ...items.map((item) => item.zIndex));
  const bottomZ = Math.min(0, ...items.map((item) => item.zIndex));

  return (
    <section className="board-shell">
      <div className="board-toolbar">
        <div className="board-tabs">{canvases.map((entry) => <button type="button" className={entry.id === canvasId ? "active" : ""} key={entry.id} onClick={() => setCanvasId(entry.id)}>{entry.name}<span>{entry.itemCount}</span></button>)}<button className="board-add" type="button" onClick={() => void createCanvas()}><Plus size={14} />新建画板</button></div>
        <div className="board-actions">
          {canvas ? <><span className="sync-state"><Check size={13} />共享同步</span><button type="button" onClick={() => void renameCanvas()} aria-label="重命名画板"><Pencil size={15} /></button><button type="button" onClick={() => void deleteCanvas()} aria-label="删除画板"><Trash2 size={15} /></button></> : null}
          <div className="preview-zoom"><button type="button" onClick={() => setZoom((value) => Math.max(.35, value - .1))}><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(1.2, value + .1))}><Plus size={14} /></button></div>
        </div>
      </div>
      {loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} />载入画板…</div> : canvas ? (
        <div className="board-body">
          <aside className={`asset-tray ${assetTrayOpen ? "open" : ""}`}><button className="asset-tray-toggle" type="button" onClick={() => setAssetTrayOpen((open) => !open)}><ImagePlus size={15} />项目素材<span>{assets.length}</span></button>{assetTrayOpen ? <div className="asset-tray-list">{assets.map((asset) => <button type="button" key={asset.id} onClick={() => void addAsset(asset)}>{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <span /> }<b>{asset.name}</b><Plus size={13} /></button>)}</div> : null}</aside>
          <div className="board-viewport" onPointerDown={() => setSelectedItemId(null)}>
            <div className="board-canvas" style={{ transform: `scale(${zoom})` }}>
              <div className="board-grid" />
              {items.map((item) => <article
                key={item.id}
                className={`canvas-item ${selectedItemId === item.id ? "selected" : ""}`}
                style={{ left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.zIndex, transform: `rotate(${item.rotation}deg)` }}
                onPointerDown={(event) => startInteraction(event, item, "move")}
                onPointerMove={moveInteraction}
                onPointerUp={(event) => void endInteraction(event)}
              >
                {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.name} draggable={false} /> : <div className="canvas-item-empty">{item.name}</div>}
                <span className="canvas-caption">{item.name}</span>
                <button className="resize-handle" type="button" aria-label="调整素材大小" onPointerDown={(event) => startInteraction(event, item, "resize")} onPointerMove={moveInteraction} onPointerUp={(event) => void endInteraction(event)} />
              </article>)}
            </div>
          </div>
          {selected ? <div className="canvas-selection-tools"><button type="button" onClick={() => void updateSelected({ zIndex: topZ + 1 })} title="置于顶层"><ArrowUpToLine size={15} /></button><button type="button" onClick={() => void updateSelected({ zIndex: bottomZ - 1 })} title="置于底层"><ArrowDownToLine size={15} /></button><button type="button" onClick={() => void updateSelected({ rotation: selected.rotation >= 180 ? -165 : selected.rotation + 15 })} title="旋转 15 度"><RotateCw size={15} /></button><button className="danger" type="button" onClick={() => void deleteSelected()} title="从画板删除"><Trash2 size={15} /></button></div> : null}
        </div>
      ) : <div className="board-empty"><ImagePlus size={29} /><h3>创建第一张自由画板</h3><p>把项目素材拖动、缩放、旋转并自由排列，布局会保存到服务端。</p><button className="primary-button" type="button" onClick={() => void createCanvas()}><Plus size={15} />新建画板</button></div>}
    </section>
  );
}
