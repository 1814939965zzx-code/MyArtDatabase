import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  backfillLegacyAssets,
  clearSessionCookieHeader,
  createSession,
  createUser,
  destroySession,
  hashPassword,
  logLogin,
  resolveUser,
  sessionCookieHeader,
  sessionTokenFromRequest,
  verifyPassword,
} from "./auth.js";
import { AiError, listAiModels, readAiConfigDetails, saveAiConfig, suggestTagsForUpload, tagAssetWithAi, testAiConnection } from "./ai.js";
import { findTagByName, listTags, mergeTags, replaceAssetTags } from "./tags.js";
import { enqueueVideoTranscode } from "./transcode.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/mpeg",
  "video/3gpp",
  "video/3gpp2",
]);
const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const isVideoMime = (mime) => typeof mime === "string" && mime.startsWith("video/");
/** 统一校验并返回 { kind: 'image' | 'video' }，非法类型返回 null。 */
function mediaKind(type) {
  if (IMAGE_TYPES.has(type)) return "image";
  if (VIDEO_TYPES.has(type)) return "video";
  return null;
}

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

function floatNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
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

/** 按素材行批量装配 tags 字符串数组（标签字典读取，按 position 排序）。 */
function attachTagArrays(db, assets) {
  if (!assets.length) return assets;
  const placeholders = assets.map(() => "?").join(",");
  const links = db.prepare(`
    SELECT at.asset_id AS assetId, t.name FROM asset_tags at
    INNER JOIN tags t ON t.id = at.tag_id
    WHERE at.asset_id IN (${placeholders})
    ORDER BY at.position, at.created_at, t.name
  `).all(...assets.map((asset) => asset.id));
  const map = new Map();
  for (const link of links) {
    const list = map.get(link.assetId) ?? [];
    list.push(link.name);
    map.set(link.assetId, list);
  }
  return assets.map((asset) => ({ ...asset, tags: map.get(asset.id) ?? [] }));
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
  // 每个项目取前 4 张素材缩略图作为主页封面拼图
  const covers = db.prepare(`
    SELECT pa.project_id AS projectId, a.id,
      CASE WHEN (a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL) AND (a.transcode_status IS NULL OR a.transcode_status = 'ready')
        THEN '/api/media?id=' || a.id || '&variant=thumbnail&v=' || COALESCE(a.thumbnail_key, a.storage_key) ELSE a.thumbnail_url END AS thumbnailUrl
    FROM project_assets pa
    INNER JOIN assets a ON a.id = pa.asset_id AND a.deleted_at IS NULL
    ORDER BY pa.created_at ASC, a.id ASC
  `).all();
  const coverMap = new Map();
  for (const row of covers) {
    if (!row.thumbnailUrl) continue;
    const list = coverMap.get(row.projectId) ?? [];
    if (list.length < 4) list.push(row.thumbnailUrl);
    coverMap.set(row.projectId, list);
  }
  return Response.json({
    projects: rows.map((row) => ({ ...row, thumbnails: coverMap.get(row.id) ?? [] })),
  });
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

async function updateDimensions(request, { db }) {
  const payload = await request.json();
  const projectId = cleanId(payload.projectId);
  const rawUpdates = Array.isArray(payload.dimensions) ? payload.dimensions : [];
  if (!projectId || !rawUpdates.length) return Response.json({ error: "维度参数不完整" }, { status: 400 });
  const updates = rawUpdates.map((entry) => ({
    id: cleanId(entry?.id),
    leftLabel: cleanText(entry?.leftLabel, 24),
    rightLabel: cleanText(entry?.rightLabel, 24),
  }));
  if (updates.some((entry) => !entry.id || !entry.leftLabel || !entry.rightLabel)) {
    return Response.json({ error: "请填写维度两端的名称" }, { status: 400 });
  }
  if (updates.some((entry) => entry.leftLabel === entry.rightLabel)) {
    return Response.json({ error: "维度两端不能相同" }, { status: 400 });
  }
  if (new Set(updates.map((entry) => entry.id)).size !== updates.length) {
    return Response.json({ error: "维度不能重复提交" }, { status: 400 });
  }
  const findDimension = db.prepare("SELECT id FROM project_dimensions WHERE id = ? AND project_id = ?");
  if (updates.some((entry) => !findDimension.get(entry.id, projectId))) {
    return Response.json({ error: "部分维度不存在" }, { status: 404 });
  }
  transaction(db, () => {
    const update = db.prepare("UPDATE project_dimensions SET left_label = ?, right_label = ? WHERE id = ? AND project_id = ?");
    for (const entry of updates) update.run(entry.leftLabel, entry.rightLabel, entry.id, projectId);
    db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
  });
  return Response.json({ dimensions: updates });
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
    CASE WHEN (a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL) AND (a.transcode_status IS NULL OR a.transcode_status = 'ready')
      THEN '/api/media?id=' || a.id || '&variant=thumbnail&v=' || COALESCE(a.thumbnail_key, a.storage_key) ELSE a.thumbnail_url END AS thumbnailUrl,
    CASE WHEN a.storage_key IS NOT NULL
      THEN '/api/media?id=' || a.id || '&variant=original&v=' || a.storage_key ELSE a.thumbnail_url END AS originalUrl,
    a.description, a.notes, a.source_url AS sourceUrl,
    a.file_size AS fileSize, a.width, a.height, a.mime_type AS mimeType,
    a.duration AS duration, a.transcode_status AS transcodeStatus,
    a.created_at AS createdAt, a.created_by_name AS createdByName
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
    assets: attachTagArrays(db, assets).map((asset) => ({
      ...asset,
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
      CASE WHEN (a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL) AND (a.transcode_status IS NULL OR a.transcode_status = 'ready')
        THEN '/api/media?id=' || a.id || '&variant=thumbnail&v=' || COALESCE(a.thumbnail_key, a.storage_key) ELSE a.thumbnail_url END AS thumbnailUrl,
      a.mime_type AS mimeType, a.transcode_status AS transcodeStatus,
      EXISTS(SELECT 1 FROM project_assets pa WHERE pa.asset_id = a.id AND pa.project_id = ?) AS inProject
    FROM assets a
    WHERE a.sha256 = ? AND a.deleted_at IS NULL
    ORDER BY a.created_at DESC
  `).all(projectId, sha256);
  return Response.json({ duplicates });
}

async function upload(request, { db, store, user }) {
  let storedId = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    const kind = file instanceof File ? mediaKind(file.type) : null;
    if (!kind) {
      return Response.json({ error: "仅支持 JPEG、PNG、WebP 图片或 mp4/mov/webm/mkv 等视频" }, { status: 400 });
    }
    const maxBytes = kind === "video" ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
    if (file.size <= 0 || file.size > maxBytes) {
      return Response.json({ error: kind === "video" ? "视频不能超过 200MB" : "图片不能超过 50MB" }, { status: 400 });
    }
    const projectId = cleanText(form.get("projectId"), 80);
    const name = cleanText(form.get("name"), 120) || file.name.slice(0, 120);
    const description = cleanText(form.get("description"), 2000);
    const notes = cleanText(form.get("notes"), 2000);
    const sourceUrl = cleanText(form.get("sourceUrl"), 1000);
    const tags = cleanText(form.get("tags"), 4000).split(",").map((t) => t.trim()).filter(Boolean);
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
    const stored = kind === "video"
      ? await store.putVideoOriginal(buffer, file.type)
      : await store.put(buffer, file.type);
    storedId = stored.id;

    const dimensions = db.prepare("SELECT id FROM project_dimensions WHERE project_id = ? ORDER BY sort_order").all(projectId);
    try {
      transaction(db, () => {
        db.prepare(`INSERT INTO assets (id, name, file_name, sha256, file_size, width, height, mime_type, duration, transcode_status, description, notes, source_url, storage_key, thumbnail_key, created_by, created_by_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            id, name, file.name, sha256, file.size,
            stored.width ?? 0, stored.height ?? 0, file.type,
            kind === "video" ? 0 : 0, kind === "video" ? "processing" : null,
            description, notes, sourceUrl,
            stored.id, kind === "video" ? null : stored.id,
            user?.id ?? null, user?.displayName ?? "",
          );
        replaceAssetTags(db, id, tags, { source: "manual", inTransaction: true });
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
    // 视频入库后异步转码（不阻塞上传请求）
    if (kind === "video") enqueueVideoTranscode({ db, store, assetId: id });
    return Response.json({
      asset: { id, name, fileName: file.name, sha256, transcodeStatus: kind === "video" ? "processing" : null },
    }, { status: 201 });
  } catch (error) {
    if (storedId) await store.remove(storedId).catch(() => {});
    return Response.json({ error: errorMessage(error, "上传失败") }, { status: 500 });
  }
}

async function replaceAssetMedia(request, { db, store }) {
  let storedId = "";
  try {
    const form = await request.formData();
    const id = cleanId(form.get("id"));
    const file = form.get("file");
    if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
    const kind = file instanceof File ? mediaKind(file.type) : null;
    if (!kind) {
      return Response.json({ error: "仅支持 JPEG、PNG、WebP 图片或 mp4/mov/webm/mkv 等视频" }, { status: 400 });
    }

    const existing = db.prepare(`SELECT id, storage_key AS storageKey, thumbnail_key AS thumbnailKey, mime_type AS mimeType
      FROM assets WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!existing) return Response.json({ error: "素材不存在" }, { status: 404 });

    // 同类型替换：图片换图片、视频换视频；跨类型不允许，避免预览/画板形态错乱。
    const existingIsVideo = isVideoMime(existing.mimeType);
    if (existingIsVideo !== (kind === "video")) {
      return Response.json({ error: existingIsVideo ? "请选择视频文件替换" : "请选择图片文件替换" }, { status: 400 });
    }

    const maxBytes = kind === "video" ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
    if (file.size <= 0 || file.size > maxBytes) {
      return Response.json({ error: kind === "video" ? "视频不能为空或超过 200MB" : "图片不能为空或超过 50MB" }, { status: 400 });
    }
    const fileName = cleanText(file.name, 240) || `replacement.${kind === "video" ? "mp4" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = kind === "video"
      ? await store.putVideoOriginal(buffer, file.type)
      : await store.put(buffer, file.type);
    storedId = stored.id;
    const result = db.prepare(`UPDATE assets SET
      file_name = ?, sha256 = ?, file_size = ?, width = ?, height = ?, mime_type = ?,
      duration = ?, transcode_status = ?, storage_key = ?, thumbnail_key = ?, thumbnail_url = NULL
      WHERE id = ? AND deleted_at IS NULL`)
      .run(
        fileName, stored.sha256, stored.size,
        stored.width ?? 0, stored.height ?? 0, stored.mimeType,
        kind === "video" ? 0 : 0, kind === "video" ? "processing" : null,
        stored.id, kind === "video" ? null : stored.id, id,
      );
    if (!result.changes) {
      await store.remove(stored.id).catch(() => {});
      storedId = "";
      return Response.json({ error: "素材不存在" }, { status: 404 });
    }

    // 数据库已经安全切换到新文件。后续清理旧文件失败只会留下可清理的孤儿文件，
    // 不能反过来删除新文件或让已经完成的替换失效。
    storedId = "";
    const oldKeys = [...new Set([existing.storageKey, existing.thumbnailKey].filter(Boolean))];
    const cleanup = await Promise.allSettled(oldKeys.map((key) => store.remove(key)));

    // 视频替换后重新进入转码流程
    if (kind === "video") enqueueVideoTranscode({ db, store, assetId: id });
    return Response.json({
      ok: true,
      asset: {
        id, fileName, sha256: stored.sha256, fileSize: stored.size,
        width: stored.width ?? 0, height: stored.height ?? 0, mimeType: stored.mimeType,
        transcodeStatus: kind === "video" ? "processing" : null,
      },
      cleanupWarning: cleanup.some((entry) => entry.status === "rejected"),
    });
  } catch (error) {
    if (storedId) await store.remove(storedId).catch(() => {});
    return Response.json({ error: errorMessage(error, "替换素材失败") }, { status: 500 });
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
    // 缩略图只允许在真正生成后提供：转码中的视频 thumbnail_key 为空，
    // 此时绝不能把原视频字节按 image/webp 返回（前端会拿到坏图）。
    if (variant === "thumbnail" && !asset.thumbnailKey) return new Response("Not found", { status: 404 });
    if (!key) return new Response("Not found", { status: 404 });
    const opened = await store.open(key, variant);
    if (!opened) return new Response("Not found", { status: 404 });
    const total = opened.size;
    const baseHeaders = {
      "content-type": variant === "thumbnail" ? "image/webp" : asset.mimeType,
      "cache-control": "private, max-age=3600",
      "etag": `"${opened.size}-${Math.round(opened.mtimeMs)}"`,
      "accept-ranges": "bytes",
    };

    // HTTP Range（206 Partial Content）：浏览器 <video> seek/拖进度条依赖此能力。
    const range = request.headers.get("range");
    const rangeMatch = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (rangeMatch && (rangeMatch[1] !== "" || rangeMatch[2] !== "")) {
      const start = rangeMatch[1] === "" ? Math.max(0, total - Number(rangeMatch[2])) : Number(rangeMatch[1]);
      const requestedEnd = rangeMatch[2] === "" ? total - 1 : Number(rangeMatch[2]);
      if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start >= total || start > requestedEnd) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}`, ...baseHeaders } });
      }
      const end = Math.min(requestedEnd, total - 1);
      const sliced = await store.open(key, variant, { start, end });
      if (!sliced) return new Response("Not found", { status: 404 });
      return new Response(Readable.toWeb(sliced.stream), {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-range": `bytes ${start}-${end}/${total}`,
          "content-length": String(end - start + 1),
        },
      });
    }

    return new Response(Readable.toWeb(opened.stream), { headers: baseHeaders });
  } catch (error) {
    return new Response(errorMessage(error, "Media error"), { status: 500 });
  }
}

// ---- 素材 ----
async function updateAsset(request, { db }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
  const existing = db.prepare("SELECT id FROM assets WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!existing) return Response.json({ error: "素材不存在" }, { status: 404 });
  const deleteTag = cleanText(payload.deleteTag, 800);
  if (deleteTag) {
    db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)").run(id, deleteTag);
    return Response.json({ ok: true, deletedTag: deleteTag });
  }
  const name = cleanText(payload.name, 120);
  if (!name) return Response.json({ error: "素材名称不能为空" }, { status: 400 });
  const tags = cleanText(payload.tags, 4000).split(",").map((t) => t.trim()).filter(Boolean);
  const description = cleanText(payload.description, 2000);
  const notes = cleanText(payload.notes, 2000);
  const sourceUrl = cleanText(payload.sourceUrl, 1000);
  const result = db.prepare("UPDATE assets SET name = ?, description = ?, notes = ?, source_url = ? WHERE id = ? AND deleted_at IS NULL")
    .run(name, description, notes, sourceUrl, id);
  if (!result.changes) return Response.json({ error: "素材不存在" }, { status: 404 });
  replaceAssetTags(db, id, tags, { source: "manual" });
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
    CASE WHEN (a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL) AND (a.transcode_status IS NULL OR a.transcode_status = 'ready')
      THEN '/api/media?id=' || a.id || '&variant=thumbnail&v=' || COALESCE(a.thumbnail_key, a.storage_key) ELSE a.thumbnail_url END AS thumbnailUrl,
    CASE WHEN a.storage_key IS NOT NULL
      THEN '/api/media?id=' || a.id || '&variant=original&v=' || a.storage_key ELSE a.thumbnail_url END AS originalUrl,
    a.description, a.notes, a.source_url AS sourceUrl,
    a.file_size AS fileSize, a.width, a.height, a.mime_type AS mimeType,
    a.duration AS duration, a.transcode_status AS transcodeStatus,
    a.created_at AS createdAt, a.created_by_name AS createdByName
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
    assets: attachTagArrays(db, assets).map((asset) => ({
      ...asset,
      projects: projectMap.get(asset.id) ?? [],
    })),
  });
}

// ---- 回收站 ----
function trash({ db }) {
  const assets = db.prepare(`SELECT a.id, a.name, a.file_name AS fileName,
    CASE WHEN (a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL) AND (a.transcode_status IS NULL OR a.transcode_status = 'ready')
      THEN '/api/media?id=' || a.id || '&variant=thumbnail&v=' || COALESCE(a.thumbnail_key, a.storage_key) ELSE a.thumbnail_url END AS thumbnailUrl,
    a.file_size AS fileSize, a.width, a.height, a.mime_type AS mimeType,
    a.duration AS duration, a.transcode_status AS transcodeStatus,
    a.deleted_at AS deletedAt, a.created_by_name AS createdByName
    FROM assets a
    WHERE a.deleted_at IS NOT NULL
    ORDER BY a.deleted_at DESC, a.id`).all();
  const references = db.prepare(`SELECT pa.asset_id AS assetId, p.id AS projectId, p.name AS projectName
    FROM project_assets pa
    INNER JOIN projects p ON p.id = pa.project_id
    INNER JOIN assets a ON a.id = pa.asset_id
    WHERE a.deleted_at IS NOT NULL
    ORDER BY p.name, p.id`).all();
  const projectMap = new Map();
  for (const reference of references) {
    const current = projectMap.get(reference.assetId) ?? [];
    current.push({ id: reference.projectId, name: reference.projectName });
    projectMap.set(reference.assetId, current);
  }
  return Response.json({
    assets: attachTagArrays(db, assets).map((asset) => ({
      ...asset,
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
  const rows = db.prepare(`SELECT ci.id, ci.canvas_id AS canvasId, ci.asset_id AS assetId, ci.type, ci.parent_frame_id AS parentFrameId,
    ci.x, ci.y, ci.width, ci.height, ci.z_index AS zIndex, ci.rotation, ci.payload,
    a.name, CASE WHEN (a.thumbnail_key IS NOT NULL OR a.storage_key IS NOT NULL) AND (a.transcode_status IS NULL OR a.transcode_status = 'ready')
      THEN '/api/media?id=' || a.id || '&variant=thumbnail&v=' || COALESCE(a.thumbnail_key, a.storage_key) ELSE a.thumbnail_url END AS thumbnailUrl
    FROM canvas_items ci LEFT JOIN assets a ON a.id = ci.asset_id
    WHERE ci.canvas_id = ? AND (ci.asset_id IS NULL OR a.deleted_at IS NULL) ORDER BY ci.z_index, ci.id`).all(canvasId);
  const items = rows.map((row) => {
    let payload = null;
    if (row.payload) {
      try { payload = JSON.parse(row.payload); } catch { payload = null; }
    }
    const { payload: _ignored, ...rest } = row;
    return { ...rest, payload };
  });
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
  const assetId = cleanId(payload.assetId);
  const type = (cleanText(payload.type, 20) || "image");
  const allowedTypes = new Set(["image", "shape", "text"]);
  if (!allowedTypes.has(type)) return Response.json({ error: "不支持的元素类型" }, { status: 400 });
  if (type === "image" && !assetId) return Response.json({ error: "图片元素缺少素材 ID" }, { status: 400 });
  if (!canvasId) return Response.json({ error: "参数不完整" }, { status: 400 });
  const parentFrameId = payload.parentFrameId ? cleanText(payload.parentFrameId, 80) : null;
  if (type === "image") {
    const membership = db.prepare(`SELECT 1 FROM canvases c
      INNER JOIN project_assets pa ON pa.project_id = c.project_id
      WHERE c.id = ? AND pa.asset_id = ?`).get(canvasId, assetId);
    if (!membership) return Response.json({ error: "素材不属于当前项目" }, { status: 409 });
  }
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM canvas_items WHERE canvas_id = ?").get(canvasId);

  const id = randomUUID();
  const itemPayload = (payload.payload && typeof payload.payload === "object") ? JSON.stringify(payload.payload) : null;
  const item = {
    id, canvasId, type, parentFrameId, assetId: type === "image" ? assetId : null,
    x: floatNumber(payload.x, 120, -1_000_000_000, 1_000_000_000),
    y: floatNumber(payload.y, 100, -1_000_000_000, 1_000_000_000),
    width: floatNumber(payload.width, 220, 0.1, 100000),
    height: floatNumber(payload.height, 170, 0.1, 100000),
    zIndex: number(payload.zIndex, count + 1, 0, 10000),
    rotation: number(payload.rotation, 0, -180, 180),
    payload: payload.payload && typeof payload.payload === "object" ? payload.payload : null,
  };
  db.prepare("INSERT INTO canvas_items (id, canvas_id, asset_id, type, parent_frame_id, x, y, width, height, z_index, rotation, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(item.id, item.canvasId, item.assetId, item.type, parentFrameId, item.x, item.y, item.width, item.height, item.zIndex, item.rotation, itemPayload);
  const revision = bumpRevision(db, canvasId);
  return Response.json({ item, revision }, { status: 201 });
}

async function updateCanvasItem(request, { db }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  const canvasId = cleanText(payload.canvasId, 80);
  if (!id || !canvasId) return Response.json({ error: "参数不完整" }, { status: 400 });
  const itemPayload = (payload.payload && typeof payload.payload === "object") ? JSON.stringify(payload.payload) : null;
  const parentFrameId = payload.parentFrameId ? cleanText(payload.parentFrameId, 80) : null;
  const result = db.prepare(`UPDATE canvas_items SET x = ?, y = ?, width = ?, height = ?, z_index = ?, rotation = ?, parent_frame_id = ?, payload = ?
    WHERE id = ? AND canvas_id = ?`)
    .run(
      floatNumber(payload.x, 0, -1_000_000_000, 1_000_000_000), floatNumber(payload.y, 0, -1_000_000_000, 1_000_000_000),
      floatNumber(payload.width, 220, 0.1, 100000), floatNumber(payload.height, 170, 0.1, 100000),
      number(payload.zIndex, 1, 0, 10000), number(payload.rotation, 0, -180, 180),
      parentFrameId, itemPayload,
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

// ---- 视频重新转码 ----
/** 转码失败（failed）后重新入队；processing 视为已在进行，直接返回。 */
async function retranscodeAsset(request, { db, store }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
  const asset = db.prepare("SELECT id, mime_type AS mimeType, transcode_status AS transcodeStatus FROM assets WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
  if (!isVideoMime(asset.mimeType)) return Response.json({ error: "只有视频素材需要转码" }, { status: 400 });
  if (asset.transcodeStatus === "processing") return Response.json({ ok: true, status: "processing" });
  db.prepare("UPDATE assets SET transcode_status = 'processing' WHERE id = ?").run(id);
  enqueueVideoTranscode({ db, store, assetId: id });
  return Response.json({ ok: true, status: "processing" });
}

// ---- AI 打标 ----
async function aiTagAsset(request, { db, store }) {
  try {
    const payload = await request.json();
    const id = cleanText(payload.id, 80);
    if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
    const asset = db.prepare("SELECT mime_type AS mimeType FROM assets WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
    if (isVideoMime(asset.mimeType)) return Response.json({ error: "视频素材不支持 AI 打标" }, { status: 400 });
    const result = await tagAssetWithAi(db, store, id);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof AiError ? error.status : 500;
    return Response.json({ error: errorMessage(error, "AI 打标失败") }, { status });
  }
}

/** 上传前 AI 打标：对选中的待上传图片分析并返回建议标签（不落库，前端填入标签输入框供确认后随上传提交）。 */
async function aiTagUploadImage(request, { db }) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !IMAGE_TYPES.has(file.type)) {
      return Response.json({ error: "仅支持 JPEG、PNG 和 WebP 图片" }, { status: 400 });
    }
    if (file.size <= 0 || file.size > IMAGE_MAX_BYTES) {
      return Response.json({ error: "图片不能超过 50MB" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await suggestTagsForUpload(db, buffer);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof AiError ? error.status : 500;
    return Response.json({ error: errorMessage(error, "AI 打标失败") }, { status });
  }
}

// ---- AI 服务配置 ----
function aiConfigStatus() {
  return Response.json(readAiConfigDetails());
}

async function saveAiConfigEndpoint(request) {
  const payload = await request.json();
  const baseUrl = cleanText(payload.baseUrl, 500);
  const model = cleanText(payload.model, 100);
  if (!baseUrl || !model) return Response.json({ error: "接口地址和模型名不能为空" }, { status: 400 });
  const apiKey = cleanText(payload.apiKey, 500);
  saveAiConfig({ baseUrl, apiKey, model });
  const details = readAiConfigDetails();
  return Response.json({
    ok: true,
    envOverride: details.envOverride,
    apiKeyLast4: details.apiKeyLast4,
    configured: details.configured,
  });
}

async function testAiConfigEndpoint() {
  try {
    const reply = await testAiConnection();
    return Response.json({ ok: true, reply: reply.slice(0, 100) });
  } catch (error) {
    const status = error instanceof AiError ? error.status : 502;
    return Response.json({ error: errorMessage(error, "连接测试失败") }, { status });
  }
}

async function listAiModelsEndpoint() {
  try {
    const models = await listAiModels();
    return Response.json({ ok: true, models });
  } catch (error) {
    const status = error instanceof AiError ? error.status : 502;
    return Response.json({ error: errorMessage(error, "获取模型列表失败") }, { status });
  }
}

// ---- 标签字典管理 ----
function listTagDictionary({ db }) {
  return Response.json({ tags: listTags(db) });
}

async function renameOrMergeTag(request, { db }) {
  const payload = await request.json();
  const id = cleanText(payload.id, 80);
  const name = cleanText(payload.name, 40);
  if (!id || !name) return Response.json({ error: "参数不完整" }, { status: 400 });
  const tag = db.prepare("SELECT id, name FROM tags WHERE id = ?").get(id);
  if (!tag) return Response.json({ error: "标签不存在" }, { status: 404 });
  const target = findTagByName(db, name);
  if (target && target.id !== id) {
    mergeTags(db, id, target.id);
    return Response.json({ ok: true, merged: true, tag: { id: target.id, name: target.name } });
  }
  if (target?.id === id) return Response.json({ ok: true, tag: { id, name: tag.name } });
  db.prepare("UPDATE tags SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(name, id);
  return Response.json({ ok: true, tag: { id, name } });
}

async function mergeTwoTags(request, { db }) {
  const payload = await request.json();
  const sourceId = cleanText(payload.sourceId, 80);
  const targetId = cleanText(payload.targetId, 80);
  if (!sourceId || !targetId) return Response.json({ error: "参数不完整" }, { status: 400 });
  if (sourceId === targetId) return Response.json({ error: "不能合并同一个标签" }, { status: 400 });
  const result = mergeTags(db, sourceId, targetId);
  return Response.json({ ok: true, ...result });
}

function deleteTag(request, { db }) {
  const id = cleanId(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "缺少标签 ID" }, { status: 400 });
  const tag = db.prepare("SELECT id FROM tags WHERE id = ?").get(id);
  if (!tag) return Response.json({ error: "标签不存在" }, { status: 404 });
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  return Response.json({ ok: true });
}

function cleanupUnusedTags({ db }) {
  const result = db.prepare("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM asset_tags WHERE asset_tags.tag_id = tags.id)").run();
  return Response.json({ ok: true, removed: result.changes });
}

// ---- 账号系统 ----
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,50}$/;

function validPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function toUserPayload(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName || row.display_name || row.username,
    role: row.role,
    active: Boolean(row.active),
  };
}

/** 账号状态：是否首次需要初始化管理员，以及当前登录用户（未登录为 null）。 */
function authStatus(request, { db }) {
  const user = resolveUser(db, request);
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  return Response.json({ needsSetup: count === 0, user: user ? { ...user, role: user.role } : null });
}

/** 首次初始化：数据库没有任何用户时创建管理员并直接登录。 */
async function setupAdmin(request, { db }) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  if (count > 0) return Response.json({ error: "系统已完成初始化，请直接登录" }, { status: 409 });
  const payload = await request.json();
  const username = cleanText(payload.username, 50);
  const displayName = cleanText(payload.displayName, 50);
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!USERNAME_PATTERN.test(username)) {
    return Response.json({ error: "用户名只能包含字母、数字、点、下划线和连字符（2-50 位）" }, { status: 400 });
  }
  if (!validPassword(password)) return Response.json({ error: "密码至少 8 位" }, { status: 400 });
  const user = createUser(db, { username, displayName, password, role: "admin" });
  // 存量数据整体挂到默认管理员名下，不做追溯
  backfillLegacyAssets(db, user.id, user.displayName);
  const session = createSession(db, user.id, true);
  return Response.json({ user: toUserPayload({ ...user, active: true }) }, {
    status: 201,
    headers: { "set-cookie": sessionCookieHeader(session.token, session.maxAge) },
  });
}

/** 登录：校验密码、写入审计、创建会话。 */
async function login(request, { db, clientIp }) {
  const payload = await request.json();
  const username = cleanText(payload.username, 50);
  const password = typeof payload.password === "string" ? payload.password : "";
  const remember = payload.remember === true;
  const userAgent = request.headers.get("user-agent") || "";
  const audit = (success, message) => logLogin(db, { username, success, ip: clientIp, userAgent, message });

  if (!username || !password) {
    audit(false, "缺少用户名或密码");
    return Response.json({ error: "请输入用户名和密码" }, { status: 400 });
  }
  const row = db.prepare("SELECT id, username, display_name AS displayName, role, active, password_hash AS passwordHash FROM users WHERE username = ?").get(username);
  if (!row || !verifyPassword(password, row.passwordHash)) {
    audit(false, "用户名或密码错误");
    return Response.json({ error: "用户名或密码错误" }, { status: 401 });
  }
  if (!row.active) {
    audit(false, "账号已停用");
    return Response.json({ error: "账号已停用，请联系管理员" }, { status: 403 });
  }
  db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  const session = createSession(db, row.id, remember);
  audit(true, "登录成功");
  return Response.json({ user: { id: row.id, username: row.username, displayName: row.displayName, role: row.role, active: true } }, {
    headers: { "set-cookie": sessionCookieHeader(session.token, session.maxAge) },
  });
}

/** 退出登录：删除会话并清 cookie。 */
function logout(request, { db }) {
  destroySession(db, request);
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookieHeader() } });
}

/** 当前用户信息。 */
function me({ user }) {
  return Response.json({ user });
}

/** 修改自己的显示名 / 密码。 */
async function updateMe(request, { db, user }) {
  const payload = await request.json();
  const displayName = cleanText(payload.displayName, 50);
  const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
  const hasDisplayName = payload.displayName !== undefined;
  const hasPassword = Boolean(newPassword);

  if (hasDisplayName && !displayName) return Response.json({ error: "显示名不能为空" }, { status: 400 });
  if (hasPassword && !validPassword(newPassword)) return Response.json({ error: "新密码至少 8 位" }, { status: 400 });
  if (hasPassword) {
    const row = db.prepare("SELECT password_hash AS passwordHash FROM users WHERE id = ?").get(user.id);
    if (!row || !verifyPassword(currentPassword, row.passwordHash)) {
      return Response.json({ error: "当前密码不正确" }, { status: 400 });
    }
    db.prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(hashPassword(newPassword), user.id);
    // 改密后使其他会话失效，保留当前会话
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(user.id, sessionTokenFromRequest(request));
  }
  if (hasDisplayName) {
    db.prepare("UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(displayName, user.id);
  }
  const fresh = db.prepare("SELECT id, username, display_name AS displayName, role, active FROM users WHERE id = ?").get(user.id);
  return Response.json({ user: toUserPayload(fresh) });
}

// ---- 登录页公告 ----
const ANNOUNCEMENT_TEXT_MAX = 2000;

/** 登录页公告：公开读取（登录页在未登录时展示）。 */
function getAnnouncement({ db }) {
  const read = (key) => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value ?? "";
  const row = db.prepare("SELECT updated_at AS updatedAt FROM app_settings WHERE key = 'announcement.text'").get();
  return Response.json({
    text: read("announcement.text"),
    enabled: read("announcement.enabled") === "1",
    updatedAt: row?.updatedAt ?? null,
  });
}

/** 更新登录页公告：仅管理员。 */
async function updateAnnouncement(request, { db }) {
  const payload = await request.json();
  const text = cleanText(payload.text, ANNOUNCEMENT_TEXT_MAX);
  const enabled = payload.enabled === true;
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  transaction(db, () => {
    upsert.run("announcement.text", text);
    upsert.run("announcement.enabled", enabled ? "1" : "0");
  });
  return Response.json({ ok: true });
}

// ---- 用户管理（仅管理员） ----
function requireAdmin({ user }) {
  if (user?.role !== "admin") return Response.json({ error: "需要管理员权限" }, { status: 403 });
  return null;
}

function listUsers({ db }) {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, u.role, u.active,
      u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
      (SELECT COUNT(*) FROM assets a WHERE a.created_by = u.id AND a.deleted_at IS NULL) AS assetCount
    FROM users u ORDER BY u.created_at, u.username
  `).all().map(toUserPayload);
  return Response.json({ users });
}

async function createMember(request, { db }) {
  const payload = await request.json();
  const username = cleanText(payload.username, 50);
  const displayName = cleanText(payload.displayName, 50);
  const password = typeof payload.password === "string" ? payload.password : "";
  const role = payload.role === "admin" ? "admin" : "member";
  if (!USERNAME_PATTERN.test(username)) {
    return Response.json({ error: "用户名只能包含字母、数字、点、下划线和连字符（2-50 位）" }, { status: 400 });
  }
  if (!validPassword(password)) return Response.json({ error: "密码至少 8 位" }, { status: 400 });
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return Response.json({ error: "用户名已存在" }, { status: 409 });
  const user = createUser(db, { username, displayName, password, role });
  return Response.json({ user: toUserPayload({ ...user, active: true }) }, { status: 201 });
}

async function updateMember(request, { db, user: me }) {
  const payload = await request.json();
  const id = cleanId(payload.id);
  if (!id) return Response.json({ error: "缺少用户 ID" }, { status: 400 });
  const row = db.prepare("SELECT id, username, display_name AS displayName, role, active FROM users WHERE id = ?").get(id);
  if (!row) return Response.json({ error: "用户不存在" }, { status: 404 });

  const isSelf = row.id === me.id;
  const updates = [];

  if (payload.displayName !== undefined) {
    const displayName = cleanText(payload.displayName, 50);
    if (!displayName) return Response.json({ error: "显示名不能为空" }, { status: 400 });
    updates.push(["display_name = ?", displayName]);
  }
  if (payload.role !== undefined) {
    const role = payload.role === "admin" ? "admin" : "member";
    if (isSelf) return Response.json({ error: "不能修改自己的角色" }, { status: 400 });
    if (row.role === "admin" && role !== "admin") {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count;
      if (adminCount <= 1) return Response.json({ error: "系统必须保留至少一名启用的管理员" }, { status: 400 });
    }
    updates.push(["role = ?", role]);
  }
  if (payload.active !== undefined) {
    const active = payload.active ? 1 : 0;
    if (isSelf && !active) return Response.json({ error: "不能停用自己的账号" }, { status: 400 });
    if (row.role === "admin" && row.active && !active) {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count;
      if (adminCount <= 1) return Response.json({ error: "系统必须保留至少一名启用的管理员" }, { status: 400 });
    }
    updates.push(["active = ?", active]);
    if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id); // 停用立即踢下线
  }
  if (payload.password !== undefined && payload.password !== null) {
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!validPassword(password)) return Response.json({ error: "密码至少 8 位" }, { status: 400 });
    updates.push(["password_hash = ?", hashPassword(password)]);
    // 管理员重置密码后使该用户全部会话失效（含自身，避免旧会话继续使用）
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  }

  if (updates.length) {
    const sets = updates.map(([expr]) => expr).join(", ");
    const values = updates.map(([, value]) => value);
    db.prepare(`UPDATE users SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
  }
  const fresh = db.prepare("SELECT id, username, display_name AS displayName, role, active FROM users WHERE id = ?").get(id);
  return Response.json({ user: toUserPayload(fresh) });
}

async function deleteMember(request, { db, user: me }) {
  const id = cleanId(new URL(request.url).searchParams.get("id"));
  if (!id) return Response.json({ error: "缺少用户 ID" }, { status: 400 });
  if (id === me.id) return Response.json({ error: "不能删除自己的账号" }, { status: 400 });
  const row = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
  if (!row) return Response.json({ error: "用户不存在" }, { status: 404 });
  if (row.role === "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
    if (adminCount <= 1) return Response.json({ error: "系统必须保留至少一名管理员" }, { status: 400 });
  }
  db.exec("BEGIN");
  try {
    // 素材保留：上传者置为「已删除用户」快照
    db.prepare("UPDATE assets SET created_by = NULL, created_by_name = '已删除用户' WHERE created_by = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return Response.json({ ok: true });
}

/** 登录审计（仅管理员）：最近 100 条。 */
function listLoginLogs({ db }) {
  const logs = db.prepare(`
    SELECT id, username, success, ip, user_agent AS userAgent, message, created_at AS createdAt
    FROM login_logs ORDER BY id DESC LIMIT 100
  `).all();
  return Response.json({ logs });
}

// ---- 路由分发 ----
export async function handleApi(request, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  try {
    // 健康检查：部署脚本与运维巡检使用，无需登录
    if (pathname === "/api/health" && method === "GET") return Response.json({ ok: true });

    // 登录页公告：未登录即可读取（登录页展示用）
    if (pathname === "/api/announcement" && method === "GET") return getAnnouncement(ctx);

    // 公开的账号接口
    if (pathname === "/api/auth/status" && method === "GET") return authStatus(request, ctx);
    if (pathname === "/api/auth/setup" && method === "POST") return await setupAdmin(request, ctx);
    if (pathname === "/api/auth/login" && method === "POST") return await login(request, ctx);

    // 其余所有接口都必须登录
    const user = resolveUser(ctx.db, request);
    if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
    ctx.user = user;

    if (pathname === "/api/auth/me" && method === "GET") return me(ctx);
    if (pathname === "/api/auth/me" && method === "PATCH") return await updateMe(request, ctx);
    if (pathname === "/api/auth/logout" && method === "POST") return logout(request, ctx);

    // 管理员专属：用户管理、登录审计、AI 服务配置、登录页公告
    if (pathname.startsWith("/api/users") || pathname === "/api/login-logs" || (pathname === "/api/announcement" && method === "PUT")) {
      const denied = requireAdmin(ctx);
      if (denied) return denied;
      if (pathname === "/api/users" && method === "GET") return listUsers(ctx);
      if (pathname === "/api/users" && method === "POST") return await createMember(request, ctx);
      if (pathname === "/api/users" && method === "PATCH") return await updateMember(request, ctx);
      if (pathname === "/api/users" && method === "DELETE") return deleteMember(request, ctx);
      if (pathname === "/api/login-logs" && method === "GET") return listLoginLogs(ctx);
      if (pathname === "/api/announcement" && method === "PUT") return await updateAnnouncement(request, ctx);
    }

    if (pathname.startsWith("/api/ai-config")) {
      const denied = requireAdmin(ctx);
      if (denied) return denied;
      if (pathname === "/api/ai-config/test" && method === "POST") return await testAiConfigEndpoint();
      if (pathname === "/api/ai-config/models" && method === "POST") return await listAiModelsEndpoint();
      if (pathname === "/api/ai-config" && method === "GET") return aiConfigStatus();
      if (pathname === "/api/ai-config" && method === "POST") return await saveAiConfigEndpoint(request);
    }

    if (pathname === "/api/projects" && method === "GET") return listProjects(ctx);
    if (pathname === "/api/projects" && method === "POST") return await createProject(request, ctx);
    if (pathname === "/api/projects" && method === "PATCH") return await updateProject(request, ctx);
    if (pathname === "/api/projects" && method === "DELETE") return deleteProject(request, ctx);

    if (pathname === "/api/dimensions" && method === "POST") return await createDimension(request, ctx);
    if (pathname === "/api/dimensions" && method === "PATCH") return await updateDimensions(request, ctx);
    if (pathname === "/api/dimensions" && method === "DELETE") return deleteDimension(request, ctx);

    if (pathname === "/api/asset-values" && method === "PATCH") return await updateDimensionValue(request, ctx);

    if (pathname === "/api/workspace" && method === "GET") return workspace(request, ctx);

    if (pathname === "/api/uploads/check" && method === "POST") return await checkUpload(request, ctx);
    if (pathname === "/api/uploads/ai-tags" && method === "POST") return await aiTagUploadImage(request, ctx);
    if (pathname === "/api/uploads" && method === "POST") return await upload(request, ctx);

    if (pathname === "/api/media" && method === "GET") return await media(request, ctx);

    if (pathname === "/api/assets/restore" && method === "POST") return await restoreAsset(request, ctx);
    if (pathname === "/api/assets/retranscode" && method === "POST") return await retranscodeAsset(request, ctx);
    if (pathname === "/api/assets/image" && method === "POST") return await replaceAssetMedia(request, ctx);
    if (pathname === "/api/assets/ai-tags" && method === "POST") return await aiTagAsset(request, ctx);
    if (pathname === "/api/assets" && method === "PATCH") return await updateAsset(request, ctx);
    if (pathname === "/api/assets" && method === "DELETE") return await deleteAsset(request, ctx);

    if (pathname === "/api/tags/merge" && method === "POST") return await mergeTwoTags(request, ctx);
    if (pathname === "/api/tags/cleanup" && method === "POST") return cleanupUnusedTags(ctx);
    if (pathname === "/api/tags" && method === "GET") return listTagDictionary(ctx);
    if (pathname === "/api/tags" && method === "PATCH") return await renameOrMergeTag(request, ctx);
    if (pathname === "/api/tags" && method === "DELETE") return deleteTag(request, ctx);

    if (pathname === "/api/library" && method === "GET") return library(ctx);
    if (pathname === "/api/trash" && method === "GET") return trash(ctx);

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
