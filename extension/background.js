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

/** 仅接受 JPEG / PNG / WebP / GIF / SVG / TIFF / HEIC（与服务端 IMAGE_TYPES 一致），按魔数判定。 */
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
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "保存到素材库", contexts: ["image"] });
  });
});

// ---- 右键菜单点击 ----
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const tabId = tab?.id;
  if (tabId == null) return;

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

  // 1. 下载图片
  if (!info.srcUrl) {
    notify(tabId, { type: "toast", message: "无法获取图片（该图片没有可用地址，可能是懒加载未完成）", kind: "error" });
    return;
  }
  let bytes, declaredMime;
  try {
    ({ bytes, mime: declaredMime } = await fetchImage(info.srcUrl, tabId));
  } catch (error) {
    notify(tabId, { type: "toast", message: "无法获取图片：" + error.message, kind: "error" });
    return;
  }

  // 2. 校验格式与大小
  const mime = detectImage(bytes, declaredMime);
  if (!mime) {
    notify(tabId, { type: "toast", message: "仅支持 JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC 图片，其他格式无法保存", kind: "error" });
    return;
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    notify(tabId, { type: "toast", message: "图片超过 50MB，无法保存", kind: "error" });
    return;
  }

  // 3. 查重（弹面板之前；重复直接跳过）
  let sha256;
  try {
    sha256 = await sha256Hex(bytes);
  } catch {
    notify(tabId, { type: "toast", message: "图片校验失败，请重试", kind: "error" });
    return;
  }
  try {
    const checked = await api(serverUrl, token, "/api/uploads/check", {
      method: "POST",
      body: JSON.stringify({ sha256 }),
    });
    if (Array.isArray(checked?.duplicates) && checked.duplicates.length > 0) {
      notify(tabId, { type: "toast", message: "已存在，未保存（素材库中已有相同图片）", kind: "info" });
      return;
    }
  } catch (error) {
    if (error.status === 401) {
      notify(tabId, { type: "toast", message: "令牌无效或已过期，请到扩展设置页更新", kind: "error", actionLabel: "去设置", action: "open-options" });
      return;
    }
    if (error.status === 409) {
      notify(tabId, { type: "toast", message: "已存在，未保存（素材库中已有相同图片）", kind: "info" });
      return;
    }
    notify(tabId, { type: "toast", message: "查重失败：" + error.message, kind: "error" });
    return;
  }

  // 4. 派发确认面板（blob 经消息通道传给内容脚本用于预览）
  notify(tabId, {
    type: "show-panel",
    payload: {
      blob: new Blob([bytes], { type: mime }),
      sha256,
      mime,
      pageUrl: info.pageUrl || "",
      srcUrl: info.srcUrl || "",
    },
  });
});

// ---- 图片下载与校验 ----

async function fetchImage(srcUrl, tabId) {
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
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/tiff", "image/heic", "image/heif",
  ]);
  if (DECLARED_IMAGE_MIMES.has(declaredMime)) {
    return declaredMime;
  }
  return null;
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
          chrome.runtime.openOptionsPage();
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
          const form = new FormData();
          form.append("file", message.blob, "capture.jpg");
          const body = await api(cfg.serverUrl, cfg.token, "/api/uploads/ai-tags", { method: "POST", body: form });
          sendResponse({ ok: true, tags: body.tags || [] });
          break;
        }
        case "upload": {
          const cfg = await requireConfig();
          const EXT_BY_MIME = {
            "image/png": "png", "image/webp": "webp", "image/gif": "gif",
            "image/svg+xml": "svg", "image/tiff": "tiff", "image/heic": "heic", "image/heif": "heif",
          };
          const ext = EXT_BY_MIME[message.mime] || "jpg";
          const form = new FormData();
          form.append("file", message.blob, "capture." + ext);
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
