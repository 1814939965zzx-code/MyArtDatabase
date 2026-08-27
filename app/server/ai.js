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
const MAX_DICT_TAGS = 200;
const MAX_TAG_LENGTH = 40;
const MAX_REMOTE_IMAGE_BYTES = 20 * 1024 * 1024;

/** 近义变体常见尾缀：候选匹配时剥离后再比较，用于“氛围”→“氛围感”这类同源词。 */
const SUFFIX_CHARS = "感风气色调型物图景体品式化效";

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * 配置文件路径：AI_CONFIG_PATH 显式指定 > 数据库同目录。
 * 跟随 DB_PATH 保证服务进程永远有权写入（开发 app/data/，生产 /var/lib/artdatabase/）。
 */
export function resolveConfigPath() {
  const explicit = process.env.AI_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  const dbPath = process.env.DB_PATH?.trim() || path.join(appRoot, "data", "app.db");
  return path.join(path.dirname(dbPath), "ai-config.json");
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

/** 第一轮视觉提示词：注入词库时要求词库优先、禁止近义变体；无词库时退回自由生成。 */
const ROUND1_SYSTEM = (hasDictionary) => [
  `你是专业的图片素材标签助手。用户会给你一张图片${hasDictionary ? "和本素材库的已有标签" : ""}，请观察图片内容，输出适合素材库检索的简洁中文标签。`,
  "要求：",
  "- 只输出 JSON 字符串数组，不要任何解释文字；",
  "- 每个标签为 2~8 个汉字或简短中文词组；",
  ...(hasDictionary
    ? [
      "- 优先原样使用用户消息中列出的词库标签，这是第一优先级；",
      "- 只有词库确实没有合适标签时才允许新建，且新建数量尽量少（不超过 3 个）；",
      "- 禁止输出词库标签的同义或近义变体（例如词库已有“氛围”就不要再输出“氛围感”“气氛”）；",
    ]
    : []),
  "- 不要输出该素材已使用的标签；",
  "- 覆盖主体、场景、风格、色调、氛围、构图等维度；",
  "- 输出 8~15 个标签，最多不超过 30 个；",
  "- 输出前自查：剔除重复项和含义重复的近义词；",
  "- 不要输出与图片无关的标签。",
].join("\n");

const ROUND2_SYSTEM = [
  "你是标签词库管理员。我们会给你若干 AI 建议标签，以及每个标签在本词库中的相似候选标签。",
  "请判断每个建议标签应该复用哪个候选，还是作为新标签创建。",
  "只输出 JSON 数组，不要解释文字。每个元素格式：{\"tag\":\"建议标签\",\"decision\":\"reuse\"或\"new\",\"reusedTag\":\"候选标签名或null\"}。",
  "优先复用：候选中有同义、近义或表达更规范的一致标签时，decision 必须用 reuse 且 reusedTag 必须为其中一个候选；",
  "只有全部候选都不合适时，才允许 decision 用 new（reusedTag 为 null）。",
].join("\n");

/** 剥离近义尾缀（“氛围感”→“氛围”），剥离后至少保留 1 个字符。 */
function stripSuffix(key) {
  const stripped = key.replace(new RegExp(`[${SUFFIX_CHARS}]+$`, "u"), "");
  return stripped.length >= 1 ? stripped : key;
}

/** 莱文斯坦距离：用于短词近义匹配（如“人像”/“人物”）。 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 生成模糊候选：归一后互相包含、去尾缀同源或短词编辑距离相近，按使用次数降序，最多 MAX_CANDIDATES 个。 */
function fuzzyCandidates(rawTag, tagRows) {
  const key = normalizeTag(rawTag);
  if (!key) return [];
  const stripped = stripSuffix(key);
  return tagRows
    .filter((row) => {
      const normalized = normalizeTag(row.name);
      if (!normalized || normalized === key) return false;
      if (normalized.includes(key) || key.includes(normalized)) return true;
      const normStripped = stripSuffix(normalized);
      if (stripped === normStripped) return true;
      const minLen = Math.min(key.length, normalized.length);
      const maxDist = minLen <= 3 ? 1 : 2;
      if (minLen >= 2 && levenshtein(key, normalized) <= maxDist) return true;
      return false;
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

/** 把裁决结果合并成最终标签列表（不落库）：已有标签在前、AI 标签追加在后，去重并应用 50 个上限。 */
function mergeDecisions(existingNames, decisions) {
  const present = new Set(existingNames.map(normalizeTag));
  const finalTags = [...existingNames];
  let reused = 0;
  let created = 0;
  let dropped = 0;
  for (const decision of decisions) {
    const name = String(decision.tag ?? "").trim();
    if (!name) continue;
    if (finalTags.length >= MAX_ASSET_TAGS) { dropped += 1; continue; }
    const finalName = decision.decision === "reuse" && decision.reusedTag ? decision.reusedTag : name;
    if (present.has(normalizeTag(finalName))) continue; // 与已有标签重复，天然幂等
    present.add(normalizeTag(finalName));
    finalTags.push(finalName);
    if (decision.decision === "reuse" && decision.reusedTag && normalizeTag(decision.reusedTag) === normalizeTag(name)) {
      reused += 1;
    } else {
      created += 1;
    }
  }
  return { tags: finalTags, reused, created, dropped };
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

/** 单图 AI 打标核心分析：看图出标签 → 精确复用 / 模糊候选 AI 裁决，返回裁决列表（不落库）。 */
async function analyzeTags(db, config, dataUri, existingNames) {
  // 词库优先：按使用次数取前 MAX_DICT_TAGS 个标签注入第一轮，已用标签单独列出
  const tagRows = listTags(db);
  const existingSet = new Set(existingNames.map(normalizeTag));
  const used = [];
  const unused = [];
  for (const row of tagRows) {
    if (existingSet.has(normalizeTag(row.name))) continue;
    (row.usageCount > 0 ? used : unused).push(row);
  }
  const sortRows = (a, b) => (b.usageCount - a.usageCount) || a.name.localeCompare(b.name, "zh-CN");
  const dictPool = [...used.sort(sortRows), ...unused.sort(sortRows)].slice(0, MAX_DICT_TAGS).map((row) => row.name);
  const promptParts = [];
  if (dictPool.length) {
    promptParts.push(`本素材库已有标签（按使用次数排序）：${dictPool.join("、")}`);
  }
  if (existingNames.length) {
    promptParts.push(`该素材当前已使用标签：${existingNames.join("、")}（不要重复输出）`);
  }
  promptParts.push("请为这张图片生成中文标签，只输出 JSON 字符串数组，例如：[\"建筑\",\"氛围\",\"灰调\"]");

  const round1 = await chatCompletions({
    ...config,
    temperature: 0.2,
    messages: [
      { role: "system", content: ROUND1_SYSTEM(dictPool.length > 0) },
      {
        role: "user",
        content: [
          { type: "text", text: promptParts.join("\n\n") },
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
  return decisions;
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
  const existingNames = getAssetTagNames(db, assetId);
  const decisions = await analyzeTags(db, config, dataUri, existingNames);
  return applyAiDecisions(db, assetId, decisions);
}

/** 上传前 AI 打标：对尚未入库的待上传图片分析并返回建议标签（不落库、不建立任何关联）。 */
export async function suggestTagsForUpload(db, buffer) {
  const config = readAiConfig();
  if (!config) {
    throw new AiError("未配置 AI 打标服务：请设置 AI_BASE_URL、AI_API_KEY、AI_MODEL 环境变量，或提供 app/data/ai-config.json", 400);
  }
  const compressed = await compressForAi(buffer);
  const dataUri = `data:image/jpeg;base64,${compressed.toString("base64")}`;
  const decisions = await analyzeTags(db, config, dataUri, []);
  return mergeDecisions([], decisions);
}
