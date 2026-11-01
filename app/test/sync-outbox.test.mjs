import test from "node:test";
import assert from "node:assert/strict";

// outbox 只依赖 window 上的定时器与 localStorage，用最小桩在 Node 里跑。
const storage = new Map();
globalThis.window = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: (key) => { storage.delete(key); },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { createOutbox } = await import("../src/sync/outbox.ts");

function makeOutbox(submit, extra = {}) {
  return createOutbox({ storageKey: extra.storageKey ?? "draft", submit, maxBatch: 100 });
}

test("同键后写覆盖前写，一批发出去", async () => {
  const batches = [];
  const box = makeOutbox(async (batch) => { batches.push(batch); return {}; });
  box.set("a", { x: 1 });
  box.set("a", { x: 2 });
  box.set("b", { x: 3 });
  await box.flush();
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].map((entry) => [entry.key, entry.payload.x, entry.op]), [["a", 2, "update"], ["b", 3, "update"]]);
  assert.equal(box.pendingCount(), 0);
  assert.equal(box.status(), "synced");
  box.dispose();
});

test("未确认的新元素继续沿用 insert", async () => {
  const batches = [];
  const box = makeOutbox(async (batch) => { batches.push(batch); return {}; });
  box.set("a", { x: 1 }, true);
  box.set("a", { x: 5 });
  await box.flush();
  assert.equal(batches[0][0].op, "insert");
  box.dispose();
});

test("新建后未确认就被删：不发 delete", async () => {
  const batches = [];
  const box = makeOutbox(async (batch) => { batches.push(batch); return {}; });
  box.set("a", { x: 1 }, true);
  box.remove("a");
  await box.flush();
  assert.equal(batches.length, 0);
  assert.equal(box.pendingCount(), 0);
  box.dispose();
});

test("失败保留队列并转为 offline，恢复后补传", async () => {
  let fail = true;
  const batches = [];
  const box = makeOutbox(async (batch) => {
    if (fail) throw new Error("network");
    batches.push(batch);
    return {};
  });
  box.set("a", { x: 1 });
  await box.flush();
  assert.equal(box.status(), "offline");
  assert.equal(box.pendingCount(), 1);
  fail = false;
  await box.flush();
  assert.equal(batches.length, 1);
  assert.equal(box.pendingCount(), 0);
  assert.equal(box.status(), "synced");
  box.dispose();
});

test("not_found 视为已处理：清队列并通知本地清理", async () => {
  const dropped = [];
  const box = createOutbox({
    storageKey: "draft-drop",
    submit: async () => ({ failed: [{ id: "a", reason: "not_found" }] }),
    onDrop: (keys) => dropped.push(...keys),
  });
  box.set("a", { x: 1 });
  await box.flush();
  assert.equal(box.pendingCount(), 0);
  assert.deepEqual(dropped, ["a"]);
  box.dispose();
});

test("草稿可恢复：新实例 load 出上次没传完的改动", async () => {
  const first = makeOutbox(async () => ({}), { storageKey: "draft-restore" });
  first.set("a", { x: 7 }, true);
  first.dispose(); // 模拟页面关闭：只留草稿

  const restored = [];
  const second = createOutbox({
    storageKey: "draft-restore",
    submit: async (batch) => { restored.push(...batch); return {}; },
  });
  const items = second.restore();
  assert.deepEqual(items.map((entry) => [entry.key, entry.op]), [["a", "insert"]]);
  await second.flush();
  assert.equal(restored.length, 1);
  assert.equal(second.pendingCount(), 0);
  second.dispose();
});
