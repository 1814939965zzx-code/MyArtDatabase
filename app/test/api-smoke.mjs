import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDatabase } from "../server/db.js";
import { createLocalDiskStore } from "../server/storage.js";
import { getAssetTagNames, listTags } from "../server/tags.js";

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
process.env.AI_CONFIG_PATH = path.join(tmp, "ai-config.json");
await writeFile(process.env.AI_CONFIG_PATH, JSON.stringify({
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

// 0.5) 旧库迁移：assets.tags 字符串 → tags/asset_tags，删除旧列，重开幂等
const legacyPath = path.join(tmp, "legacy.db");
{
  const legacy = new DatabaseSync(legacyPath);
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
let legacyDb = openDatabase(legacyPath);
assert.deepEqual(
  listTags(legacyDb).map((tag) => tag.name).sort(),
  ["新标签", "暖色", "灰调"].sort(),
  "旧标签应迁移为字典行",
);
assert.deepEqual(getAssetTagNames(legacyDb, "legacy-1"), ["灰调", "暖色"], "关联顺序应保持原字符串顺序");
assert.equal(listTags(legacyDb).find((tag) => tag.name === "灰调").usageCount, 2, "共享标签应只保留一行");
assert.ok(
  !legacyDb.prepare("PRAGMA table_info(assets)").all().some((column) => column.name === "tags"),
  "迁移后应删除 assets.tags 旧列",
);
legacyDb.close();
legacyDb = openDatabase(legacyPath); // 幂等：重开不得重复迁移或报错
assert.deepEqual(getAssetTagNames(legacyDb, "legacy-2"), ["灰调", "新标签"], "重开数据库后迁移结果保持不变");
legacyDb.close();

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
const onDiskConfig = JSON.parse(await readFile(process.env.AI_CONFIG_PATH, "utf8"));
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

console.log("✓ 全部通过：项目 / 工作区 / 上传 / 缩略图 / 原图 / 去重 / 改元数据 / 改维度名称 / 画板 / 安全替换图片 / 旧库标签迁移 / AI 打标(复用·裁决·降级) / 标签管理(重命名·合并·删除·清理) / AI 服务配置(状态·保存·掩码·测试连接·模型列表·环境变量覆盖) / 回收站(软删-列出-恢复-彻底删)");
process.exit(0);
