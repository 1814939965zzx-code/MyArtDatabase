import test from "node:test";
import assert from "node:assert/strict";
import { mergeFrames, mergeItems, mergePageAssets } from "../src/sync/merge.ts";

const item = (id, lastRev, x = 0) => ({ id, lastRev, x });

test("未同步的元素保留本地，不被服务器快照覆盖", () => {
  const server = [item("a", 5, 100), item("b", 5, 200)];
  const local = [item("a", 3, 111), item("b", 5, 200)];
  const merged = mergeItems(server, local, new Set(["a"]));
  assert.equal(merged.find((entry) => entry.id === "a").x, 111);
});

test("服务器版本更新时采纳服务器值", () => {
  const merged = mergeItems([item("a", 9, 900)], [item("a", 3, 111)], new Set());
  assert.equal(merged.find((entry) => entry.id === "a").x, 900);
});

test("本地版本更新时保留本地值（旧快照不回退）", () => {
  const merged = mergeItems([item("a", 2, 200)], [item("a", 7, 700)], new Set());
  assert.equal(merged.find((entry) => entry.id === "a").x, 700);
});

test("快照里没有的本地元素视为已删除", () => {
  const merged = mergeItems([item("a", 5)], [item("a", 5), item("deleted-elsewhere", 5)], new Set());
  assert.deepEqual(merged.map((entry) => entry.id), ["a"]);
});

test("待删除的键不会被快照复活", () => {
  const merged = mergeItems([item("a", 5), item("b", 5)], [item("a", 5)], new Set(["b"]));
  assert.deepEqual(merged.map((entry) => entry.id), ["a"]);
});

test("服务器新增的元素会合并进来", () => {
  const merged = mergeItems([item("a", 5), item("new", 6)], [item("a", 5)], new Set());
  assert.deepEqual(merged.map((entry) => entry.id).sort(), ["a", "new"]);
});

test("Frame：有未同步改动时保留本地，否则采纳服务器", () => {
  const server = [{ id: "f1" }];
  const local = [{ id: "f2" }];
  assert.deepEqual(mergeFrames(server, local, true), local);
  assert.deepEqual(mergeFrames(server, local, false), server);
});

test("预览坐标：未同步的坐标保留本地，其余按版本采纳", () => {
  const server = { id: "p1", assets: [{ assetId: "a1", dimensionValues: { d1: 100, d2: 200 }, valueRevs: { d1: 9, d2: 9 } }] };
  const local = { id: "p1", assets: [{ assetId: "a1", dimensionValues: { d1: 150, d2: 200 }, valueRevs: { d1: 4, d2: 9 } }] };
  const merged = mergePageAssets(server, local, (key) => key === "a1|d1");
  assert.equal(merged.assets[0].dimensionValues.d1, 150, "未同步坐标保留本地");
  assert.equal(merged.assets[0].dimensionValues.d2, 200, "非未同步坐标采纳服务器");
});

test("预览坐标：服务器版本更新时覆盖本地", () => {
  const server = { id: "p1", assets: [{ assetId: "a1", dimensionValues: { d1: 100 }, valueRevs: { d1: 9 } }] };
  const local = { id: "p1", assets: [{ assetId: "a1", dimensionValues: { d1: 500 }, valueRevs: { d1: 4 } }] };
  const merged = mergePageAssets(server, local, () => false);
  assert.equal(merged.assets[0].dimensionValues.d1, 100);
});

test("预览坐标：素材被移出 Page 后本地坐标一并删除", () => {
  const server = { id: "p1", assets: [] };
  const local = { id: "p1", assets: [{ assetId: "a1", dimensionValues: { d1: 500 } }] };
  const merged = mergePageAssets(server, local, () => false);
  assert.deepEqual(merged.assets, []);
});

test("预览坐标：本地没有这个 Page 时直接采用服务器页", () => {
  const server = { id: "p1", assets: [{ assetId: "a1", dimensionValues: { d1: 100 } }] };
  assert.equal(mergePageAssets(server, null, () => false), server);
});
