import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "artdb_session";
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 记住我：30 天
const DEFAULT_MS = 24 * 60 * 60 * 1000; // 不记住：24 小时（浏览器会话 cookie 关闭即失效，服务端兜底过期）

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** scrypt 哈希，格式：scrypt$N$r$p$saltBase64$hashBase64。 */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export function verifyPassword(password, stored) {
  if (typeof stored !== "string" || typeof password !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  try {
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    const actual = scryptSync(password, salt, expected.length, { N, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    role: row.role,
    active: Boolean(row.active),
  };
}

/** 读取请求中的 session token；无 cookie 或格式非法返回空串。 */
export function sessionTokenFromRequest(request) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  return cookies[SESSION_COOKIE] || "";
}

function purgeExpiredSessions(db) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

/**
 * 创建会话并写入数据库。remember=true 时服务端有效 30 天；否则 24 小时。
 * 返回 { token, maxAge }，maxAge 为 null 表示浏览器会话 cookie（关闭即失效）。
 */
export function createSession(db, userId, remember) {
  purgeExpiredSessions(db);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_MS : DEFAULT_MS)).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at, remember) VALUES (?, ?, ?, ?)")
    .run(token, userId, expiresAt, remember ? 1 : 0);
  return { token, maxAge: remember ? REMEMBER_MS / 1000 : null };
}

/** 生成 Set-Cookie 响应头值。maxAge 为 null 时不写 Max-Age（浏览器会话 cookie）。 */
export function sessionCookieHeader(token, maxAge) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
  ];
  if (maxAge) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join("; ");
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

/** 根据请求 cookie 解析当前用户；session 过期、用户被停用或删除时返回 null。 */
export function resolveUser(db, request) {
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  const session = db.prepare(`
    SELECT s.token, s.expires_at AS expiresAt, u.id, u.username, u.display_name AS displayName,
      u.role, u.active
    FROM sessions s INNER JOIN users u ON u.id = s.user_id
    WHERE s.token = ? LIMIT 1
  `).get(token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  if (!session.active) {
    // 停用立即踢下线：删除其全部会话，避免残留 cookie 反复命中
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(session.id);
    return null;
  }
  return {
    id: session.id,
    username: session.username,
    displayName: session.displayName || session.username,
    role: session.role,
    active: true,
  };
}

export function destroySession(db, request) {
  const token = sessionTokenFromRequest(request);
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

/** 新建用户（含首管理员与管理员创建的成员）。返回公开用户对象。 */
export function createUser(db, { username, displayName, password, role }) {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)")
    .run(id, username, displayName || username, hashPassword(password), role);
  return { id, username, displayName: displayName || username, role, active: true };
}

export function publicUserFromId(db, userId) {
  const row = db.prepare("SELECT id, username, display_name AS displayName, role, active FROM users WHERE id = ?").get(userId);
  return row ? publicUser(row) : null;
}

/** 首次设置管理员成功后，把存量素材整体挂到该管理员名下（不做追溯）。 */
export function backfillLegacyAssets(db, adminId, adminDisplayName) {
  db.prepare("UPDATE assets SET created_by = ?, created_by_name = ? WHERE created_by IS NULL")
    .run(adminId, adminDisplayName || "管理员");
}

/** 记录登录成功/失败审计。 */
export function logLogin(db, { username, success, ip, userAgent, message }) {
  db.prepare("INSERT INTO login_logs (username, success, ip, user_agent, message) VALUES (?, ?, ?, ?, ?)")
    .run(username || "", success ? 1 : 0, ip || "", (userAgent || "").slice(0, 400), message || "");
}

// ---- 插件令牌（浏览器扩展等外部客户端 Bearer 认证）----

function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * 生成插件令牌。明文只在生成时返回一次，数据库仅存哈希。
 * 令牌无过期时间，只能吊销（由账号设置页管理）。
 */
export function createApiToken(db, userId, name) {
  const raw = "artdb_" + randomBytes(24).toString("base64url");
  const id = randomUUID();
  db.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash) VALUES (?, ?, ?, ?)")
    .run(id, userId, name, hashToken(raw));
  return { id, name, raw };
}

/** 列出某用户未吊销的令牌（不含哈希）。 */
export function listApiTokens(db, userId) {
  return db.prepare(`
    SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt
    FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(userId);
}

/** 吊销令牌（软删除）。只能吊销自己的令牌。返回是否吊销成功。 */
export function revokeApiToken(db, userId, id) {
  const result = db.prepare(`
    UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).run(id, userId);
  return result.changes > 0;
}

/**
 * 根据 Authorization: Bearer <token> 解析当前用户；令牌不存在、已吊销或
 * 用户被停用/删除时返回 null。命中时节流更新 last_used_at（10 分钟一次）。
 */
export function resolveUserFromToken(db, request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const raw = match ? match[1].trim() : "";
  if (!raw) return null;
  const row = db.prepare(`
    SELECT t.id AS tokenId, t.last_used_at AS lastUsedAt,
      u.id, u.username, u.display_name AS displayName, u.role, u.active
    FROM api_tokens t INNER JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.revoked_at IS NULL LIMIT 1
  `).get(hashToken(raw));
  if (!row || !row.active) return null;
  const stale = !row.lastUsedAt || new Date(row.lastUsedAt).getTime() < Date.now() - 10 * 60 * 1000;
  if (stale) db.prepare("UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.tokenId);
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName || row.username,
    role: row.role,
    active: true,
  };
}
