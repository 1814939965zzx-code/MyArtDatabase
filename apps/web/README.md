# Art Database Web

artDatabase 的本地 Web 应用，使用 React、vinext、Cloudflare D1 本地开发绑定和 Drizzle。

## 开发

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`。本地数据库状态由 Wrangler 保存在本目录的 `.wrangler/` 中。

同一局域网中的手机或其他电脑需要访问时，使用 `npm run dev:lan`，然后打开本机局域网 IP 的 `3000` 端口。

启动前复制 `.dev.vars.example` 为 `.dev.vars`，并填写 ResourceSpace 服务地址、服务账号和 API 密钥。密钥只由服务端读取，不会发送到浏览器。

## 验证

```bash
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
```

修改 `db/schema.ts` 后执行 `npm run db:generate` 更新数据库迁移。

## 当前 API

- `GET/POST/PATCH/DELETE /api/projects`
- `POST/DELETE /api/dimensions`
- `PATCH /api/asset-values`
- `POST /api/uploads` 与 `POST /api/uploads/check`（原图与 Metadata 写入 ResourceSpace）
- `GET /api/media`（由服务端代理 ResourceSpace 文件，兼容读取旧 R2 素材）
- `GET/POST/PATCH/DELETE /api/canvases`
- `GET /api/canvas`
- `POST/PATCH/DELETE /api/canvas-items`
- `PATCH/DELETE /api/assets`
- `GET /api/workspace?projectId=...`
