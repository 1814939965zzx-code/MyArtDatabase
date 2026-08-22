import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { attachTagToAsset, findTagByName, findOrCreateTag, getAssetTagNames, listTags, MAX_ASSET_TAGS, normalizeTag } from "./tags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const CALL_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_AI_TAGS = 30;
const MAX_CANDIDATES = 5;
const MAX_TAG_LENGTH = 40;
const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** 配置文件路径：AI_CONFIG_PATH 或默认 app/data/ai-config.json。 */
export function resolveConfigPath() {
  return process.env.AI_CONFIG_PATH?.trim() || path.join(appRoot, "data", "ai-config.json");
}

function readConfigFile() {
  try {
    const parsed = JSON.parse(readFileSync(resolveConfigPath(), "utf8"));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 读取 AI 服务配置：环境变量（AI_BASE_URL / AI_API_KEY / AI_MODEL）逐项优先，
 * 缺失项回退到配置文件（AI_CONFIG_PATH 或 app/data/ai-config.json）。
 */
export function readAiConfig() {
  const env = {
    baseUrl: process.env.AI_BASE_URL?.trim() || "",
    apiKey: process.env.AI_API_KEY?.trim() || "",
    model: process.env.AI_MODEL?.trim() || "",
  };
  const file = readConfigFile();
  const merged = {
    baseUrl: env.baseUrl || String(file.baseUrl || "").trim(),
    apiKey: env.apiKey || String(file.apiKey || "").trim(),
    model: env.model || String(file.model || "").trim(),
  };
  if (!merged.baseUrl || !merged.apiKey || !merged.model) return null;
  return merged;
}

/**
 * 配置页只读状态：永不回显完整 key，只给尾号掩码；标注环境变量是否接管。
 */
export function readAiConfigDetails() {
  const env = {
    baseUrl: process.env.AI_BASE_URL?.trim() || "",
    apiKey: process.env.AI_API_KEY?.trim() || "",
    model: process.env.AI_MODEL?.trim() || "",
  };
  const file = readConfigFile();
  const envOverride = Boolean(env.baseUrl || env.apiKey || env.model);
  const apiKey = env.apiKey || String(file.apiKey || "").trim();
  const merged = {
    baseUrl: env.baseUrl || String(file.baseUrl || "").trim(),
    apiKey,
    model: env.model || String(file.model || "").trim(),
  };
  return {
    source: envOverride ? "env" : "file",
    envOverride,
    baseUrl: merged.baseUrl,
    model: merged.model,
    apiKeyLast4: apiKey.length >= 4 ? apiKey.slice(-4) : "",
    configured: Boolean(merged.baseUrl && apiKey && merged.model),
  };
}

/** 配置页保存：写入配置文件；apiKey 留空时保留原值，key 只存服务端。 */
export function saveAiConfig({ baseUrl, apiKey, model }) {
  const configPath = resolveConfigPath();
  const file = readConfigFile();
  const next = {
    baseUrl: String(baseUrl ?? file.baseUrl ?? "").trim(),
    model: String(model ?? file.model ?? "").trim(),
    apiKey: apiKey && String(apiKey).trim() ? String(apiKey).trim() : String(file.apiKey || "").trim(),
  };
  mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(next, null, 2));
  renameSync(tmpPath, configPath);
  return next;
}

async function chatCompletions({ baseUrl, apiKey, model, messages, temperature, maxTokens }) {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/chat/completions";
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AiError("AI 服务调用超时，请重试");
    }
    throw new AiError(`无法连接 AI 服务：${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new AiError(`AI 服务返回 ${response.status}：${text.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError("AI 服务响应不是有效 JSON");
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiError("AI 服务未返回内容");
  return content;
}

/** 配置页“测试连接”：用当前生效配置发一次极小的文本请求。 */
export async function testAiConnection() {
  const config = readAiConfig();
  if (!config) throw new AiError("未配置 AI 服务", 400);
  return chatCompletions({
    ...config,
    temperature: 0,
    maxTokens: 8,
    messages: [{ role: "user", content: "ping" }],
  });
}

/** 配置页“查看可用模型”：拉取当前 key 有权访问的模型 id 列表。 */
export async function listAiModels() {
  const config = readAiConfig();
  if (!config) throw new AiError("未配置 AI 服务", 400);
  const url = new URL(config.baseUrl);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/models";
  let response;
  try {
    response = await fetch(url, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AiError(`无法连接 AI 服务：${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  if (!response.ok) throw new AiError(`AI 服务返回 ${response.status}：${text.slice(0, 300)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError("AI 服务响应不是有效 JSON");
  }
  const ids = (Array.isArray(data?.data) ? data.data : [])
    .map((entry) => typeof entry?.id === "string" ? entry.id : "")
    .filter(Boolean);
  return [...new Set(ids)].sort();
}

function parseJsonFromContent(content) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : content;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // 继续抛统一错误
      }
    }
  }
  throw new AiError("无法解析 AI 返回的 JSON");
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function fetchRemoteImage(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AiError("远程图片地址协议不受支持", 400);
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new AiError("下载远程图片超时或失败");
  }
  if (!response.ok) throw new AiError(`下载远程图片失败：HTTP ${response.status}`);
  if (!(response.headers.get("content-type") || "").startsWith("image/")) throw new AiError("远程资源不是图片");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new AiError("远程图片超过 20MB");
  return buffer;
}

async function loadAssetImage(db, store, assetId) {
  const asset = db.prepare("SELECT storage_key AS storageKey, thumbnail_url AS thumbnailUrl FROM assets WHERE id = ? AND deleted_at IS NULL").get(assetId);
  if (!asset) throw new AiError("素材不存在", 404);
  if (asset.storageKey) {
    const opened = await store.open(asset.storageKey, "original");
    if (!opened) throw new AiError("素材原图文件缺失", 404);
    return streamToBuffer(opened.stream);
  }
  if (asset.thumbnailUrl && /^https?:\/\//i.test(asset.thumbnailUrl)) {
    return fetchRemoteImage(asset.thumbnailUrl);
  }
  throw new AiError("该素材没有可发送的图片文件", 400);
}

async function compressForAi(buffer) {
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    throw new AiError("图片压缩失败，无法发送给 AI");
  }
}

const ROUND1_SYSTEM = [
  "你是专业的图片素材标签助手。用户会给你一张图片，请观察图片内容，输出适合素材库检索的简洁中文标签。",
  "要求：",
  "- 只输出 JSON 字符串数组，不要任何解释文字；",
  "- 每个标签为 2~8 个汉字或简短中文词组；",
  "- 覆盖主体、场景、风格、色调、氛围、构图等维度；",
  "- 输出 8~15 个标签，最多不超过 30 个；",
  "- 不要输出与图片无关的标签。",
].join("\n");

const ROUND2_SYSTEM = [
  "你是标签词库管理员。我们会给你若干 AI 建议标签，以及每个标签在本词库中的相似候选标签。",
  "请判断每个建议标签应该复用哪个候选，还是作为新标签创建。",
  "只输出 JSON 数组，不要解释文字。每个元素格式：{\"tag\":\"建议标签\",\"decision\":\"reuse\"或\"new\",\"reusedTag\":\"候选标签名或null\"}。",
  "如果候选中有同义或表达更好的一致标签，decision 用 reuse 且 reusedTag 必须为候选之一；否则 decision 用 new 且 reusedTag 为 null。",
].join("\n");

/** 生成模糊候选：归一后互相包含、按使用次数降序，最多 MAX_CANDIDATES 个。 */
function fuzzyCandidates(rawTag, tagRows) {
  const key = normalizeTag(rawTag);
  if (!key) return [];
  return tagRows
    .filter((row) => {
      const normalized = normalizeTag(row.name);
      return normalized && normalized !== key && (normalized.includes(key) || key.includes(normalized));
    })
    .sort((a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, MAX_CANDIDATES)
    .map((row) => row.name);
}

async function judgeAmbiguous(config, items) {
  const content = await chatCompletions({
    ...config,
    temperature: 0,
    messages: [
      { role: "system", content: ROUND2_SYSTEM },
      { role: "user", content: JSON.stringify({ items }) },
    ],
  });
  const judged = parseJsonFromContent(content);
  if (!Array.isArray(judged)) throw new AiError("AI 裁决返回格式异常");
  const byTag = new Map(items.map((item) => [item.tag, item]));
  const decisions = [];
  for (const entry of judged) {
    const item = entry && typeof entry.tag === "string" ? byTag.get(entry.tag) : undefined;
    if (!item) continue;
    if (entry.decision === "reuse" && typeof entry.reusedTag === "string" && item.candidates.includes(entry.reusedTag)) {
      decisions.push({ tag: item.tag, decision: "reuse", reusedTag: entry.reusedTag });
    } else {
      decisions.push({ tag: item.tag, decision: "new", reusedTag: null });
    }
  }
  for (const item of items) {
    if (!decisions.some((decision) => decision.tag === item.tag)) {
      decisions.push({ tag: item.tag, decision: "new", reusedTag: null });
    }
  }
  return decisions;
}

/** 把裁决结果写入素材标签：合并去重、总上限 50、人工标签在前、AI 标签追加在后。 */
function applyAiDecisions(db, assetId, decisions) {
  const existingNames = getAssetTagNames(db, assetId);
  const present = new Set(existingNames.map(normalizeTag));
  const finalTags = [...existingNames];
  let reused = 0;
  let created = 0;
  let dropped = 0;
  db.exec("BEGIN");
  try {
    for (const decision of decisions) {
      const name = String(decision.tag ?? "").trim();
      if (!name) continue;
      if (finalTags.length >= MAX_ASSET_TAGS) { dropped += 1; continue; }
      let tag;
      if (decision.decision === "reuse" && decision.reusedTag) {
        tag = findTagByName(db, decision.reusedTag);
      }
      if (!tag) tag = findOrCreateTag(db, name, "ai");
      if (present.has(normalizeTag(tag.name))) continue; // 与已有标签重复，天然幂等
      attachTagToAsset(db, assetId, tag.id, { source: "ai" });
      present.add(normalizeTag(tag.name));
      finalTags.push(tag.name);
      if (decision.decision === "reuse" && decision.reusedTag && normalizeTag(decision.reusedTag) === normalizeTag(tag.name)) {
        reused += 1;
      } else {
        created += 1;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { tags: finalTags, reused, created, dropped };
}

/** 单图 AI 打标主流程：看图出标签 → 精确复用 / 模糊候选 AI 裁决 → 合并落库。 */
export async function tagAssetWithAi(db, store, assetId) {
  const config = readAiConfig();
  if (!config) {
    throw new AiError("未配置 AI 打标服务：请设置 AI_BASE_URL、AI_API_KEY、AI_MODEL 环境变量，或提供 app/data/ai-config.json", 400);
  }
  const buffer = await loadAssetImage(db, store, assetId);
  const compressed = await compressForAi(buffer);
  const dataUri = `data:image/jpeg;base64,${compressed.toString("base64")}`;

  const round1 = await chatCompletions({
    ...config,
    temperature: 0.2,
    messages: [
      { role: "system", content: ROUND1_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "请为这张图片生成中文标签，只输出 JSON 字符串数组，例如：[\"建筑\",\"氛围\",\"灰调\"]" },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ],
  });
  const rawTags = parseJsonFromContent(round1);
  if (!Array.isArray(rawTags)) throw new AiError("AI 返回的标签格式异常");
  const aiTags = [...new Set(
    rawTags.map((tag) => String(tag).trim()).filter((tag) => tag && tag.length <= MAX_TAG_LENGTH),
  )].slice(0, MAX_AI_TAGS);
  if (!aiTags.length) throw new AiError("AI 未识别出标签，请换一张更清晰的图片重试");

  const tagRows = listTags(db);
  const decisions = [];
  const ambiguous = [];
  for (const tag of aiTags) {
    const key = normalizeTag(tag);
    const exact = tagRows.find((row) => normalizeTag(row.name) === key);
    if (exact) {
      decisions.push({ tag, decision: "reuse", reusedTag: exact.name });
      continue;
    }
    const candidates = fuzzyCandidates(tag, tagRows);
    if (!candidates.length) {
      decisions.push({ tag, decision: "new", reusedTag: null });
      continue;
    }
    ambiguous.push({ tag, candidates });
  }
  if (ambiguous.length) {
    try {
      decisions.push(...await judgeAmbiguous(config, ambiguous));
    } catch {
      // 第二轮裁决失败：歧义标签退化为新建，不阻塞整体打标
      for (const { tag } of ambiguous) decisions.push({ tag, decision: "new", reusedTag: null });
    }
  }
  return applyAiDecisions(db, assetId, decisions);
}
