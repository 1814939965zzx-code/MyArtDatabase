import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeTag } from "./tags.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS project_dimensions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  left_label TEXT NOT NULL,
  right_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, sort_order)
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  thumbnail_url TEXT,
  storage_key TEXT,
  thumbnail_key TEXT,
  sha256 TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  duration INTEGER NOT NULL DEFAULT 0,
  transcode_status TEXT,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS login_logs_created_idx ON login_logs(created_at DESC);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (asset_id, tag_id)
);
CREATE TABLE IF NOT EXISTS project_assets (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, asset_id)
);
CREATE TABLE IF NOT EXISTS asset_dimension_values (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  dimension_id TEXT NOT NULL REFERENCES project_dimensions(id) ON DELETE CASCADE,
  value INTEGER NOT NULL DEFAULT 500 CHECK (value >= 0 AND value <= 1000),
  PRIMARY KEY(project_id, asset_id, dimension_id)
);
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY NOT NULL,
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'image',
  parent_frame_id TEXT,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  z_index INTEGER NOT NULL DEFAULT 0,
  rotation INTEGER NOT NULL DEFAULT 0,
  payload TEXT
);
CREATE INDEX IF NOT EXISTS project_assets_project_idx ON project_assets(project_id);
CREATE INDEX IF NOT EXISTS dimensions_project_idx ON project_dimensions(project_id);
CREATE INDEX IF NOT EXISTS assets_sha256_idx ON assets(sha256);
CREATE INDEX IF NOT EXISTS asset_tags_tag_idx ON asset_tags(tag_id);
CREATE INDEX IF NOT EXISTS canvases_project_idx ON canvases(project_id);
CREATE INDEX IF NOT EXISTS canvas_items_canvas_idx ON canvas_items(canvas_id);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

function allowRepeatedCanvasAssets(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'canvas_items'").get();
  if (!row?.sql || !/UNIQUE\s*\(\s*canvas_id\s*,\s*asset_id\s*\)/i.test(row.sql)) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE canvas_items_next (
        id TEXT PRIMARY KEY NOT NULL,
        canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'image',
        parent_frame_id TEXT,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        z_index INTEGER NOT NULL DEFAULT 0,
        rotation INTEGER NOT NULL DEFAULT 0,
        payload TEXT
      );
      INSERT INTO canvas_items_next (id, canvas_id, asset_id, type, parent_frame_id, x, y, width, height, z_index, rotation, payload)
        SELECT id, canvas_id, asset_id, 'image', NULL, x, y, width, height, z_index, rotation, NULL FROM canvas_items;
      DROP TABLE canvas_items;
      ALTER TABLE canvas_items_next RENAME TO canvas_items;
      CREATE INDEX canvas_items_canvas_idx ON canvas_items(canvas_id);
      COMMIT;
    `);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const SCHEMA_VERSION = 6;

/**
 * v1：把素材上的逗号分隔标签字符串迁入 tags/asset_tags 标签字典。
 * 迁移完成后删除 assets.tags 列，标签以新表为唯一事实来源；用 user_version 保证幂等。
 * v2：为 assets 补充 created_by / created_by_name（上传者快照），兼容没有账号概念的旧库。
 * v3：新增 app_settings 键值表（登录页公告等系统级设置），CREATE TABLE IF NOT EXISTS 已覆盖新旧库。
 * v4：自由画板改为无限画布 + 可选 Frame。canvas_items 新增 type（image/shape/text）、
 *     parent_frame_id（所属 Frame，可空）、payload（图形/文本/手绘属性 JSON）；
 *     asset_id 改为可空（文本与图形元素不引用素材）。既有图片元素迁移为 type='image'。
 * v5：为旧库重建 canvas_items，真正去掉 asset_id 的 NOT NULL 约束（v4 只加列未改约束），
 *     保证标记图层（shape/text）可写入 asset_id 为 NULL 的元素。
 * v6：视频素材支持。assets 新增 duration（转码后时长，毫秒，图片恒为 0）与
 *     transcode_status（NULL=图片 / processing / ready / failed）。
 */
function migrateSchema(db) {
  const { user_version: version } = db.prepare("PRAGMA user_version").get();
  if (version < 1) {
    const hasLegacyTags = db.prepare("PRAGMA table_info(assets)").all().some((column) => column.name === "tags");
    if (hasLegacyTags) {
      const rows = db.prepare("SELECT id, tags FROM assets").all();
      const known = new Map(db.prepare("SELECT id, name FROM tags").all()
        .map((row) => [normalizeTag(row.name), row.id]));
      const insertTag = db.prepare("INSERT INTO tags (id, name, source) VALUES (?, ?, 'manual')");
      const insertLink = db.prepare("INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, position, source) VALUES (?, ?, ?, 'manual')");
      db.exec("BEGIN");
      try {
        for (const row of rows) {
          String(row.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean).forEach((name, index) => {
            const key = normalizeTag(name);
            let tagId = known.get(key);
            if (!tagId) {
              tagId = randomUUID();
              insertTag.run(tagId, name);
              known.set(key, tagId);
            }
            insertLink.run(row.id, tagId, index);
          });
        }
        db.exec("ALTER TABLE assets DROP COLUMN tags");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }
  if (version < 2) {
    const assetColumns = db.prepare("PRAGMA table_info(assets)").all().map((column) => column.name);
    if (!assetColumns.includes("created_by")) {
      db.exec("ALTER TABLE assets ADD COLUMN created_by TEXT");
    }
    if (!assetColumns.includes("created_by_name")) {
      db.exec("ALTER TABLE assets ADD COLUMN created_by_name TEXT NOT NULL DEFAULT ''");
    }
  }
  if (version < 4) {
    const columns = db.prepare("PRAGMA table_info(canvas_items)").all().map((column) => column.name);
    if (!columns.includes("type")) db.exec("ALTER TABLE canvas_items ADD COLUMN type TEXT NOT NULL DEFAULT 'image'");
    if (!columns.includes("parent_frame_id")) db.exec("ALTER TABLE canvas_items ADD COLUMN parent_frame_id TEXT");
    if (!columns.includes("payload")) db.exec("ALTER TABLE canvas_items ADD COLUMN payload TEXT");
    db.exec("UPDATE canvas_items SET type = 'image' WHERE type IS NULL OR type = ''");
  }
  if (version < 5) {
    const info = db.prepare("PRAGMA table_info(canvas_items)").all();
    const cols = new Set(info.map((column) => column.name));
    const assetNotNull = info.find((column) => column.name === "asset_id")?.notnull === 1;
    const missing = !cols.has("type") || !cols.has("parent_frame_id") || !cols.has("payload");
    if (assetNotNull || missing) {
      const select = [
        "id", "canvas_id",
        cols.has("asset_id") ? "asset_id" : "NULL AS asset_id",
        cols.has("type") ? "type" : "'image' AS type",
        cols.has("parent_frame_id") ? "parent_frame_id" : "NULL AS parent_frame_id",
        "x", "y", "width", "height", "z_index", "rotation",
        cols.has("payload") ? "payload" : "NULL AS payload",
      ].join(", ");
      db.exec("BEGIN");
      try {
        db.exec(`
          CREATE TABLE canvas_items_next (
            id TEXT PRIMARY KEY NOT NULL,
            canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
            asset_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
            type TEXT NOT NULL DEFAULT 'image',
            parent_frame_id TEXT,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            z_index INTEGER NOT NULL DEFAULT 0,
            rotation INTEGER NOT NULL DEFAULT 0,
            payload TEXT
          );
          INSERT INTO canvas_items_next (id, canvas_id, asset_id, type, parent_frame_id, x, y, width, height, z_index, rotation, payload)
            SELECT ${select} FROM canvas_items;
          DROP TABLE canvas_items;
          ALTER TABLE canvas_items_next RENAME TO canvas_items;
          CREATE INDEX canvas_items_canvas_idx ON canvas_items(canvas_id);
        `);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } else {
      db.exec("UPDATE canvas_items SET type = 'image' WHERE type IS NULL OR type = ''");
    }
  }
  if (version < 6) {
    const columns = db.prepare("PRAGMA table_info(assets)").all().map((column) => column.name);
    if (!columns.includes("duration")) db.exec("ALTER TABLE assets ADD COLUMN duration INTEGER NOT NULL DEFAULT 0");
    if (!columns.includes("transcode_status")) db.exec("ALTER TABLE assets ADD COLUMN transcode_status TEXT");
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

const SEED_ASSETS = [
  ["asset-01", "雾中建筑", "mist-architecture.jpg", "artdatabase-mist", ["建筑", "氛围", "灰调"]],
  ["asset-02", "红色机械臂", "red-robot-arm.jpg", "artdatabase-robot", ["机械", "红色", "工业"]],
  ["asset-03", "流体金属", "liquid-metal.jpg", "artdatabase-metal", ["材质", "银色", "流体"]],
  ["asset-04", "透明结构", "glass-structure.jpg", "artdatabase-glass", ["透明", "结构", "空间"]],
  ["asset-05", "荒漠装置", "desert-installation.jpg", "artdatabase-desert", ["装置", "荒漠", "暖色"]],
  ["asset-06", "蓝色界面", "blue-interface.jpg", "artdatabase-interface", ["界面", "蓝色", "科技"]],
  ["asset-07", "织物微距", "fabric-closeup.jpg", "artdatabase-fabric", ["织物", "微距", "触感"]],
  ["asset-08", "光影廊道", "light-corridor.jpg", "artdatabase-light", ["光影", "空间", "极简"]],
];

function seed(db) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM projects").get();
  if (row.count > 0) return;
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)")
      .run("project-visual-direction", "机器人视觉方向", "收集机器人产品与视觉语言参考");
    db.prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)")
      .run("project-material-language", "材质与光感", "探索材质、光线和空间之间的关系");
    db.prepare("INSERT INTO project_dimensions (id, project_id, left_label, right_label, sort_order) VALUES (?, ?, ?, ?, ?)")
      .run("dimension-form", "project-visual-direction", "抽象", "具象", 0);
    db.prepare("INSERT INTO project_dimensions (id, project_id, left_label, right_label, sort_order) VALUES (?, ?, ?, ?, ?)")
      .run("dimension-temperature", "project-visual-direction", "冷静", "热烈", 1);

    const insertAsset = db.prepare("INSERT INTO assets (id, name, file_name, thumbnail_url) VALUES (?, ?, ?, ?)");
    const insertLink = db.prepare("INSERT INTO project_assets (project_id, asset_id) VALUES (?, ?)");
    const insertValue = db.prepare("INSERT INTO asset_dimension_values (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, ?)");
    const known = new Map(db.prepare("SELECT id, name FROM tags").all()
      .map((tag) => [normalizeTag(tag.name), tag.id]));
    const insertTag = db.prepare("INSERT INTO tags (id, name, source) VALUES (?, ?, 'manual')");
    const insertAssetTag = db.prepare("INSERT INTO asset_tags (asset_id, tag_id, position, source) VALUES (?, ?, ?, 'manual')");
    SEED_ASSETS.forEach(([id, name, fileName, imageSeed, tags], index) => {
      insertAsset.run(id, name, fileName, `https://picsum.photos/seed/${imageSeed}/900/700`);
      insertLink.run("project-visual-direction", id);
      insertValue.run("project-visual-direction", id, "dimension-form", 160 + index * 95);
      insertValue.run("project-visual-direction", id, "dimension-temperature", [210, 820, 420, 170, 880, 350, 610, 290][index]);
      tags.forEach((tagName, tagIndex) => {
        const key = normalizeTag(tagName);
        let tagId = known.get(key);
        if (!tagId) {
          tagId = randomUUID();
          insertTag.run(tagId, tagName);
          known.set(key, tagId);
        }
        insertAssetTag.run(id, tagId, tagIndex);
      });
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(dbPath, { seedDemo = false } = {}) {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  // 旧版本限制同一素材在一张画板只能出现一次。事务迁移保留全部既有元素，
  // 只移除该唯一约束，使每次放置都由独立的 canvas_items.id 表示。
  migrateSchema(db);
  allowRepeatedCanvasAssets(db);
  // 示例数据只允许在开发模式或显式开启时写入；生产环境绝不自动写入，
  // 否则空库/路径配置错误会被静默伪装成“示例素材库”。
  if (seedDemo) seed(db);
  return db;
}
