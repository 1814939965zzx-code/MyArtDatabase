import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanId(value) {
  return typeof value === "string" ? value.trim().slice(0,80) : "";
}

function number(value, fallback, min, max) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function errorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}

// ---- 项目 ----
function listProjects({ db }) {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.description,
      p.created_at AS createdAt, p.updated_at AS updatedAt,
      COUNT(DISTINCT a.id) AS assetCount,
      COUNT(DISTINCT pd.id) AS dimensionCount
    FROM projects p
    LEFT JOIN project_assets pa ON pa.project_id = p.id
    LEFT JOIN assets a ON a.id = pa.asset_id AND a.deleted_at IS NULL
    LEFT JOIN project_dimensions pd ON pd.project_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC, assetCount DESC, p.created_at DESC
  `).all();
  return Response.json({ projects: rows });
}

async function createProject(request, { db }) {
  const payload = await request.json();
  const name = cleanText(payload.name, 50);
  const description = cleanText(payload.description, 240);
  if (!name) return Response.json({ error: "项目名称不能为空" }, { status: 400 });
  const id = randomUUID();
  db.prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)").run(id, name, description);
  return Response.json({ project: { id, name, description } }, { status: 201 });
}

async function updateProject(request, { db }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  const name = cleanText(payload.name, 50);
  const description = cleanText(payload.description, 240);
  if (!id || !name) return Response.json({ error: "缺少项目 ID 或名称" }, { status: 400 });
  const result = db.prepare("UPDATE projects SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(name, description, id);
  if (!result.changes) return Response.json({ error: "项目不存在" }, { status: 404 });
  return Response.json({ project: { id, name, description } });
}

function deleteProject(request, { db }) {
  const id = cleanId(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "缺少项目 ID" }, { status: 400 });
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  if (!result.changes) return Response.json({ error: "项目不存在" }, { status: 404 });
  return Response.json({ ok: true });
}

// ---- 维度 ----
async function createDimension(request, { db }) {
  const payload = await request.json();
  const projectId = cleanText(payload.projectId, 80);
  const leftLabel = cleanText(payload.leftLabel, 24);
  const rightLabel = cleanText(payload.rightLabel, 24);
  if (!projectId || !leftLabel || !rightLabel) return Response.json({ error: "请填写维度两端的名称" }, { status: 400 });
  if (leftLabel === rightLabel) return Response.json({ error: "维度两端不能相同" }, { status: 400 });
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM project_dimensions WHERE project_id = ?").get(projectId);
  const sortOrder = count;
  const id = randomUUID();
  const assets = db.prepare("SELECT asset_id AS assetId FROM project_assets WHERE project_id = ?").all(projectId);
  transaction(db, () => {
    db.prepare("INSERT INTO project_dimensions (id, project_id, left_label, right_label, sort_order) VALUES (?, ?, ?, ?, ?)")
      .run(id, projectId, leftLabel, rightLabel, sortOrder);
    const insertValue = db.prepare("INSERT INTO asset_dimension_values (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, 500)");
    for (const { assetId } of assets) insertValue.run(projectId, assetId, id);
    db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
  });
  return Response.json({ dimension: { id, projectId, leftLabel, rightLabel, sortOrder } }, { status: 201 });
}

function deleteDimension(request, { db }) {
  const url = new URL(request.url);
  const id = cleanId(url.searchParams.get("id"));
  const projectId = cleanId(url.searchParams.get("projectId"));
  if (!id || !projectId) return Response.json({ error: "缺少维度或项目 ID" }, { status: 400 });
  const dimension = db.prepare("SELECT sort_order AS sortOrder FROM project_dimensions WHERE id = ? AND project_id = ?").get(id, projectId);
  if (!dimension) return Response.json({ error: "维度不存在" }, { status: 404 });
  const result = db.prepare("DELETE FROM project_dimensions WHERE id = ? AND project_id = ?").run(id, projectId);
  if (!result.changes) return Response.json({ error: "维度不存在" }, { status: 404 });
  transaction(db, () => {
    db.prepare("UPDATE project_dimensions SET sort_order = sort_order - 1 WHERE project_id = ? AND sort_order > ?").run(projectId, dimension.sortOrder);
    db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
  });
  return Response.json({ ok: true });
}

// ---- 维度值 ----
async function updateDimensionValue(request, { db }) {
  const payload = await request.json();
  const projectId = cleanId(payload.projectId);
  const assetId = cleanId(payload.assetId);
  const dimensionId = cleanId(payload.dimensionId);
  const numericValue = typeof payload.value === "number" ? payload.value : Number.NaN;
  const value = Math.round(numericValue);
  if (!projectId || !assetId || !dimensionId || !Number.isFinite(value)) {
    return Response.json({ error: "维度值参数不完整" }, { status: 400 });
  }
  if (value < 0 || value > 1000) return Response.json({ error: "维度值必须在 0 到 1000 之间" }, { status: 400 });
  const result = db.prepare("UPDATE asset_dimension_values SET value = ? WHERE project_id = ? AND asset_id = ? AND dimension_id = ?")
    .run(value, projectId, assetId, dimensionId);
  if (!result.changes) return Response.json({ error: "该素材没有对应的维度值" }, { status: 404 });
  return Response.json({ value });
}

// ---- 项目工作区 ----
function workspace(request, { db }) {
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) return Response.json({ error: "缺少项目 ID" }, { status: 400 });
  const project = db.prepare("SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?").get(projectId);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  const dimensions = db.prepare("SELECT id, project_id AS projectId, left_label AS leftLabel, right_label AS rightLabel, sort_order AS sortOrder FROM project_dimensions WHERE project_id = ? ORDER BY sort_order").all(projectId);
  const assets = db.prepare(`SELECT a.id, a.name, a.file_name AS fileName,
    CASE WHEN a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL
      THEN '/api/media?id=' || a.id || '&variant=thumbnail' ELSE a.thumbnail_url END AS thumbnailUrl,
    CASE WHEN a.storage_key IS NOT NULL
      THEN '/api/media?id=' || a.id || '&variant=original' ELSE a.thumbnail_url END AS originalUrl,
    a.tags, a.description, a.notes, a.source_url AS sourceUrl,
    a.file_size AS fileSize, a.width, a.height, a.mime_type AS mimeType,
    a.created_at AS createdAt
    FROM assets a
    INNER JOIN project_assets pa ON pa.asset_id = a.id
    WHERE pa.project_id = ? AND a.deleted_at IS NULL ORDER BY pa.created_at DESC, a.id`).all(projectId);
  const values = db.prepare("SELECT asset_id AS assetId, dimension_id AS dimensionId, value FROM asset_dimension_values WHERE project_id = ?").all(projectId);

  const valueMap = new Map();
  for (const row of values) {
    const current = valueMap.get(row.assetId) ?? {};
    current[row.dimensionId] = row.value;
    valueMap.set(row.assetId, current);
  }
  return Response.json({
    project,
    dimensions,
    assets: assets.map((asset) => ({
      ...asset,
      tags: asset.tags ? asset.tags.split(",") : [],
      dimensionValues: valueMap.get(asset.id) ?? {},
    })),
  });
}

// ---- 上传与重复检查 ----
async function checkUpload(request, { db }) {
  const payload = await request.json();
  const sha256 = typeof payload.sha256 === "string" ? payload.sha256.trim().toLowerCase() : "";
  const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
  if (!/^[a-f0-9]{64}$/.test(sha256) || !projectId) return Response.json({ error: "文件哈希或项目参数无效" }, { status: 400 });
  const duplicates = db.prepare(`
    SELECT a.id, a.name, a.file_name AS fileName,
      CASE WHEN a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL
        THEN '/api/media?id=' || a.id || '&variant=thumbnail' ELSE a.thumbnail_url END AS thumbnailUrl,
      EXISTS(SELECT 1 FROM project_assets pa WHERE pa.asset_id = a.id AND pa.project_id = ?) AS inProject
    FROM assets a
    WHERE a.sha256 = ? AND a.deleted_at IS NULL
    ORDER BY a.created_at DESC
  `).all(projectId, sha256);
  return Response.json({ duplicates });
}

async function upload(request, { db, store }) {
  let storedId = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) {
      return Response.json({ error: "仅支持 JPEG、PNG 和 WebP 图片" }, { status: 400 });
    }
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
      return Response.json({ error: "图片不能超过 50MB" }, { status: 400 });
    }
    const projectId = cleanText(form.get("projectId"), 80);
    const name = cleanText(form.get("name"), 120) || file.name.slice(0, 120);
    const description = cleanText(form.get("description"), 2000);
    const notes = cleanText(form.get("notes"), 2000);
    const sourceUrl = cleanText(form.get("sourceUrl"), 1000);
    const tags = cleanText(form.get("tags"), 800).split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20).join(",");
    const allowDuplicate = form.get("allowDuplicate") === "true";
    const rawDimensionValues = cleanText(form.get("dimensionValues"), 4000);
    const dimensionValues = rawDimensionValues ? JSON.parse(rawDimensionValues) : {};
    if (!projectId) return Response.json({ error: "缺少目标项目" }, { status: 400 });

    const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
    if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicate = db.prepare("SELECT id, name FROM assets WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1").get(sha256);
    if (duplicate && !allowDuplicate) {
      return Response.json({ error: "发现完全相同的素材", duplicate }, { status: 409 });
    }

    const id = randomUUID();
    const stored = await store.put(buffer, file.type);
    storedId = stored.id;

    const dimensions = db.prepare("SELECT id FROM project_dimensions WHERE project_id = ? ORDER BY sort_order").all(projectId);
    try {
      transaction(db, () => {
        db.prepare(`INSERT INTO assets (id, name, file_name, sha256, file_size, width, height, mime_type, tags, description, notes, source_url, storage_key, thumbnail_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, name, file.name, sha256, file.size, stored.width, stored.height, file.type, tags, description, notes, sourceUrl, stored.id, stored.id);
        db.prepare("INSERT INTO project_assets (project_id, asset_id) VALUES (?, ?)").run(projectId, id);
        const insertValue = db.prepare("INSERT INTO asset_dimension_values (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, ?)");
        for (const { id: dimensionId } of dimensions) {
          const candidate = Math.round(Number(dimensionValues[dimensionId] ?? 500));
          const value = Number.isFinite(candidate) ? Math.min(1000, Math.max(0, candidate)) : 500;
          insertValue.run(projectId, id, dimensionId, value);
        }
        db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
      });
    } catch (error) {
      await store.remove(stored.id).catch(() => {});
      throw error;
    }
    return Response.json({ asset: { id, name, fileName: file.name, sha256 } }, { status: 201 });
  } catch (error) {
    if (storedId) await store.remove(storedId).catch(() => {});
    return Response.json({ error: errorMessage(error, "上传失败") }, { status: 500 });
  }
}

// ---- 媒体 ----
async function media(request, { db, store }) {
  try {
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") || "").trim();
    const variant = url.searchParams.get("variant") === "thumbnail" ? "thumbnail" : "original";
    if (!id) return new Response("Missing asset id", { status: 400 });
    const asset = db.prepare("SELECT storage_key AS storageKey, thumbnail_key AS thumbnailKey, mime_type AS mimeType FROM assets WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!asset) return new Response("Not found", { status: 404 });
    const key = variant === "thumbnail" ? (asset.thumbnailKey || asset.storageKey) : asset.storageKey;
    if (!key) return new Response("Not found", { status: 404 });
    const opened = await store.open(key, variant);
    if (!opened) return new Response("Not found", { status: 404 });
    return new Response(Readable.toWeb(opened.stream), {
      headers: {
        "content-type": variant === "thumbnail" ? "image/webp" : asset.mimeType,
        "content-length": String(opened.size),
        "cache-control": "private, max-age=3600",
        "etag": `"${opened.size}-${Math.round(opened.mtimeMs)}"`,
      },
    });
  } catch (error) {
    return new Response(errorMessage(error, "Media error"), { status: 500 });
  }
}

// ---- 素材 ----
async function updateAsset(request, { db }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
  const existing = db.prepare("SELECT tags FROM assets WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!existing) return Response.json({ error: "素材不存在" }, { status: 404 });
  const deleteTag = cleanText(payload.deleteTag, 800);
  if (deleteTag) {
    const tags = existing.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag && tag !== deleteTag).join(",");
    db.prepare("UPDATE assets SET tags = ? WHERE id = ? AND deleted_at IS NULL").run(tags, id);
    return Response.json({ ok: true, deletedTag: deleteTag });
  }
  const name = cleanText(payload.name, 120);
  if (!name) return Response.json({ error: "素材名称不能为空" }, { status: 400 });
  const tags = cleanText(payload.tags, 800).split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20).join(",");
  const description = cleanText(payload.description, 2000);
  const notes = cleanText(payload.notes, 2000);
  const sourceUrl = cleanText(payload.sourceUrl, 1000);
  const result = db.prepare("UPDATE assets SET name = ?, tags = ?, description = ?, notes = ?, source_url = ? WHERE id = ? AND deleted_at IS NULL")
    .run(name, tags, description, notes, sourceUrl, id);
  if (!result.changes) return Response.json({ error: "素材不存在" }, { status: 404 });
  return Response.json({ ok: true });
}

async function deleteAsset(request, { db, store }) {
  const url = new URL(request.url);
  const id = cleanId(url.searchParams.get("id"));
  const permanent = url.searchParams.get("mode") === "permanent";
  const force = url.searchParams.get("force") === "true";
  if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });

  if (!permanent) {
    const result = db.prepare("UPDATE assets SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
    if (!result.changes) return Response.json({ error: "素材不存在" }, { status: 404 });
    return Response.json({ ok: true, trashed: true });
  }

  const asset = db.prepare(`SELECT storage_key AS storageKey, thumbnail_key AS thumbnailKey,
    (SELECT COUNT(*) FROM project_assets WHERE asset_id = assets.id) AS referenceCount
    FROM assets WHERE id = ?`).get(id);
  if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
  if (asset.referenceCount > 0 && !force) return Response.json({ error: "素材仍被项目引用，不能彻底删除" }, { status: 409 });

  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
  const keys = [...new Set([asset.storageKey, asset.thumbnailKey].filter(Boolean))];
  await Promise.all(keys.map((key) => store.remove(key)));
  return Response.json({ ok: true, permanent: true });
}

async function restoreAsset(request, { db }) {
  const payload = await request.json();
  const id = typeof payload.id === "string" ? payload.id.trim().slice(0, 80) : "";
  if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
  const result = db.prepare("UPDATE assets SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL").run(id);
  if (!result.changes) return Response.json({ error: "素材不存在" }, { status: 404 });
  return Response.json({ ok: true });
}

// ---- 全局素材库 ----
function library({ db }) {
  const assets = db.prepare(`SELECT a.id, a.name, a.file_name AS fileName,
    CASE WHEN a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL
      THEN '/api/media?id=' || a.id || '&variant=thumbnail' ELSE a.thumbnail_url END AS thumbnailUrl,
    CASE WHEN a.storage_key IS NOT NULL
      THEN '/api/media?id=' || a.id || '&variant=original' ELSE a.thumbnail_url END AS originalUrl,
    a.tags, a.description, a.notes, a.source_url AS sourceUrl,
    a.file_size AS fileSize, a.width, a.height, a.mime_type AS mimeType,
    a.created_at AS createdAt
    FROM assets a
    WHERE a.deleted_at IS NULL
    ORDER BY a.created_at DESC, a.id`).all();
  const references = db.prepare(`SELECT pa.asset_id AS assetId, p.id AS projectId, p.name AS projectName
    FROM project_assets pa
    INNER JOIN projects p ON p.id = pa.project_id
    INNER JOIN assets a ON a.id = pa.asset_id
    WHERE a.deleted_at IS NULL
    ORDER BY p.name, p.id`).all();
  const projectMap = new Map();
  for (const reference of references) {
    const current = projectMap.get(reference.assetId) ?? [];
    current.push({ id: reference.projectId, name: reference.projectName });
    projectMap.set(reference.assetId, current);
  }
  return Response.json({
    assets: assets.map((asset) => ({
      ...asset,
      tags: asset.tags ? asset.tags.split(",") : [],
      projects: projectMap.get(asset.id) ?? [],
    })),
  });
}

// ---- 项目素材引用 ----
async function assignAssets(request, { db }) {
  const payload = await request.json();
  const projectIds = Array.isArray(payload.projectIds)
    ? [...new Set(payload.projectIds.map((v) => cleanText(v, 80)).filter(Boolean))]
    : [cleanText(payload.projectId, 80)].filter(Boolean);
  const assetId = cleanText(payload.assetId, 80);
  if (!projectIds.length || !assetId) return Response.json({ error: "参数不完整" }, { status: 400 });

  const asset = db.prepare("SELECT id FROM assets WHERE id = ? AND deleted_at IS NULL").get(assetId);
  if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });

  const placeholders = projectIds.map(() => "?").join(",");
  const projects = db.prepare(`SELECT id FROM projects WHERE id IN (${placeholders})`).all(...projectIds);
  if (projects.length !== projectIds.length) return Response.json({ error: "部分项目不存在，请刷新后重试" }, { status: 404 });

  transaction(db, () => {
    for (const projectId of projectIds) {
      db.prepare("INSERT OR IGNORE INTO project_assets (project_id, asset_id) VALUES (?, ?)").run(projectId, assetId);
      const dimensions = db.prepare("SELECT id FROM project_dimensions WHERE project_id = ?").all(projectId);
      const insertValue = db.prepare("INSERT OR IGNORE INTO asset_dimension_values (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, 500)");
      for (const { id: dimensionId } of dimensions) insertValue.run(projectId, assetId, dimensionId);
      db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
    }
  });
  return Response.json({ ok: true, projectCount: projectIds.length });
}

function removeAssetFromProject(request, { db }) {
  const url = new URL(request.url);
  const projectId = cleanText(url.searchParams.get("projectId"), 80);
  const assetId = cleanText(url.searchParams.get("assetId"), 80);
  if (!projectId || !assetId) return Response.json({ error: "参数不完整" }, { status: 400 });
  transaction(db, () => {
    db.prepare("DELETE FROM project_assets WHERE project_id = ? AND asset_id = ?").run(projectId, assetId);
    db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
  });
  return Response.json({ ok: true });
}

// ---- 画板 ----
function listCanvases(request, { db }) {
  const projectId = cleanText(new URL(request.url).searchParams.get("projectId"), 80);
  if (!projectId) return Response.json({ error: "缺少项目 ID" }, { status: 400 });
  const rows = db.prepare(`SELECT c.id, c.project_id AS projectId, c.name, c.revision,
    COUNT(ci.id) AS itemCount FROM canvases c
    LEFT JOIN canvas_items ci ON ci.canvas_id = c.id
    WHERE c.project_id = ? GROUP BY c.id ORDER BY c.updated_at DESC`).all(projectId);
  return Response.json({ canvases: rows });
}

async function createCanvas(request, { db }) {
  const payload = await request.json();
  const projectId = cleanText(payload.projectId, 80);
  const name = cleanText(payload.name, 50) || "未命名画板";
  if (!projectId) return Response.json({ error: "缺少项目 ID" }, { status: 400 });
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  const id = randomUUID();
  const revision = Date.now();
  db.prepare("INSERT INTO canvases (id, project_id, name, revision) VALUES (?, ?, ?, ?)").run(id, projectId, name, revision);
  return Response.json({ canvas: { id, projectId, name, revision, itemCount: 0 } }, { status: 201 });
}

async function renameCanvas(request, { db }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  const name = cleanText(payload.name, 50);
  if (!id || !name) return Response.json({ error: "参数不完整" }, { status: 400 });
  const revision = Date.now();
  const result = db.prepare("UPDATE canvases SET name = ?, revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(name, revision, id);
  if (!result.changes) return Response.json({ error: "画板不存在" }, { status: 404 });
  return Response.json({ canvas: { id, name, revision } });
}

function deleteCanvas(request, { db }) {
  const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
  if (!id) return Response.json({ error: "缺少画板 ID" }, { status: 400 });
  const result = db.prepare("DELETE FROM canvases WHERE id = ?").run(id);
  if (!result.changes) return Response.json({ error: "画板不存在" }, { status: 404 });
  return Response.json({ ok: true });
}

function getCanvas(request, { db }) {
  const canvasId = new URL(request.url).searchParams.get("canvasId")?.trim();
  if (!canvasId) return Response.json({ error: "缺少画板 ID" }, { status: 400 });
  const canvas = db.prepare("SELECT id, project_id AS projectId, name, revision FROM canvases WHERE id = ?").get(canvasId);
  if (!canvas) return Response.json({ error: "画板不存在" }, { status: 404 });
  const items = db.prepare(`SELECT ci.id, ci.canvas_id AS canvasId, ci.asset_id AS assetId,
    ci.x, ci.y, ci.width, ci.height, ci.z_index AS zIndex, ci.rotation,
    a.name, CASE WHEN a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL
      THEN '/api/media?id=' || a.id || '&variant=thumbnail' ELSE a.thumbnail_url END AS thumbnailUrl
    FROM canvas_items ci INNER JOIN assets a ON a.id = ci.asset_id
    WHERE ci.canvas_id = ? AND a.deleted_at IS NULL ORDER BY ci.z_index, ci.id`).all(canvasId);
  return Response.json({ canvas, items });
}

function bumpRevision(db, canvasId) {
  const revision = Date.now();
  db.prepare("UPDATE canvases SET revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(revision, canvasId);
  return revision;
}

async function addCanvasItem(request, { db }) {
  const payload = await request.json();
  const canvasId = cleanText(payload.canvasId, 80);
  const assetId = cleanText(payload.assetId, 80);
  if (!canvasId || !assetId) return Response.json({ error: "参数不完整" }, { status: 400 });
  const membership = db.prepare(`SELECT 1 FROM canvases c
    INNER JOIN project_assets pa ON pa.project_id = c.project_id
    WHERE c.id = ? AND pa.asset_id = ?`).get(canvasId, assetId);
  if (!membership) return Response.json({ error: "素材不属于当前项目" }, { status: 409 });
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM canvas_items WHERE canvas_id = ?").get(canvasId);
  if (count >= 200) return Response.json({ error: "单个画板最多放置 200 个元素" }, { status: 409 });

  const id = randomUUID();
  const item = {
    id, canvasId, assetId,
    x: number(payload.x, 120, 0, 1880),
    y: number(payload.y, 100, 0, 1080),
    width: number(payload.width, 220, 80, 800),
    height: number(payload.height, 170, 60, 800),
    zIndex: number(payload.zIndex, count + 1, 0, 10000),
    rotation: number(payload.rotation, 0, -180, 180),
  };
  db.prepare("INSERT INTO canvas_items (id, canvas_id, asset_id, x, y, width, height, z_index, rotation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(item.id, item.canvasId, item.assetId, item.x, item.y, item.width, item.height, item.zIndex, item.rotation);
  const revision = bumpRevision(db, canvasId);
  return Response.json({ item, revision }, { status: 201 });
}

async function updateCanvasItem(request, { db }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  const canvasId = cleanText(payload.canvasId, 80);
  if (!id || !canvasId) return Response.json({ error: "参数不完整" }, { status: 400 });
  const result = db.prepare(`UPDATE canvas_items SET x = ?, y = ?, width = ?, height = ?, z_index = ?, rotation = ?
    WHERE id = ? AND canvas_id = ?`)
    .run(
      number(payload.x, 0, 0, 1920), number(payload.y, 0, 0, 1120),
      number(payload.width, 220, 80, 900), number(payload.height, 170, 60, 900),
      number(payload.zIndex, 1, 0, 10000), number(payload.rotation, 0, -180, 180),
      id, canvasId,
    );
  if (!result.changes) return Response.json({ error: "元素不存在" }, { status: 404 });
  const revision = bumpRevision(db, canvasId);
  return Response.json({ ok: true, revision });
}

function deleteCanvasItem(request, { db }) {
  const url = new URL(request.url);
  const id = cleanText(url.searchParams.get("id"), 80);
  const canvasId = cleanText(url.searchParams.get("canvasId"), 80);
  if (!id || !canvasId) return Response.json({ error: "参数不完整" }, { status: 400 });
  db.prepare("DELETE FROM canvas_items WHERE id = ? AND canvas_id = ?").run(id, canvasId);
  const revision = bumpRevision(db, canvasId);
  return Response.json({ ok: true, revision });
}

// ---- 路由分发 ----
export async function handleApi(request, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  try {
    if (pathname === "/api/projects" && method === "GET") return listProjects(ctx);
    if (pathname === "/api/projects" && method === "POST") return await createProject(request, ctx);
    if (pathname === "/api/projects" && method === "PATCH") return await updateProject(request, ctx);
    if (pathname === "/api/projects" && method === "DELETE") return deleteProject(request, ctx);

    if (pathname === "/api/dimensions" && method === "POST") return await createDimension(request, ctx);
    if (pathname === "/api/dimensions" && method === "DELETE") return deleteDimension(request, ctx);

    if (pathname === "/api/asset-values" && method === "PATCH") return await updateDimensionValue(request, ctx);

    if (pathname === "/api/workspace" && method === "GET") return workspace(request, ctx);

    if (pathname === "/api/uploads/check" && method === "POST") return await checkUpload(request, ctx);
    if (pathname === "/api/uploads" && method === "POST") return await upload(request, ctx);

    if (pathname === "/api/media" && method === "GET") return await media(request, ctx);

    if (pathname === "/api/assets/restore" && method === "POST") return await restoreAsset(request, ctx);
    if (pathname === "/api/assets" && method === "PATCH") return await updateAsset(request, ctx);
    if (pathname === "/api/assets" && method === "DELETE") return await deleteAsset(request, ctx);

    if (pathname === "/api/library" && method === "GET") return library(ctx);

    if (pathname === "/api/project-assets" && method === "POST") return await assignAssets(request, ctx);
    if (pathname === "/api/project-assets" && method === "DELETE") return removeAssetFromProject(request, ctx);

    if (pathname === "/api/canvases" && method === "GET") return listCanvases(request, ctx);
    if (pathname === "/api/canvases" && method === "POST") return await createCanvas(request, ctx);
    if (pathname === "/api/canvases" && method === "PATCH") return await renameCanvas(request, ctx);
    if (pathname === "/api/canvases" && method === "DELETE") return deleteCanvas(request, ctx);

    if (pathname === "/api/canvas" && method === "GET") return getCanvas(request, ctx);
    if (pathname === "/api/canvas-items" && method === "POST") return await addCanvasItem(request, ctx);
    if (pathname === "/api/canvas-items" && method === "PATCH") return await updateCanvasItem(request, ctx);
    if (pathname === "/api/canvas-items" && method === "DELETE") return deleteCanvasItem(request, ctx);

    return Response.json({ error: "未知接口" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: errorMessage(error, "请求失败") }, { status: 500 });
  }
}
