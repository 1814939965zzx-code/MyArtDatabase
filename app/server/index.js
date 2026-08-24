import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db.js";
import { createLocalDiskStore } from "./storage.js";
import { handleApi } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

const dev = process.argv.includes("--dev");
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(appRoot, "data", "app.db");
const STORE_ROOT = process.env.STORE_ROOT || path.join(appRoot, "data", "media");
const seedDemo = dev || process.env.SEED_DEMO === "1";

const db = openDatabase(DB_PATH, { seedDemo });
const store = createLocalDiskStore({ root: STORE_ROOT });

let vite;
if (dev) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    root: appRoot,
    server: { middlewareMode: true },
    appType: "spa",
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function sendResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  res.writeHead(response.status, headers);
  if (response.body) {
    const stream = Readable.fromWeb(response.body);
    stream.on("error", (error) => {
      console.error("[artdatabase] 响应流读取失败:", error);
      res.destroy(error);
    });
    stream.pipe(res);
  } else {
    res.end();
  }
}

async function toWebRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else headers.set(key, value);
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(`http://localhost${req.url}`, { method: req.method, headers });
  }
  return new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers,
    body: Readable.toWeb(req),
    duplex: "half",
  });
}

const distRoot = path.resolve(appRoot, "dist");

function resolveStaticPath(pathname) {
  const relative = pathname.replace(/^[/\\]+/, "");
  const candidate = path.resolve(distRoot, relative);
  if (candidate !== distRoot && !candidate.startsWith(`${distRoot}${path.sep}`)) return null;
  return candidate;
}

async function readStatic(pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) return null;
  try {
    return { filePath, content: await readFile(filePath) };
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "EISDIR")) return null;
    throw error;
  }
}

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  if (!resolveStaticPath(pathname)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }
  const found = await readStatic(pathname);
  if (found) {
    const ext = path.extname(found.filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": String(found.content.length),
    });
    res.end(found.content);
    return;
  }
  const index = await readStatic("index.html");
  if (index) {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(index.content.length),
    });
    res.end(index.content);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found（请先执行 npm run build 生成前端）");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const request = await toWebRequest(req);
      const forwarded = req.headers["x-forwarded-for"];
      const clientIp = typeof forwarded === "string" && forwarded.trim()
        ? forwarded.split(",")[0].trim()
        : req.socket.remoteAddress || "";
      const response = await handleApi(request, { db, store, clientIp });
      sendResponse(res, response);
      return;
    }
    if (dev && vite) {
      vite.middlewares(req, res);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "服务器错误");
  }
});

server.listen(PORT, () => {
  console.log(`[artdatabase] 服务已启动 http://localhost:${PORT}${dev ? "（开发模式）" : ""}`);
  console.log(`[artdatabase] Node.js=${process.version}`);
  console.log(`[artdatabase] DB_PATH=${DB_PATH}`);
  console.log(`[artdatabase] STORE_ROOT=${STORE_ROOT}`);
  console.log(`[artdatabase] 示例数据写入=${seedDemo ? "开启" : "关闭（生产环境不会自动生成示例库）"}`);
});
