/**
 * 合并纯函数（不依赖 React / DOM，可单测）。
 *
 * 规则统一为三条：
 * 1. 未同步的键一律保留本地（含待删除的键）；
 * 2. 非未同步的键按版本采纳服务器值（本地没有则直接采纳）；
 * 3. 服务器全量快照里没有的本地元素 = 已删除。
 */

export type MergeItem = {
  id: string;
  lastRev?: number;
  [key: string]: unknown;
};

export function mergeItems<T extends MergeItem>(serverItems: T[], localItems: T[], pendingKeys: Set<string>): T[] {
  const serverById = new Map(serverItems.map((item) => [item.id, item]));
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const local of localItems) {
    if (pendingKeys.has(local.id)) { merged.push(local); seen.add(local.id); continue; }
    const server = serverById.get(local.id);
    if (!server) continue; // 快照里没有 = 别处删了
    merged.push((server.lastRev ?? 0) > (local.lastRev ?? 0) ? server : local);
    seen.add(local.id);
  }
  for (const server of serverItems) {
    if (seen.has(server.id) || pendingKeys.has(server.id)) continue;
    merged.push(server);
  }
  return merged;
}

/** Frame 是整组替换：本地没有未同步的 Frame 改动时以服务端为准。 */
export function mergeFrames<T>(serverFrames: T[], localFrames: T[], framesPending: boolean): T[] {
  return framesPending ? localFrames : serverFrames;
}

export type MergeAsset = {
  assetId: string;
  dimensionValues: Record<string, number>;
  valueRevs?: Record<string, number>;
};

export type MergePage = {
  id: string;
  assets: MergeAsset[];
  [key: string]: unknown;
};

/**
 * 预览页合并：未同步坐标保留本地，其余按 lastRev 采纳；素材被移出 Page 则整条删除。
 * keyOf 由调用方提供，形如 `素材id|维度id`。
 */
export function mergePageAssets<T extends MergePage>(server: T, local: MergePage | null, isPending: (key: string) => boolean): T {
  if (!local || local.id !== server.id) return server;
  const assets = server.assets.map((serverAsset) => {
    const localAsset = local.assets.find((entry) => entry.assetId === serverAsset.assetId);
    const values: Record<string, number> = {};
    const revs: Record<string, number> = {};
    for (const [dimensionId, serverValue] of Object.entries(serverAsset.dimensionValues)) {
      const key = `${serverAsset.assetId}|${dimensionId}`;
      const localValue = localAsset?.dimensionValues?.[dimensionId];
      const localRev = localAsset?.valueRevs?.[dimensionId] ?? 0;
      const serverRev = serverAsset.valueRevs?.[dimensionId] ?? 0;
      if (isPending(key) && localValue !== undefined) { values[dimensionId] = localValue; revs[dimensionId] = localRev; }
      else if (localValue === undefined || serverRev > localRev) { values[dimensionId] = serverValue; revs[dimensionId] = serverRev; }
      else { values[dimensionId] = localValue; revs[dimensionId] = localRev; }
    }
    return { ...serverAsset, dimensionValues: values, valueRevs: revs };
  });
  return { ...server, assets };
}
