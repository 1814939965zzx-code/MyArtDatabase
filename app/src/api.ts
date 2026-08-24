"use client";

/**
 * 统一 API 请求封装。
 * - 自动附带 JSON 头；
 * - 非 2xx 抛出带服务端 error 文案的 ApiError；
 * - 401 时派发 artdb:unauthorized 事件，由 AuthGate 切回登录页。
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function notifyUnauthorized() {
  window.dispatchEvent(new CustomEvent("artdb:unauthorized"));
}

async function handleResponse(response: Response, url: string): Promise<unknown> {
  // 登录/初始化/状态接口自身的 401 由调用方展示具体错误，不触发全局“会话过期”跳转；
  // 其余 /api/auth/*（me、logout）返回 401 仍代表会话失效，需要跳回登录页
  const isAuthFormEndpoint = url.includes("/api/auth/login") || url.includes("/api/auth/setup") || url.includes("/api/auth/status");
  if (response.status === 401 && !isAuthFormEndpoint) notifyUnauthorized();
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 非 JSON 响应（如媒体 404），保留 null
  }
  if (!response.ok) {
    const message = (body as { error?: string } | null)?.error || `请求失败（${response.status}）`;
    throw new ApiError(message, response.status);
  }
  return body;
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  return (await handleResponse(response, url)) as T;
}

/** FormData 请求（上传/替换图片），不设置 JSON 头。 */
export async function apiForm<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return (await handleResponse(response, url)) as T;
}
