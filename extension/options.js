/**
 * artDatabase 浏览器采集扩展 —— 设置页
 * 保存服务器地址与插件令牌；提供「测试连接」（GET /api/auth/me）。
 */
(() => {
  const serverInput = document.getElementById("serverUrl");
  const tokenInput = document.getElementById("token");
  const eyeButton = document.getElementById("eye");
  const saveButton = document.getElementById("save");
  const testButton = document.getElementById("test");
  const statusEl = document.getElementById("status");

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (kind ? " " + kind : "");
  }

  function normalizeServer(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function readValues() {
    return { serverUrl: normalizeServer(serverInput.value), token: String(tokenInput.value || "").trim() };
  }

  async function load() {
    const { serverUrl, token } = await chrome.storage.local.get(["serverUrl", "token"]);
    serverInput.value = serverUrl || "http://localhost:3000";
    tokenInput.value = token || "";
  }

  eyeButton.addEventListener("click", () => {
    const show = tokenInput.type === "password";
    tokenInput.type = show ? "text" : "password";
    eyeButton.textContent = show ? "隐藏" : "显示";
  });

  document.getElementById("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { serverUrl, token } = readValues();
    if (!serverUrl) {
      setStatus("请填写服务器地址", "error");
      return;
    }
    if (!token) {
      setStatus("请填写插件令牌", "error");
      return;
    }
    await chrome.storage.local.set({ serverUrl, token });
    setStatus("已保存", "ok");
  });

  testButton.addEventListener("click", async () => {
    const { serverUrl, token } = readValues();
    if (!serverUrl || !token) {
      setStatus("请先填写服务器地址与令牌", "error");
      return;
    }
    testButton.disabled = true;
    setStatus("测试中…");
    try {
      const res = await fetch(serverUrl + "/api/auth/me", {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.status === 200) {
        const body = await res.json();
        setStatus("连接成功，身份：" + (body?.user?.displayName || body?.user?.username || "未知"), "ok");
      } else if (res.status === 401) {
        setStatus("令牌无效或已过期", "error");
      } else {
        let message = "HTTP " + res.status;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // 忽略非 JSON 响应
        }
        setStatus("连接失败：" + message, "error");
      }
    } catch (error) {
      setStatus("无法连接服务器：" + error.message, "error");
    } finally {
      testButton.disabled = false;
    }
  });

  load();
})();
