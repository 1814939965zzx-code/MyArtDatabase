import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

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
  tags TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  z_index INTEGER NOT NULL DEFAULT 0,
  rotation INTEGER NOT NULL DEFAULT 0,
  UNIQUE(canvas_id, asset_id)
);
CREATE INDEX IF NOT EXISTS project_assets_project_idx ON project_assets(project_id);
CREATE INDEX IF NOT EXISTS dimensions_project_idx ON project_dimensions(project_id);
CREATE INDEX IF NOT EXISTS assets_sha256_idx ON assets(sha256);
CREATE INDEX IF NOT EXISTS canvases_project_idx ON canvases(project_id);
CREATE INDEX IF NOT EXISTS canvas_items_canvas_idx ON canvas_items(canvas_id);
`;

const SEED_ASSETS = [
  ["asset-01", "雾中建筑", "mist-architecture.jpg", "artdatabase-mist", "建筑,氛围,灰调"],
  ["asset-02", "红色机械臂", "red-robot-arm.jpg", "artdatabase-robot", "机械,红色,工业"],
  ["asset-03", "流体金属", "liquid-metal.jpg", "artdatabase-metal", "材质,银色,流体"],
  ["asset-04", "透明结构", "glass-structure.jpg", "artdatabase-glass", "透明,结构,空间"],
  ["asset-05", "荒漠装置", "desert-installation.jpg", "artdatabase-desert", "装置,荒漠,暖色"],
  ["asset-06", "蓝色界面", "blue-interface.jpg", "artdatabase-interface", "界面,蓝色,科技"],
  ["asset-07", "织物微距", "fabric-closeup.jpg", "artdatabase-fabric", "织物,微距,触感"],
  ["asset-08", "光影廊道", "light-corridor.jpg", "artdatabase-light", "光影,空间,极简"],
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

    const insertAsset = db.prepare("INSERT INTO assets (id, name, file_name, thumbnail_url, tags) VALUES (?, ?, ?, ?, ?)");
    const insertLink = db.prepare("INSERT INTO project_assets (project_id, asset_id) VALUES (?, ?)");
    const insertValue = db.prepare("INSERT INTO asset_dimension_values (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, ?)");
    SEED_ASSETS.forEach(([id, name, fileName, imageSeed, tags], index) => {
      insertAsset.run(id, name, fileName, `https://picsum.photos/seed/${imageSeed}/900/700`, tags);
      insertLink.run("project-visual-direction", id);
      insertValue.run("project-visual-direction", id, "dimension-form", 160 + index * 95);
      insertValue.run("project-visual-direction", id, "dimension-temperature", [210, 820, 420, 170, 880, 350, 610, 290][index]);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(dbPath) {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  seed(db);
  return db;
}
