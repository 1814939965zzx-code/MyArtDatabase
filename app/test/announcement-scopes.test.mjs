import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../server/db.js";

function settings(db) {
  return Object.fromEntries(
    db.prepare("SELECT key, value, updated_at AS updatedAt FROM app_settings").all()
      .map((row) => [row.key, row]),
  );
}

test("旧版单份公告迁移为登录页公告：全局公告不继承，旧键删除，重开不重复迁移", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "artdb-announcement-"));
  const file = path.join(dir, "app.db");
  try {
    // 模拟旧库：只有一份 announcement.text / announcement.enabled
    let db = openDatabase(file);
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('announcement.text', ?, '2026-01-02 03:04:05')").run("旧版公告内容");
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('announcement.enabled', '1', '2026-01-02 03:04:05')").run();
    db.close();

    db = openDatabase(file);
    const migrated = settings(db);
    assert.equal(migrated["announcement.login.text"]?.value, "旧版公告内容", "旧公告应迁到登录页公告");
    assert.equal(migrated["announcement.login.enabled"]?.value, "1", "启用状态应一并迁移");
    assert.equal(migrated["announcement.login.text"].updatedAt, "2026-01-02 03:04:05", "迁移保留更新时间");
    assert.equal(migrated["announcement.global.text"], undefined, "全局公告不继承旧内容");
    assert.equal(migrated["announcement.global.enabled"], undefined, "全局公告不继承旧开关");
    assert.equal(migrated["announcement.text"], undefined, "旧键应被删除");
    assert.equal(migrated["announcement.enabled"], undefined, "旧开关应被删除");

    // 迁移后再改动登录页公告，重开数据库不能被旧内容覆盖
    db.prepare("UPDATE app_settings SET value = '迁移后改过的公告' WHERE key = 'announcement.login.text'").run();
    db.close();
    db = openDatabase(file);
    assert.equal(settings(db)["announcement.login.text"].value, "迁移后改过的公告", "重开不应重复迁移");
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("全新数据库启动即有两份空公告，互不影响", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "artdb-announcement-fresh-"));
  const file = path.join(dir, "app.db");
  try {
    const db = openDatabase(file);
    assert.equal(settings(db)["announcement.login.text"], undefined, "登录页公告初始为空");
    assert.equal(settings(db)["announcement.global.text"], undefined, "全局公告初始为空");
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
