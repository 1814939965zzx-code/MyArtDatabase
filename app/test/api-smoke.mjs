import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const tmp = await mkdtemp(path.join(os.tmpdir(), "artdb-"));
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const testPort = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
process.env.PORT = String(testPort);
process.env.DB_PATH = path.join(tmp, "app.db");
process.env.STORE_ROOT = path.join(tmp, "media");
// 冒烟测试依赖示例数据作为基线；生产环境默认不再自动写入示例数据。
process.env.SEED_DEMO = "1";

await import("../server/index.js");
await new Promise((resolve) => setTimeout(resolve, 400));

const base = `http://127.0.0.1:${testPort}`;
const json = (r) => r.json();
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// 1) 项目列表（含种子数据）
const projects = await json(await fetch(`${base}/api/projects`));
assert.ok(projects.projects.length >= 1, "应有种子项目");

// 2) 工作区
const ws = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.equal(ws.project.name, "机器人视觉方向");
assert.ok(ws.assets.length >= 8, "应有种子素材");
assert.equal(ws.dimensions.length, 2, "应有 2 个维度");

// 3) 上传
const buffer = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
const form = new FormData();
form.set("file", new File([buffer], "smoke.png", { type: "image/png" }));
form.set("projectId", "project-visual-direction");
form.set("name", "冒烟测试图");
form.set("tags", "测试");
form.set("dimensionValues", JSON.stringify({ "dimension-form": 300, "dimension-temperature": 700 }));
const up = await fetch(`${base}/api/uploads`, { method: "POST", body: form });
assert.equal(up.status, 201, `上传应 201，实际 ${up.status}`);
const { asset } = await up.json();
assert.equal(asset.sha256.length, 64);

// 4) 读缩略图
const thumb = await fetch(`${base}/api/media?id=${asset.id}&variant=thumbnail`);
assert.equal(thumb.status, 200, "缩略图应 200");
assert.match(thumb.headers.get("content-type") || "", /image\/webp/);
assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).format, "webp");

// 5) 读原图
const orig = await fetch(`${base}/api/media?id=${asset.id}`);
assert.equal(orig.status, 200);
assert.equal((await orig.arrayBuffer()).byteLength, buffer.length);

// 6) 重复检测
const check = await json(await post(`${base}/api/uploads/check`, { sha256: asset.sha256, projectId: "project-visual-direction" }));
assert.ok(check.duplicates.length >= 1, "重复检测应命中");

// 7) 更新素材元数据
const patch = await fetch(`${base}/api/assets`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: asset.id, name: "冒烟测试图-改", tags: "测试,改", description: "x", notes: "", sourceUrl: "" }) });
assert.equal(patch.status, 200);

const deleteTag = await fetch(`${base}/api/assets`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: asset.id, deleteTag: "改" }) });
assert.equal(deleteTag.status, 200);
const wsAfterTagDelete = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.deepEqual(wsAfterTagDelete.assets.find((item) => item.id === asset.id).tags, ["测试"]);

// 8) 批量更新维度两端名称
const dimensionPatch = await fetch(`${base}/api/dimensions`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "project-visual-direction", dimensions: [{ id: "dimension-form", leftLabel: "极度抽象", rightLabel: "极度具象" }] }) });
assert.equal(dimensionPatch.status, 200);
const wsAfterDimensionPatch = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.deepEqual(
  wsAfterDimensionPatch.dimensions.find((item) => item.id === "dimension-form"),
  { id: "dimension-form", projectId: "project-visual-direction", leftLabel: "极度抽象", rightLabel: "极度具象", sortOrder: 0 },
);

// 9) 画板 + 元素
const canvas = await json(await post(`${base}/api/canvases`, { projectId: "project-visual-direction", name: "测试画板" }));
assert.ok(canvas.canvas.id);
const item = await json(await post(`${base}/api/canvas-items`, { canvasId: canvas.canvas.id, assetId: asset.id, x: 10, y: 20, width: 200, height: 150, zIndex: 1, rotation: 0 }));
assert.ok(item.item.id);

// 10) 软删除 → 回收站列出 → 恢复
const softDel = await fetch(`${base}/api/assets?id=${asset.id}`, { method: "DELETE" });
assert.equal(softDel.status, 200);
let trash = await json(await fetch(`${base}/api/trash`));
const trashed = trash.assets.find((item) => item.id === asset.id);
assert.ok(trashed, "回收站应包含软删除素材");
assert.ok(trashed.projects.length >= 1, "回收站素材应保留项目引用");
assert.ok(trashed.deletedAt, "回收站素材应有删除时间");

// 11) 恢复后回到项目
const restore = await fetch(`${base}/api/assets/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: asset.id }) });
assert.equal(restore.status, 200);
trash = await json(await fetch(`${base}/api/trash`));
assert.ok(!trash.assets.some((item) => item.id === asset.id), "恢复后回收站不应包含该素材");
const wsAfterRestore = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.ok(wsAfterRestore.assets.some((item) => item.id === asset.id), "恢复后素材应回到项目");

// 12) 再次软删除后彻底删除
const softDel2 = await fetch(`${base}/api/assets?id=${asset.id}`, { method: "DELETE" });
assert.equal(softDel2.status, 200);
const del = await fetch(`${base}/api/assets?id=${asset.id}&mode=permanent&force=true`, { method: "DELETE" });
assert.equal(del.status, 200);
trash = await json(await fetch(`${base}/api/trash`));
assert.ok(!trash.assets.some((item) => item.id === asset.id), "彻底删除后回收站不应包含该素材");
assert.equal((await fetch(`${base}/api/media?id=${asset.id}&variant=thumbnail`)).status, 404, "删除后缩略图应 404");

console.log("✓ 全部通过：项目 / 工作区 / 上传 / 缩略图 / 原图 / 去重 / 改元数据 / 改维度名称 / 画板 / 回收站(软删-列出-恢复-彻底删)");
process.exit(0);
