/**
 * artDatabase 浏览器采集扩展 —— 后台 Service Worker
 *
 * 职责：
 *  - 注册右键菜单（仅图片上出现，单选项「保存到素材库」）
 *  - 点击后：注入内容脚本 → 下载图片（绕过页面 CORS）→ 魔数校验格式与大小
 *           → SHA-256 查重 → 重复则 toast 跳过，否则向页面派发确认面板
 *  - 代理内容脚本的全部网络请求（项目列表 / 标签字典 / AI 打标 / 上传），统一携带 Bearer 令牌
 *
 * 本扩展与服务器的所有通信均使用「插件令牌」（Authorization: Bearer），
 * 令牌在网页端「账号设置 → 插件令牌」生成，填入本扩展设置页。
 */

const MENU_ID = "artdb-save-image";
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * 采集会话：SW 在内存中持有图片字节，内容脚本只收元数据。
 * 不要经消息通道传 Blob —— Blob 跨上下文传递不可靠，会导致内容脚本
 * URL.createObjectURL 抛错、面板后续逻辑（项目加载/按钮绑定）全部中断。
 */
const sessions = new Map(); // tabId -> { bytes, mime, sha256, at }
const SESSION_TTL_MS = 10 * 60 * 1000;

function getSession(tabId) {
  const session = sessions.get(tabId);
  if (!session) return null;
  if (Date.now() - session.at > SESSION_TTL_MS) {
    sessions.delete(tabId);
    return null;
  }
  return session;
}

function takeSession(tabId) {
  const session = getSession(tabId);
  if (session) sessions.delete(tabId);
  return session;
}

function dropSession(tabId) {
  sessions.delete(tabId);
}

const EXT_BY_MIME = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/svg+xml": "svg", "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif", "image/avif": "avif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "video/x-msvideo": "avi", "video/x-matroska": "mkv", "video/mpeg": "mpg",
  "video/3gpp": "3gp", "video/3gpp2": "3g2",
};

/** 仅接受 JPEG / PNG / WebP / GIF / SVG / TIFF / HEIC / AVIF（与服务端 IMAGE_TYPES 一致），按魔数判定。 */
const IMAGE_DETECTORS = [
  {
    mime: "image/jpeg",
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: "image/webp",
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    mime: "image/gif",
    test: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
      (b[3] === 0x38 || b[3] === 0x39) && b[4] === 0x37 && b[5] === 0x61,
  },
  {
    mime: "image/svg+xml",
    test: (b) => {
      const head = new TextDecoder().decode(b.slice(0, 1024)).replace(/^\uFEFF/, "").trimStart().toLowerCase();
      return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
    },
  },
  {
    mime: "image/tiff",
    test: (b) =>
      b.length >= 4 &&
      ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
        (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)),
  },
  {
    mime: "image/heic",
    test: (b) => {
      if (b.length < 12) return false;
      const ascii = (offset) => String.fromCharCode(b[offset], b[offset + 1], b[offset + 2], b[offset + 3]);
      if (ascii(4) !== "ftyp") return false;
      const brand = ascii(8).toLowerCase();
      return ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand);
    },
  },
  {
    mime: "image/avif",
    test: (b) => {
      if (b.length < 12) return false;
      const ascii = (offset) => String.fromCharCode(b[offset], b[offset + 1], b[offset + 2], b[offset + 3]);
      if (ascii(4) !== "ftyp") return false;
      const brand = ascii(8).toLowerCase();
      // AVIF 也是 ISO-BMFF（ftyp）容器，必须与视频区分，否则会被误判为 video/mp4
      return ["avif", "avis"].includes(brand);
    },
  },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "保存到素材库", contexts: ["image", "video"] });
  });
});

// ---- 右键菜单点击 ----
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const tabId = tab?.id;
  if (tabId == null) return;

  try {
    // 点击右键菜单会授予 activeTab，此处按需注入内容脚本
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch {
      return; // 无法注入的页面（chrome:// 等）直接放弃
    }

    const { serverUrl, token } = await chrome.storage.local.get(["serverUrl", "token"]);
    if (!serverUrl || !token) {
      notify(tabId, { type: "toast", message: "请先在扩展设置中配置服务器地址和令牌", kind: "error", actionLabel: "去设置", action: "open-options" });
      return;
    }

    // 1. 下载图片/视频
    if (!info.srcUrl) {
      notify(tabId, { type: "toast", message: "无法获取素材（该元素没有可用地址，可能是懒加载未完成）", kind: "error" });
      return;
    }
    let bytes, declaredMime;
    try {
      ({ bytes, mime: declaredMime } = await fetchMedia(info.srcUrl, tabId));
    } catch (error) {
      notify(tabId, { type: "toast", message: "无法获取素材：" + error.message, kind: "error" });
      return;
    }

    // 2. 校验格式与大小（图片 50MB / 视频 200MB，与服务端一致）
    const imageMime = detectImage(bytes, declaredMime);
    const videoMime = imageMime ? null : detectVideo(bytes, declaredMime);
    const mime = imageMime || videoMime;
    const kind = imageMime ? "image" : videoMime ? "video" : null;
    if (!kind) {
      notify(tabId, {
        type: "toast",
        message: "仅支持 JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC 图片或 mp4/webm/mov/mkv/avi 等视频",
        kind: "error",
      });
      return;
    }
    const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (bytes.byteLength > maxBytes) {
      notify(tabId, { type: "toast", message: kind === "video" ? "视频超过 200MB，无法保存" : "图片超过 50MB，无法保存", kind: "error" });
      return;
    }

    // 3. 查重（弹面板之前；重复直接跳过）
    let sha256;
    try {
      sha256 = await sha256Hex(bytes);
    } catch {
      notify(tabId, { type: "toast", message: "素材校验失败，请重试", kind: "error" });
      return;
    }
    try {
      const checked = await api(serverUrl, token, "/api/uploads/check", {
        method: "POST",
        body: JSON.stringify({ sha256 }),
      });
      if (Array.isArray(checked?.duplicates) && checked.duplicates.length > 0) {
        notify(tabId, { type: "toast", message: "已存在，未保存（素材库中已有相同文件）", kind: "info" });
        return;
      }
    } catch (error) {
      if (error.status === 401) {
        notify(tabId, { type: "toast", message: "令牌无效或已过期，请到扩展设置页更新", kind: "error", actionLabel: "去设置", action: "open-options" });
        return;
      }
      if (error.status === 409) {
        notify(tabId, { type: "toast", message: "已存在，未保存（素材库中已有相同文件）", kind: "info" });
        return;
      }
      notify(tabId, { type: "toast", message: "查重失败：" + error.message, kind: "error" });
      return;
    }

    // 4. 字节保留在 SW 会话中，派发确认面板
    //    图片预览以 dataURL（base64 字符串）随消息下发：扩展消息通道在旧版 Chrome
    //    （<134）按 JSON 序列化，ArrayBuffer 会变成 {} 导致预览损坏；dataURL 字符串
    //    在所有版本都安全。>20MB 的降级为占位，避免消息通道超限。
    sessions.set(tabId, { bytes, mime, sha256, kind, at: Date.now() });
    const previewDataUrl = kind === "image" && bytes.byteLength <= 20 * 1024 * 1024
      ? arrayBufferToDataUrl(bytes, mime)
      : null;
    notify(tabId, {
      type: "show-panel",
      payload: {
        kind,
        mime,
        sha256,
        pageUrl: info.pageUrl || "",
        srcUrl: info.srcUrl || "",
        fileSize: bytes.byteLength,
        ...(previewDataUrl ? { previewDataUrl } : {}),
      },
    });
  } catch (error) {
    notify(tabId, { type: "toast", message: "保存失败：" + (error?.message || "未知错误"), kind: "error" });
  }
});

// ---- 素材下载与校验 ----

async function fetchMedia(srcUrl, tabId) {
  if (/^data:/i.test(srcUrl)) {
    const res = await fetch(srcUrl);
    const bytes = await res.arrayBuffer();
    return { bytes, mime: res.headers.get("content-type") || "" };
  }
  if (/^blob:/i.test(srcUrl)) {
    // blob URL 属于页面 origin，Service Worker 无法直接读取，交由内容脚本代为获取
    const reply = await chrome.tabs.sendMessage(tabId, { type: "fetch-image", srcUrl });
    if (!reply || reply.error) throw new Error(reply?.error || "无法读取该图片");
    return { bytes: reply.bytes, mime: reply.mime || "" };
  }
  const res = await fetch(srcUrl, { credentials: "omit" });
  if (!res.ok) throw new Error("下载失败（HTTP " + res.status + "）");
  const bytes = await res.arrayBuffer();
  return { bytes, mime: res.headers.get("content-type") || "" };
}

function detectImage(bytes, declaredMime) {
  const view = new Uint8Array(bytes);
  for (const detector of IMAGE_DETECTORS) {
    if (detector.test(view)) return detector.mime;
  }
  // 兜底：部分 CDN 响应头声明了类型但魔数被转码处理过
  const DECLARED_IMAGE_MIMES = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/tiff", "image/heic", "image/heif", "image/avif",
  ]);
  if (DECLARED_IMAGE_MIMES.has(declaredMime)) {
    return declaredMime;
  }
  return null;
}

/** 视频魔数检测，返回服务端 VIDEO_TYPES 白名单内的 MIME；无法识别返回 null。 */
function detectVideo(bytes, declaredMime) {
  const b = new Uint8Array(bytes);
  const ascii = (offset, len = 4) => String.fromCharCode(...b.slice(offset, offset + len));

  // ISO BMFF（MP4 / MOV / 3GP 等）：box 头为 ftyp
  if (b.length >= 12 && ascii(4) === "ftyp") {
    const brand = ascii(8).toLowerCase();
    // 图片容器（HEIC/AVIF）也以 ftyp 开头，必须排除，绝不当作视频
    if (["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(brand)) {
      return null;
    }
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand.startsWith("3gp")) return "video/3gpp";
    if (brand.startsWith("3g2")) return "video/3gpp2";
    return "video/mp4";
  }
  // EBML（WebM / MKV）
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const head = ascii(0, Math.min(b.length, 256)).toLowerCase();
    return head.includes("webm") ? "video/webm" : "video/x-matroska";
  }
  // AVI
  if (b.length >= 12 && ascii(0) === "RIFF" && ascii(8) === "AVI ") return "video/x-msvideo";
  // MPEG 节目流 / 视频流
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && (b[3] === 0xba || b[3] === 0xb3)) {
    return "video/mpeg";
  }
  // 兜底：响应头声明
  const DECLARED_VIDEO_MIMES = new Set([
    "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska", "video/mpeg", "video/3gpp", "video/3gpp2",
  ]);
  if (DECLARED_VIDEO_MIMES.has(declaredMime)) return declaredMime;
  return null;
}

/** ArrayBuffer → data URL（base64），分块拼接避免大数组展开爆栈；扩展消息通道只能安全传字符串。 */
function arrayBufferToDataUrl(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime || "application/octet-stream"};base64,${btoa(binary)}`;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- 服务器通信 ----

class ApiError extends Error {
  constructor(status, message) {
    super(message || "请求失败（HTTP " + status + "）");
    this.status = status;
  }
}

async function api(serverUrl, token, path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", "Bearer " + token);
  const res = await fetch(serverUrl.replace(/\/+$/, "") + path, { ...init, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // 非 JSON 响应
  }
  if (!res.ok) throw new ApiError(res.status, body?.error);
  return body;
}

// ---- 内容脚本 → SW 消息代理（面板所需的全部数据都经此）----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "open-options":
          chrome.runtime.openOptionsPage().catch(() => {});
          sendResponse({ ok: true });
          break;
        case "projects": {
          const cfg = await requireConfig();
          const body = await api(cfg.serverUrl, cfg.token, "/api/projects");
          sendResponse({ ok: true, projects: body.projects || [], lastProjectId: cfg.lastProjectId || "" });
          break;
        }
        case "tags": {
          const cfg = await requireConfig();
          const body = await api(cfg.serverUrl, cfg.token, "/api/tags");
          sendResponse({ ok: true, tags: body.tags || [] });
          break;
        }
        case "ai-tags": {
          const cfg = await requireConfig();
          const session = getSession(sender.tab?.id);
          if (!session) {
            sendResponse({ ok: false, error: "素材数据已失效，请重新右键采集" });
            break;
          }
          if (session.kind !== "image") {
            sendResponse({ ok: false, error: "视频不支持 AI 打标" });
            break;
          }
          const form = new FormData();
          form.append("file", new Blob([session.bytes], { type: session.mime }), "capture." + (EXT_BY_MIME[session.mime] || "jpg"));
          const body = await api(cfg.serverUrl, cfg.token, "/api/uploads/ai-tags", { method: "POST", body: form });
          sendResponse({ ok: true, tags: body.tags || [] });
          break;
        }
        case "upload": {
          const cfg = await requireConfig();
          const session = takeSession(sender.tab?.id);
          if (!session) {
            sendResponse({ ok: false, error: "素材数据已失效，请重新右键采集" });
            break;
          }
          const form = new FormData();
          form.append("file", new Blob([session.bytes], { type: session.mime }), "capture." + (EXT_BY_MIME[session.mime] || "bin"));
          form.append("projectId", message.projectId);
          form.append("name", message.name || "");
          form.append("tags", (message.tags || []).join(","));
          form.append("sourceUrl", message.sourceUrl || "");
          form.append("notes", message.notes || "");
          const body = await api(cfg.serverUrl, cfg.token, "/api/uploads", { method: "POST", body: form });
          await chrome.storage.local.set({ lastProjectId: message.projectId });
          sendResponse({ ok: true, asset: body.asset || null });
          break;
        }
        case "close-panel":
          dropSession(sender.tab?.id);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: "未知请求" });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error.message, status: error.status || 0 });
    }
  })();
  return true;
});

async function requireConfig() {
  const { serverUrl, token, lastProjectId } = await chrome.storage.local.get(["serverUrl", "token", "lastProjectId"]);
  if (!serverUrl || !token) throw new ApiError(401, "未配置服务器地址或令牌");
  return { serverUrl, token, lastProjectId: lastProjectId || "" };
}

function notify(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}
