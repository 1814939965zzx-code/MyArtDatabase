# 构建与服务器部署指南

本项目的前端源码位于 `app/src/`，生产网页由 Vite 构建到 `app/dist/`。`app/dist/` 不提交到 GitHub，因此服务器每次拉取新代码后都必须重新构建前端。

## 本地推送前检查

在仓库根目录执行：

```bash
cd app
npm install
npm run typecheck
npm test
npm run build
```

全部通过后再检查、提交和推送源码：

```bash
cd ..
git status
git diff
git add <本次修改的文件>
git commit -m "描述本次修改"
git push origin main
```

不要提交 `node_modules/`、`app/dist/`、数据库或上传图片。

## 云服务器每次拉取后的必要操作

服务器项目目录为 `/home/admin/MyArtDatabase` 时，执行：

```bash
cd /home/admin/MyArtDatabase
git pull --ff-only origin main

cd /home/admin/MyArtDatabase/app
npm install
npm run build
```

构建成功后必须重启服务。为避免启动仓库根目录残留的旧程序，使用新版入口的绝对路径：

```bash
sudo fuser -k 3000/tcp

nohup env \
DB_PATH=/home/admin/MyArtDatabase/data/app.db \
STORE_ROOT=/home/admin/MyArtDatabase/data/media \
PORT=3000 \
node /home/admin/MyArtDatabase/app/server/index.js \
> /home/admin/MyArtDatabase/app.log 2>&1 &
```

这里继续使用仓库根目录下原有的 `data/`，以保留已经上传的图片和数据库。如果服务器已经把数据迁移到 `app/data/`，应移除 `DB_PATH` 和 `STORE_ROOT`，或者将它们改成实际数据目录。

## 部署后验证

```bash
sleep 3
curl -s http://localhost:3000 | grep -o 'assets/index-[^"]*'
tail -20 /home/admin/MyArtDatabase/app.log
```

`curl` 输出的 JS/CSS 文件名应与下面命令显示的一致：

```bash
grep -o 'assets/index-[^"]*' /home/admin/MyArtDatabase/app/dist/index.html
```

如果两边不一致，说明 3000 端口仍由旧目录中的进程提供服务。检查当前进程：

```bash
sudo ss -ltnp | grep ':3000'
```

## 给服务器 Agent 的固定指令

以后可以把下面这段话直接交给负责服务器部署的 Agent：

> 拉取 GitHub `main` 的最新代码后，必须进入 `/home/admin/MyArtDatabase/app` 执行 `npm install` 和 `npm run build`。构建成功后，保留现有数据库与图片目录，停止占用 3000 端口的旧进程，并从绝对路径 `/home/admin/MyArtDatabase/app/server/index.js` 启动服务。不要启动 `/home/admin/MyArtDatabase/server/index.js`。最后用 `curl` 对比线上 HTML 引用的 JS/CSS 文件名与 `app/dist/index.html`，确认一致后才算部署完成。

## 运行环境

- Node.js 要求：`>= 23.4.0`，建议使用 Node.js 24。
- `npm start` 只启动服务，不会自动执行 `npm run build`。
- 生产服务读取的是 `app/dist/`，不是仓库根目录下可能残留的 `dist/`。
