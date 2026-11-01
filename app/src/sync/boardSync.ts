/**
 * 自由画板的同步适配器：把画板元素与 Frame 接到通用 outbox 上。
 *
 * 键的划分：
 * - 元素：键 = 元素 id，载荷 = 元素对象；
 * - Frame：键固定为 "frames"，载荷 = 整份 Frame 数组（整组替换）。
 */
import { useEffect, useRef, useState } from "react";
import { newSyncId } from "./id";
import { mergeFrames as mergeFramesPure, mergeItems as mergeItemsPure } from "./merge";
import { createOutbox, type OutboxStatus } from "./outbox";

export type SyncItem = {
  id: string; canvasId: string; assetId: string | null; type: "image" | "shape" | "text";
  parentFrameId: string | null; x: number; y: number; width: number; height: number;
  zIndex: number; rotation: number; lastRev?: number;
  name?: string | null; thumbnailUrl?: string | null; payload?: unknown;
};

export type SyncFrame = { id: string; name: string; x: number; y: number; width: number; height: number };

const FRAMES_KEY = "frames";

type Payload = SyncItem | SyncFrame[];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "同步失败");
  return data;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "同步失败");
  return data;
}

export type BoardSync = ReturnType<typeof createBoardSync>;

export function createBoardSync(options: {
  canvasId: string;
  onStatus: (status: OutboxStatus, pending: number) => void;
  onApplied: (items: SyncItem[]) => void;
  onDrop: (keys: string[]) => void;
  onRevision?: (revision: number) => void;
}) {
  const outbox = createOutbox<Payload>({
    storageKey: `artdatabase:sync-draft:v1:canvas:${options.canvasId}`,
    onStatus: options.onStatus,
    onApplied: (applied) => options.onApplied(applied.filter((entry): entry is SyncItem => !Array.isArray(entry))),
    onDrop: options.onDrop,
    submit: async (batch) => {
      const frameEntry = batch.find((entry) => entry.key === FRAMES_KEY);
      const itemEntries = batch.filter((entry) => entry.key !== FRAMES_KEY);
      const applied: SyncItem[] = [];
      const failed: Array<{ id: string; reason: string }> = [];
      if (itemEntries.length) {
        const data = await postJson<{ revision: number; items: SyncItem[]; failed?: Array<{ id: string; reason: string }> }>("/api/canvas-items/batch", {
          canvasId: options.canvasId,
          ops: itemEntries.map((entry) => entry.op === "delete"
            ? { op: "delete", id: entry.key }
            : { op: entry.op, item: entry.payload as SyncItem }),
        });
        applied.push(...(data.items ?? []));
        failed.push(...(data.failed ?? []));
        if (typeof data.revision === "number") options.onRevision?.(data.revision);
      }
      if (frameEntry) {
        await patchJson("/api/canvases", { id: options.canvasId, frames: frameEntry.payload as SyncFrame[] });
      }
      return { applied, failed };
    },
  });

  return {
    ...outbox,
    markItem(item: SyncItem, insert = false) {
      outbox.set(item.id, item, insert);
    },
    markDelete(id: string) {
      outbox.remove(id);
    },
    markFrames(frames: SyncFrame[]) {
      outbox.set(FRAMES_KEY, frames);
    },
    /** 全量快照合并：本地未同步的键优先；快照里没有的非未同步元素视为已删除。 */
    mergeItems(serverItems: SyncItem[], localItems: SyncItem[]): SyncItem[] {
      return mergeItemsPure(serverItems, localItems, outbox.keys());
    },
    mergeFrames(serverFrames: SyncFrame[], localFrames: SyncFrame[]): SyncFrame[] {
      return mergeFramesPure(serverFrames, localFrames, outbox.keys().has(FRAMES_KEY));
    },
    /** 草稿恢复：返回上次没传完的本地状态，供画板先展示再补传。 */
    restoreDraft() {
      const items: SyncItem[] = [];
      const deleted: string[] = [];
      let frames: SyncFrame[] | null = null;
      for (const entry of outbox.restore()) {
        if (entry.key === FRAMES_KEY) { frames = entry.payload as SyncFrame[]; continue; }
        if (entry.op === "delete") { deleted.push(entry.key); continue; }
        items.push(entry.payload as SyncItem);
      }
      return { items, deleted, frames };
    },
    isPending: (key: string) => outbox.keys().has(key),
    hasPending: () => outbox.hasPending(),
  };
}

/** 把同步器包成 React 状态：状态点、未同步计数、提交方法。 */
export function useBoardSync(params: {
  canvasId: string;
  onApplied: (items: SyncItem[]) => void;
  onDrop: (keys: string[]) => void;
  onRevision?: (revision: number) => void;
}) {
  const [status, setStatus] = useState<OutboxStatus>("synced");
  const [pending, setPending] = useState(0);
  const syncRef = useRef<BoardSync | null>(null);
  const handlersRef = useRef({ onApplied: params.onApplied, onDrop: params.onDrop, onRevision: params.onRevision });
  handlersRef.current = { onApplied: params.onApplied, onDrop: params.onDrop, onRevision: params.onRevision };

  useEffect(() => {
    if (!params.canvasId) { syncRef.current?.dispose(); syncRef.current = null; return; }
    const sync = createBoardSync({
      canvasId: params.canvasId,
      onStatus: (next, count) => { setStatus(next); setPending(count); },
      onApplied: (items) => handlersRef.current.onApplied(items),
      onDrop: (keys) => handlersRef.current.onDrop(keys),
      onRevision: (revision) => handlersRef.current.onRevision?.(revision),
    });
    syncRef.current = sync;
    return () => { sync.dispose(); syncRef.current = null; };
  }, [params.canvasId]);

  return {
    status,
    pending,
    retry: () => syncRef.current?.retryNow(),
    flush: async () => { await syncRef.current?.flush(); },
    markItem: (item: SyncItem, insert = false) => syncRef.current?.markItem(item, insert),
    markDelete: (id: string) => syncRef.current?.markDelete(id),
    markFrames: (frames: SyncFrame[]) => syncRef.current?.markFrames(frames),
    mergeItems: (serverItems: SyncItem[], localItems: SyncItem[]) => syncRef.current
      ? syncRef.current.mergeItems(serverItems, localItems)
      : serverItems,
    mergeFrames: (serverFrames: SyncFrame[], localFrames: SyncFrame[]) => syncRef.current
      ? syncRef.current.mergeFrames(serverFrames, localFrames)
      : serverFrames,
    restoreDraft: () => syncRef.current?.restoreDraft() ?? { items: [] as SyncItem[], deleted: [] as string[], frames: null as SyncFrame[] | null },
    isPending: (key: string) => syncRef.current?.isPending(key) ?? false,
    hasPending: () => syncRef.current?.hasPending() ?? false,
  };
}

export { newSyncId };
