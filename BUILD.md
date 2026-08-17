# 构建与部署

生产入口是 `app/server/index.js`，生产页面来自未提交 Git 的 `app/dist/`。每次更新源码都必须重新构建前端再重启服务。

## 交付前验证

```bash
cd app
npm ci
npm run typecheck
npm test
npm run build
```

不要提交 `node_modules/`、`app/dist/`、数据库、上传图片或日志。

## 自动部署

[`scripts/deploy.sh`](./scripts/deploy.sh) 会检查服务器工作区、以 fast-forward 对齐远端分支、执行 `npm ci` 和前端构建、重启服务，并比对实际页面与本次构建的资源哈希。

推荐只使用 systemd 管理生产服务：

```bash
cd /home/admin/MyArtDatabase
SERVICE_NAME=artdatabase ./scripts/deploy.sh
```

同时验证公网 Nginx/CDN：

```bash
SERVICE_NAME=artdatabase \
PUBLIC_URL=https://your-domain.example \
./scripts/deploy.sh
```

不传 `SERVICE_NAME` 时脚本使用 `nohup`，只适合作为临时方式。不要混用 systemd、PM2、Docker 和 `nohup` 管理同一端口。

## 首次配置 systemd

示例 `/etc/systemd/system/artdatabase.service`：

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

先用 `command -v node` 确认 `ExecStart` 中的 Node 绝对路径，再启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now artdatabase
```

启用前确认 3000 端口没有被其他 systemd 服务、PM2 或 Docker 管理。

## 配置项

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `REPO_DIR` | 脚本上一级目录 | 仓库路径 |
| `BRANCH` | `main` | 部署分支 |
| `PORT` | `3000` | 服务与健康检查端口 |
| `SERVICE_NAME` | 空 | systemd 服务名；为空时使用 `nohup` |
| `PUBLIC_URL` | 空 | 可选公网验证地址 |
| `DB_PATH` | `<repo>/data/app.db` | `nohup` 模式数据库位置 |
| `STORE_ROOT` | `<repo>/data/media` | `nohup` 模式图片位置 |
| `LOG_FILE` | `<repo>/app.log` | `nohup` 模式日志位置 |

使用 systemd 时，数据路径必须写在 unit 的 `Environment=` 中；命令行传入的 `DB_PATH` 和 `STORE_ROOT` 不会覆盖 systemd unit。

## 部署失败排查

```bash
sudo systemctl status artdatabase --no-pager
sudo systemctl show artdatabase --property MainPID,ExecStart,WorkingDirectory
sudo ss -ltnp | grep ':3000'

curl -fsS http://localhost:3000 | grep -o 'assets/index-[^"]*'
grep -o 'assets/index-[^"]*' /home/admin/MyArtDatabase/app/dist/index.html
```

页面和 `dist/index.html` 的 JS/CSS 哈希必须一致。本机一致而公网不一致时，检查 Nginx、CDN 和浏览器缓存。

## 部署完成标准

以下条件全部满足才算完成：

- 本地 commit 与远端目标分支一致。
- `app/dist/` 已由当前源码重新构建。
- 运行进程入口是当前仓库的 `app/server/index.js`。
- 首页和 `/api/projects` 健康检查通过。
- 服务返回的资源哈希与本次构建一致。
- 设置 `PUBLIC_URL` 时，公网返回的资源哈希也一致。
