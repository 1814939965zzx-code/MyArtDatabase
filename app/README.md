# artDatabase（单 Node 服务）

一个 Node.js 程序搞定全部：React 前端 + 业务接口 + SQLite 数据库 + 图片存储。不再依赖 Cloudflare Worker / D1 / ResourceSpace。

## 环境要求

- Node.js ≥ 23.4（数据库用 Node 自带的 `node:sqlite`，无需额外安装）

## 启动（开发模式）

```bash
cd app
npm install
npm run dev
```

打开 `http://localhost:3000`。一个进程同时提供前端页面和 `/api/*` 接口，前端改动即时热更新。

## 生产模式

```bash
npm run build    # 打包前端到 dist/
npm start        # 单进程服务 dist/ + 接口
```

`npm start` 不会自动构建前端。服务器每次 `git pull` 后必须重新执行 `npm run build`，再重启服务。不要从仓库根目录的旧入口启动；生产入口必须是 `app/server/index.js`。完整操作见仓库根目录的 [`BUILD.md`](../BUILD.md)。

## 数据与图片

- 数据库：`data/app.db`（SQLite，首次启动自动建表并写入示例数据）
- 图片：`data/media/`（原图 `blobs/`、缩略图 `thumbs/`）

想换位置，用环境变量 `DB_PATH`、`STORE_ROOT`；端口用 `PORT`（默认 3000）。

## 验证

```bash
npm test          # 后端接口全链路冒烟测试
npm run typecheck # 前端类型检查
```

## 目录结构

```
server/
  index.js    # HTTP 服务入口（接口 + 前端静态/开发服务）
  routes.js   # 全部 API 接口
  db.js       # SQLite 建表 + 示例数据
  storage.js  # 图片存储（可插拔，本地磁盘 + sharp 缩略图）
src/          # React 前端（Vite）
```
