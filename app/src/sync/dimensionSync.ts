/**
 * 维度预览的同步适配器：键 = "素材id|维度id"，载荷 = 单个坐标值。
 * 提交时按素材分组为一次 PATCH /api/preview-values；合并时按坐标的 lastRev 比较。
 */
import { useEffect, useRef, useState } from "react";
import { mergePageAssets } from "./merge";
import { createOutbox, type OutboxStatus } from "./outbox";

export type PreviewValue = { assetId: string; dimensionId: string; value: number; lastRev?: number };

export type PreviewPageLike = {
  id: string; projectId: string; name: string; selectedIds: string[];
  dimensions: unknown[];
  assets: Array<{ assetId: string; dimensionValues: Record<string, number>; valueRevs?: Record<string, number> }>;
  revision?: number;
};

export const dimensionKey = (assetId: string, dimensionId: string) => `${assetId}|${dimensionId}`;

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "同步失败");
  return data;
}

export type DimensionSync = ReturnType<typeof createDimensionSync>;

export function createDimensionSync(options: {
  projectId: string;
  pageId: string;
  onStatus: (status: OutboxStatus, pending: number) => void;
  onApplied: (applied: PreviewValue[]) => void;
  onDrop: (keys: string[]) => void;
  onRevision?: (revision: number) => void;
}) {
  const outbox = createOutbox<PreviewValue>({
    storageKey: `artdatabase:sync-draft:v1:preview:${options.pageId}`,
    onStatus: options.onStatus,
    onApplied: options.onApplied,
    onDrop: options.onDrop,
    submit: async (batch) => {
      const byAsset = new Map<string, Record<string, number>>();
      for (const entry of batch) {
        if (entry.op === "delete") continue;
        const payload = entry.payload;
        const values = byAsset.get(payload.assetId) ?? {};
        values[payload.dimensionId] = payload.value;
        byAsset.set(payload.assetId, values);
      }
      if (!byAsset.size) return {};
      const data = await patchJson<{
        revision: number;
        updates?: Array<{ assetId: string; values: Array<{ dimensionId: string; value: number; lastRev: number }> }>;
        failed?: Array<{ assetId: string; reason: string }>;
      }>("/api/preview-values", {
        projectId: options.projectId,
        pageId: options.pageId,
        updates: [...byAsset.entries()].map(([assetId, values]) => ({ assetId, values })),
      });
      if (typeof data.revision === "number") options.onRevision?.(data.revision);
      const applied: PreviewValue[] = [];
      for (const update of data.updates ?? []) {
        for (const value of update.values ?? []) applied.push({ assetId: update.assetId, dimensionId: value.dimensionId, value: value.value, lastRev: value.lastRev });
      }
      // 服务端按素材返回失败：展开成这批里该素材的每个键，交给 outbox 清理本地。
      const failed: Array<{ id: string; reason: string }> = [];
      for (const failure of data.failed ?? []) {
        for (const entry of batch) {
          if (entry.payload.assetId !== failure.assetId) continue;
          failed.push({ id: entry.key, reason: failure.reason });
        }
      }
      return { applied, failed };
    },
  });

  return {
    ...outbox,
    setValue(assetId: string, dimensionId: string, value: number) {
      outbox.set(dimensionKey(assetId, dimensionId), { assetId, dimensionId, value });
    },
    isPending: (key: string) => outbox.keys().has(key),
    hasPending: () => outbox.hasPending(),
  };
}

/** 合并服务器预览页：未同步坐标保留本地，其余按 lastRev 采纳；素材/维度被移除则本地一并删除。 */
export function mergePreviewPage<T extends PreviewPageLike>(server: T, local: PreviewPageLike | null, isPending: (key: string) => boolean): T {
  return mergePageAssets(server, local, isPending);
}

export function useDimensionSync(params: {
  projectId: string;
  pageId: string;
  onApplied: (applied: PreviewValue[]) => void;
  onDrop: (keys: string[]) => void;
  onRevision?: (revision: number) => void;
}) {
  const [status, setStatus] = useState<OutboxStatus>("synced");
  const [pending, setPending] = useState(0);
  const syncRef = useRef<DimensionSync | null>(null);
  const handlersRef = useRef({ onApplied: params.onApplied, onDrop: params.onDrop, onRevision: params.onRevision });
  handlersRef.current = { onApplied: params.onApplied, onDrop: params.onDrop, onRevision: params.onRevision };

  useEffect(() => {
    if (!params.projectId || !params.pageId) { syncRef.current?.dispose(); syncRef.current = null; return; }
    const sync = createDimensionSync({
      projectId: params.projectId,
      pageId: params.pageId,
      onStatus: (next, count) => { setStatus(next); setPending(count); },
      onApplied: (applied) => handlersRef.current.onApplied(applied),
      onDrop: (keys) => handlersRef.current.onDrop(keys),
      onRevision: (revision) => handlersRef.current.onRevision?.(revision),
    });
    syncRef.current = sync;
    return () => { sync.dispose(); syncRef.current = null; };
  }, [params.projectId, params.pageId]);

  return {
    status,
    pending,
    retry: () => syncRef.current?.retryNow(),
    flush: async () => { await syncRef.current?.flush(); },
    setValue: (assetId: string, dimensionId: string, value: number) => syncRef.current?.setValue(assetId, dimensionId, value),
    isPending: (key: string) => syncRef.current?.isPending(key) ?? false,
    hasPending: () => syncRef.current?.hasPending() ?? false,
    restoreDraft: (): PreviewValue[] => (syncRef.current?.restore() ?? []).map((entry) => entry.payload),
  };
}
