import { randomUUID } from "node:crypto";

/** 标签数量上限：单素材标签总数（人工 + AI 统一）。 */
export const MAX_ASSET_TAGS = 50;

/**
 * 归一化标签名：去首尾空格、全角 ASCII 转半角、转小写。
 * 用于"相同标签"判定（精确匹配与去重），不改写存储的展示名。
 */
export function normalizeTag(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\uFF01-\uFF5E]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

/** 按归一化名称查找标签；不存在返回 null。 */
export function findTagByName(db, name) {
  const key = normalizeTag(name);
  return db.prepare("SELECT id, name, source, created_at AS createdAt, updated_at AS updatedAt FROM tags").all()
    .find((row) => normalizeTag(row.name) === key) ?? null;
}

/** 查找或创建标签；新标签的来源记为 source（manual/ai）。 */
export function findOrCreateTag(db, name, source = "manual") {
  const existing = findTagByName(db, name);
  if (existing) return existing;
  const id = randomUUID();
  const displayName = String(name).trim();
  db.prepare("INSERT INTO tags (id, name, source) VALUES (?, ?, ?)").run(id, displayName, source);
  return { id, name: displayName, source, createdAt: null, updatedAt: null };
}

/**
 * 列出标签字典（含使用计数）。
 * usageCount 只统计未被软删除素材上的关联；零引用标签保留在字典中供 AI 复用。
 */
export function listTags(db) {
  return db.prepare(`
    SELECT t.id, t.name, t.source, t.created_at AS createdAt, t.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM asset_tags at
        INNER JOIN assets a ON a.id = at.asset_id AND a.deleted_at IS NULL
        WHERE at.tag_id = t.id) AS usageCount
    FROM tags t
  `).all();
}

/** 读取单个素材的标签名，按 position 排序。 */
export function getAssetTagNames(db, assetId) {
  return db.prepare(`
    SELECT t.name FROM asset_tags at
    INNER JOIN tags t ON t.id = at.tag_id
    WHERE at.asset_id = ?
    ORDER BY at.position, at.created_at, t.name
  `).all(assetId).map((row) => row.name);
}

/** 把新标签挂到素材末尾（position 取当前最大值 + 1）。 */
export function attachTagToAsset(db, assetId, tagId, { source = "manual" } = {}) {
  const { next } = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM asset_tags WHERE asset_id = ?").get(assetId);
  db.prepare("INSERT INTO asset_tags (asset_id, tag_id, position, source) VALUES (?, ?, ?, ?)").run(assetId, tagId, next, source);
}

/**
 * 用一份有序标签名整体替换素材的标签集合：
 * - 已存在的关联只更新 position，保留原 source（避免编辑名称把 AI 标签洗成人工来源）；
 * - 新增关联的 source 由参数指定；不再出现的关联删除。
 */
export function replaceAssetTags(db, assetId, names, { source = "manual", inTransaction = false } = {}) {
  const cleaned = [...new Set(names.map((name) => String(name).trim()).filter(Boolean))].slice(0, MAX_ASSET_TAGS);
  const current = db.prepare("SELECT tag_id AS tagId FROM asset_tags WHERE asset_id = ?").all(assetId).map((row) => row.tagId);
  const currentSet = new Set(current);
  const nextSet = new Set();
  if (!inTransaction) db.exec("BEGIN");
  try {
    cleaned.forEach((name, index) => {
      const tag = findOrCreateTag(db, name, source);
      nextSet.add(tag.id);
      if (currentSet.has(tag.id)) {
        db.prepare("UPDATE asset_tags SET position = ? WHERE asset_id = ? AND tag_id = ?").run(index, assetId, tag.id);
      } else {
        db.prepare("INSERT INTO asset_tags (asset_id, tag_id, position, source) VALUES (?, ?, ?, ?)").run(assetId, tag.id, index, source);
      }
    });
    for (const tagId of current) {
      if (!nextSet.has(tagId)) db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?").run(assetId, tagId);
    }
    if (!inTransaction) db.exec("COMMIT");
  } catch (error) {
    if (!inTransaction) db.exec("ROLLBACK");
    throw error;
  }
  return cleaned;
}

/** 合并两个标签：源标签的全部素材关联并入目标（已同时挂两者时去重），源标签从字典删除。 */
export function mergeTags(db, sourceId, targetId) {
  if (sourceId === targetId) return { merged: false };
  const source = db.prepare("SELECT id FROM tags WHERE id = ?").get(sourceId);
  const target = db.prepare("SELECT id FROM tags WHERE id = ?").get(targetId);
  if (!source || !target) throw new Error("标签不存在");
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE asset_tags SET tag_id = ?
      WHERE tag_id = ? AND asset_id NOT IN (SELECT asset_id FROM asset_tags WHERE tag_id = ?)
    `).run(targetId, sourceId, targetId);
    db.prepare("DELETE FROM asset_tags WHERE tag_id = ?").run(sourceId);
    db.prepare("DELETE FROM tags WHERE id = ?").run(sourceId);
    db.prepare("UPDATE tags SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(targetId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { merged: true };
}
