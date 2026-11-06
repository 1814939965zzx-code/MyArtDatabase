/**
 * artDatabase 浏览器采集扩展 —— 内容脚本
 *
 * 职责：
 *  - 注入「保存到素材库」确认面板（Shadow DOM 隔离样式，不污染页面；图片预览 / 视频占位）
 *  - 页面内 toast 反馈（成功 / 已存在 / 失败）
 *  - 协助 Service Worker 获取 blob: 素材（blob URL 属于页面 origin）
 *  - 计算默认名称（img alt → URL 文件名 → 兜底）
 *
 * 本脚本不直接访问服务器，所有网络请求经 chrome.runtime.sendMessage 由后台代理。
 */
(() => {
  if (window.__artdbContentLoaded) return;
  window.__artdbContentLoaded = true;

  let host = null;
  let panelEl = null;
  let panelState = null;

  // 右键目标记录：contextMenus 点击时只能拿到 info.srcUrl，拿不到 DOM 元素。
  // Instagram 等站点会把图片盖在透明 div 下面，导致 info.srcUrl 为空；这里在右键发生前
  // 记住目标与坐标，菜单点击后再穿透覆盖层解析真正的 <img>/<video>。
  let lastPointer = null;
  const POINTER_TTL_MS = 30 * 1000;

  function rememberPointer(event) {
    if (!(event.target instanceof Element)) return;
    let media = mediaFromTarget(event.target, event.clientX, event.clientY)
      || mediaFromPoint(event.clientX, event.clientY);
    media = preferInstagramVideo(media, event.clientX, event.clientY);
    const instagramTarget = media && isInstagram() ? instagramCarouselTarget(media) : null;
    lastPointer = {
      target: event.target,
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
      media,
      imageUrl: media?.tagName === "IMG" ? pickImageUrl(media) : "",
      videoUrl: media?.tagName === "VIDEO" ? pickVideoDirectUrl(media) : "",
      instagramTarget,
      pageUrl: instagramTarget ? instagramPostUrl(instagramTarget) : location.href,
    };
  }

  // capture 阶段先记录，避免站点在冒泡阶段 stopPropagation 后我们收不到事件
  window.addEventListener("contextmenu", rememberPointer, true);
  window.addEventListener("mousedown", (event) => {
    if (event.button === 2) rememberPointer(event);
  }, true);
  window.addEventListener("mouseup", (event) => {
    if (event.button === 2) rememberPointer(event);
  }, true);

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .toast-stack {
      position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column;
      gap: 8px; z-index: 2147483647; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      pointer-events: auto; /* 宿主是 pointer-events:none，这里必须重新开启，否则 toast 按钮点不到 */
    }
    .toast {
      min-width: 220px; max-width: 360px; padding: 10px 14px; border-radius: 8px;
      background: rgba(28, 28, 32, 0.94); color: #fff; font-size: 13px; line-height: 1.5;
      box-shadow: 0 6px 24px rgba(0,0,0,.35); display: flex; align-items: center; gap: 8px;
      animation: artdb-in .16s ease-out; pointer-events: auto;
    }
    .toast.kind-success { border-left: 3px solid #34c759; }
    .toast.kind-error { border-left: 3px solid #ff453a; }
    .toast.kind-info { border-left: 3px solid #0a84ff; }
    .toast button {
      margin-left: auto; border: 0; background: rgba(255,255,255,.16); color: #fff;
      padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; white-space: nowrap;
    }
    .toast button:hover { background: rgba(255,255,255,.26); }
    @keyframes artdb-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    .overlay {
      position: fixed; inset: 0; z-index: 2147483646; background: rgba(0,0,0,.38);
      display: flex; align-items: center; justify-content: center; pointer-events: auto;
      font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .card {
      width: 420px; max-width: calc(100vw - 32px); max-height: calc(100vh - 48px);
      background: #fff; border-radius: 12px; box-shadow: 0 18px 60px rgba(0,0,0,.4);
      display: flex; flex-direction: column; overflow: hidden; color: #1c1c20;
    }
    .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid #ececf0;
    }
    .head strong { font-size: 14px; }
    .close {
      border: 0; background: transparent; cursor: pointer; font-size: 18px; line-height: 1;
      color: #8e8e96; padding: 4px 6px; border-radius: 6px;
    }
    .close:hover { background: #f2f2f5; color: #1c1c20; }
    .body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .preview {
      height: 220px; border-radius: 8px; background: #f6f6f8; display: flex;
      align-items: center; justify-content: center; overflow: hidden; border: 1px solid #ececf0;
    }
    .preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .video-placeholder {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 6px; color: #6e6e78; font-size: 13px; text-align: center; line-height: 1.6; padding: 12px;
    }
    .video-placeholder .video-icon { font-size: 40px; line-height: 1; }
    .video-placeholder small { font-size: 11px; color: #9b9e98; }
    .fields { display: flex; flex-direction: column; gap: 10px; }
    .fields label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #6e6e78; }
    .fields input, .fields select, .fields textarea {
      font: inherit; font-size: 13px; color: #1c1c20; padding: 7px 9px;
      border: 1px solid #d9d9de; border-radius: 7px; outline: none; background: #fff;
      width: 100%;
    }
    .fields input:focus, .fields select:focus, .fields textarea:focus { border-color: #0a84ff; box-shadow: 0 0 0 2px rgba(10,132,255,.18); }
    .fields textarea { resize: vertical; min-height: 46px; }
    .row { display: flex; align-items: center; gap: 10px; }
    .ai-btn {
      border: 1px solid #d9d9de; background: #fff; color: #1c1c20; font-size: 12px;
      padding: 6px 10px; border-radius: 7px; cursor: pointer; white-space: nowrap;
    }
    .ai-btn:hover { background: #f6f6f8; }
    .ai-btn:disabled { opacity: .55; cursor: default; }
    .status { font-size: 12px; color: #6e6e78; line-height: 1.4; }
    .status.error { color: #d70015; }
    .foot {
      padding: 12px 16px; border-top: 1px solid #ececf0;
      display: flex; justify-content: flex-end; gap: 8px;
    }
    .btn {
      border: 0; border-radius: 8px; padding: 8px 18px; font-size: 13px; cursor: pointer;
    }
    .btn.cancel { background: #f2f2f5; color: #1c1c20; }
    .btn.cancel:hover { background: #e8e8ec; }
    .btn.save { background: #0a84ff; color: #fff; }
    .btn.save:hover { background: #0070e0; }
    .btn.save:disabled { opacity: .6; cursor: default; }
  `;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return host;
    host = document.createElement("div");
    host.id = "artdb-capture-host";
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    return host;
  }

  // ---- 消息入口 ----
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ping") {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "resolve-media") {
      resolveMedia()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || "媒体解析失败" }));
      return true;
    }
    if (message.type === "fetch-image") {
      fetch(message.srcUrl)
        .then(async (res) => {
          if (!res.ok) throw new Error("下载失败（HTTP " + res.status + "）");
          const bytes = await res.arrayBuffer();
          sendResponse({ bytes, mime: res.headers.get("content-type") || "" });
        })
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === "toast") {
      showToast(message.message, message.kind, message.actionLabel, message.action);
      return;
    }
    if (message.type === "show-panel") {
      showPanel(message.payload);
      return;
    }
    if (message.type === "find-video-urls") {
      sendResponse({ ok: true, urls: findVideoUrls() });
      return;
    }
  });

  /**
   * 扫描页面可用的视频直链（mp4 优先，其次 m3u8），用于 MSE/blob 流式播放页面
   * （如 Pinterest）右键抓不到视频时的回退：<video>/<source>、资源条目、页面内嵌 JSON。
   */
  function findVideoUrls() {
    const candidates = new Set();
    try {
      document.querySelectorAll("video").forEach((video) => {
        for (const src of [video.currentSrc, video.src]) {
          if (typeof src === "string" && /^https?:/i.test(src)) candidates.add(src);
        }
        video.querySelectorAll("source").forEach((source) => {
          if (typeof source.src === "string" && /^https?:/i.test(source.src)) candidates.add(source.src);
        });
      });
    } catch { /* 忽略 */ }
    try {
      performance.getEntriesByType("resource").forEach((entry) => {
        if (/\.(mp4|m3u8)(\?|#|$)/i.test(entry.name)) candidates.add(entry.name);
      });
    } catch { /* 忽略 */ }
    try {
      const html = document.documentElement.outerHTML;
      const re = /https:\/\/[^\s"'\\<>]+?\.(?:mp4|m3u8)(?:[^\s"'\\<>]*)?/gi;
      let match;
      while ((match = re.exec(html))) candidates.add(match[0]);
    } catch { /* 忽略 */ }
    const score = (url) => {
      const lower = url.toLowerCase();
      if (lower.endsWith(".m3u8")) return 1;
      // 命名上像标准编码的直链（expMp4 等）优先于 HEVC 变体
      if (/expmp4|hls|_720w|_1080w/.test(lower)) return 3;
      return 2;
    };
    return [...candidates].filter((url) => /^https?:/i.test(url)).sort((a, b) => score(b) - score(a));
  }

  // ---- 右键目标解析：穿透覆盖层找到真正的图片/视频 ----
  // 站点（尤其 Instagram）常用透明 div、pointer-events:none、绝对定位覆盖层挡住 <img>，
  // 因此不能只看浏览器给的 info.srcUrl：先看右键命中的元素，再看坐标下的元素，最后兜底整页。

  function isUsableMedia(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (element.tagName === "IMG") {
      const hasSource = Boolean(element.currentSrc || element.getAttribute("src") || element.getAttribute("srcset"));
      if (!hasSource) return false;
      // 排除 1px 占位图 / 埋点像素
      if (element.naturalWidth > 0 && element.naturalWidth <= 8 && element.naturalHeight <= 8) return false;
    }
    return true;
  }

  function mediaContainsPoint(media, x, y) {
    if (!isUsableMedia(media)) return false;
    const rect = media.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
    // 相邻轮播项也有完整的 bounding rect，但被祖先裁切；不能采集不可见的那一项。
    for (let parent = media.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      // 根元素的 overflow 作用于视口，不作用于其 getBoundingClientRect()。
      // 页面滚动后 html 的 rect 会整体移出视口，不能据此排除屏幕里的视频。
      if (parent === document.documentElement || parent === document.body || parent === document.scrollingElement) continue;
      const bounds = parent.getBoundingClientRect();
      if (/^(hidden|clip|scroll|auto)$/.test(style.overflowX)
        && (x < bounds.left || x >= bounds.right)) return false;
      if (/^(hidden|clip|scroll|auto)$/.test(style.overflowY)
        && (y < bounds.top || y >= bounds.bottom)) return false;
    }
    return true;
  }

  function preferInstagramVideo(media, x, y) {
    if (media?.tagName !== "IMG" || !isInstagram()) return media;
    // 只在同一个轮播项内把视频封面换成视频，不能从整帖中挑到相邻项。
    const container = media.closest("li") || media.parentElement;
    return [...(container?.querySelectorAll("video") || [])]
      .find((video) => mediaContainsPoint(video, x, y)) || media;
  }

  function mediaFromTarget(target, x, y) {
    if (!(target instanceof Element)) return null;
    const direct = target.closest("img, video, picture");
    if (direct) {
      const media = direct.tagName === "PICTURE" ? direct.querySelector("img") : direct;
      return media && mediaContainsPoint(media, x, y) ? media : null;
    }
    // Instagram 的图片通常在 <a href="/p/..."> 里，命中容器时向下找一层
    const link = target.closest("a");
    if (link && typeof x === "number" && typeof y === "number") {
      return [...link.querySelectorAll("img, video")].find((media) => mediaContainsPoint(media, x, y)) || null;
    }
    return null;
  }

  function mediaWithinPoint(element, x, y) {
    if (!(element instanceof Element) || element === document.documentElement || element === document.body) return null;
    const matches = [];
    for (const media of element.querySelectorAll("img, video")) {
      if (mediaContainsPoint(media, x, y)) matches.push(media);
    }
    // 同一位置同时有封面图和 <video> 时优先视频，避免把视频封面当成图片保存
    return matches.find((media) => media.tagName === "VIDEO") || matches[0] || null;
  }

  function mediaFromPoint(x, y) {
    // 临时让所有元素可命中，覆盖 pointer-events:none 的图片/视频
    const style = document.createElement("style");
    style.textContent = "* { pointer-events: auto !important; }";
    document.documentElement.appendChild(style);
    let elements = [];
    try {
      elements = document.elementsFromPoint(x, y);
    } finally {
      style.remove();
    }
    for (const element of elements) {
      if (element.tagName === "IMG" || element.tagName === "VIDEO") {
        if (mediaContainsPoint(element, x, y)) return element;
      }
    }
    // 和 Eagle 一样优先使用命中栈里的媒体；容器向下查找只作后备。
    for (const element of elements) {
      const media = mediaWithinPoint(element, x, y);
      if (media) return media;
    }
    return null;
  }

  function largestVisibleMedia() {
    const all = [...document.querySelectorAll("img, video")].filter(isUsableMedia);
    const inView = all.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    });
    const pool = inView.length ? inView : all;
    return pool.sort((a, b) => area(b) - area(a))[0] || null;
  }

  function area(element) {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function absoluteUrl(raw) {
    if (!raw) return "";
    try {
      return new URL(raw, location.href).href;
    } catch {
      return raw;
    }
  }

  function pickLargestSrcset(srcset) {
    if (!srcset) return "";
    let best = "";
    let bestScore = -1;
    for (const candidate of srcset.split(",")) {
      const [url, descriptor = ""] = candidate.trim().split(/\s+/);
      if (!url) continue;
      const score = Number.parseFloat(descriptor) || 0;
      if (score > bestScore) {
        bestScore = score;
        best = url;
      }
    }
    return best;
  }

  function pickImageUrl(image) {
    // srcset 里通常有比当前显示更大的版本，优先取最大
    const best = pickLargestSrcset(image.getAttribute("srcset"));
    return absoluteUrl(best || image.currentSrc || image.getAttribute("src") || "");
  }

  function pickVideoDirectUrl(video) {
    const candidates = [video.currentSrc, video.src];
    for (const source of video.querySelectorAll("source")) candidates.push(source.src);
    const isVideoUrl = (url) => /^https?:/i.test(url)
      && (/\.(mp4|webm|mov|m4v)([?#]|$)/i.test(url) || /(?:fbcdn|cdninstagram)\./i.test(url));
    return candidates.map(absoluteUrl).find(isVideoUrl) || "";
  }

  function findMetaVideoUrl() {
    const selectors = [
      'meta[property="og:video"]',
      'meta[property="og:video:secure_url"]',
      'meta[property="twitter:player:stream"]',
    ];
    for (const selector of selectors) {
      const content = document.querySelector(selector)?.getAttribute("content");
      if (content && /^https?:/i.test(content)) return content;
    }
    return "";
  }

  function isInstagram() {
    return location.hostname === "instagram.com" || location.hostname.endsWith(".instagram.com");
  }

  const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let cachedInstagramAppId = "";

  function parseInstagramShortcode(href) {
    return href.match(/\/(?:p|reel|reels)\/([^/?#]+)/)?.[1] || "";
  }

  function instagramPostPath(element) {
    const linked = element?.closest('a[href]')?.getAttribute("href") || "";
    const container = element?.closest('article, div[role="dialog"]');
    const articleLink = container?.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    for (const href of [linked, articleLink?.getAttribute("href") || "", location.pathname]) {
      const match = href.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)(?=\/|[?#]|$)/);
      if (match) return `/${match[1] === "reels" ? "reel" : match[1]}/${match[2]}/`;
    }
    return "";
  }

  function instagramShortcode(element) {
    return parseInstagramShortcode(instagramPostPath(element));
  }

  function instagramPostUrl(target) {
    if (!target?.postPath) return location.href;
    const url = new URL(target.postPath, "https://www.instagram.com");
    const { position, layoutIndex, activeIndex, buttonCount, count, index, shortcode, pageShortcode, urlIndex } = target;
    const selected = [
      target.resolvedIndex,
      Number.isInteger(position) && position >= 1 ? position - 1 : -1,
      layoutIndex,
      activeIndex,
      buttonCount > 1 && count === buttonCount ? index : -1,
      shortcode === pageShortcode && Number.isInteger(urlIndex) && urlIndex >= 1 ? urlIndex - 1 : -1,
    ].find((value) => Number.isInteger(value) && value >= 0);
    if (selected !== undefined) url.searchParams.set("img_index", String(selected + 1));
    return url.href;
  }

  function instagramAppId() {
    if (cachedInstagramAppId) return cachedInstagramAppId;
    cachedInstagramAppId = document.documentElement.innerHTML.match(/"appId":"(\d+)"/)?.[1] || "";
    return cachedInstagramAppId;
  }

  /** Instagram 短链（base64url 变体）转内部 media id。 */
  function instagramMediaId(shortcode) {
    let id = 0n;
    for (const character of shortcode) {
      const value = IG_ALPHABET.indexOf(character);
      if (value < 0) throw new Error("Instagram 帖子 ID 解析失败");
      id = id * 64n + BigInt(value);
    }
    return id.toString();
  }

  function instagramCarouselTarget(video) {
    const slide = video.closest("li");
    const slides = slide?.parentElement
      ? [...slide.parentElement.children].filter((child) => child.tagName === "LI" && child.querySelector("img, video"))
      : [];
    const rect = slide?.getBoundingClientRect();
    const listRect = slide?.parentElement?.getBoundingClientRect();
    // 主页真实结构：前置 1px 占位 li，实际项按 translateX(index * width) 绝对定位，
    // 且只挂载相邻项。用布局偏移得到全局序号，不用兄弟节点的局部序号。
    const offset = rect?.width > 8 && listRect && /^translateX\(/.test(slide.style?.transform || "")
      ? (rect.left - listRect.left) / rect.width : NaN;
    const layoutIndex = Number.isFinite(offset) && Math.abs(offset - Math.round(offset)) < 0.03
      ? Math.round(offset) : -1;
    const container = video.closest('article, div[role="dialog"]');
    const buttons = [...(container?.querySelectorAll('button[aria-label^="Go to slide "]') || [])];
    const active = buttons.filter((button) => button.getAttribute("aria-current") === "step"
      || button.getAttribute("aria-current") === "true");
    const activeIndex = active.length === 1
      ? Number(active[0].getAttribute("aria-label").match(/(\d+)$/)?.[1]) - 1 : -1;
    const videoRect = video.getBoundingClientRect();
    const centerX = videoRect.left + videoRect.width / 2;
    const centerY = videoRect.top + videoRect.height / 2;
    return {
      poster: video.poster,
      position: Number(slide?.getAttribute("aria-posinset")),
      index: slides.indexOf(slide),
      count: slides.length,
      layoutIndex,
      activeIndex: mediaContainsPoint(video, centerX, centerY) ? activeIndex : -1,
      buttonCount: buttons.length,
      shortcode: instagramShortcode(video),
      postPath: instagramPostPath(video),
      pageShortcode: parseInstagramShortcode(location.pathname),
      urlIndex: Number(new URLSearchParams(location.search).get("img_index")),
    };
  }

  function instagramCarouselIndex(target, carousel) {
    // 封面与接口图片按资源路径匹配，忽略 CDN 的签名/尺寸参数；优先于可能滞后的 URL 页码。
    const poster = target.poster;
    if (poster) {
      const path = (url) => {
        try { return new URL(url, location.href).pathname; } catch { return ""; }
      };
      const posterPath = path(poster);
      const matches = carousel.map((media, index) => ({ media, index })).filter(({ media }) =>
        posterPath && media?.image_versions2?.candidates?.some((image) => image?.url && path(image.url) === posterPath));
      if (matches.length === 1) return matches[0].index;
    }
    const { position, index, count, layoutIndex, activeIndex, buttonCount, shortcode, pageShortcode, urlIndex } = target;
    if (Number.isInteger(position) && position >= 1 && position <= carousel.length) return position - 1;
    if (layoutIndex >= 0 && layoutIndex < carousel.length) return layoutIndex;
    if (buttonCount === carousel.length && activeIndex >= 0 && activeIndex < carousel.length) return activeIndex;
    // 虚拟化列表只保留相邻几项，局部序号不能当作全局序号；排除占位 li 后须项数完整。
    if (count === carousel.length && index >= 0) return index;
    if (shortcode && shortcode === pageShortcode
      && Number.isInteger(urlIndex) && urlIndex >= 1 && urlIndex <= carousel.length) return urlIndex - 1;
    return -1;
  }

  /**
   * Instagram 的视频是 MSE/blob 流，DOM 里没有可直接下载的 mp4。
   * 与 Eagle 扩展相同：用帖子短链换 media id，再带登录 cookie 调 Instagram
   * 自己的媒体接口取 video_versions（轮播则按 img_index / 当前 slide 取）。
   */
  async function resolveInstagramVideo(video, capturedTarget = null) {
    const target = capturedTarget || instagramCarouselTarget(video);
    const shortcode = target.shortcode;
    if (!shortcode) throw new Error("无法识别 Instagram 帖子");
    // 在请求之前固定右键目标的位置，避免等待接口期间切换轮播后解析到另一项。
    const appId = instagramAppId();
    if (!appId) throw new Error("无法读取 Instagram appId，请刷新页面后重试");
    const mediaId = instagramMediaId(shortcode);
    let response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      response = await fetch(`https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
        credentials: "include",
        headers: { "x-ig-app-id": appId },
        signal: controller.signal,
      });
    } catch {
      throw new Error("Instagram 视频接口请求失败，请确认已登录 Instagram 后重试");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Instagram 登录状态无效，请重新登录后再试");
      }
      throw new Error(`Instagram 视频接口返回 HTTP ${response.status}`);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Instagram 视频接口返回了无法解析的内容");
    }
    const item = Array.isArray(data?.items) ? data.items[0] : null;
    if (!item) throw new Error("Instagram 未返回该帖子的媒体信息");
    const versions = (Array.isArray(item.video_versions) ? item.video_versions : [])
      .filter((version) => version && typeof version.url === "string" && version.url);
    if (versions.length) {
      // 同一帖子可能返回多个清晰度/编码版本，取分辨率最高、其次码率最高
      const best = versions.slice().sort((a, b) => {
        const areaA = (Number(a.width) || 0) * (Number(a.height) || 0);
        const areaB = (Number(b.width) || 0) * (Number(b.height) || 0);
        return areaB - areaA || (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0);
      })[0];
      return best.url;
    }
    const carousel = Array.isArray(item.carousel_media) ? item.carousel_media : [];
    if (carousel.length) {
      const index = instagramCarouselIndex(target, carousel);
      if (index < 0) throw new Error("无法确定右键视频在轮播中的位置，请打开该项后重试");
      target.resolvedIndex = index;
      const media = carousel[index];
      const candidates = (Array.isArray(media?.video_versions) ? media.video_versions : [])
        .filter((version) => version && typeof version.url === "string" && version.url)
        .sort((a, b) => (Number(b.width) || 0) * (Number(b.height) || 0) - (Number(a.width) || 0) * (Number(a.height) || 0));
      if (candidates[0]?.url) return candidates[0].url;
      throw new Error("右键选中的轮播项没有可下载的视频直链");
    }
    throw new Error("该 Instagram 帖子没有可下载的视频直链");
  }

  async function resolveMedia() {
    const recent = lastPointer && Date.now() - lastPointer.at <= POINTER_TTL_MS ? lastPointer : null;
    let element = recent?.media || null;
    // 只有在拿不到右键上下文时才兜底整页（例如内容脚本是点击菜单后才补注入的旧标签页）；
    // 正常右键点在空白处时不应随便保存页面里最大的图片。
    if (!element && !recent && !isInstagram()) element = largestVisibleMedia();
    if (!element) return { ok: false, error: "这里没有可保存的图片或视频" };

    if (element.tagName === "IMG") {
      const srcUrl = recent?.imageUrl || pickImageUrl(element);
      if (!srcUrl) return { ok: false, error: "没有找到图片地址" };
      return {
        ok: true,
        kind: "image",
        srcUrl,
        pageUrl: recent?.pageUrl || location.href,
        suggestedName: (element.alt || "").trim().slice(0, 120),
      };
    }

    if (element.tagName === "VIDEO") {
      const direct = recent ? recent.videoUrl : pickVideoDirectUrl(element);
      if (direct) return { ok: true, kind: "video", srcUrl: direct, pageUrl: recent?.pageUrl || location.href };

      if (isInstagram()) {
        try {
          const url = await resolveInstagramVideo(element, recent?.instagramTarget);
          if (url) {
            const shortcode = recent?.instagramTarget?.shortcode || instagramShortcode(element);
            return {
              ok: true,
              kind: "video",
              srcUrl: url,
              pageUrl: instagramPostUrl(recent?.instagramTarget),
              suggestedName: shortcode ? `instagram-${shortcode}` : "",
            };
          }
        } catch (error) {
          // og:video 只代表整帖，不能证明属于右键的轮播项。
          return { ok: false, stopFallback: true, error: error.message };
        }
      }

      const meta = findMetaVideoUrl();
      if (meta) return { ok: true, kind: "video", srcUrl: meta, pageUrl: location.href };
      return { ok: false, error: "该视频使用流式播放，没有可下载的直链" };
    }

    return { ok: false, error: "没有找到可保存的图片或视频" };
  }

  /** 向后台发消息并等待回复；带超时兜底，绝不永久挂起。timeoutMs <= 0 表示不超时。 */
  function send(message, timeoutMs = 12000) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = timeoutMs > 0
        ? setTimeout(() => done({ ok: false, error: "后台无响应（超时），请重试" }), timeoutMs)
        : null;
      function done(reply) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(reply);
      }
      try {
        chrome.runtime.sendMessage(message, (reply) => {
          if (chrome.runtime.lastError) done({ ok: false, error: chrome.runtime.lastError.message });
          else done(reply || { ok: false, error: "无响应" });
        });
      } catch (error) {
        done({ ok: false, error: error.message });
      }
    });
  }

  // ---- toast ----
  function showToast(message, kind = "info", actionLabel, action) {
    const shadow = ensureHost().shadowRoot;
    let stack = shadow.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      shadow.appendChild(stack);
    }
    const el = document.createElement("div");
    el.className = "toast kind-" + (kind || "info");
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    if (actionLabel && action) {
      const btn = document.createElement("button");
      btn.textContent = actionLabel;
      btn.addEventListener("click", () => {
        send({ type: "open-options" });
        el.remove();
      });
      el.appendChild(btn);
    }
    stack.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .18s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 200);
    }, kind === "error" ? 5000 : 3500);
  }

  // ---- 确认面板 ----
  function showPanel(payload) {
    if (panelEl) closePanel({ skipNotify: true }); // 替换旧面板，不释放后台刚建的新会话
    if (!payload || !payload.mime) {
      showToast("面板数据不完整，请重新右键采集", "error");
      return;
    }
    panelState = { projects: [], projectNames: {}, lastProjectId: "" };
    panelState.kind = payload.kind === "video" ? "video" : "image";
    const shadow = ensureHost().shadowRoot;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="card">
        <div class="head">
          <strong>保存到素材库</strong>
          <button class="close" title="取消">✕</button>
        </div>
        <div class="body">
          <div class="preview"></div>
          <div class="fields">
            <label>项目
              <select class="project"><option value="">加载中…</option></select>
            </label>
            <label>名称<input class="name" maxlength="120"></label>
            <label>标签<input class="tags" maxlength="4000" placeholder="用逗号分隔，例如：建筑, 暖色"><datalist></datalist></label>
            <label>来源链接<input class="source" maxlength="1000" placeholder="https://"></label>
            <label>备注<textarea class="notes" maxlength="2000"></textarea></label>
            <div class="row">
              <button class="ai-btn">✨ AI 打标</button>
              <span class="status"></span>
            </div>
          </div>
        </div>
        <div class="foot">
          <button class="btn cancel">取消</button>
          <button class="btn save">保存</button>
        </div>
      </div>
    `;
    shadow.appendChild(overlay);
    panelEl = overlay;

    // 事件先行绑定：即使后续预览或数据加载失败，取消/关闭也必须可用
    overlay.querySelector(".close").addEventListener("click", closePanel);
    overlay.querySelector(".cancel").addEventListener("click", closePanel);
    overlay.querySelector(".save").addEventListener("click", save);
    overlay.querySelector(".ai-btn").addEventListener("click", runAiTags);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePanel();
    });
    document.addEventListener("keydown", onPanelKeydown);

    // 预览：图片由后台传来的 dataURL 直接显示（扩展消息通道传二进制不可靠，见 background.js）；
    // 视频/超大图只显示占位（不跨上下文传大字节）
    const previewBox = overlay.querySelector(".preview");
    if (payload.previewDataUrl) {
      const img = document.createElement("img");
      img.src = payload.previewDataUrl;
      previewBox.appendChild(img);
    } else if (panelState.kind === "video") {
      previewBox.innerHTML = `
        <div class="video-placeholder">
          <span class="video-icon">🎬</span>
          <span>视频素材 · ${formatSize(payload.fileSize || 0)}</span>
          <small>上传后服务端自动转码为低码率 MP4</small>
        </div>`;
    } else {
      previewBox.innerHTML = `
        <div class="video-placeholder">
          <span class="video-icon">📷</span>
          <span>图片素材 · ${formatSize(payload.fileSize || 0)}</span>
          <small>图片较大，未加载预览</small>
        </div>`;
    }

    // 视频不支持 AI 打标（与服务端一致），隐藏按钮
    if (panelState.kind === "video") {
      overlay.querySelector(".ai-btn").style.display = "none";
    }

    // 默认名称与来源
    const imgEl = findImgBySrc(payload.srcUrl);
    overlay.querySelector(".name").value = (payload.suggestedName || "").trim() || defaultName(payload.srcUrl, imgEl);
    overlay.querySelector(".source").value = payload.pageUrl || "";

    // 项目列表 + 标签字典
    loadProjects(overlay);
    loadTags(overlay);
  }

  function onPanelKeydown(event) {
    if (event.key === "Escape") closePanel();
  }

  function closePanel({ skipNotify = false } = {}) {
    if (!panelEl) return;
    document.removeEventListener("keydown", onPanelKeydown);
    panelEl.remove();
    panelEl = null;
    panelState = null;
    if (!skipNotify) send({ type: "close-panel" }); // 通知后台释放采集会话（尽力而为，不阻塞关闭）
  }

  function findImgBySrc(srcUrl) {
    if (!srcUrl) return null;
    for (const img of document.querySelectorAll("img")) {
      if (img.currentSrc === srcUrl || img.src === srcUrl) return img;
    }
    return null;
  }

  function defaultName(srcUrl, img) {
    const alt = img?.alt?.trim();
    if (alt) return alt.slice(0, 120);
    if (/^https?:/i.test(srcUrl)) {
      try {
        const url = new URL(srcUrl);
        const base = decodeURIComponent(url.pathname.split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "").trim();
        if (base) return base.slice(0, 120);
      } catch {
        // 忽略解析失败
      }
    }
    return "未命名-" + new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function loadProjects(overlay) {
    const select = overlay.querySelector(".project");
    const reply = await send({ type: "projects" });
    if (!reply.ok) {
      select.innerHTML = `<option value="">项目加载失败</option>`;
      const status = overlay.querySelector(".status");
      status.textContent = "项目加载失败：" + (reply.error || "未知错误") + "（点此重试）";
      status.classList.add("error");
      status.style.cursor = "pointer";
      status.onclick = () => {
        status.textContent = "";
        status.classList.remove("error");
        status.onclick = null;
        status.style.cursor = "";
        void loadProjects(overlay);
      };
      if (reply.status === 401) {
        showToast("令牌无效或已过期，请到扩展设置页更新", "error", "去设置", "open-options");
      }
      return;
    }
    panelState.projects = reply.projects;
    panelState.lastProjectId = reply.lastProjectId || "";
    panelState.projectNames = {};
    select.innerHTML = "";
    if (!reply.projects.length) {
      select.innerHTML = `<option value="">（暂无项目，请先在网页端创建）</option>`;
      return;
    }
    let hasPreselected = false;
    for (const project of reply.projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
      panelState.projectNames[project.id] = project.name;
      if (project.id === panelState.lastProjectId) hasPreselected = true;
    }
    if (hasPreselected) select.value = panelState.lastProjectId;
  }

  async function loadTags(overlay) {
    const reply = await send({ type: "tags" });
    if (!reply.ok) return;
    const datalist = overlay.querySelector("datalist");
    datalist.innerHTML = "";
    for (const tag of reply.tags) {
      const option = document.createElement("option");
      option.value = tag.name;
      datalist.appendChild(option);
    }
  }

  async function runAiTags() {
    const overlay = panelEl;
    if (!overlay) return;
    const btn = overlay.querySelector(".ai-btn");
    btn.disabled = true;
    setStatus(overlay, "AI 打标中…");
    try {
      const reply = await send({ type: "ai-tags" }, 60 * 1000);
      if (!reply.ok) {
        setStatus(overlay, reply.error || "AI 打标失败", true);
        return;
      }
      if (!reply.tags || !reply.tags.length) {
        setStatus(overlay, "AI 未给出建议标签");
        return;
      }
      const input = overlay.querySelector(".tags");
      input.value = mergeTags(input.value, reply.tags);
      setStatus(overlay, "已合并 " + reply.tags.length + " 个建议标签");
    } finally {
      btn.disabled = false;
    }
  }

  function mergeTags(current, additions) {
    const existing = String(current || "").split(",").map((t) => t.trim()).filter(Boolean);
    for (const tag of additions) {
      const name = String(tag).trim();
      if (name && !existing.some((e) => e.toLowerCase() === name.toLowerCase())) existing.push(name);
    }
    return existing.join(", ");
  }

  async function save() {
    const overlay = panelEl;
    if (!overlay) return;
    const projectId = overlay.querySelector(".project").value;
    if (!projectId) {
      setStatus(overlay, "请选择一个项目", true);
      return;
    }
    const name = overlay.querySelector(".name").value.trim();
    if (!name) {
      setStatus(overlay, "请填写素材名称", true);
      return;
    }
    const tags = overlay.querySelector(".tags").value
      .split(",").map((t) => t.trim()).filter(Boolean).slice(0, 50);
    const sourceUrl = overlay.querySelector(".source").value.trim();
    const notes = overlay.querySelector(".notes").value.trim();

    const saveBtn = overlay.querySelector(".save");
    saveBtn.disabled = true;
    setStatus(overlay, panelState.kind === "video" ? "上传中…（视频较大时可能需要一会儿）" : "上传中…");
    // 视频上传 + 服务端落盘可能超过 12 秒，不能用消息默认超时误判为失败
    const reply = await send({
      type: "upload",
      projectId,
      name,
      tags,
      sourceUrl,
      notes,
    }, panelState.kind === "video" ? 5 * 60 * 1000 : 60 * 1000);
    saveBtn.disabled = false;

    if (reply.ok) {
      const projectName = panelState.projectNames[projectId] || "";
      closePanel();
      showToast(projectName ? "已保存到项目「" + projectName + "」" : "已保存到素材库", "success");
      return;
    }
    if (reply.status === 409) {
      closePanel();
      showToast("已存在，未保存（素材库中已有相同图片）", "info");
      return;
    }
    if (reply.status === 401) {
      closePanel();
      showToast("令牌无效或已过期，请到扩展设置页更新", "error", "去设置", "open-options");
      return;
    }
    setStatus(overlay, reply.error || "上传失败，请重试", true);
  }

  function setStatus(overlay, text, isError) {
    const el = overlay.querySelector(".status");
    el.textContent = text || "";
    el.classList.toggle("error", Boolean(isError));
  }
})();
