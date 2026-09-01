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
  let previewUrl = null;
  let panelState = null;

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
  });

  /** 向后台发消息并等待回复；带超时兜底，绝不永久挂起。 */
  function send(message, timeoutMs = 12000) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => done({ ok: false, error: "后台无响应（超时），请重试" }), timeoutMs);
      function done(reply) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
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

    // 预览：图片由后台传来的字节在本地构建 Blob；视频/超大图只显示占位（不跨上下文传大字节）
    const previewBox = overlay.querySelector(".preview");
    if (payload.bytes) {
      try {
        previewUrl = URL.createObjectURL(new Blob([payload.bytes], { type: payload.mime }));
        const img = document.createElement("img");
        img.src = previewUrl;
        previewBox.appendChild(img);
      } catch {
        showToast("图片预览失败，请重新右键采集", "error");
        closePanel();
        return;
      }
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
    overlay.querySelector(".name").value = defaultName(payload.srcUrl, imgEl);
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
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
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
      const reply = await send({ type: "ai-tags" });
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
    setStatus(overlay, "上传中…");
    const reply = await send({
      type: "upload",
      projectId,
      name,
      tags,
      sourceUrl,
      notes,
    });
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
