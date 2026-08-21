import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDatabase } from "../server/db.js";
import { createLocalDiskStore } from "../server/storage.js";

const tmp = await mkdtemp(path.join(os.tmpdir(), "artdb-"));
const legacyDbPath = path.join(tmp, "legacy.db");
const legacyDb = new DatabaseSync(legacyDbPath);
legacyDb.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE projects (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, file_name TEXT NOT NULL, thumbnail_url TEXT, storage_key TEXT, thumbnail_key TEXT, sha256 TEXT, file_size INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, mime_type TEXT NOT NULL DEFAULT 'image/jpeg', tags TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', deleted_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE canvases (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE canvas_items (id TEXT PRIMARY KEY NOT NULL, canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, x INTEGER NOT NULL, y INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, z_index INTEGER NOT NULL DEFAULT 0, rotation INTEGER NOT NULL DEFAULT 0, UNIQUE(canvas_id, asset_id));
  INSERT INTO projects (id, name) VALUES ('legacy-project', '旧项目');
  INSERT INTO assets (id, name, file_name) VALUES ('legacy-asset', '旧素材', 'legacy.png');
  INSERT INTO canvases (id, project_id, name) VALUES ('legacy-canvas', 'legacy-project', '旧画板');
  INSERT INTO canvas_items (id, canvas_id, asset_id, x, y, width, height) VALUES ('legacy-item', 'legacy-canvas', 'legacy-asset', 11, 22, 333, 222);
`);
legacyDb.close();
const migratedDb = openDatabase(legacyDbPath);
assert.deepEqual({ ...migratedDb.prepare("SELECT id, x, y, width, height FROM canvas_items WHERE id = 'legacy-item'").get() }, { id: "legacy-item", x: 11, y: 22, width: 333, height: 222 }, "迁移必须保留既有画板元素");
migratedDb.prepare("INSERT INTO canvas_items (id, canvas_id, asset_id, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)").run("legacy-item-copy", "legacy-canvas", "legacy-asset", 44, 55, 333, 222);
assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM canvas_items WHERE canvas_id = 'legacy-canvas' AND asset_id = 'legacy-asset'").get().count, 2, "迁移后同一素材应允许重复放置");
migratedDb.close();
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
const rawGet = (requestPath) => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: "127.0.0.1", port: testPort, path: requestPath, method: "GET" }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
  });
  req.on("error", reject);
  req.end();
});

// 0) 安全边界：编码路径穿越不得读取系统文件或导致进程崩溃
const traversal = await rawGet("/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd");
assert.equal(traversal.status, 400, "路径穿越应返回 400");
assert.ok(!traversal.body.includes("root:"), "不得泄露系统文件内容");
assert.equal((await fetch(`${base}/api/projects`)).status, 200, "恶意请求后服务应继续运行");

const guardedStore = createLocalDiskStore({ root: path.join(tmp, "guarded-media") });
await assert.rejects(() => guardedStore.open("../../../../etc/passwd", "original"), /非法存储键/);
await assert.rejects(() => guardedStore.remove("../../../../etc/passwd"), /非法存储键/);

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
const patch = await fetch(`${base}/api/assets`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: asset.id, name: "冒烟测试图-改", tags: "测试,改", description: "x", notes: "保留备注", sourceUrl: "https://example.com/source" }) });
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
const repeatedItem = await json(await post(`${base}/api/canvas-items`, { canvasId: canvas.canvas.id, assetId: asset.id, x: 40, y: 50, width: 200, height: 150, zIndex: 2, rotation: 0 }));
assert.ok(repeatedItem.item.id);
assert.notEqual(repeatedItem.item.id, item.item.id, "同一素材的每次放置必须拥有独立实例 ID");
const repeatedCanvas = await json(await fetch(`${base}/api/canvas?canvasId=${canvas.canvas.id}`));
assert.equal(repeatedCanvas.items.filter((entry) => entry.assetId === asset.id).length, 2, "同一素材应能在 Page 内重复放置");
assert.equal((await fetch(`${base}/api/canvas-items?id=${repeatedItem.item.id}&canvasId=${canvas.canvas.id}`, { method: "DELETE" })).status, 200, "应能删除单个画板实例");
const canvasAfterInstanceDelete = await json(await fetch(`${base}/api/canvas?canvasId=${canvas.canvas.id}`));
assert.equal(canvasAfterInstanceDelete.items.filter((entry) => entry.assetId === asset.id).length, 1, "删除单个实例不得影响同素材的其他画板实例");
assert.ok((await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`))).assets.some((entry) => entry.id === asset.id), "删除画板实例不得删除项目素材");

// 10) 替换图片：只更新文件字段，保留素材 ID、Metadata、项目引用、维度值和画板元素
const beforeReplaceWorkspace = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
const beforeReplaceAsset = beforeReplaceWorkspace.assets.find((entry) => entry.id === asset.id);
const beforeReplaceLibrary = await json(await fetch(`${base}/api/library`));
const beforeReplaceLibraryAsset = beforeReplaceLibrary.assets.find((entry) => entry.id === asset.id);
const replacementBuffer = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 210, g: 60, b: 40 } } }).webp().toBuffer();
const replacementForm = new FormData();
replacementForm.set("id", asset.id);
replacementForm.set("file", new File([replacementBuffer], "replacement.webp", { type: "image/webp" }));
const replacement = await fetch(`${base}/api/assets/image`, { method: "POST", body: replacementForm });
assert.equal(replacement.status, 200, `替换图片应 200，实际 ${replacement.status}`);

const afterReplaceWorkspace = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
const afterReplaceAsset = afterReplaceWorkspace.assets.find((entry) => entry.id === asset.id);
assert.equal(afterReplaceAsset.id, beforeReplaceAsset.id, "替换后素材 ID 必须不变");
assert.equal(afterReplaceAsset.name, beforeReplaceAsset.name, "替换后素材名称必须不变");
assert.deepEqual(afterReplaceAsset.tags, beforeReplaceAsset.tags, "替换后标签必须不变");
assert.equal(afterReplaceAsset.description, beforeReplaceAsset.description, "替换后描述必须不变");
assert.equal(afterReplaceAsset.notes, beforeReplaceAsset.notes, "替换后备注必须不变");
assert.equal(afterReplaceAsset.sourceUrl, beforeReplaceAsset.sourceUrl, "替换后来源链接必须不变");
assert.equal(afterReplaceAsset.createdAt, beforeReplaceAsset.createdAt, "替换后创建时间必须不变");
assert.deepEqual(afterReplaceAsset.dimensionValues, beforeReplaceAsset.dimensionValues, "替换后维度值必须不变");
assert.equal(afterReplaceAsset.fileName, "replacement.webp");
assert.equal(afterReplaceAsset.width, 320);
assert.equal(afterReplaceAsset.height, 240);
assert.equal(afterReplaceAsset.mimeType, "image/webp");
assert.notEqual(afterReplaceAsset.thumbnailUrl, beforeReplaceAsset.thumbnailUrl, "替换后媒体版本 URL 必须更新以避开旧缓存");

const afterReplaceLibrary = await json(await fetch(`${base}/api/library`));
const afterReplaceLibraryAsset = afterReplaceLibrary.assets.find((entry) => entry.id === asset.id);
assert.deepEqual(afterReplaceLibraryAsset.projects, beforeReplaceLibraryAsset.projects, "替换后项目引用必须不变");
const canvasAfterReplace = await json(await fetch(`${base}/api/canvas?canvasId=${canvas.canvas.id}`));
assert.ok(canvasAfterReplace.items.some((entry) => entry.id === item.item.id && entry.assetId === asset.id), "替换后画板元素必须保留");
assert.match(canvasAfterReplace.items.find((entry) => entry.assetId === asset.id).thumbnailUrl, /[?&]v=/, "画板缩略图应包含新文件版本");

const replacedOriginal = await fetch(`${base}${afterReplaceAsset.originalUrl}`);
assert.equal(replacedOriginal.status, 200);
assert.equal((await sharp(Buffer.from(await replacedOriginal.arrayBuffer())).metadata()).format, "webp");
assert.deepEqual(await readdir(path.join(tmp, "media", "blobs")), await readdir(path.join(tmp, "media", "thumbs")), "原图和缩略图存储键应一一对应");
assert.equal((await readdir(path.join(tmp, "media", "blobs"))).length, 1, "替换成功后应清理旧媒体文件，不得影响其他素材");

const invalidReplacementForm = new FormData();
invalidReplacementForm.set("id", asset.id);
invalidReplacementForm.set("file", new File(["not an image"], "bad.txt", { type: "text/plain" }));
assert.equal((await fetch(`${base}/api/assets/image`, { method: "POST", body: invalidReplacementForm })).status, 400, "非法替换文件应被拒绝");

const corruptReplacementForm = new FormData();
corruptReplacementForm.set("id", asset.id);
corruptReplacementForm.set("file", new File(["not really a png"], "corrupt.png", { type: "image/png" }));
assert.equal((await fetch(`${base}/api/assets/image`, { method: "POST", body: corruptReplacementForm })).status, 500, "图片处理失败时替换应失败");
const originalAfterRejectedReplacement = await fetch(`${base}${afterReplaceAsset.originalUrl}`);
assert.equal(originalAfterRejectedReplacement.status, 200, "替换失败后当前图片必须仍然可读");
assert.equal((await originalAfterRejectedReplacement.arrayBuffer()).byteLength, replacementBuffer.length, "替换失败不得改动当前图片");
assert.equal((await readdir(path.join(tmp, "media", "blobs"))).length, 1, "替换失败不得留下新文件或删除当前文件");

// 11) 软删除 → 回收站列出 → 恢复
const softDel = await fetch(`${base}/api/assets?id=${asset.id}`, { method: "DELETE" });
assert.equal(softDel.status, 200);
let trash = await json(await fetch(`${base}/api/trash`));
const trashed = trash.assets.find((item) => item.id === asset.id);
assert.ok(trashed, "回收站应包含软删除素材");
assert.ok(trashed.projects.length >= 1, "回收站素材应保留项目引用");
assert.ok(trashed.deletedAt, "回收站素材应有删除时间");

// 12) 恢复后回到项目
const restore = await fetch(`${base}/api/assets/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: asset.id }) });
assert.equal(restore.status, 200);
trash = await json(await fetch(`${base}/api/trash`));
assert.ok(!trash.assets.some((item) => item.id === asset.id), "恢复后回收站不应包含该素材");
const wsAfterRestore = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.ok(wsAfterRestore.assets.some((item) => item.id === asset.id), "恢复后素材应回到项目");

// 13) 再次软删除后彻底删除
const softDel2 = await fetch(`${base}/api/assets?id=${asset.id}`, { method: "DELETE" });
assert.equal(softDel2.status, 200);
const del = await fetch(`${base}/api/assets?id=${asset.id}&mode=permanent&force=true`, { method: "DELETE" });
assert.equal(del.status, 200);
trash = await json(await fetch(`${base}/api/trash`));
assert.ok(!trash.assets.some((item) => item.id === asset.id), "彻底删除后回收站不应包含该素材");
assert.equal((await fetch(`${base}/api/media?id=${asset.id}&variant=thumbnail`)).status, 404, "删除后缩略图应 404");

console.log("✓ 全部通过：项目 / 工作区 / 上传 / 缩略图 / 原图 / 去重 / 改元数据 / 改维度名称 / 画板迁移与重复实例 / 安全替换图片 / 回收站(软删-列出-恢复-彻底删)");
process.exit(0);
