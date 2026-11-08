import { randomUUID } from "node:crypto";

function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function createPreviewPage(db, projectId, name = "Page 1") {
  const id = randomUUID();
  db.prepare("INSERT INTO preview_pages (id, project_id, name) VALUES (?, ?, ?)").run(id, projectId, name);
  return { id, projectId, name, selectedIds: [] };
}

// v9：旧项目维度快照迁入默认 Page。保留旧 API 表，供已有客户端继续使用。
export function migratePreviewPages(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS preview_pages (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      selected_axes TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(id, project_id)
    );
    CREATE INDEX IF NOT EXISTS preview_pages_project_idx ON preview_pages(project_id);
    CREATE TABLE IF NOT EXISTS preview_page_assets (
      page_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      PRIMARY KEY(page_id, asset_id),
      FOREIGN KEY(page_id, project_id) REFERENCES preview_pages(id, project_id) ON DELETE CASCADE,
      FOREIGN KEY(project_id, asset_id) REFERENCES project_assets(project_id, asset_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS preview_dimensions (
      id TEXT PRIMARY KEY NOT NULL,
      page_id TEXT NOT NULL REFERENCES preview_pages(id) ON DELETE CASCADE,
      left_label TEXT NOT NULL,
      right_label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      UNIQUE(page_id, id)
    );
    CREATE INDEX IF NOT EXISTS preview_dimensions_page_idx ON preview_dimensions(page_id);
    CREATE TABLE IF NOT EXISTS preview_dimension_values (
      page_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      dimension_id TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 500 CHECK(value BETWEEN 0 AND 1000),
      last_rev INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(page_id, asset_id, dimension_id),
      FOREIGN KEY(page_id, asset_id) REFERENCES preview_page_assets(page_id, asset_id) ON DELETE CASCADE,
      FOREIGN KEY(page_id, dimension_id) REFERENCES preview_dimensions(page_id, id) ON DELETE CASCADE
    );
  `);
  // 同步所需的版本字段（幂等补列）：Page 级 revision + 每个坐标的 last_rev。
  {
    const pageColumns = db.prepare("PRAGMA table_info(preview_pages)").all().map((column) => column.name);
    if (!pageColumns.includes("revision")) db.exec("ALTER TABLE preview_pages ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
    const valueColumns = db.prepare("PRAGMA table_info(preview_dimension_values)").all().map((column) => column.name);
    if (!valueColumns.includes("last_rev")) db.exec("ALTER TABLE preview_dimension_values ADD COLUMN last_rev INTEGER NOT NULL DEFAULT 0");
    const dimensionColumns = db.prepare("PRAGMA table_info(preview_dimensions)").all().map((column) => column.name);
    if (!dimensionColumns.includes("description")) db.exec("ALTER TABLE preview_dimensions ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (db.prepare("PRAGMA user_version").get().user_version >= 9) return;
  transaction(db, () => {
    for (const project of db.prepare("SELECT id FROM projects").all()) {
      const page = createPreviewPage(db, project.id, "默认画板");
      db.prepare(`INSERT INTO preview_page_assets (page_id, project_id, asset_id)
        SELECT ?, project_id, asset_id FROM project_assets WHERE project_id = ?`).run(page.id, project.id);
      db.prepare(`INSERT INTO preview_dimensions (id, page_id, left_label, right_label, sort_order)
        SELECT id, ?, left_label, right_label, sort_order FROM project_dimensions WHERE project_id = ?`).run(page.id, project.id);
      db.prepare(`INSERT INTO preview_dimension_values (page_id, asset_id, dimension_id, value)
        SELECT ?, pa.asset_id, pd.id, COALESCE(v.value, 500)
        FROM project_assets pa JOIN project_dimensions pd ON pd.project_id = pa.project_id
        LEFT JOIN asset_dimension_values v ON v.project_id = pa.project_id AND v.asset_id = pa.asset_id AND v.dimension_id = pd.id
        WHERE pa.project_id = ?`).run(page.id, project.id);
      const axes = db.prepare("SELECT id FROM preview_dimensions WHERE page_id = ? ORDER BY sort_order LIMIT 3").all(page.id).map((d) => d.id);
      db.prepare("UPDATE preview_pages SET selected_axes = ? WHERE id = ?").run(JSON.stringify(axes), page.id);
    }
    db.exec("PRAGMA user_version = 9");
  });
}

const bad = (error, status = 400) => Response.json({ error }, { status });
const clean = (value, max = 80) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function handlePreviewPages(request, { db }) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;
  let payload = {};
  if (["POST", "PATCH"].includes(method)) {
    try { payload = await request.json(); } catch { return bad("请求内容必须是 JSON"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return bad("请求内容必须是对象");
  }
  const projectId = clean(payload.projectId ?? url.searchParams.get("projectId"));
  if (!projectId) return bad("缺少项目 ID");
  if (!db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) return bad("项目不存在", 404);
  if (path === "/api/preview-pages" && method === "GET") {
    const pages = db.prepare(`SELECT p.id, p.name, p.project_id AS projectId,
      (SELECT COUNT(*) FROM preview_page_assets pa JOIN assets a ON a.id = pa.asset_id WHERE pa.page_id = p.id AND a.deleted_at IS NULL) AS assetCount
      FROM preview_pages p WHERE p.project_id = ? ORDER BY p.created_at, p.rowid`).all(projectId);
    return Response.json({ pages });
  }
  if (path === "/api/preview-pages" && method === "POST") {
    const name = clean(payload.name, 50);
    if (!name) return bad("Page 名称不能为空");
    return Response.json({ page: createPreviewPage(db, projectId, name) }, { status: 201 });
  }
  const pageId = clean(payload.pageId ?? url.searchParams.get("pageId"));
  const page = db.prepare("SELECT id, project_id AS projectId, name, selected_axes, revision FROM preview_pages WHERE id = ? AND project_id = ?").get(pageId, projectId);
  if (!page) return bad("Page 不存在", 404);
  if (path === "/api/preview-pages" && method === "DELETE") {
    db.prepare("DELETE FROM preview_pages WHERE id = ?").run(pageId);
    return Response.json({ ok: true });
  }
  if (path === "/api/preview-pages" && method === "PATCH") {
    const name = clean(payload.name, 50);
    if (payload.name !== undefined && !name) return bad("Page 名称不能为空");
    if (payload.selectedIds !== undefined) {
      const ids = payload.selectedIds;
      if (!Array.isArray(ids) || ids.length > 3 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !db.prepare("SELECT id FROM preview_dimensions WHERE page_id = ? AND id = ?").get(pageId, id))) return bad("请选择当前 Page 的最多三个维度");
    }
    transaction(db, () => {
      if (payload.name !== undefined) db.prepare("UPDATE preview_pages SET name = ? WHERE id = ?").run(name, pageId);
      if (payload.selectedIds !== undefined) db.prepare("UPDATE preview_pages SET selected_axes = ? WHERE id = ?").run(JSON.stringify(payload.selectedIds), pageId);
    });
    return Response.json({ ok: true });
  }
  if (path === "/api/preview-page" && method === "GET") {
    const dimensions = db.prepare(`SELECT d.id, p.project_id AS projectId, d.page_id AS pageId, d.left_label AS leftLabel, d.right_label AS rightLabel, d.description, d.sort_order AS sortOrder
      FROM preview_dimensions d JOIN preview_pages p ON p.id = d.page_id WHERE d.page_id = ? ORDER BY d.sort_order, d.id`).all(pageId);
    const rows = db.prepare(`SELECT pa.asset_id AS assetId FROM preview_page_assets pa JOIN assets a ON a.id = pa.asset_id WHERE pa.page_id = ? AND a.deleted_at IS NULL`).all(pageId);
    const values = db.prepare("SELECT asset_id AS assetId, dimension_id AS dimensionId, value, last_rev AS lastRev FROM preview_dimension_values WHERE page_id = ?").all(pageId);
    const map = new Map(rows.map(({ assetId }) => [assetId, {}]));
    const revMap = new Map(rows.map(({ assetId }) => [assetId, {}]));
    for (const v of values) {
      if (!map.has(v.assetId)) continue;
      map.get(v.assetId)[v.dimensionId] = v.value;
      revMap.get(v.assetId)[v.dimensionId] = v.lastRev;
    }
    return Response.json({ page: {
      id: page.id, projectId, name: page.name,
      selectedIds: JSON.parse(page.selected_axes).filter((id) => dimensions.some((d) => d.id === id)),
      dimensions,
      assets: rows.map(({ assetId }) => ({ assetId, dimensionValues: map.get(assetId), valueRevs: revMap.get(assetId) })),
      revision: page.revision,
    } });
  }
  if (path === "/api/preview-page-assets" && method === "POST") {
    const ids = payload.assetIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((id) => typeof id !== "string")) return bad("请选择 1～1000 个项目素材");
    const unique = [...new Set(ids)];
    const find = db.prepare("SELECT a.id FROM project_assets pa JOIN assets a ON a.id = pa.asset_id WHERE pa.project_id = ? AND pa.asset_id = ? AND a.deleted_at IS NULL");
    if (unique.some((id) => !find.get(projectId, id))) return bad("部分素材不在当前项目中", 404);
    transaction(db, () => {
      for (const id of unique) {
        db.prepare("INSERT OR IGNORE INTO preview_page_assets (page_id, project_id, asset_id) VALUES (?, ?, ?)").run(pageId, projectId, id);
        db.prepare(`INSERT OR IGNORE INTO preview_dimension_values (page_id, asset_id, dimension_id, value)
          SELECT ?, ?, id, 500 FROM preview_dimensions WHERE page_id = ?`).run(pageId, id, pageId);
      }
    });
    return Response.json({ ok: true });
  }
  if (path === "/api/preview-page-assets" && method === "DELETE") {
    db.prepare("DELETE FROM preview_page_assets WHERE page_id = ? AND asset_id = ?").run(pageId, clean(url.searchParams.get("assetId")));
    db.prepare("UPDATE preview_pages SET revision = revision + 1 WHERE id = ?").run(pageId);
    return Response.json({ ok: true });
  }
  if (path === "/api/preview-dimensions" && method === "POST") {
    const leftLabel = clean(payload.leftLabel, 24), rightLabel = clean(payload.rightLabel, 24);
    const description = clean(payload.description, 500);
    if (!leftLabel || !rightLabel || leftLabel === rightLabel) return bad("请填写不相同的维度两端名称");
    const id = randomUUID();
    transaction(db, () => {
      const { next } = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM preview_dimensions WHERE page_id = ?").get(pageId);
      db.prepare("INSERT INTO preview_dimensions (id, page_id, left_label, right_label, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)").run(id, pageId, leftLabel, rightLabel, description, next);
      db.prepare(`INSERT INTO preview_dimension_values (page_id, asset_id, dimension_id, value)
        SELECT page_id, asset_id, ?, 500 FROM preview_page_assets WHERE page_id = ?`).run(id, pageId);
      const axes = JSON.parse(page.selected_axes);
      if (axes.length < 3) db.prepare("UPDATE preview_pages SET selected_axes = ? WHERE id = ?").run(JSON.stringify([...axes, id]), pageId);
    });
    return Response.json({ dimension: { id, pageId, projectId, leftLabel, rightLabel, description } }, { status: 201 });
  }
  if (path === "/api/preview-dimensions" && method === "PATCH") {
    const updates = payload.dimensions;
    if (!Array.isArray(updates) || !updates.length || updates.some((d) => !d || !clean(d.leftLabel, 24) || !clean(d.rightLabel, 24) || clean(d.leftLabel, 24) === clean(d.rightLabel, 24))) return bad("请填写不相同的维度两端名称");
    if (updates.some((d) => !db.prepare("SELECT id FROM preview_dimensions WHERE page_id = ? AND id = ?").get(pageId, clean(d.id)))) return bad("维度不存在", 404);
    transaction(db, () => {
      for (const d of updates) db.prepare("UPDATE preview_dimensions SET left_label = ?, right_label = ?, description = ? WHERE page_id = ? AND id = ?").run(clean(d.leftLabel, 24), clean(d.rightLabel, 24), clean(d.description, 500), pageId, d.id);
    });
    return Response.json({ ok: true });
  }
  if (path === "/api/preview-dimensions" && method === "DELETE") {
    const id = clean(url.searchParams.get("id"));
    transaction(db, () => {
      db.prepare("DELETE FROM preview_dimensions WHERE page_id = ? AND id = ?").run(pageId, id);
      db.prepare("UPDATE preview_pages SET selected_axes = ? WHERE id = ?").run(JSON.stringify(JSON.parse(page.selected_axes).filter((axis) => axis !== id)), pageId);
    });
    return Response.json({ ok: true });
  }
  if (path === "/api/preview-values" && method === "PATCH") {
    const isBatch = Array.isArray(payload.updates);
    const updates = [];
    if (isBatch) {
      if (!payload.updates.length) return bad("没有要提交的坐标");
      if (payload.updates.length > 200) return bad("单次最多提交 200 条坐标");
      for (const entry of payload.updates) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return bad("坐标格式不正确");
        const assetId = clean(entry.assetId);
        const values = entry.values;
        if (!assetId || !values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length) return bad("坐标格式不正确");
        if (Object.values(values).some((v) => !Number.isInteger(v) || v < 0 || v > 1000)) return bad("维度值必须是 0～1000 的整数");
        updates.push({ assetId, values });
      }
    } else {
      const assetId = clean(payload.assetId), values = payload.values;
      if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length || Object.values(values).some((v) => !Number.isInteger(v) || v < 0 || v > 1000)) return bad("维度值必须是 0～1000 的整数");
      updates.push({ assetId, values });
    }

    const failed = [];
    const accepted = [];
    const pageAssetStmt = db.prepare(`SELECT pa.asset_id FROM preview_page_assets pa JOIN assets a ON a.id = pa.asset_id WHERE pa.page_id = ? AND pa.asset_id = ? AND a.deleted_at IS NULL`);
    const dimensionStmt = db.prepare("SELECT id FROM preview_dimensions WHERE page_id = ? AND id = ?");
    for (const update of updates) {
      if (!pageAssetStmt.get(pageId, update.assetId)) { failed.push({ assetId: update.assetId, reason: "not_in_page" }); continue; }
      if (Object.keys(update.values).some((id) => !dimensionStmt.get(pageId, id))) { failed.push({ assetId: update.assetId, reason: "dimension_not_in_page" }); continue; }
      accepted.push(update);
    }
    if (!accepted.length) {
      // 旧调用方（单条 body）继续用 404 表达"素材/维度不在此 Page"，新批量形态用 failed 逐条返回。
      if (!isBatch) {
        const reason = failed[0] && failed[0].reason;
        if (reason === "not_in_page") return bad("素材不在当前 Page 中", 404);
        if (reason === "dimension_not_in_page") return bad("维度不在当前 Page 中", 404);
      }
      return Response.json({ ok: true, revision: page.revision, updates: [], failed });
    }

    let revision = page.revision;
    transaction(db, () => {
      db.prepare("UPDATE preview_pages SET revision = revision + 1 WHERE id = ?").run(pageId);
      revision = db.prepare("SELECT revision FROM preview_pages WHERE id = ?").get(pageId).revision;
      const updateStmt = db.prepare("UPDATE preview_dimension_values SET value = ?, last_rev = ? WHERE page_id = ? AND asset_id = ? AND dimension_id = ?");
      for (const update of accepted) for (const [dimensionId, value] of Object.entries(update.values)) updateStmt.run(value, revision, pageId, update.assetId, dimensionId);
    });

    const assetIds = accepted.map((entry) => entry.assetId);
    const placeholders = assetIds.map(() => "?").join(", ");
    const rows = db.prepare(`SELECT asset_id AS assetId, dimension_id AS dimensionId, value, last_rev AS lastRev
      FROM preview_dimension_values WHERE page_id = ? AND asset_id IN (${placeholders})`).all(pageId, ...assetIds);
    const grouped = new Map(assetIds.map((assetId) => [assetId, []]));
    for (const row of rows) {
      if (!grouped.has(row.assetId)) continue;
      grouped.get(row.assetId).push({ dimensionId: row.dimensionId, value: row.value, lastRev: row.lastRev });
    }
    return Response.json({
      ok: true,
      revision,
      updates: assetIds.map((assetId) => ({ assetId, values: grouped.get(assetId) })),
      failed,
    });
  }
  return bad("Not found", 404);
}
