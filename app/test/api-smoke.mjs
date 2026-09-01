import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { openDatabase } from "../server/db.js";
import { createLocalDiskStore } from "../server/storage.js";
import { getAssetTagNames, listTags } from "../server/tags.js";

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

// AI 服务 mock：按 system prompt 区分“看图轮”与“裁决轮”；裁决轮遇到“机械臂”返回 500 以验证降级。
let visionCalls = 0;
const aiMock = createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "qwen-vl-plus" }, { id: "smoke-model" }] }));
    return;
  }
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end('{"error":"bad json"}');
      return;
    }
    const system = payload?.messages?.[0]?.content ?? "";
    const respond = (content) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    };
    if (!system.includes("图片素材标签助手") && !system.includes("标签词库管理员")) {
      respond("pong"); // 配置页“测试连接”的轻量 ping
      return;
    }
    if (system.includes("标签词库管理员")) {
      const items = JSON.parse(payload.messages.at(-1).content).items;
      if (items.some((item) => item.tag === "机械臂")) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"error":"mock judgment failure"}');
        return;
      }
      respond(JSON.stringify(items.map((item) => item.tag === "暖色系" && item.candidates.includes("暖色")
        ? { tag: item.tag, decision: "reuse", reusedTag: "暖色" }
        : { tag: item.tag, decision: "new", reusedTag: null })));
      return;
    }
    visionCalls += 1;
    respond(visionCalls === 1 ? '["建筑","测试词语","暖色系"]' : '["机械臂"]');
  });
});
await new Promise((resolve, reject) => {
  aiMock.once("error", reject);
  aiMock.listen(0, "127.0.0.1", resolve);
});
const aiMockPort = aiMock.address().port;
// AI 配置走文件回退路径（不设环境变量），端到端验证读取链路
// AI 配置走“跟随数据库目录”的默认路径（DB_PATH=tmp/app.db → tmp/ai-config.json），端到端验证默认解析逻辑
await writeFile(path.join(tmp, "ai-config.json"), JSON.stringify({
  baseUrl: `http://127.0.0.1:${aiMockPort}`,
  apiKey: "sk-smoke-1234",
  model: "smoke-model",
}), "utf8");

await import("../server/index.js");
await new Promise((resolve) => setTimeout(resolve, 400));

const base = `http://127.0.0.1:${testPort}`;
const json = (r) => r.json();
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const rawGet = (requestPath) => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: "127.0.0.1", port: testPort, path: requestPath, method: "GET", headers: sessionCookie ? { cookie: sessionCookie } : {} }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
  });
  req.on("error", reject);
  req.end();
});

// ---- 账号系统：未登录拦截 / 健康检查 / 首次初始化 ----
let sessionCookie = "";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  if (sessionCookie) headers.set("cookie", sessionCookie);
  const response = await originalFetch(input, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0];
  return response;
};

assert.equal((await fetch(`${base}/api/projects`)).status, 401, "未登录访问业务接口应 401");
assert.equal((await fetch(`${base}/api/media?id=asset-01`)).status, 401, "未登录访问媒体应 401");
assert.deepEqual(await json(await fetch(`${base}/api/health`)), { ok: true }, "健康检查无需登录");
const authStatusBefore = await json(await fetch(`${base}/api/auth/status`));
assert.equal(authStatusBefore.needsSetup, true, "无用户时应提示首次初始化");
assert.equal(authStatusBefore.user, null);

const setupRes = await post(`${base}/api/auth/setup`, { username: "admin", displayName: "管理员", password: "admin1234" });
assert.equal(setupRes.status, 201, "首次初始化应创建管理员并登录");
assert.ok(sessionCookie, "初始化后应下发会话 cookie");
const setupUser = (await setupRes.json()).user;
assert.equal(setupUser.role, "admin");
assert.equal((await post(`${base}/api/auth/setup`, { username: "x", password: "12345678" })).status, 409, "重复初始化应拒绝");

// 存量种子素材应整体挂到管理员名下
{
  const checkDb = new DatabaseSync(path.join(tmp, "app.db"));
  const count = checkDb.prepare("SELECT COUNT(*) AS count FROM assets WHERE created_by IS NULL").get().count;
  assert.equal(count, 0, "初始化后存量素材应全部归属默认管理员");
  checkDb.close();
}

// 错误密码登录：应 401 并记录失败审计
const badLogin = await post(`${base}/api/auth/login`, { username: "admin", password: "wrong-password" });
assert.equal(badLogin.status, 401, "密码错误应 401");
const goodLogin = await post(`${base}/api/auth/login`, { username: "admin", password: "admin1234", remember: true });
assert.equal(goodLogin.status, 200, "正确密码应登录成功");

// 0) 安全边界：编码路径穿越不得读取系统文件或导致进程崩溃
const traversal = await rawGet("/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd");
assert.equal(traversal.status, 400, "路径穿越应返回 400");
assert.ok(!traversal.body.includes("root:"), "不得泄露系统文件内容");
assert.equal((await fetch(`${base}/api/projects`)).status, 200, "恶意请求后服务应继续运行");

const guardedStore = createLocalDiskStore({ root: path.join(tmp, "guarded-media") });
await assert.rejects(() => guardedStore.open("../../../../etc/passwd", "original"), /非法存储键/);
await assert.rejects(() => guardedStore.remove("../../../../etc/passwd"), /非法存储键/);

// 0.5) 旧库迁移：assets.tags 字符串 → tags/asset_tags，删除旧列，重开幂等（独立于画板迁移测试的数据库文件）
const tagsLegacyPath = path.join(tmp, "tags-legacy.db");
{
  const legacy = new DatabaseSync(tagsLegacyPath);
  legacy.exec(`CREATE TABLE assets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '',
    thumbnail_url TEXT, storage_key TEXT, thumbnail_key TEXT, sha256 TEXT,
    file_size INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg', tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
    deleted_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  legacy.prepare("INSERT INTO assets (id, name, file_name, tags) VALUES (?, ?, ?, ?)").run("legacy-1", "旧素材一", "a.jpg", "灰调, 暖色");
  legacy.prepare("INSERT INTO assets (id, name, file_name, tags) VALUES (?, ?, ?, ?)").run("legacy-2", "旧素材二", "b.jpg", "灰调,新标签");
  legacy.close();
}
let tagsLegacyDb = openDatabase(tagsLegacyPath);
assert.deepEqual(
  listTags(tagsLegacyDb).map((tag) => tag.name).sort(),
  ["新标签", "暖色", "灰调"].sort(),
  "旧标签应迁移为字典行",
);
assert.deepEqual(getAssetTagNames(tagsLegacyDb, "legacy-1"), ["灰调", "暖色"], "关联顺序应保持原字符串顺序");
assert.equal(listTags(tagsLegacyDb).find((tag) => tag.name === "灰调").usageCount, 2, "共享标签应只保留一行");
assert.ok(
  !tagsLegacyDb.prepare("PRAGMA table_info(assets)").all().some((column) => column.name === "tags"),
  "迁移后应删除 assets.tags 旧列",
);
tagsLegacyDb.close();
tagsLegacyDb = openDatabase(tagsLegacyPath); // 幂等：重开不得重复迁移或报错
assert.deepEqual(getAssetTagNames(tagsLegacyDb, "legacy-2"), ["灰调", "新标签"], "重开数据库后迁移结果保持不变");
tagsLegacyDb.close();

// 1) 项目列表（含种子数据）
const projects = await json(await fetch(`${base}/api/projects`));
assert.ok(projects.projects.length >= 1, "应有种子项目");
assert.ok(Array.isArray(projects.projects[0].thumbnails), "项目列表应返回封面缩略图数组");
assert.ok(projects.projects[0].thumbnails.length <= 4, "封面缩略图最多 4 张");

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

// 9b) 标记图层元素：文本与描边图形（type=text/shape，assetId 可空，payload 存取）
const textItem = await json(await post(`${base}/api/canvas-items`, { canvasId: canvas.canvas.id, type: "text", x: 5, y: 6, width: 180, height: 40, zIndex: 1, payload: { text: "批注", color: "#292d29", fontSize: 18 } }));
assert.equal(textItem.item.type, "text", "应能创建文本标记元素");
assert.equal(textItem.item.assetId, null, "文本元素不引用素材");
const shapeItem = await json(await post(`${base}/api/canvas-items`, { canvasId: canvas.canvas.id, type: "shape", x: 7, y: 8, width: 60, height: 40, zIndex: 2, payload: { kind: "rect", stroke: "#d43a3a", strokeWidth: 3 } }));
assert.equal(shapeItem.item.type, "shape", "应能创建描边图形元素");
const canvasWithMarkers = await json(await fetch(`${base}/api/canvas?canvasId=${canvas.canvas.id}`));
const markerItems = canvasWithMarkers.items.filter((entry) => entry.assetId === null);
assert.ok(markerItems.some((entry) => entry.type === "text" && entry.payload && entry.payload.text === "批注"), "文本元素的 payload 应完整返回");
assert.ok(markerItems.some((entry) => entry.type === "shape" && entry.payload && entry.payload.kind === "rect"), "图形元素的 payload 应完整返回");
const textPatch = await json(await fetch(`${base}/api/canvas-items`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: textItem.item.id, canvasId: canvas.canvas.id, type: "text", x: 20, y: 30, width: 200, height: 50, zIndex: 3, payload: { text: "改后批注", color: "#2f7dd1", fontSize: 20, bold: true, italic: true, underline: true, strikeThrough: true, textAlign: "center", verticalAlign: "middle", autoWidth: true, autoHeight: true } }) }));
assert.ok(textPatch.ok, "应能更新文本元素");
const canvasAfterTextPatch = await json(await fetch(`${base}/api/canvas?canvasId=${canvas.canvas.id}`));
const textPayloadAfterPatch = canvasAfterTextPatch.items.find((entry) => entry.id === textItem.item.id).payload;
assert.equal(textPayloadAfterPatch.text, "改后批注", "更新后的文本内容应持久化");
assert.equal(textPayloadAfterPatch.bold, true, "加粗格式应持久化");
assert.equal(textPayloadAfterPatch.italic, true, "斜体格式应持久化");
assert.equal(textPayloadAfterPatch.underline, true, "下划线格式应持久化");
assert.equal(textPayloadAfterPatch.strikeThrough, true, "删除线格式应持久化");
assert.equal(textPayloadAfterPatch.textAlign, "center", "水平对齐应持久化");
assert.equal(textPayloadAfterPatch.verticalAlign, "middle", "垂直对齐应持久化");
assert.equal(textPayloadAfterPatch.autoWidth, true, "自动宽度应持久化");
assert.equal(textPayloadAfterPatch.autoHeight, true, "自动高度应持久化");

// 9c) 无限画布坐标可超出 (0,0)：负坐标必须原样保存，不得被钳回原点
const negativeItem = await json(await post(`${base}/api/canvas-items`, { canvasId: canvas.canvas.id, type: "shape", x: -120, y: -80, width: 60, height: 40, zIndex: 1, payload: { kind: "rect", stroke: "#292d29", strokeWidth: 2 } }));
assert.equal(negativeItem.item.x, -120, "负 x 坐标应原样保存");
assert.equal(negativeItem.item.y, -80, "负 y 坐标应原样保存");
const canvasWithNegative = await json(await fetch(`${base}/api/canvas?canvasId=${canvas.canvas.id}`));
assert.equal(canvasWithNegative.items.find((entry) => entry.id === negativeItem.item.id).x, -120, "画板读取后负 x 坐标应保持");
assert.equal(canvasWithNegative.items.find((entry) => entry.id === negativeItem.item.id).y, -80, "画板读取后负 y 坐标应保持");

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

// 10.5) AI 打标：精确复用 / 模糊候选 AI 裁决复用 / 裁决失败退化为新建
const aiResult1 = await json(await post(`${base}/api/assets/ai-tags`, { id: "asset-01" }));
assert.equal(aiResult1.reused, 1, "暖色应被裁决复用");
assert.equal(aiResult1.created, 1, "测试词语应按新建落库");
assert.equal(aiResult1.dropped, 0, "不应超上限丢弃");
assert.deepEqual(aiResult1.tags, ["建筑", "氛围", "灰调", "测试词语", "暖色"], "人工标签在前、AI 新标签追加在后");

const aiResult2 = await json(await post(`${base}/api/assets/ai-tags`, { id: "asset-02" }));
assert.equal(aiResult2.created, 1, "裁决失败时机械臂应退化为新建");
assert.deepEqual(aiResult2.tags, ["机械", "红色", "工业", "机械臂"]);

// 10.5b) 上传前 AI 打标：对待上传图片返回建议标签（复用词库），不落库、不建立素材关联
const dictBeforeUploadAi = await json(await fetch(`${base}/api/tags`));
const uploadAiForm = new FormData();
uploadAiForm.set("file", new File([buffer], "ai-tag.png", { type: "image/png" }));
const uploadAiRes = await fetch(`${base}/api/uploads/ai-tags`, { method: "POST", body: uploadAiForm });
assert.equal(uploadAiRes.status, 200, "上传前 AI 打标应 200");
const uploadAi = await uploadAiRes.json();
assert.equal(uploadAi.reused, 1, "机械臂应精确复用词库标签");
assert.equal(uploadAi.created, 0, "不应新建标签");
assert.deepEqual(uploadAi.tags, ["机械臂"], "应只返回建议标签");
const badUploadAiForm = new FormData();
badUploadAiForm.set("file", new File(["nope"], "x.txt", { type: "text/plain" }));
assert.equal((await fetch(`${base}/api/uploads/ai-tags`, { method: "POST", body: badUploadAiForm })).status, 400, "非图片文件应拒绝");
const dictAfterUploadAi = await json(await fetch(`${base}/api/tags`));
assert.equal(dictAfterUploadAi.tags.length, dictBeforeUploadAi.tags.length, "上传前 AI 打标不得改动标签字典");
const byNameUploadAi = new Map(dictAfterUploadAi.tags.map((tag) => [tag.name, tag]));
assert.equal(byNameUploadAi.get("机械臂").usageCount, 1, "上传前 AI 打标不得建立素材关联");

const dict1 = await json(await fetch(`${base}/api/tags`));
const dictByName1 = new Map(dict1.tags.map((tag) => [tag.name, tag]));
assert.equal(dictByName1.get("测试词语").source, "ai", "AI 新建标签来源应为 ai");
assert.equal(dictByName1.get("测试词语").usageCount, 1);
assert.equal(dictByName1.get("暖色").usageCount, 2, "复用已有标签应增加使用次数");
assert.equal(dictByName1.get("机械臂").source, "ai");

// 10.6) 标签管理：重命名 / 重名合并 / 显式合并 / 删除 / 清理未使用
const renamedId = dictByName1.get("测试词语").id;
const renameRes = await json(await fetch(`${base}/api/tags`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: renamedId, name: "测试词组" }),
}));
assert.equal(renameRes.ok, true);
let wsAfterTags = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.ok(wsAfterTags.assets.find((entry) => entry.id === "asset-01").tags.includes("测试词组"), "重命名应全局生效");

const mergeByRename = await json(await fetch(`${base}/api/tags`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: renamedId, name: "机械臂" }),
}));
assert.equal(mergeByRename.merged, true, "重命名为已有标签应等价于合并");
wsAfterTags = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.deepEqual(wsAfterTags.assets.find((entry) => entry.id === "asset-01").tags, ["建筑", "氛围", "灰调", "机械臂", "暖色"], "合并后关联应并入目标标签");

const dict2 = await json(await fetch(`${base}/api/tags`));
const byName2 = new Map(dict2.tags.map((tag) => [tag.name, tag]));
assert.ok(!byName2.has("测试词组"), "合并后源标签应从字典删除");
assert.equal(byName2.get("机械臂").usageCount, 2);

const mergeExplicit = await json(await fetch(`${base}/api/tags/merge`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sourceId: byName2.get("灰调").id, targetId: byName2.get("建筑").id }),
}));
assert.equal(mergeExplicit.merged, true);
wsAfterTags = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.deepEqual(wsAfterTags.assets.find((entry) => entry.id === "asset-01").tags, ["建筑", "氛围", "机械臂", "暖色"], "同一素材上源目标并存时合并应去重");

const dict3 = await json(await fetch(`${base}/api/tags`));
const byName3 = new Map(dict3.tags.map((tag) => [tag.name, tag]));
assert.ok(!byName3.has("灰调"));

const deleteTagRes = await fetch(`${base}/api/tags?id=${encodeURIComponent(byName3.get("机械臂").id)}`, { method: "DELETE" });
assert.equal(deleteTagRes.status, 200);
wsAfterTags = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.deepEqual(wsAfterTags.assets.find((entry) => entry.id === "asset-01").tags, ["建筑", "氛围", "暖色"], "删除标签应从所有素材移除");
assert.deepEqual(wsAfterTags.assets.find((entry) => entry.id === "asset-02").tags, ["机械", "红色", "工业"]);

const dropTagsPatch = await fetch(`${base}/api/assets`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: "asset-02", name: "红色机械臂", tags: "机械" }),
});
assert.equal(dropTagsPatch.status, 200);
const cleanupRes = await json(await fetch(`${base}/api/tags/cleanup`, { method: "POST" }));
assert.ok(cleanupRes.removed >= 2, "清理未使用应删除失去引用的标签");
const dict4 = await json(await fetch(`${base}/api/tags`));
const byName4 = new Map(dict4.tags.map((tag) => [tag.name, tag]));
assert.ok(!byName4.has("红色") && !byName4.has("工业"), "清理后孤儿标签应从字典移除");

// 10.7) AI 服务配置接口：状态 / 保存 / 保留原 key / 磁盘存储 / 测试连接 / 环境变量覆盖
let cfg = await json(await fetch(`${base}/api/ai-config`));
assert.equal(cfg.configured, true);
assert.equal(cfg.source, "file");
assert.equal(cfg.model, "smoke-model");
assert.equal(cfg.apiKeyLast4, "1234", "状态接口只返回 key 尾号");
assert.equal(cfg.envOverride, false);
assert.equal(typeof cfg.baseUrl, "string");

const cfgSave = await json(await fetch(`${base}/api/ai-config`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ baseUrl: `http://127.0.0.1:${aiMockPort}`, model: "smoke-model-2" }),
}));
assert.equal(cfgSave.ok, true);
cfg = await json(await fetch(`${base}/api/ai-config`));
assert.equal(cfg.model, "smoke-model-2");
assert.equal(cfg.apiKeyLast4, "1234", "未提交 apiKey 应保留原 key");
const onDiskConfig = JSON.parse(await readFile(path.join(tmp, "ai-config.json"), "utf8"));
assert.equal(onDiskConfig.apiKey, "sk-smoke-1234", "key 应完整保存在服务端文件，接口不回显");

const cfgSave2 = await json(await fetch(`${base}/api/ai-config`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ baseUrl: `http://127.0.0.1:${aiMockPort}`, apiKey: "sk-new-5678", model: "smoke-model-2" }),
}));
assert.equal(cfgSave2.ok, true);
cfg = await json(await fetch(`${base}/api/ai-config`));
assert.equal(cfg.apiKeyLast4, "5678", "新 key 应生效且只显示尾号");

const cfgTest = await json(await fetch(`${base}/api/ai-config/test`, { method: "POST" }));
assert.equal(cfgTest.ok, true, "测试连接应通过 mock 成功");
assert.match(cfgTest.reply, /pong/);

const cfgModels = await json(await fetch(`${base}/api/ai-config/models`, { method: "POST" }));
assert.equal(cfgModels.ok, true);
assert.ok(cfgModels.models.includes("qwen-vl-plus"), "模型列表接口应返回 key 可用的模型 id");
assert.ok(cfgModels.models.includes("smoke-model"));

process.env.AI_MODEL = "env-model";
cfg = await json(await fetch(`${base}/api/ai-config`));
assert.equal(cfg.envOverride, true, "设置环境变量后应标记环境变量接管");
assert.equal(cfg.source, "env");
assert.equal(cfg.model, "env-model", "环境变量应优先于页面配置");
delete process.env.AI_MODEL;
cfg = await json(await fetch(`${base}/api/ai-config`));
assert.equal(cfg.source, "file", "清除环境变量后应回到文件配置");

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

// 14) 账号系统：成员创建 / 登录 / 权限隔离 / 停用踢下线 / 重置密码 / 删除成员保留素材
assert.equal((await post(`${base}/api/users`, { username: "member1", password: "member123" })).status, 201, "管理员应能创建成员");
assert.equal((await post(`${base}/api/users`, { username: "member1", password: "member123" })).status, 409, "重复用户名应拒绝");
assert.equal((await post(`${base}/api/users`, { username: "含中文", password: "12345678" })).status, 400, "用户名规则校验");
assert.equal((await post(`${base}/api/users`, { username: "member2", password: "123" })).status, 400, "密码过短应拒绝");

const usersList = await json(await fetch(`${base}/api/users`));
assert.equal(usersList.users.length, 2, "用户列表应包含管理员与成员");
const member1 = usersList.users.find((u) => u.username === "member1");
assert.equal(member1.role, "member");
assert.equal(member1.active, true);

// 成员登录后：可访问业务接口，但不可访问用户管理与 AI 配置
const memberLogin = await post(`${base}/api/auth/login`, { username: "member1", password: "member123" });
assert.equal(memberLogin.status, 200);
const memberCookie = sessionCookie.split(";")[0];
// 恢复管理员会话（此时管理员密码仍为初始值 admin1234，改密发生在下方）
await post(`${base}/api/auth/login`, { username: "admin", password: "admin1234" });
const memberFetch = (url, init) => originalFetch(url, { ...init, headers: { ...(init?.headers || {}), cookie: memberCookie } });
assert.equal((await memberFetch(`${base}/api/projects`)).status, 200, "成员应能访问业务接口");
assert.equal((await memberFetch(`${base}/api/users`)).status, 403, "成员访问用户管理应 403");
assert.equal((await memberFetch(`${base}/api/login-logs`)).status, 403, "成员访问登录审计应 403");
assert.equal((await memberFetch(`${base}/api/ai-config`)).status, 403, "成员访问 AI 配置应 403");
assert.equal((await memberFetch(`${base}/api/tags`)).status, 200, "成员应能维护标签字典");
assert.equal((await memberFetch(`${base}/api/assets?id=asset-01&mode=permanent`, { method: "DELETE" })).status, 409, "成员应能彻底删除素材（有引用时被拒）");

// 14.5) 登录页公告：未登录可读 / 仅管理员可写 / 启用开关
const anonAnnouncement = await json(await originalFetch(`${base}/api/announcement`));
assert.deepEqual(anonAnnouncement, { text: "", enabled: false, updatedAt: null }, "未登录应能读取公告（初始为空）");
assert.equal((await memberFetch(`${base}/api/announcement`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "成员写的公告", enabled: true }) })).status, 403, "成员写公告应 403");
const annSave = await fetch(`${base}/api/announcement`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "周五维护公告", enabled: true }) });
assert.equal(annSave.status, 200, "管理员应能保存公告");
const annAfter = await json(await originalFetch(`${base}/api/announcement`));
assert.equal(annAfter.text, "周五维护公告", "公开读取应回显公告内容");
assert.equal(annAfter.enabled, true, "公开读取应回显启用状态");
assert.ok(annAfter.updatedAt, "公告应记录更新时间");
await fetch(`${base}/api/announcement`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "周五维护公告", enabled: false }) });
const annDisabled = await json(await originalFetch(`${base}/api/announcement`));
assert.equal(annDisabled.enabled, false, "关闭后 enabled 应为 false");

// 管理员修改自己的显示名与密码
const selfPatch = await json(await fetch(`${base}/api/auth/me`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ displayName: "大管理员" }),
}));
assert.equal(selfPatch.user.displayName, "大管理员", "管理员应能修改自己的显示名");
assert.equal((await fetch(`${base}/api/auth/me`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ currentPassword: "wrong", newPassword: "admin5678" }),
})).status, 400, "改密必须验证当前密码");
const selfPasswordPatch = await json(await fetch(`${base}/api/auth/me`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ currentPassword: "admin1234", newPassword: "admin5678" }),
}));
assert.equal(selfPasswordPatch.user.displayName, "大管理员");
assert.equal((await post(`${base}/api/auth/login`, { username: "admin", password: "admin1234" })).status, 401, "旧密码应失效");
assert.equal((await post(`${base}/api/auth/login`, { username: "admin", password: "admin5678" })).status, 200, "新密码应可登录");

// 管理员停用成员 → 立即踢下线且不能再登录
const deactivate = await json(await fetch(`${base}/api/users`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: member1.id, active: false }),
}));
assert.equal(deactivate.user.active, false);
assert.equal((await memberFetch(`${base}/api/projects`)).status, 401, "停用后成员会话应立即失效");
assert.equal((await post(`${base}/api/auth/login`, { username: "member1", password: "member123" })).status, 403, "停用后成员不能登录");

// 重新启用 + 重置密码
const reactivate = await json(await fetch(`${base}/api/users`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: member1.id, active: true }),
}));
assert.equal(reactivate.user.active, true);
const resetPwd = await json(await fetch(`${base}/api/users`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: member1.id, password: "newpass456" }),
}));
assert.equal(resetPwd.user.active, true);
assert.equal((await post(`${base}/api/auth/login`, { username: "member1", password: "member123" })).status, 401, "重置后旧密码应失效");
const memberLogin2 = await post(`${base}/api/auth/login`, { username: "member1", password: "newpass456" });
assert.equal(memberLogin2.status, 200, "重置后新密码应可登录");
// 重新登录后拿到新的有效会话，同时恢复管理员会话
const memberCookie2 = sessionCookie.split(";")[0];
await post(`${base}/api/auth/login`, { username: "admin", password: "admin5678" });
const memberFetch2 = (url, init) => originalFetch(url, { ...init, headers: { ...(init?.headers || {}), cookie: memberCookie2 } });

// 成员上传素材记录上传者；删除成员后素材保留且上传者为「已删除用户」
const memberBuffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 40, b: 160 } } }).png().toBuffer();
const memberForm = new FormData();
memberForm.set("file", new File([memberBuffer], "member-upload.png", { type: "image/png" }));
memberForm.set("projectId", "project-visual-direction");
memberForm.set("name", "成员上传素材");
const memberUpload = await memberFetch2(`${base}/api/uploads`, { method: "POST", body: memberForm });
assert.equal(memberUpload.status, 201, "成员应能上传素材");
const memberAsset = (await memberUpload.json()).asset;
const wsWithUploader = await json(await memberFetch2(`${base}/api/workspace?projectId=project-visual-direction`));
assert.equal(wsWithUploader.assets.find((item) => item.id === memberAsset.id).createdByName, "member1", "素材应记录上传者显示名");

// 成员不能删除账号；管理员删除成员后素材保留
assert.equal((await memberFetch2(`${base}/api/users?id=${member1.id}`, { method: "DELETE" })).status, 403, "成员不能删除账号");
const delMember = await fetch(`${base}/api/users?id=${member1.id}`, { method: "DELETE" });
assert.equal(delMember.status, 200, "管理员应能删除成员");
const usersAfterDelete = await json(await fetch(`${base}/api/users`));
assert.equal(usersAfterDelete.users.length, 1, "删除后只剩管理员");
const wsAfterMemberDelete = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
assert.equal(wsAfterMemberDelete.assets.find((item) => item.id === memberAsset.id).createdByName, "已删除用户", "删除成员后素材保留且上传者置为快照");
const libraryWithUploader = await json(await fetch(`${base}/api/library`));
assert.equal(libraryWithUploader.assets.find((item) => item.id === memberAsset.id).createdByName, "已删除用户", "全局库同样展示上传者快照");

// 管理员自保：不能删除/停用自己，必须保留至少一名管理员
assert.equal((await fetch(`${base}/api/users?id=${setupUser.id}`, { method: "DELETE" })).status, 400, "不能删除自己的账号");
const adminSelfDeactivate = await fetch(`${base}/api/users`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: setupUser.id, active: false }),
});
assert.equal(adminSelfDeactivate.status, 400, "不能停用自己的账号");

// 登录审计：成功与失败均应记录
const logs = await json(await fetch(`${base}/api/login-logs`));
assert.ok(logs.logs.length >= 4, "登录审计应包含多条记录");
const failureLog = logs.logs.find((entry) => entry.username === "admin" && !entry.success);
assert.ok(failureLog, "错误密码登录应记录失败审计");
assert.ok(failureLog.ip, "审计应记录客户端 IP");
const successLog = logs.logs.find((entry) => entry.username === "member1" && entry.success);
assert.ok(successLog, "成员成功登录应记录审计");

// 退出登录后会话失效
const logoutRes = await fetch(`${base}/api/auth/logout`, { method: "POST" });
assert.equal(logoutRes.status, 200);
sessionCookie = "";
assert.equal((await fetch(`${base}/api/projects`)).status, 401, "退出后原会话应失效");
const reLogin = await post(`${base}/api/auth/login`, { username: "admin", password: "admin5678" });
assert.equal(reLogin.status, 200, "退出后可重新登录");

// 15) 视频素材：上传 → 异步转码 → 时长/封面/Range 播放（解码在浏览器端，服务端只喂字节）
// 用 ffmpeg-static 生成 1 秒测试视频（320x240, 10fps），stderr 走文件描述符避免管道
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const logPath = path.join(tmp, `ffmpeg-${Math.random().toString(36).slice(2)}.log`);
    const fd = openSync(logPath, "w");
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", fd] });
    child.on("error", (error) => { try { closeSync(fd); } catch { /* 忽略 */ } reject(error); });
    child.on("close", (code) => { try { closeSync(fd); } catch { /* 忽略 */ } if (code === 0) resolve(); else reject(new Error(`ffmpeg 退出码 ${code}`)); });
  });
}
const smokeVideoPath = path.join(tmp, "smoke-video.mp4");
await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", smokeVideoPath]);

const videoForm = new FormData();
videoForm.set("file", new File([await readFile(smokeVideoPath)], "smoke-video.mp4", { type: "video/mp4" }));
videoForm.set("projectId", "project-visual-direction");
videoForm.set("name", "冒烟测试视频");
const vup = await fetch(`${base}/api/uploads`, { method: "POST", body: videoForm });
assert.equal(vup.status, 201, `视频上传应 201，实际 ${vup.status}`);
const videoUpload = (await vup.json()).asset;
assert.equal(videoUpload.transcodeStatus, "processing", "视频上传后应处于转码中");

// 等待异步转码完成（processing 不可播放，ready 后可播放）
let videoEntry;
{
  const deadline = Date.now() + 60000;
  for (;;) {
    const wsVideo = await json(await fetch(`${base}/api/workspace?projectId=project-visual-direction`));
    videoEntry = wsVideo.assets.find((item) => item.id === videoUpload.id);
    assert.ok(videoEntry, "视频素材应出现在工作区");
    if (videoEntry.transcodeStatus === "ready") break;
    if (videoEntry.transcodeStatus === "failed") throw new Error(`视频转码失败：${JSON.stringify(videoEntry)}`);
    if (Date.now() > deadline) throw new Error("视频转码超时");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
assert.ok(videoEntry.duration > 0, "转码后应写入时长");
assert.equal(videoEntry.mimeType, "video/mp4", "转码后 mime 应为 video/mp4");
assert.ok(videoEntry.width > 0 && videoEntry.height > 0, "转码后应写入分辨率");
assert.ok(videoEntry.thumbnailUrl, "转码后应有封面");

const vOriginal = await fetch(`${base}/api/media?id=${videoUpload.id}`);
assert.equal(vOriginal.status, 200);
assert.match(vOriginal.headers.get("content-type") || "", /video\/mp4/);
assert.equal(vOriginal.headers.get("accept-ranges"), "bytes", "媒体接口应声明 accept-ranges");

// HTTP Range：206 与 content-range（浏览器 <video> seek 依赖）
const rangeRes = await fetch(`${base}/api/media?id=${videoUpload.id}`, { headers: { Range: "bytes=0-99" } });
assert.equal(rangeRes.status, 206, "Range 请求应返回 206");
assert.match(rangeRes.headers.get("content-range") || "", /^bytes 0-99\/\d+$/, "content-range 应正确");
const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
assert.equal(rangeBytes.length, 100, "Range 响应体长度应等于请求区间");

const vThumb = await fetch(`${base}/api/media?id=${videoUpload.id}&variant=thumbnail`);
assert.equal(vThumb.status, 200);
assert.match(vThumb.headers.get("content-type") || "", /image\/webp/);

// 同类型替换限制：图片换视频应被拒绝
const crossTypeForm = new FormData();
crossTypeForm.set("id", videoUpload.id);
crossTypeForm.set("file", new File([buffer], "cross-type.png", { type: "image/png" }));
assert.equal((await fetch(`${base}/api/assets/image`, { method: "POST", body: crossTypeForm })).status, 400, "跨类型替换应被拒绝");

// 视频不支持 AI 打标；图片素材不需要转码
assert.equal((await post(`${base}/api/assets/ai-tags`, { id: videoUpload.id })).status, 400, "视频素材应拒绝 AI 打标");
assert.equal((await post(`${base}/api/assets/retranscode`, { id: memberAsset.id })).status, 400, "图片素材应拒绝重新转码");

console.log("✓ 全部通过：项目 / 工作区 / 上传 / 缩略图 / 原图 / 去重 / 改元数据 / 改维度名称 / 画板迁移与重复实例 / 安全替换图片 / 旧库标签迁移 / AI 打标(复用·裁决·降级·上传前建议) / 标签管理(重命名·合并·删除·清理) / AI 服务配置(状态·保存·掩码·测试连接·模型列表·环境变量覆盖) / 回收站(软删-列出-恢复-彻底删) / 登录页公告(公开读取·仅管理员可写·启用开关) / 账号系统(首次初始化·登录·权限隔离·成员管理·停用踢下线·重置密码·删除保留素材·登录审计·退出) / 视频(上传·异步转码·时长·封面·Range/206·同类型替换·AI 拦截)");
process.exit(0);
