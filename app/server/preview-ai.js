import { randomUUID } from "node:crypto";
import { AiError, parseJsonFromContent, prepareAssetImageDataUri, readAiConfig, requestVisionJson } from "./ai.js";

const MAX_DIMENSIONS = 20;
const MAX_IMAGES = 200;
const MAX_TOKENS = 2_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const JOB_TTL_MS = 10 * 60 * 1000;
const JOB_EVENT_LIMIT = 2_000;

const DIMENSION_SYSTEM = [
  "你是图片素材的维度标注助手。用户会给你一张图片，以及当前维度 Page 的维度列表。",
  "请只判断这一张图片在每个维度上的位置，并输出 JSON。",
  "要求：",
  "- 每个维度输出 -100 到 100 的整数；",
  "- -100 表示完全靠近左端，100 表示完全靠近右端；0 表示中性、无法判断或与该维度无关；",
  "- 必须使用整数，不要小数；",
  "- 每个维度都要给出，不要遗漏；",
  "- 只输出 JSON，不要解释、不要 Markdown 代码块。",
  "输出格式：{\"values\":{\"d1\":-30,\"d2\":40}}",
].join("\n");

/** pageId → { kind: "single" | "batch", id }；同一 Page 同时只允许一个 AI 维度操作。 */
const pageBusy = new Map();
/** pageId → 最近一个批量任务；用于刷新/切页后 adopt。 */
const jobsByPage = new Map();
const jobsById = new Map();
const jobTimers = new Map();
let activeBatchJobId = null;

const clean = (value, max = 80) => typeof value === "string" ? value.trim().slice(0, max) : "";
const bad = (error, status = 400) => Response.json({ error }, { status });
const timeoutMs = () => Number(process.env.AI_DIMENSION_ITEM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
const concurrency = () => Math.max(1, Math.min(2, Number(process.env.AI_DIMENSION_CONCURRENCY) || 2));

function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function buildPrompt(dimensions) {
  const lines = dimensions.map((dimension, index) => `- d${index + 1}：左端「${dimension.leftLabel}」 ↔ 右端「${dimension.rightLabel}」`);
  return [
    "当前维度：",
    ...lines,
    "",
    "请为每个维度给出一个 -100 到 100 的整数，只输出 JSON：{\"values\":{\"d1\":-30,\"d2\":40}}",
  ].join("\n");
}

function normalizeValues(parsed, targets) {
  let values = parsed;
  if (Array.isArray(parsed)) values = parsed[0]?.values ?? parsed[0];
  else if (parsed && typeof parsed === "object" && parsed.values && typeof parsed.values === "object") values = parsed.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new AiError("AI 返回的维度格式异常");

  const updates = [];
  for (const target of targets) {
    const raw = values[target.alias];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const display = Math.max(-100, Math.min(100, Math.round(raw)));
    updates.push({
      dimensionId: target.dimensionId,
      value: (display + 100) * 5,
      lastRev: target.lastRev,
    });
  }
  return updates;
}

function getPage(db, projectId, pageId) {
  return db.prepare("SELECT id, project_id AS projectId, revision FROM preview_pages WHERE id = ? AND project_id = ?").get(pageId, projectId);
}

function getDimensions(db, pageId) {
  return db.prepare(
    "SELECT id, left_label AS leftLabel, right_label AS rightLabel FROM preview_dimensions WHERE page_id = ? ORDER BY sort_order, id",
  ).all(pageId);
}

function selectDimensions(allDimensions, payload) {
  if (payload.dimensionIds === undefined) {
    if (allDimensions.length > MAX_DIMENSIONS) return { error: `单次最多标记 ${MAX_DIMENSIONS} 个维度，请先精简本次选择` };
    return { dimensions: allDimensions };
  }
  if (!Array.isArray(payload.dimensionIds) || payload.dimensionIds.some((id) => typeof id !== "string")) {
    return { error: "维度选择格式不正确" };
  }
  const requested = [...new Set(payload.dimensionIds.map((id) => clean(id)).filter(Boolean))];
  if (!requested.length) return { error: "请选择至少一个维度" };
  if (requested.length > MAX_DIMENSIONS) return { error: `单次最多标记 ${MAX_DIMENSIONS} 个维度` };
  const byId = new Map(allDimensions.map((dimension) => [dimension.id, dimension]));
  const dimensions = requested.map((id) => byId.get(id)).filter(Boolean);
  if (dimensions.length !== requested.length) return { error: "维度不在当前 Page 中", status: 404 };
  return { dimensions };
}

function normalizeMode(value) {
  if (value === undefined) return "zero";
  return value === "zero" || value === "all" ? value : null;
}

function loadTargets(db, pageId, assetId, dimensions, mode) {
  const rows = db.prepare(
    "SELECT dimension_id AS dimensionId, value, last_rev AS lastRev FROM preview_dimension_values WHERE page_id = ? AND asset_id = ?",
  ).all(pageId, assetId);
  const values = new Map(rows.map((row) => [row.dimensionId, row]));
  return dimensions
    .map((dimension) => {
      const row = values.get(dimension.id);
      if (!row) return null;
      if (mode === "zero" && row.value !== 500) return null;
      return {
        dimensionId: dimension.id,
        lastRev: row.lastRev,
        leftLabel: dimension.leftLabel,
        rightLabel: dimension.rightLabel,
      };
    })
    .filter(Boolean);
}

/** 发送前过滤：用户改过的坐标剔除；维度被删剔除；维度名称用发送时的最新值。 */
function currentTargetsAtSend(db, pageId, assetId, targets) {
  const ids = targets.map((target) => target.dimensionId);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const values = new Map(db.prepare(
    `SELECT dimension_id AS dimensionId, last_rev AS lastRev FROM preview_dimension_values WHERE page_id = ? AND asset_id = ? AND dimension_id IN (${placeholders})`,
  ).all(pageId, assetId, ...ids).map((row) => [row.dimensionId, row.lastRev]));
  const dimensions = new Map(db.prepare(
    `SELECT id, left_label AS leftLabel, right_label AS rightLabel FROM preview_dimensions WHERE page_id = ? AND id IN (${placeholders})`,
  ).all(pageId, ...ids).map((dimension) => [dimension.id, dimension]));

  return targets
    .filter((target) => values.get(target.dimensionId) === target.lastRev && dimensions.has(target.dimensionId))
    .map((target) => {
      const dimension = dimensions.get(target.dimensionId);
      return { ...target, leftLabel: dimension.leftLabel, rightLabel: dimension.rightLabel };
    });
}

async function analyzeTargets({ config, db, store, assetId, targets, signal }) {
  const promptTargets = targets.map((target, index) => ({
    dimensionId: target.dimensionId,
    alias: `d${index + 1}`,
    lastRev: target.lastRev,
  }));
  const promptText = buildPrompt(targets);
  const dataUri = await prepareAssetImageDataUri(db, store, assetId);
  const content = await requestVisionJson(config, {
    system: DIMENSION_SYSTEM,
    text: promptText,
    dataUri,
    maxTokens: Math.min(MAX_TOKENS, 200 + targets.length * 40),
    timeoutMs: timeoutMs(),
    signal,
  });
  return normalizeValues(parseJsonFromContent(content), promptTargets);
}

function applyCandidates(db, pageId, assetId, candidates, targets) {
  const currentDimensions = new Map(getDimensions(db, pageId).map((dimension) => [dimension.id, dimension]));
  const skipped = [];
  const accepted = [];
  for (const candidate of candidates) {
    const target = targets.find((entry) => entry.dimensionId === candidate.dimensionId);
    const current = currentDimensions.get(candidate.dimensionId);
    if (!target || !current) {
      skipped.push({ dimensionId: candidate.dimensionId, reason: "dimension_not_in_page" });
      continue;
    }
    if (current.leftLabel !== target.leftLabel || current.rightLabel !== target.rightLabel) {
      skipped.push({ dimensionId: candidate.dimensionId, reason: "dimension_changed" });
      continue;
    }
    accepted.push(candidate);
  }

  let revision = db.prepare("SELECT revision FROM preview_pages WHERE id = ?").get(pageId)?.revision ?? 0;
  const updates = [];
  if (accepted.length) {
    transaction(db, () => {
      const currentRevision = db.prepare("SELECT revision FROM preview_pages WHERE id = ?").get(pageId);
      if (!currentRevision) throw new Error("Page 不存在");
      const nextRevision = currentRevision.revision + 1;
      const update = db.prepare(
        "UPDATE preview_dimension_values SET value = ?, last_rev = ? WHERE page_id = ? AND asset_id = ? AND dimension_id = ? AND last_rev = ?",
      );
      for (const candidate of accepted) {
        const result = update.run(candidate.value, nextRevision, pageId, assetId, candidate.dimensionId, candidate.lastRev);
        if (result.changes > 0) {
          updates.push({ dimensionId: candidate.dimensionId, value: candidate.value, lastRev: nextRevision });
        } else {
          skipped.push({ dimensionId: candidate.dimensionId, reason: "value_changed" });
        }
      }
      if (updates.length) {
        db.prepare("UPDATE preview_pages SET revision = ? WHERE id = ?").run(nextRevision, pageId);
        revision = nextRevision;
      } else {
        revision = currentRevision.revision;
      }
    });
  }
  return { updates, skipped, revision };
}

function canStop(user, job) {
  return Boolean(user && (user.id === job.userId || user.role === "admin"));
}

function summarize(job, user) {
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    done: job.done,
    applied: job.applied,
    skipped: job.skipped,
    failed: job.failed,
    timedOut: job.timedOut,
    inFlight: [...job.inFlight],
    canStop: canStop(user, job),
    items: [...job.items.entries()].map(([assetId, item]) => ({ assetId, ...item })),
    startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function scheduleCleanup(job) {
  const previous = jobTimers.get(job.id);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    if (jobsByPage.get(job.pageId) === job) jobsByPage.delete(job.pageId);
    jobsById.delete(job.id);
    jobTimers.delete(job.id);
  }, JOB_TTL_MS);
  timer.unref?.();
  jobTimers.set(job.id, timer);
}

function clearJobTimer(jobId) {
  const timer = jobTimers.get(jobId);
  if (timer) clearTimeout(timer);
  jobTimers.delete(jobId);
}

function finalizeJob(job) {
  if (job.status !== "error") job.status = job.cancelRequested ? "stopped" : "done";
  job.finishedAt = new Date().toISOString();
  if (activeBatchJobId === job.id) activeBatchJobId = null;
  if (pageBusy.get(job.pageId)?.id === job.id) pageBusy.delete(job.pageId);
  scheduleCleanup(job);
}

function abortJob(job) {
  job.cancelRequested = true;
  job.queue = [];
  for (const controller of job.controllers.values()) controller.abort();
}

async function processItem(job, assetId, ctx, config) {
  if (job.cancelRequested) return;
  job.items.set(assetId, { status: "running" });
  job.inFlight.add(assetId);
  let status = "skipped";
  let error;
  try {
    const targets = currentTargetsAtSend(ctx.db, job.pageId, assetId, job.targets.get(assetId) ?? []);
    if (!targets.length) {
      job.skipped += 1;
      return;
    }
    const controller = new AbortController();
    job.controllers.set(assetId, controller);
    const candidates = await analyzeTargets({
      config,
      db: ctx.db,
      store: ctx.store,
      assetId,
      targets,
      signal: controller.signal,
    });
    if (job.cancelRequested || controller.signal.aborted) return;
    const result = applyCandidates(ctx.db, job.pageId, assetId, candidates, targets);
    if (result.updates.length) {
      status = "applied";
      job.applied += 1;
      job.seq += 1;
      job.events.push({ seq: job.seq, type: "applied", assetId, updates: result.updates, revision: result.revision });
      if (job.events.length > JOB_EVENT_LIMIT) job.events.splice(0, job.events.length - JOB_EVENT_LIMIT);
    } else {
      job.skipped += 1;
    }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (job.cancelRequested || (reason instanceof AiError && reason.status === 499)) {
      status = "skipped";
    } else if (message.includes("超时")) {
      status = "timed_out";
      job.timedOut += 1;
    } else if (reason instanceof AiError && (reason.status === 401 || reason.status === 403 || /AI 服务返回 40[13]/.test(message))) {
      status = "failed";
      error = message;
      job.failed += 1;
      job.error = message;
      job.status = "error";
      abortJob(job);
    } else {
      status = "failed";
      error = message;
      job.failed += 1;
    }
  } finally {
    job.inFlight.delete(assetId);
    job.controllers.delete(assetId);
    job.items.set(assetId, { status, ...(error ? { error } : {}) });
    job.done += 1;
  }
}

async function runWorker(job, ctx, config) {
  while (!job.cancelRequested) {
    const assetId = job.queue.shift();
    if (!assetId) break;
    await processItem(job, assetId, ctx, config);
  }
}

async function runBatch(job, ctx, config) {
  try {
    const count = Math.min(concurrency(), job.total);
    await Promise.all(Array.from({ length: count }, () => runWorker(job, ctx, config)));
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : String(error);
    abortJob(job);
  } finally {
    finalizeJob(job);
  }
}

function parseJobQuery(url) {
  return {
    projectId: clean(url.searchParams.get("projectId")),
    pageId: clean(url.searchParams.get("pageId")),
    since: Math.max(0, Number(url.searchParams.get("since")) || 0),
  };
}

async function handleSingle(request, ctx) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return bad("请求内容必须是 JSON 对象");

  const projectId = clean(payload.projectId);
  const pageId = clean(payload.pageId);
  const assetId = clean(payload.assetId);
  if (!projectId) return bad("缺少项目 ID");
  if (!pageId) return bad("缺少 Page ID");
  if (!assetId) return bad("缺少素材 ID");

  const page = getPage(ctx.db, projectId, pageId);
  if (!page) return bad("Page 不存在", 404);
  const asset = ctx.db.prepare("SELECT id, mime_type AS mimeType FROM assets WHERE id = ? AND deleted_at IS NULL").get(assetId);
  if (!asset) return bad("素材不存在", 404);
  if (!String(asset.mimeType || "").startsWith("image/")) return bad("只有图片素材支持 AI 标记维度", 400);
  if (!ctx.db.prepare("SELECT 1 FROM preview_page_assets WHERE page_id = ? AND asset_id = ?").get(pageId, assetId)) {
    return bad("素材不在当前 Page 中", 404);
  }

  const allDimensions = getDimensions(ctx.db, pageId);
  if (!allDimensions.length) return bad("当前 Page 没有维度");
  const selected = selectDimensions(allDimensions, payload);
  if (selected.error) return bad(selected.error, selected.status);
  const mode = normalizeMode(payload.mode);
  if (!mode) return bad("标记范围必须是 all 或 zero");
  const config = readAiConfig();
  if (!config) return bad("未配置 AI 服务，请先联系管理员在「AI 服务配置」中设置");

  if (pageBusy.has(pageId)) return bad("当前 Page 已有 AI 标注请求，请稍后再试", 409);
  pageBusy.set(pageId, { kind: "single", id: assetId });

  try {
    const targets = loadTargets(ctx.db, pageId, assetId, selected.dimensions, mode);
    if (!targets.length) return bad(mode === "zero" ? "选中维度没有需要标记的 0 值" : "没有需要标记的维度");
    const candidates = await analyzeTargets({ config, db: ctx.db, store: ctx.store, assetId, targets });
    const result = applyCandidates(ctx.db, pageId, assetId, candidates, targets);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AiError
      ? (message.includes("超时") ? 504 : error.status)
      : 500;
    return bad(message || "AI 标记维度失败", status);
  } finally {
    if (pageBusy.get(pageId)?.id === assetId) pageBusy.delete(pageId);
  }
}

async function handleCreateBatch(request, ctx) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return bad("请求内容必须是 JSON 对象");

  const projectId = clean(payload.projectId);
  const pageId = clean(payload.pageId);
  if (!projectId) return bad("缺少项目 ID");
  if (!pageId) return bad("缺少 Page ID");

  const page = getPage(ctx.db, projectId, pageId);
  if (!page) return bad("Page 不存在", 404);
  const allDimensions = getDimensions(ctx.db, pageId);
  if (!allDimensions.length) return bad("当前 Page 没有维度");
  const selected = selectDimensions(allDimensions, payload);
  if (selected.error) return bad(selected.error, selected.status);
  const mode = normalizeMode(payload.mode);
  if (!mode) return bad("标记范围必须是 all 或 zero");
  const config = readAiConfig();
  if (!config) return bad("未配置 AI 服务，请先联系管理员在「AI 服务配置」中设置");
  if (activeBatchJobId || pageBusy.has(pageId)) return bad("已有 AI 标注任务在执行，请稍后再试", 409);

  const images = ctx.db.prepare(
    `SELECT pa.asset_id AS assetId FROM preview_page_assets pa
     JOIN assets a ON a.id = pa.asset_id
     WHERE pa.page_id = ? AND a.deleted_at IS NULL AND a.mime_type LIKE 'image/%'`,
  ).all(pageId);
  if (!images.length) return bad("当前 Page 没有可标注的图片");

  const targetsByAsset = new Map();
  const queue = [];
  for (const { assetId } of images) {
    const targets = loadTargets(ctx.db, pageId, assetId, selected.dimensions, mode);
    if (!targets.length) continue;
    if (queue.length >= MAX_IMAGES) return bad(`单次最多标记 ${MAX_IMAGES} 张图片，请减少 Page 素材或分批处理`);
    targetsByAsset.set(assetId, targets);
    queue.push(assetId);
  }
  if (!queue.length) return bad(mode === "zero" ? "选中维度没有需要标记的 0 值" : "没有需要标记的图片");

  const id = randomUUID();
  const job = {
    id,
    projectId,
    pageId,
    userId: ctx.user.id,
    userName: ctx.user.username,
    status: "running",
    queue,
    total: queue.length,
    done: 0,
    applied: 0,
    skipped: 0,
    failed: 0,
    timedOut: 0,
    items: new Map(),
    inFlight: new Set(),
    targets: targetsByAsset,
    controllers: new Map(),
    events: [],
    seq: 0,
    startedAt: new Date().toISOString(),
    cancelRequested: false,
  };

  const old = jobsByPage.get(pageId);
  if (old) clearJobTimer(old.id);
  jobsByPage.set(pageId, job);
  jobsById.set(id, job);
  activeBatchJobId = id;
  pageBusy.set(pageId, { kind: "batch", id });

  void runBatch(job, ctx, config);
  return Response.json({ jobId: id, total: job.total }, { status: 202 });
}

async function handleGetJob(request, ctx) {
  const url = new URL(request.url);
  const { projectId, pageId, since } = parseJobQuery(url);
  if (!projectId) return bad("缺少项目 ID");
  if (!pageId) return bad("缺少 Page ID");
  const page = getPage(ctx.db, projectId, pageId);
  if (!page) return bad("Page 不存在", 404);
  const job = jobsByPage.get(pageId);
  if (!job || job.projectId !== projectId) return Response.json({ job: null, events: [] });
  return Response.json({
    job: summarize(job, ctx.user),
    events: job.events.filter((event) => event.seq > since),
  });
}

async function handleStop(request, ctx) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") return bad("请求内容必须是 JSON 对象");
  const jobId = clean(payload.jobId);
  if (!jobId) return bad("缺少任务 ID");
  const job = jobsById.get(jobId);
  if (!job) return bad("任务不存在", 404);
  if (!canStop(ctx.user, job)) return bad("只有任务创建者或管理员可以停止", 403);
  if (job.status === "running" || job.status === "stopping") {
    job.status = "stopping";
    abortJob(job);
  }
  return Response.json({ ok: true, status: job.status });
}

/**
 * 维度预览的 AI 标记入口：
 * - POST /api/preview-pages/ai-dimensions/single 单图同步
 * - POST /api/preview-pages/ai-dimensions      批量任务
 * - GET  /api/preview-pages/ai-dimensions/job  任务状态与增量事件
 * - POST /api/preview-pages/ai-dimensions/stop 停止任务
 */
export async function handlePreviewAi(request, ctx) {
  const url = new URL(request.url);
  if (ctx.user?.role === "guest") return bad("游客只能浏览，不能进行此操作", 403);

  if (url.pathname === "/api/preview-pages/ai-dimensions/single" && request.method === "POST") {
    return handleSingle(request, ctx);
  }
  if (url.pathname === "/api/preview-pages/ai-dimensions" && request.method === "POST") {
    return handleCreateBatch(request, ctx);
  }
  if (url.pathname === "/api/preview-pages/ai-dimensions/job" && request.method === "GET") {
    return handleGetJob(request, ctx);
  }
  if (url.pathname === "/api/preview-pages/ai-dimensions/stop" && request.method === "POST") {
    return handleStop(request, ctx);
  }
  return bad("Not found", 404);
}
