/**
 * 客户端生成的同步 ID。
 *
 * 优先用 crypto.randomUUID；局域网 http:// 不是安全上下文时它不可用，
 * 退回"时间戳 + 随机串"。服务端 cleanId 只做 trim 与 80 字符截断，两种格式都接受。
 */
export function newSyncId(): string {
  try {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  } catch { /* 非安全上下文：走下面的兜底 */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}
