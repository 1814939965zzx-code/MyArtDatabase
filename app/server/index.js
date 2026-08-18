import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createReadStream, existsSync, statSync } from "node:fs";
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
    Readable.fromWeb(response.body).pipe(res);
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

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(appRoot, "dist", pathname);
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": String(statSync(filePath).size),
    });
    createReadStream(filePath).pipe(res);
    return;
  }
  const indexFile = path.join(appRoot, "dist", "index.html");
  if (existsSync(indexFile)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(indexFile).pipe(res);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found（请先执行 npm run build 生成前端）");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      const request = await toWebRequest(req);
      const response = await handleApi(request, { db, store });
      sendResponse(res, response);
      return;
    }
    if (dev && vite) {
      vite.middlewares(req, res);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "服务器错误");
  }
});

server.listen(PORT, () => {
  console.log(`[artdatabase] 服务已启动 http://localhost:${PORT}${dev ? "（开发模式）" : ""}`);
  console.log(`[artdatabase] DB_PATH=${DB_PATH}`);
  console.log(`[artdatabase] STORE_ROOT=${STORE_ROOT}`);
  console.log(`[artdatabase] 示例数据写入=${seedDemo ? "开启" : "关闭（生产环境不会自动生成示例库）"}`);
});
