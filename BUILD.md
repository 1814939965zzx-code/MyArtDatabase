# 构建与部署

生产入口是 `app/server/index.js`，生产页面来自未提交 Git 的 `app/dist/`。生产环境**不会自动写入示例数据**（仅 `--dev` 或 `SEED_DEMO=1` 时写入）。

日常运维只需要三条命令：

```bash
sudo ./scripts/setup-server.sh          # 首次初始化（只执行一次）
./scripts/deploy.sh                     # 日常一键部署（服务器上唯一部署命令）
./scripts/check-production.sh           # 只读生产检查（可选，随时可跑）
```

## 首次初始化：`sudo ./scripts/setup-server.sh`（只执行一次）

负责：

- 创建非 root 服务用户 `artdatabase`；
- 把持久化数据固定到 `/var/lib/artdatabase/`（`app.db` + `media/`）；
- 探测旧数据库：`<repo>/app/data/app.db`、`<repo>/data/app.db`、`/var/lib/artdatabase/app.db`；
  - **多个数据库同时存在时停止**，绝不自动猜测；
  - 唯一旧库迁移前先备份到 `/var/lib/artdatabase/backups/`；
- 写入 `/etc/artdatabase/env`（`PORT`/`DB_PATH`/`STORE_ROOT`/`SERVICE_NAME`/`RUN_USER`）；
- 生成 systemd unit（`User=artdatabase`，`EnvironmentFile=/etc/artdatabase/env`）；
- 启动并验证服务。

**未发现旧库时不创建空库**，必须明确执行：

```bash
sudo INIT_EMPTY_DB=1 ./scripts/setup-server.sh
```

想先预览操作可以加 `--dry-run`（无需 root）。初始化完成后先执行一次 `./scripts/deploy.sh` 完成构建。

## 日常部署：`./scripts/deploy.sh`

脚本自己读取 `/etc/artdatabase/env` 和仓库位置，无需手动传参。流程：

```text
数据预检（库在仓库外 / SQLite quick_check / 非空库非示例库 / 无 SEED_DEMO / 媒体目录可读 / 非 root 运行 / 工作区干净）
  ↓
git fetch + fast-forward（本地有未提交修改、分支不对或无法 ff 则停止）
  ↓
npm ci + typecheck + test + build
  ↓
重启 systemd
  ↓
后检（systemd 运行当前代码入口 / 首页与 API 有效 JSON / 项目与素材数与部署前一致 / 页面资源哈希对应当次构建）
  ↓
输出“部署成功”
```

**任何一项异常都以非零退出并输出恢复指引**，不会出现“有警告但仍成功”。服务器无需先手动 `git pull`。

## 生产检查：`./scripts/check-production.sh`

只读：不拉代码、不构建、不重启。执行与部署相同的预检与后检（另校验 API 项目数与数据库一致），适合巡检或部署后复核。

## 配置

| 位置 | 说明 |
| --- | --- |
| `/etc/artdatabase/env` | 生产配置，由 `setup-server.sh` 生成（`PORT`/`DB_PATH`/`STORE_ROOT`/`SERVICE_NAME`/`RUN_USER`），勿手改 |
| `/var/lib/artdatabase/` | 生产数据：`app.db` + `media/` + `backups/`，属主 `artdatabase` |
| `/etc/systemd/system/artdatabase.service` | systemd unit，由 `setup-server.sh` 生成 |

端口默认 `3000`，可在初始化时指定：`sudo ./scripts/setup-server.sh --port=8080`。

## 禁止事项

- 禁止 `git clean -fdx`、`rm -rf` 仓库或仓库内目录、重新 `git clone`（会删除仓库内数据；生产数据在 `/var/lib/artdatabase/` 不受影响，但旧库可能仍在仓库内）；
- 禁止用 `nohup`、PM2、Docker 再起一个服务，端口只能由 systemd 服务管理；
- 禁止零散执行 `npm install` / `npm run build` / `systemctl restart`，一切以 `deploy.sh` 为准。

## 排查

```bash
sudo systemctl status artdatabase --no-pager
sudo journalctl -u artdatabase -n 100 --no-pager
./scripts/check-production.sh
ls -l /var/lib/artdatabase/ /var/lib/artdatabase/backups/
```

## 交付前验证

```bash
cd app
npm ci
npm run typecheck
npm test
npm run build
bash scripts/test-deploy.sh   # 部署脚本测试（lib 单测 + 迁移决策 + 生产检查正反用例 + deploy 端到端）
```

不要提交 `node_modules/`、`app/dist/`、数据库、上传图片或日志。
