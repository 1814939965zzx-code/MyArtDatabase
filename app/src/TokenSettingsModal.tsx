"use client";

import { Copy, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { Button, InlineMessage, Input, Modal, Spinner } from "./ui";

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
    <Modal
      open
      onClose={onClose}
      eyebrow="PLUGIN TOKEN"
      title="插件令牌"
      description={
        <>
          供浏览器扩展等外部客户端以{" "}
          <code className="rounded-sm bg-surface-muted px-1 py-0.5 font-mono text-xs">Authorization: Bearer</code>{" "}
          认证调用 API。令牌只存哈希，可随时吊销。
        </>
      }
      size="md"
      className="flex max-h-[calc(100dvh-40px)] flex-col"
      bodyClassName="min-h-0 gap-3 overflow-y-auto"
    >
      <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-base font-semibold text-ink">浏览器扩展插件</strong>
          <a
            href="/api/extension"
            download
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:border-accent-strong hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            下载扩展 (.zip)
          </a>
        </div>
        <p className="text-sm font-medium text-ink-label">使用说明</p>
        <ol className="flex list-inside list-decimal flex-col gap-1 text-sm text-muted">
          <li>解压下载的 zip 文件。</li>
          <li>在浏览器扩展管理页开启「开发者模式」，点击「加载已解压的扩展程序」并选择解压目录（Chrome 访问 chrome://extensions，Edge 访问 edge://extensions）。</li>
          <li>打开扩展的设置页，填写服务器地址与本面板上方生成的插件令牌。</li>
          <li>在网页的图片 / 视频上右键，即可「保存到素材库」。</li>
        </ol>
        <p className="text-sm font-medium text-ink-label">支持浏览器</p>
        <p className="text-sm text-muted">Chrome 及 Chromium 内核浏览器（Edge / Brave / Vivaldi 等，需开启开发者模式）。</p>
      </div>

      {tokenMessage ? (
        <InlineMessage tone={tokenMessage.kind === "error" ? "error" : "success"}>{tokenMessage.text}</InlineMessage>
      ) : null}

      {freshToken ? (
        <div className="rounded-md border border-sage/30 bg-sage-wash p-2.5">
          <p className="text-sm text-ink">令牌已生成，明文只显示这一次，请立即复制保存：</p>
          <div className="mt-2 flex items-center gap-2">
            <code id="fresh-token-text" className="min-w-0 flex-1 break-all rounded-sm bg-white px-2 py-1 font-mono text-xs text-ink">
              {freshToken.token}
            </code>
            <Button size="sm" icon={<Copy size={13} aria-hidden />} onClick={() => void copyToken()}>
              复制
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-1 flex gap-2">
        <Input
          value={tokenName}
          onChange={(event) => setTokenName(event.target.value)}
          maxLength={50}
          placeholder="备注，如：我的笔记本（可空）"
          className="flex-1"
        />
        <Button
          variant="primary"
          icon={<KeyRound size={14} aria-hidden />}
          loading={generating}
          onClick={() => void generateToken()}
        >
          生成新令牌
        </Button>
      </div>

      <div className="flex max-h-[190px] flex-col gap-1.5 overflow-y-auto">
        {tokens === null ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Spinner size={14} />加载中…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted">还没有令牌</p>
        ) : (
          tokens.map((token) => (
            <div className="flex items-center gap-2.5 rounded-md border border-line px-2.5 py-2" key={token.id}>
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold text-ink">{token.name || "（未命名）"}</strong>
                <span className="block truncate text-xs text-muted">
                  创建于 {formatTime(token.createdAt)} · 最后使用 {formatTime(token.lastUsedAt)}
                </span>
              </div>
              <Button size="xs" variant="ghost" className="text-danger" onClick={() => void revokeToken(token.id)}>
                吊销
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
