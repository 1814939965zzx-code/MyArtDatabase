"use client";

import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { notifyUnauthorized } from "./api";
import { Button, Field, InlineMessage, Input, Modal, PasswordInput, Tag } from "./ui";

export type AiConfigStatus = {
  source: "env" | "file";
  envOverride: boolean;
  baseUrl: string;
  model: string;
  apiKeyLast4: string;
  configured: boolean;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 401) notifyUnauthorized();
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

export function AiConfigModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<AiConfigStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await request<AiConfigStatus>("/api/ai-config");
      setStatus(data);
      setBaseUrl(data.baseUrl);
      setModel(data.model);
      setApiKey("");
    } catch (reason) {
      setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "配置载入失败" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const cleanBaseUrl = baseUrl.trim();
    const cleanModel = model.trim();
    if (!cleanBaseUrl || !cleanModel) {
      setMessage({ kind: "error", text: "接口地址和模型名不能为空" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await request("/api/ai-config", {
        method: "POST",
        body: JSON.stringify({ baseUrl: cleanBaseUrl, apiKey: apiKey.trim(), model: cleanModel }),
      });
      setApiKey("");
      await load();
      setMessage({ kind: "ok", text: "配置已保存到服务端，key 不会回显" });
    } catch (reason) {
      setMessage({ kind: "error", text: reason instanceof Error ? reason.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage(null);
    try {
      const result = await request<{ reply?: string }>("/api/ai-config/test", { method: "POST" });
      setMessage({ kind: "ok", text: `连接成功：${result.reply ? `模型响应“${result.reply}”` : "服务已响应"}` });
    } catch (reason) {
      setMessage({ kind: "error", text: `连接测试失败：${reason instanceof Error ? reason.message : "未知错误"}` });
    } finally {
      setTesting(false);
    }
  }

  async function fetchModels() {
    setLoadingModels(true);
    setMessage(null);
    try {
      const result = await request<{ models: string[] }>("/api/ai-config/models", { method: "POST" });
      const isVision = (id: string) => /vl|omni/i.test(id);
      const sorted = [...result.models].sort((a, b) => (
        Number(isVision(b)) - Number(isVision(a)) || a.localeCompare(b)
      ));
      setModels(sorted);
      if (!result.models.length) setMessage({ kind: "error", text: "该 key 没有可用模型，请到百炼控制台开通模型服务" });
    } catch (reason) {
      setMessage({ kind: "error", text: `获取模型列表失败：${reason instanceof Error ? reason.message : "未知错误"}` });
    } finally {
      setLoadingModels(false);
    }
  }

  function isVisionModel(id: string) {
    return /vl|omni/i.test(id);
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="AI SERVICE"
      title="AI 服务配置"
      description="配置 OpenAI 兼容接口，用于“AI 打标”。API key 只保存在服务端，不会回显到页面。"
      size="md"
      className="flex max-h-[calc(100dvh-40px)] flex-col"
      bodyClassName="min-h-0 gap-3 overflow-y-auto"
    >
      {status?.envOverride ? (
        <InlineMessage tone="warning">
          检测到环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL 已设置，将优先于本页配置生效。页面保存仍会写入配置文件。
        </InlineMessage>
      ) : null}
      {message ? <InlineMessage tone={message.kind === "error" ? "error" : "success"}>{message.text}</InlineMessage> : null}

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="接口地址（Base URL）" htmlFor="ai-base-url">
          <Input
            id="ai-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            maxLength={500}
            placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            spellCheck={false}
          />
        </Field>
        <Field label="API Key" htmlFor="ai-api-key">
          <PasswordInput
            id="ai-api-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            maxLength={500}
            autoComplete="new-password"
            placeholder={status?.apiKeyLast4 ? `已保存（••••${status.apiKeyLast4}），留空保持不变` : "sk-..."}
            spellCheck={false}
          />
        </Field>
        <Field label="模型名" htmlFor="ai-model">
          <Input
            id="ai-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            maxLength={100}
            placeholder="qwen-vl-plus"
            spellCheck={false}
          />
        </Field>

        <div className="-mt-2 flex justify-end">
          <Button
            variant="ghost"
            size="xs"
            className="text-sage-deep"
            loading={loadingModels}
            disabled={loadingModels || testing || busy}
            onClick={() => void fetchModels()}
          >
            {loadingModels ? "获取中…" : "查看可用模型"}
          </Button>
        </div>

        {models.length ? (
          <div
            role="listbox"
            aria-label="可用模型"
            className="flex max-h-[160px] flex-wrap gap-1.5 overflow-y-auto rounded-sm border border-line p-2"
          >
            {models.map((entry) => (
              <Tag key={entry} role="option" aria-selected={entry === model} active={entry === model} onClick={() => setModel(entry)}>
                {entry}
                {isVisionModel(entry) ? <span className="ml-1 text-2xs font-semibold">VL</span> : null}
              </Tag>
            ))}
          </div>
        ) : null}

        <p className="text-sm text-muted">
          打标签需要视觉（VL）模型：建议 qwen-vl-plus / qwen3-vl-plus，列表中带 VL 标记的均可；文本模型不能识别图片。
        </p>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            icon={<KeyRound size={14} aria-hidden />}
            loading={testing}
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {testing ? "测试中…" : "测试连接"}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || testing}>
            {busy ? "保存中…" : "保存配置"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
