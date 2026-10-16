import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../server/db.js";
import { createUser, createSession, sessionCookieHeader } from "../server/auth.js";
import { handleApi } from "../server/routes.js";

function client(db) {
  const user = createUser(db, { username: "tester", displayName: "测试", password: "test-password", role: "admin" });
  const { token } = createSession(db, user.id, false);
  const cookie = sessionCookieHeader(token).split(";")[0];
  return async (route, method = "GET", payload) => {
    const response = await handleApi(new Request(`http://localhost/api/${route}`, {
      method, headers: { cookie, "content-type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }), { db });
    return { status: response.status, ...await response.json() };
  };
}

test("旧项目迁移保留素材、维度、坐标且重开幂等，不复活已删除的 Page", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "artdb-pages-migration-"));
  const file = path.join(dir, "app.db");
  let db;
  try {
    db = openDatabase(file, { seedDemo: true });
    // 模拟没有 Page 表的 v8 数据库，并保留一条不再属于项目的历史维度值。
    db.exec(`DROP TABLE preview_dimension_values; DROP TABLE preview_dimensions;
      DROP TABLE preview_page_assets; DROP TABLE preview_pages;
      DELETE FROM project_assets WHERE asset_id = 'asset-08'; PRAGMA user_version = 8`);
    const dimensions = db.prepare("SELECT * FROM project_dimensions ORDER BY id").all();
    const values = db.prepare("SELECT * FROM asset_dimension_values ORDER BY project_id, asset_id, dimension_id").all();
    db.close();
    db = openDatabase(file);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 9);
    const pages = db.prepare("SELECT * FROM preview_pages").all();
    assert.equal(pages.length, db.prepare("SELECT COUNT(*) AS n FROM projects").get().n);
    for (const page of pages) {
      assert.equal(page.name, "默认画板");
      const oldDims = dimensions.filter((d) => d.project_id === page.project_id);
      assert.deepEqual(db.prepare("SELECT id, left_label, right_label, sort_order FROM preview_dimensions WHERE page_id = ? ORDER BY id").all(page.id).map((d) => ({ ...d })), oldDims.map(({ id, left_label, right_label, sort_order }) => ({ id, left_label, right_label, sort_order })));
      assert.deepEqual(JSON.parse(page.selected_axes), oldDims.sort((a, b) => a.sort_order - b.sort_order).slice(0, 3).map((d) => d.id));
      const refs = db.prepare("SELECT asset_id FROM preview_page_assets WHERE page_id = ? ORDER BY asset_id").all(page.id);
      assert.deepEqual(refs, db.prepare("SELECT asset_id FROM project_assets WHERE project_id = ? ORDER BY asset_id").all(page.project_id));
      for (const v of values.filter((v) => v.project_id === page.project_id && refs.some((r) => r.asset_id === v.asset_id))) assert.equal(db.prepare("SELECT value FROM preview_dimension_values WHERE page_id = ? AND asset_id = ? AND dimension_id = ?").get(page.id, v.asset_id, v.dimension_id).value, v.value);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM preview_dimension_values WHERE page_id = ? AND asset_id = 'asset-08'").get(page.id).n, 0, "不再属于项目的素材不得被迁移复活");
    }
    db.close();
    db = openDatabase(file);
    assert.deepEqual(db.prepare("SELECT * FROM preview_pages").all(), pages);
    db.prepare("DELETE FROM preview_pages WHERE id = ?").run(pages[0].id);
    db.close();
    db = openDatabase(file);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM preview_pages").get().n, pages.length - 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db?.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Page 素材与维度独立，边界校验、轴持久化、移除及级联删除", async () => {
  const db = openDatabase(":memory:", { seedDemo: true });
  try {
    const call = client(db);
    const projectId = "project-visual-direction";
    const otherProject = (await call("projects", "POST", { name: "其他项目" })).project.id;
    const initial = (await call(`preview-pages?projectId=${projectId}`)).pages[0];
    const b = (await call("preview-pages", "POST", { projectId, name: "Page B" })).page;
    const get = async (pageId) => (await call(`preview-page?projectId=${projectId}&pageId=${pageId}`)).page;
    const data = (pageId, extra = {}) => ({ projectId, pageId, ...extra });
    const empty = await get(b.id);
    assert.deepEqual(empty.assets, []);
    assert.deepEqual(empty.dimensions, []);
    assert.deepEqual(empty.selectedIds, []);
    assert.equal((await call(`preview-page?projectId=${otherProject}&pageId=${b.id}`)).status, 404);
    const unauth = await handleApi(new Request(`http://localhost/api/preview-pages?projectId=${projectId}`), { db });
    assert.equal(unauth.status, 401);
    assert.equal((await call("preview-page-assets", "POST", data(b.id, { assetIds: ["asset-01", "missing"] }))).status, 404);
    assert.equal((await get(b.id)).assets.length, 0, "无效批次不得部分加入");
    assert.equal((await call("preview-page-assets", "POST", { projectId: otherProject, pageId: (await call(`preview-pages?projectId=${otherProject}`)).pages[0].id, assetIds: ["asset-01"] })).status, 404);
    await call("preview-page-assets", "POST", data(b.id, { assetIds: ["asset-01", "asset-01", "asset-02"] }));
    assert.equal((await get(b.id)).assets.length, 2);
    const dimension = (await call("preview-dimensions", "POST", data(b.id, { leftLabel: "抽象", rightLabel: "具象" }))).dimension;
    assert.equal((await get(b.id)).assets[0].dimensionValues[dimension.id], 500);
    const aBefore = await get(initial.id);
    await call("preview-values", "PATCH", data(b.id, { assetId: "asset-01", values: { [dimension.id]: 870 } }));
    assert.deepEqual(await get(initial.id), aBefore, "同一素材在 B 改坐标不能影响 A");
    assert.equal((await get(b.id)).assets.find((a) => a.assetId === "asset-01").dimensionValues[dimension.id], 870);
    assert.equal((await call("preview-values", "PATCH", data(initial.id, { assetId: "asset-01", values: { [dimension.id]: 1 } }))).status, 404);
    assert.equal((await call("preview-values", "PATCH", data(b.id, { assetId: "asset-03", values: { [dimension.id]: 1 } }))).status, 404);
    for (const value of [-1, 1001, 0.5, "500"]) assert.equal((await call("preview-values", "PATCH", data(b.id, { assetId: "asset-01", values: { [dimension.id]: value } }))).status, 400);
    await call("preview-pages", "PATCH", data(b.id, { name: "重命名", selectedIds: [] }));
    assert.equal((await get(b.id)).name, "重命名");
    assert.deepEqual((await get(b.id)).selectedIds, []);
    assert.equal((await call("preview-pages", "PATCH", data(b.id, { name: "不应保存", selectedIds: ["dimension-form"] }))).status, 400);
    assert.equal((await get(b.id)).name, "重命名", "请求校验失败不得部分修改 Page");
    await call("preview-pages", "PATCH", data(b.id, { selectedIds: [dimension.id] }));
    assert.deepEqual((await get(b.id)).selectedIds, [dimension.id]);
    const axis2 = (await call("preview-dimensions", "POST", data(b.id, { leftLabel: "平静", rightLabel: "活跃" }))).dimension.id;
    const axis3 = (await call("preview-dimensions", "POST", data(b.id, { leftLabel: "简单", rightLabel: "复杂" }))).dimension.id;
    const axis4 = (await call("preview-dimensions", "POST", data(b.id, { leftLabel: "年轻", rightLabel: "成熟" }))).dimension.id;
    assert.equal((await call("preview-pages", "PATCH", data(b.id, { selectedIds: [dimension.id, axis2, axis3, axis4] }))).status, 400);
    await call("preview-pages", "PATCH", data(b.id, { selectedIds: [axis3, dimension.id, axis2] }));
    assert.deepEqual((await get(b.id)).selectedIds, [axis3, dimension.id, axis2], "应保存每个 Page 的轴顺序");
    assert.throws(() => db.prepare("INSERT INTO preview_dimension_values (page_id, asset_id, dimension_id, value) VALUES (?, ?, ?, 1)").run(b.id, "asset-01", "dimension-form"), /FOREIGN KEY/, "数据库应阻止跨 Page 数值");
    await call("preview-dimensions", "PATCH", data(b.id, { dimensions: [{ id: dimension.id, leftLabel: "冷静", rightLabel: "热烈" }] }));
    assert.equal((await get(b.id)).dimensions[0].leftLabel, "冷静");
    assert.deepEqual(await get(initial.id), aBefore);
    await call(`preview-page-assets?projectId=${projectId}&pageId=${b.id}&assetId=asset-01`, "DELETE");
    assert.equal((await get(b.id)).assets.length, 1);
    assert.equal((await get(initial.id)).assets.length, aBefore.assets.length);
    assert.ok(db.prepare("SELECT id FROM assets WHERE id = 'asset-01'").get());
    await call("preview-page-assets", "POST", data(b.id, { assetIds: ["asset-01"] }));
    assert.equal((await get(b.id)).assets.find((a) => a.assetId === "asset-01").dimensionValues[dimension.id], 500);
    db.prepare("UPDATE assets SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'asset-01'").run();
    assert.ok(!(await get(b.id)).assets.some((a) => a.assetId === "asset-01"));
    db.prepare("UPDATE assets SET deleted_at = NULL WHERE id = 'asset-01'").run();
    assert.ok((await get(b.id)).assets.some((a) => a.assetId === "asset-01"));
    await call(`project-assets?projectId=${projectId}&assetId=asset-01`, "DELETE");
    assert.ok(!(await get(initial.id)).assets.some((a) => a.assetId === "asset-01"));
    assert.ok(!(await get(b.id)).assets.some((a) => a.assetId === "asset-01"));
    await call(`preview-dimensions?projectId=${projectId}&pageId=${b.id}&id=${dimension.id}`, "DELETE");
    assert.ok(!(await get(b.id)).dimensions.some((d) => d.id === dimension.id));
    assert.deepEqual((await get(b.id)).selectedIds, [axis3, axis2]);
    await call(`preview-pages?projectId=${projectId}&pageId=${b.id}`, "DELETE");
    assert.equal((await call(`preview-page?projectId=${projectId}&pageId=${b.id}`)).status, 404);
    assert.ok(db.prepare("SELECT id FROM assets WHERE id = 'asset-02'").get());
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});

test("新项目默认 Page 为空，上传、项目引用不会自动加入 Page", async () => {
  const db = openDatabase(":memory:", { seedDemo: true });
  try {
    const call = client(db);
    const project = (await call("projects", "POST", { name: "新项目" })).project;
    const pages = (await call(`preview-pages?projectId=${project.id}`)).pages;
    assert.equal(pages.length, 1);
    await call("project-assets", "POST", { projectId: project.id, assetId: "asset-01" });
    db.prepare("INSERT INTO assets (id, name, file_name) VALUES ('new-upload', '新上传', 'new.png')").run();
    db.prepare("INSERT INTO project_assets (project_id, asset_id) VALUES (?, 'new-upload')").run(project.id);
    const current = (await call(`preview-page?projectId=${project.id}&pageId=${pages[0].id}`)).page;
    assert.deepEqual(current.assets, []);
    assert.deepEqual(current.dimensions, []);
    await call(`projects?id=${project.id}`, "DELETE");
    assert.ok(db.prepare("SELECT id FROM assets WHERE id = 'new-upload'").get());
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM preview_pages WHERE project_id = ?").get(project.id).n, 0);
  } finally { db.close(); }
});
