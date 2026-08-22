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
  - 先停止同名旧服务，使用 SQLite Online Backup API 生成一致性备份；
  - 将备份复制到生产目录，旧数据库与旧媒体目录原地保留，便于回退；
- 以仓库所有者身份执行 `npm ci`、类型检查、测试和首次构建；
- 写入 `/etc/artdatabase/env`（`PORT`/`DB_PATH`/`STORE_ROOT`/`SERVICE_NAME`/`RUN_USER`）；
- 生成 systemd unit（`User=artdatabase`，`EnvironmentFile=/etc/artdatabase/env`）；
- 显式重启并验证服务用户、代码入口、API、数据库和媒体文件。

**未发现旧库时不创建空库**，必须明确执行：

```bash
sudo INIT_EMPTY_DB=1 ./scripts/setup-server.sh
```

想先预览操作可以加 `--dry-run`（无需 root）。setup 本身已完成首次构建，成功后可直接访问服务；全新空库请先在界面创建第一个项目，之后日常更新只需 `./scripts/deploy.sh`。

## 日常部署：`./scripts/deploy.sh`

脚本自己读取 `/etc/artdatabase/env` 和仓库位置，无需手动传参。流程：

```text
数据预检（数据库与媒体均在仓库外 / SQLite quick_check / 非空库非示例库 / 无 SEED_DEMO / 服务用户可读写 / 每个本地素材文件存在 / 非 root 运行 / 工作区干净）
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

### AI 打标服务（可选）

单图“AI 打标”通过 OpenAI 兼容接口调用外部视觉大模型，模型不内置。两种配置方式：

1. **界面配置（推荐）**：“全部素材 → 标签管理”面板内的“AI 服务配置”填写接口地址、API key 与模型名并保存。key 写入服务端配置文件、页面只显示尾号掩码，提供“测试连接”按钮。
2. **环境变量**：`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`，逐项优先于界面配置。

| 变量 | 说明 |
| --- | --- |
| `AI_BASE_URL` | 兼容接口根地址，如 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `AI_API_KEY` | API key，仅存服务端，前端不回显 |
| `AI_MODEL` | 模型名，如 `qwen-vl-plus` |
| `AI_CONFIG_PATH` | 配置文件路径；默认**与数据库同目录**（`DB_PATH` 所在目录下的 `ai-config.json`，开发为 `app/data/ai-config.json`，生产为 `/var/lib/artdatabase/ai-config.json`），该文件已被 Git 忽略 |

生产环境通常无需配置 `AI_CONFIG_PATH`：界面保存的配置会自动落到 `/var/lib/artdatabase/`（服务用户可写）。若坚持用环境变量，把 `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` 写入 `/etc/artdatabase/env`（systemd `EnvironmentFile` 自动加载）并 `sudo systemctl restart artdatabase`。未配置时点击“AI 打标”会得到明确错误提示，不影响其他功能。

> 注意：打标会把图片（压缩到长边 ≤1024）上传到所配置的第三方 AI 服务，开启前请确认素材保密要求；敏感素材不要执行 AI 打标。

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
