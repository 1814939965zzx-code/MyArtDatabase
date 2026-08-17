import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const tmp = await mkdtemp(path.join(os.tmpdir(), "artdb-"));
process.env.PORT = "3111";
process.env.DB_PATH = path.join(tmp, "app.db");
process.env.STORE_ROOT = path.join(tmp, "media");

await import("../server/index.js");
await new Promise((resolve) => setTimeout(resolve, 400));

const base = "http://localhost:3111";
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

// 8) 画板 + 元素
const canvas = await json(await post(`${base}/api/canvases`, { projectId: "project-visual-direction", name: "测试画板" }));
assert.ok(canvas.canvas.id);
const item = await json(await post(`${base}/api/canvas-items`, { canvasId: canvas.canvas.id, assetId: asset.id, x: 10, y: 20, width: 200, height: 150, zIndex: 1, rotation: 0 }));
assert.ok(item.item.id);

// 9) 彻底删除
const del = await fetch(`${base}/api/assets?id=${asset.id}&mode=permanent&force=true`, { method: "DELETE" });
assert.equal(del.status, 200);
assert.equal((await fetch(`${base}/api/media?id=${asset.id}&variant=thumbnail`)).status, 404, "删除后缩略图应 404");

console.log("✓ 全部通过：项目 / 工作区 / 上传 / 缩略图 / 原图 / 去重 / 改元数据 / 画板 / 删除");
process.exit(0);
