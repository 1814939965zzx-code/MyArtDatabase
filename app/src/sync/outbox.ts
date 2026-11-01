/**
 * 通用"待上传队列"（outbox）。
 *
 * 三条铁律的客户端实现：
 * 1. 本地只增不减：队列里的改动不会因为服务器快照而被覆盖（合并在适配器里做）。
 * 2. 未同步优先：按键去重，后写覆盖前写；同一批提交串行。
 * 3. 旧包必丢：提交串行 + 失败重试；成功才出队。
 *
 * 失败分类：
 * - not_found / not_in_page / dimension_not_in_page / already_exists：不再重试，交给 onDrop 清理本地；
 * - 其它（网络/5xx）：指数退避重试，状态转 offline。
 */

export type OutboxStatus = "synced" | "saving" | "offline";

export type OutboxOp = "insert" | "update" | "delete";

export type OutboxItem<P> = { key: string; op: OutboxOp; payload: P };

export type OutboxResult<P> = {
  applied?: P[];
  failed?: Array<{ id: string; reason: string }>;
};

type Options<P> = {
  storageKey: string;
  submit: (batch: Array<OutboxItem<P>>) => Promise<OutboxResult<P>>;
  onStatus?: (status: OutboxStatus, pendingCount: number) => void;
  onApplied?: (applied: P[]) => void;
  /** 元素/坐标已在别处删除，需要从本地清掉。 */
  onDrop?: (keys: string[]) => void;
  maxBatch?: number;
};

type Entry<P> = { item: OutboxItem<P>; seq: number };

const DROP_REASONS = new Set([
  "not_found", "not_in_page", "dimension_not_in_page", "already_exists",
  // 服务端明确拒绝、重试也不会成功的：
  "invalid_id", "invalid_type", "invalid_op", "missing_asset", "asset_not_in_project",
]);
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export type Outbox<P> = ReturnType<typeof createOutbox<P>>;

export function createOutbox<P>(options: Options<P>) {
  const pending = new Map<string, Entry<P>>();
  let status: OutboxStatus = "synced";
  let seqCounter = 0;
  let scheduleTimer: number | null = null;
  let retryTimer: number | null = null;
  let attempts = 0;
  let draining = false;
  let disposed = false;
  const maxBatch = options.maxBatch ?? 100;

  function publish() {
    options.onStatus?.(status, pending.size);
  }

  function setStatus(next: OutboxStatus, force = false) {
    if (!force && status === next) return;
    status = next;
    publish();
  }

  function schedule(delay = 150) {
    if (disposed || scheduleTimer !== null) return;
    scheduleTimer = window.setTimeout(() => {
      scheduleTimer = null;
      void drain();
    }, delay);
  }

  function scheduleRetry() {
    if (disposed || retryTimer !== null) return;
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 30000;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      void drain();
    }, delay);
  }

  function saveDraft() {
    try {
      if (!pending.size) window.localStorage.removeItem(options.storageKey);
      else window.localStorage.setItem(options.storageKey, JSON.stringify([...pending.values()].map((entry) => entry.item)));
    } catch { /* 本地草稿是尽力而为 */ }
  }

  function set(key: string, payload: P, insert = false) {
    if (disposed) return;
    const previous = pending.get(key);
    // 未确认的新元素继续沿用 insert，避免服务端 update 命中 0 行。
    const op: OutboxOp = insert || previous?.item.op === "insert" ? "insert" : "update";
    pending.set(key, { item: { key, op, payload }, seq: ++seqCounter });
    saveDraft();
    setStatus("saving");
    publish();
    schedule();
  }

  function remove(key: string) {
    if (disposed) return;
    const previous = pending.get(key);
    if (previous?.item.op === "insert") {
      pending.delete(key); // 服务器还没见过这条，直接取消
    } else {
      pending.set(key, { item: { key, op: "delete", payload: previous?.item.payload as P }, seq: ++seqCounter });
    }
    saveDraft();
    setStatus("saving");
    publish();
    schedule();
  }

  async function drain(): Promise<void> {
    if (disposed || draining) return;
    draining = true;
    try {
      while (pending.size && !disposed) {
        const batch = [...pending.values()].slice(0, maxBatch);
        let result: OutboxResult<P>;
        try {
          result = await options.submit(batch.map((entry) => entry.item));
        } catch {
          attempts += 1;
          setStatus("offline");
          publish();
          scheduleRetry();
          return;
        }
        // 只移除"发送时就是这一版"的键；发送期间又被改过的保留在队列里。
        for (const entry of batch) {
          if (pending.get(entry.item.key)?.seq === entry.seq) pending.delete(entry.item.key);
        }
        const dropped: string[] = [];
        for (const failure of result.failed ?? []) {
          if (!DROP_REASONS.has(failure.reason)) continue;
          pending.delete(failure.id);
          dropped.push(failure.id);
        }
        if (result.applied?.length) options.onApplied?.(result.applied);
        if (dropped.length) options.onDrop?.(dropped);
        attempts = 0;
        saveDraft();
        setStatus(pending.size ? "saving" : "synced");
      }
      setStatus("synced");
    } finally {
      draining = false;
    }
  }

  function restore(): Array<OutboxItem<P>> {
    try {
      const raw = window.localStorage.getItem(options.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<OutboxItem<P>>;
      if (!Array.isArray(parsed)) return [];
      for (const item of parsed) {
        if (!item || typeof item.key !== "string") continue;
        if (item.op !== "insert" && item.op !== "update" && item.op !== "delete") continue;
        pending.set(item.key, { item, seq: ++seqCounter });
      }
      if (pending.size) setStatus("saving");
      return [...pending.values()].map((entry) => entry.item);
    } catch { return []; }
  }

  function dispose() {
    disposed = true;
    window.removeEventListener("online", onOnline);
    if (scheduleTimer !== null) window.clearTimeout(scheduleTimer);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    scheduleTimer = null;
    retryTimer = null;
  }

  function retryNow() {
    attempts = 0;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    retryTimer = null;
    void drain();
  }

  /** 浏览器恢复网络时立即补传，不用等退避计时。 */
  const onOnline = () => retryNow();
  window.addEventListener("online", onOnline);

  publish();

  return {
    set,
    remove,
    drain,
    restore,
    dispose,
    retryNow,
    saveDraft,
    hasPending: () => pending.size > 0,
    pendingCount: () => pending.size,
    status: () => status,
    keys: () => new Set([...pending.keys()]),
    /** 立刻提交并等待完成（切换画板、撤销、卸载前）。 */
    flush: async () => { await drain(); },
  };
}
