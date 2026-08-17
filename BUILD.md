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

## 云服务器自动部署

仓库内的 [`scripts/deploy.sh`](./scripts/deploy.sh) 会完成下列操作：

1. 若已跟踪文件存在未提交修改则中止，防止覆盖服务器上的修改。
2. 切换到 `main`，仅以 fast-forward 方式对齐 `origin/main`，并校验两端 commit。
3. 使用 `npm ci` 按 `package-lock.json` 安装依赖，重新构建 `app/dist/`。
4. 从绝对路径 `app/server/index.js` 重启服务。
5. 比对构建产物与 3000 端口实际返回的 JS/CSS 哈希文件名。
6. 如果指定公网地址，继续检查 Nginx/CDN 对外返回的版本。

服务器项目位于 `/home/admin/MyArtDatabase` 时，拉取到本次脚本后先赋予执行权限：

```bash
cd /home/admin/MyArtDatabase
chmod +x scripts/deploy.sh
```

### 推荐：由 systemd 管理服务

`fuser + nohup` 只能处理当前进程。如果旧服务由 systemd、PM2 或 Docker 自动恢复，杀掉进程后它会再次占用 3000 端口。生产服务应只使用一个进程管理器，推荐 systemd。

首次配置 `/etc/systemd/system/artdatabase.service`：

```ini
[Unit]
Description=MyArtDatabase
After=network.target

[Service]
Type=simple
User=admin
WorkingDirectory=/home/admin/MyArtDatabase/app
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DB_PATH=/home/admin/MyArtDatabase/data/app.db
Environment=STORE_ROOT=/home/admin/MyArtDatabase/data/media
ExecStartPre=/usr/bin/test -s /home/admin/MyArtDatabase/app/dist/index.html
ExecStart=/usr/bin/node /home/admin/MyArtDatabase/app/server/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

先在服务器执行 `command -v node`。如果输出不是 `/usr/bin/node`，必须将 `ExecStart` 的 Node 路径改成该命令的实际输出。

启用新 unit 前，先用 `sudo ss -ltnp | grep ':3000'`、`pm2 list` 和 `docker ps` 确认没有另一个进程管理器在启动旧服务。如果存在，应停止并禁用那个明确的旧服务，不要只用 `fuser` 杀子进程。然后启用新 unit：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now artdatabase
```

以后每次部署只执行：

```bash
cd /home/admin/MyArtDatabase
SERVICE_NAME=artdatabase ./scripts/deploy.sh
```

如果有公网域名，同时验证 Nginx/CDN 返回的是新版：

```bash
cd /home/admin/MyArtDatabase
SERVICE_NAME=artdatabase \
PUBLIC_URL=https://your-domain.example \
./scripts/deploy.sh
```

### 临时：未配置 systemd 时直接启动

不传 `SERVICE_NAME` 时，脚本会使用 `nohup` 启动：

```bash
cd /home/admin/MyArtDatabase
./scripts/deploy.sh
```

该模式只作为临时过渡：

- 脚本只会停止工作目录或命令行属于当前仓库的 Node 进程，不会终止占用 3000 端口的其他服务。
- 停止旧进程后会等待 3 秒。如果 systemd、PM2 或 Docker 让旧服务复活，脚本会中止并提示改用 `SERVICE_NAME`。
- `nohup` 无法提供开机自启、稳定的故障恢复和日志管理。

### 数据保留与可选参数

默认继续使用仓库根目录下原有的 `data/`，以保留上传图片和数据库。可以通过环境变量修改：

```bash
DB_PATH=/actual/path/app.db \
STORE_ROOT=/actual/path/media \
PORT=3000 \
./scripts/deploy.sh
```

上述 `DB_PATH`、`STORE_ROOT` 只会直接传给 `nohup` 模式启动的 Node 进程。使用 systemd 时，必须在 `artdatabase.service` 的 `Environment=` 中修改数据路径，然后执行 `sudo systemctl daemon-reload`。脚本环境中的 `PORT` 在 systemd 模式下只用于部署后健康检查，必须与 unit 文件中的 `PORT` 保持一致。

可用参数：

- `REPO_DIR`：仓库路径，默认为脚本上一级目录。
- `BRANCH`：部署分支，默认 `main`。
- `SERVICE_NAME`：systemd 服务名；不设置时使用临时 `nohup` 模式。
- `PUBLIC_URL`：可选的公网地址，用于检查 Nginx/CDN 返回的资源版本。
- `DB_PATH`、`STORE_ROOT`、`LOG_FILE`：覆盖临时 `nohup` 模式的默认运行参数。
- `PORT`：临时模式的监听端口，也是两种模式的健康检查端口。

## 部署后人工检查

脚本已会自动检查本机构建资源。如需进一步排查：

```bash
sudo systemctl status artdatabase --no-pager
sudo systemctl show artdatabase --property MainPID,ExecStart,WorkingDirectory
sudo ss -ltnp | grep ':3000'

curl -fsS http://localhost:3000 | grep -o 'assets/index-[^"]*'
grep -o 'assets/index-[^"]*' /home/admin/MyArtDatabase/app/dist/index.html
```

两个资源列表必须一致。如果本机一致、公网域名不一致，问题在 Nginx/CDN 或浏览器缓存，而不是 Vite 构建。

## 给服务器 Agent 的固定指令

以后可以把下面这段话直接交给负责服务器部署的 Agent：

> 进入 `/home/admin/MyArtDatabase`，使用 `SERVICE_NAME=artdatabase ./scripts/deploy.sh` 部署。不要手工执行根目录下的旧入口，不要混用 systemd、PM2、Docker 和 `nohup`。脚本必须完成 commit 对齐、`app/dist` 构建、正确入口重启和资源哈希比对后，才能视为部署成功。

## 运行环境

- Node.js 要求：`>= 23.4.0`，建议使用 Node.js 24。
- `npm start` 只启动服务，不会自动执行 `npm run build`。
- 生产服务读取的是 `app/dist/`，不是仓库根目录下可能残留的 `dist/`。
