import { AiError, parseJsonFromContent, prepareAssetImageDataUri, readAiConfig, requestVisionJson } from "./ai.js";

const MAX_DIMENSIONS = 20;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 2_000;

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

/** 单 Page 的单图请求锁：同一 Page 同时只允许一个 AI 维度操作。 */
const singleLocks = new Map();

const clean = (value, max = 80) => typeof value === "string" ? value.trim().slice(0, max) : "";
const bad = (error, status = 400) => Response.json({ error }, { status });

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
  const lines = dimensions.map((dimension, index) => {
    const alias = `d${index + 1}`;
    return `- ${alias}：左端「${dimension.leftLabel}」 ↔ 右端「${dimension.rightLabel}」`;
  });
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

/**
 * 单图 AI 维度标记：同步处理一张图片，返回已写入的坐标。
 * 不建队列、不产生批量胶囊；批量任务（后续阶段）会复用这里的单图函数。
 */
export async function handlePreviewAi(request, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/preview-pages/ai-dimensions/single" || request.method !== "POST") {
    return bad("Not found", 404);
  }
  if (ctx.user?.role === "guest") return bad("游客只能浏览，不能进行此操作", 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return bad("请求内容必须是 JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return bad("请求内容必须是对象");

  const projectId = clean(payload.projectId);
  const pageId = clean(payload.pageId);
  const assetId = clean(payload.assetId);
  if (!projectId) return bad("缺少项目 ID");
  if (!pageId) return bad("缺少 Page ID");
  if (!assetId) return bad("缺少素材 ID");

  const page = ctx.db.prepare("SELECT id, project_id AS projectId, revision FROM preview_pages WHERE id = ? AND project_id = ?").get(pageId, projectId);
  if (!page) return bad("Page 不存在", 404);

  const asset = ctx.db.prepare("SELECT id, mime_type AS mimeType FROM assets WHERE id = ? AND deleted_at IS NULL").get(assetId);
  if (!asset) return bad("素材不存在", 404);
  if (!String(asset.mimeType || "").startsWith("image/")) return bad("只有图片素材支持 AI 标记维度", 400);
  if (!ctx.db.prepare("SELECT 1 FROM preview_page_assets WHERE page_id = ? AND asset_id = ?").get(pageId, assetId)) {
    return bad("素材不在当前 Page 中", 404);
  }

  const allDimensions = ctx.db.prepare(
    "SELECT id, left_label AS leftLabel, right_label AS rightLabel FROM preview_dimensions WHERE page_id = ? ORDER BY sort_order, id",
  ).all(pageId);
  if (!allDimensions.length) return bad("当前 Page 没有维度");

  let dimensions = allDimensions;
  if (payload.dimensionIds !== undefined) {
    if (!Array.isArray(payload.dimensionIds) || payload.dimensionIds.some((id) => typeof id !== "string")) {
      return bad("维度选择格式不正确");
    }
    const requested = [...new Set(payload.dimensionIds.map((id) => clean(id)).filter(Boolean))];
    if (!requested.length) return bad("请选择至少一个维度");
    if (requested.length > MAX_DIMENSIONS) return bad(`单次最多标记 ${MAX_DIMENSIONS} 个维度`);
    const byId = new Map(allDimensions.map((dimension) => [dimension.id, dimension]));
    dimensions = requested.map((id) => byId.get(id)).filter(Boolean);
    if (dimensions.length !== requested.length) return bad("维度不在当前 Page 中", 404);
  } else if (dimensions.length > MAX_DIMENSIONS) {
    return bad(`单次最多标记 ${MAX_DIMENSIONS} 个维度，请先精简本次选择`);
  }

  const mode = payload.mode === undefined ? "zero" : payload.mode;
  if (mode !== "zero" && mode !== "all") return bad("标记范围必须是 all 或 zero");

  const config = readAiConfig();
  if (!config) return bad("未配置 AI 服务，请先联系管理员在「AI 服务配置」中设置");

  if (singleLocks.has(pageId)) return bad("当前 Page 已有 AI 标注请求，请稍后再试", 409);
  singleLocks.set(pageId, assetId);

  try {
    const valueRows = ctx.db.prepare(
      "SELECT dimension_id AS dimensionId, value, last_rev AS lastRev FROM preview_dimension_values WHERE page_id = ? AND asset_id = ?",
    ).all(pageId, assetId);
    const values = new Map(valueRows.map((row) => [row.dimensionId, row]));

    const targets = dimensions
      .map((dimension) => {
        const row = values.get(dimension.id);
        if (!row) return null;
        if (mode === "zero" && row.value !== 500) return null;
        return {
          dimensionId: dimension.id,
          value: row.value,
          lastRev: row.lastRev,
          leftLabel: dimension.leftLabel,
          rightLabel: dimension.rightLabel,
        };
      })
      .filter(Boolean);

    if (!targets.length) {
      return bad(mode === "zero" ? "选中维度没有需要标记的 0 值" : "没有需要标记的维度");
    }

    const promptTargets = targets.map((target, index) => ({
      dimensionId: target.dimensionId,
      alias: `d${index + 1}`,
      lastRev: target.lastRev,
    }));
    const promptDimensions = targets.map((target) => ({
      leftLabel: target.leftLabel,
      rightLabel: target.rightLabel,
    }));
    const promptText = buildPrompt(promptDimensions);
    const dataUri = await prepareAssetImageDataUri(ctx.db, ctx.store, assetId);
    const timeoutMs = Number(process.env.AI_DIMENSION_ITEM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const content = await requestVisionJson(config, {
      system: DIMENSION_SYSTEM,
      text: promptText,
      dataUri,
      maxTokens: Math.min(MAX_TOKENS, 200 + targets.length * 40),
      timeoutMs,
    });
    const parsed = parseJsonFromContent(content);
    const candidates = normalizeValues(parsed, promptTargets);

    const skipped = [];
    const currentDimensions = new Map(ctx.db.prepare(
      "SELECT id, left_label AS leftLabel, right_label AS rightLabel FROM preview_dimensions WHERE page_id = ?",
    ).all(pageId).map((dimension) => [dimension.id, dimension]));

    const accepted = [];
    for (const candidate of candidates) {
      const target = targets.find((entry) => entry.dimensionId === candidate.dimensionId);
      const current = currentDimensions.get(candidate.dimensionId);
      if (!current) {
        skipped.push({ dimensionId: candidate.dimensionId, reason: "dimension_not_in_page" });
        continue;
      }
      if (current.leftLabel !== target.leftLabel || current.rightLabel !== target.rightLabel) {
        skipped.push({ dimensionId: candidate.dimensionId, reason: "dimension_changed" });
        continue;
      }
      accepted.push(candidate);
    }

    let revision = page.revision;
    const updates = [];
    if (accepted.length) {
      transaction(ctx.db, () => {
        const nextRevision = ctx.db.prepare("SELECT revision FROM preview_pages WHERE id = ?").get(pageId).revision + 1;
        const update = ctx.db.prepare(
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
          ctx.db.prepare("UPDATE preview_pages SET revision = ? WHERE id = ?").run(nextRevision, pageId);
          revision = nextRevision;
        } else {
          revision = ctx.db.prepare("SELECT revision FROM preview_pages WHERE id = ?").get(pageId).revision;
        }
      });
    }

    return Response.json({ ok: true, updates, skipped, revision });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof AiError
      ? (message.includes("超时") ? 504 : error.status)
      : 500;
    return bad(message || "AI 标记维度失败", status);
  } finally {
    if (singleLocks.get(pageId) === assetId) singleLocks.delete(pageId);
  }
}
