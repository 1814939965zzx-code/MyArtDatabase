"use client";

import { Copy, KeyRound, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

type ApiToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
type FreshToken = { id: string; name: string; token: string };

function formatTime(iso: string | null) {
  if (!iso) return "从未";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function TokenSettingsModal({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [freshToken, setFreshToken] = useState<FreshToken | null>(null);
  const [tokenMessage, setTokenMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    apiFetch<{ tokens: ApiToken[] }>("/api/auth/tokens")
      .then((data) => setTokens(data.tokens))
      .catch(() => setTokens([]));
  }, []);

  async function refreshTokens() {
    try {
      const data = await apiFetch<{ tokens: ApiToken[] }>("/api/auth/tokens");
      setTokens(data.tokens);
    } catch {
      setTokens([]);
    }
  }

  async function generateToken() {
    setGenerating(true);
    setTokenMessage(null);
    try {
      const data = await apiFetch<FreshToken>("/api/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name: tokenName }),
      });
      setFreshToken(data);
      setTokenName("");
      await refreshTokens();
    } catch (reason) {
      setTokenMessage({ kind: "error", text: reason instanceof Error ? reason.message : "生成失败" });
    } finally {
      setGenerating(false);
    }
  }

  async function revokeToken(id: string) {
    if (!window.confirm("吊销后该令牌立即失效，无法恢复。确定吊销吗？")) return;
    try {
      await apiFetch(`/api/auth/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setTokenMessage({ kind: "ok", text: "已吊销" });
      if (freshToken?.id === id) setFreshToken(null);
      await refreshTokens();
    } catch (reason) {
      setTokenMessage({ kind: "error", text: reason instanceof Error ? reason.message : "吊销失败" });
    }
  }

  async function copyToken() {
    if (!freshToken) return;
    const token = freshToken.token;

    // 1) Clipboard API 只在 https / localhost（安全上下文）可用；
    //    局域网 http（如 http://192.168.x.x:3000）访问时 navigator.clipboard 不存在，必须走兜底。
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(token);
        setTokenMessage({ kind: "ok", text: "已复制到剪贴板" });
        return;
      } catch {
        // 继续走兜底
      }
    }

    // 2) 兜底：临时 textarea + execCommand("copy")，非安全上下文也可用（需在用户手势内调用）
    try {
      const textarea = document.createElement("textarea");
      textarea.value = token;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "0";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      if (ok) {
        setTokenMessage({ kind: "ok", text: "已复制到剪贴板" });
        return;
      }
    } catch {
      // 忽略，走最后兜底
    }

    // 3) 最后兜底：全选令牌文本，提示手动 Ctrl+C
    selectTokenText();
    setTokenMessage({ kind: "error", text: "自动复制不可用，已为你选中令牌，请按 Ctrl+C 复制" });
  }

  /** 选中令牌文本，便于用户手动复制。 */
  function selectTokenText() {
    const code = document.getElementById("fresh-token-text");
    if (!code) return;
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-card token-settings-card" role="dialog" aria-modal="true" aria-labelledby="token-settings-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">PLUGIN TOKEN</p>
            <h2 id="token-settings-title">插件令牌</h2>
            <p>供浏览器扩展等外部客户端以 <code>Authorization: Bearer</code> 认证调用 API。令牌只存哈希，可随时吊销。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="extension-download-row">
          <div className="extension-download-head">
            <strong>浏览器扩展插件</strong>
            <a className="primary-button" href="/api/extension" download>下载扩展 (.zip)</a>
          </div>
          <p className="extension-download-label">使用说明</p>
          <ol className="extension-steps">
            <li>解压下载的 zip 文件。</li>
            <li>在浏览器扩展管理页开启「开发者模式」，点击「加载已解压的扩展程序」并选择解压目录（Chrome 访问 chrome://extensions，Edge 访问 edge://extensions）。</li>
            <li>打开扩展的设置页，填写服务器地址与本面板上方生成的插件令牌。</li>
            <li>在网页的图片 / 视频上右键，即可「保存到素材库」。</li>
          </ol>
          <p className="extension-download-label">支持浏览器</p>
          <p className="extension-browsers">Chrome 及 Chromium 内核浏览器（Edge / Brave / Vivaldi 等，需开启开发者模式）。</p>
        </div>

        {tokenMessage ? <div className={`user-manager-message ${tokenMessage.kind === "error" ? "error" : ""}`}>{tokenMessage.text}</div> : null}
        {freshToken ? (
          <div className="fresh-token">
            <p>令牌已生成，明文只显示这一次，请立即复制保存：</p>
            <div className="fresh-token-row">
              <code id="fresh-token-text">{freshToken.token}</code>
              <button className="secondary-button" type="button" onClick={() => void copyToken()}>
                <Copy size={13} /> 复制
              </button>
            </div>
          </div>
        ) : null}
        <div className="token-create-row">
          <input
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
            maxLength={50}
            placeholder="备注，如：我的笔记本（可空）"
          />
          <button className="primary-button" type="button" onClick={() => void generateToken()} disabled={generating}>
            {generating ? <LoaderCircle className="spin" size={14} /> : <KeyRound size={14} />}生成新令牌
          </button>
        </div>
        <div className="token-list">
          {tokens === null ? (
            <p className="form-hint">加载中…</p>
          ) : tokens.length === 0 ? (
            <p className="form-hint">还没有令牌</p>
          ) : (
            tokens.map((token) => (
              <div className="token-item" key={token.id}>
                <div className="token-meta">
                  <strong>{token.name || "（未命名）"}</strong>
                  <span>创建于 {formatTime(token.createdAt)} · 最后使用 {formatTime(token.lastUsedAt)}</span>
                </div>
                <button className="token-revoke" type="button" onClick={() => void revokeToken(token.id)}>吊销</button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
