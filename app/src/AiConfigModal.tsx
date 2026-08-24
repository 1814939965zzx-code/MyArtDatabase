"use client";

import { AlertTriangle, Check, KeyRound, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { notifyUnauthorized } from "./api";
import { PasswordInput } from "./PasswordInput";

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
    <div className="modal-backdrop">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="ai-config-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">AI SERVICE</p>
            <h2 id="ai-config-title">AI 服务配置</h2>
            <p>配置 OpenAI 兼容接口，用于“AI 打标”。API key 只保存在服务端，不会回显到页面。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        {status?.envOverride ? (
          <div className="form-error"><AlertTriangle size={15} />检测到环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL 已设置，将优先于本页配置生效。页面保存仍会写入配置文件。</div>
        ) : null}
        {message ? (
          <div className={`ai-config-message ${message.kind}`}><Check size={15} />{message.text}</div>
        ) : null}
        <form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>
            接口地址（Base URL）
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              maxLength={500}
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
              spellCheck={false}
            />
          </label>
          <label>
            API Key
            <PasswordInput
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              maxLength={500}
              autoComplete="new-password"
              placeholder={status?.apiKeyLast4 ? `已保存（••••${status.apiKeyLast4}），留空保持不变` : "sk-..."}
              spellCheck={false}
            />
          </label>
          <label>
            模型名
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={100}
              placeholder="qwen-vl-plus"
              spellCheck={false}
            />
          </label>
          <div className="ai-model-tools">
            <button className="ai-model-list-button" type="button" disabled={loadingModels || testing || busy} onClick={() => void fetchModels()}>
              {loadingModels ? <><LoaderCircle className="spin" size={13} />获取中…</> : "查看可用模型"}
            </button>
          </div>
          {models.length ? (
            <div className="ai-model-list" role="listbox" aria-label="可用模型">
              {models.map((entry) => (
                <button type="button" role="option" aria-selected={entry === model} className={entry === model ? "active" : ""} key={entry} onClick={() => setModel(entry)}>
                  {entry}{isVisionModel(entry) ? <i>VL</i> : null}
                </button>
              ))}
            </div>
          ) : null}
          <p className="form-hint">
            打标签需要视觉（VL）模型：建议 qwen-vl-plus / qwen3-vl-plus，列表中带 VL 标记的均可；文本模型不能识别图片。
          </p>
          <div className="modal-actions">
            <button className="secondary-button" type="button" disabled={testing} onClick={() => void testConnection()}>
              {testing ? <><LoaderCircle className="spin" size={14} />测试中…</> : <><KeyRound size={14} />测试连接</>}
            </button>
            <button className="primary-button" type="submit" disabled={busy || testing}>
              {busy ? "保存中…" : "保存配置"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
