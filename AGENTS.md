# Agent 工作指南

本文件适用于整个仓库。目标是让 Agent 以最少上下文获得当前事实，避免从历史需求推断现行规则。

## 开始工作

1. 必读本文件和 `requirements/CURRENT.md`。
2. 只在部署或排障时读取 `BUILD.md`。
3. 只在用户要求追溯历史时读取 `requirements/CHANGELOG.md` 和 `requirements/archive/`。
4. 修改前先执行 `git status --short`，保留用户已有改动，不覆盖无关文件。

## 信息权威顺序

发生冲突时按以下顺序判断：

1. 可运行代码、数据库结构和自动化测试：当前实现事实。
2. `requirements/CURRENT.md`：当前产品规则与待办。
3. 本文件：工程约束和工作方式。
4. `BUILD.md`：部署操作。
5. `requirements/archive/`：历史表述，不是当前需求。

如果代码与 `CURRENT.md` 不一致，不要静默选择一方；应指出差异，并根据用户本次目标修复代码或更新文档。

## 项目快照

- 产品：团队使用的图片素材库，按项目引用全局素材，并通过项目维度和自由画板组织素材。
- 运行时：单个原生 Node.js 进程，同时提供 React 页面、`/api/*` 接口、SQLite 数据库和本地图片存储。
- 前端：React 19、TypeScript、Vite、Tailwind CSS v4。
- 后端：`node:http`、Node 内置 `node:sqlite`、`sharp`。
- 环境要求：Node.js `>=23.4.0`，建议 Node.js 24。
- 默认开发地址：`http://localhost:3000`。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `app/src/ArtDatabaseApp.tsx` | 页面状态与主要应用流程 |
| `app/src/AllAssetsView.tsx` | 全局素材库 |
| `app/src/DimensionPreview.tsx` | 一维、二维、三维预览与拖动交互 |
| `app/src/BoardView.tsx` | 自由画板 |
| `app/src/UploadModal.tsx` | 上传与重复素材处理 |
| `app/src/AssetMetadataEditor.tsx` | 素材详情与 Metadata 编辑 |
| `app/src/TagFilterBar.tsx` | 素材标签筛选模块（全部素材页与项目素材页共用） |
| `app/src/AiConfigModal.tsx` | AI 服务配置页（key 服务端保存、测试连接） |
| `app/server/routes.js` | 全部 `/api/*` 路由 |
| `app/server/db.js` | SQLite 表结构、迁移与示例数据 |
| `app/server/tags.js` | 标签字典与素材-标签关联的共享读写 |
| `app/server/ai.js` | AI 打标：配置读取、OpenAI 兼容调用、两轮标签复用裁决 |
| `app/server/storage.js` | 原图和缩略图存储 |
| `app/src/TagManager.tsx` | 标签管理面板（全局：重命名/合并/删除/清理/AI 配置；项目：该项目标签，重命名/删除） |
| `app/test/api-smoke.mjs` | API 全链路冒烟测试 |
| `scripts/deploy.sh` | 服务器部署与版本校验 |
| `scripts/setup-server.sh` | 首次安装、旧数据安全迁移与 systemd 初始化 |
| `scripts/check-production.sh` | 只读生产环境巡检 |

## 常用命令

在 `app/` 目录执行：

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

修改前端或共享类型时至少运行 `npm run typecheck`。修改接口、数据库或存储时至少运行 `npm test`。交付跨层功能前运行三项验证：

```bash
npm run typecheck
npm test
npm run build
```

## 不可破坏的约束

- 生产入口是 `app/server/index.js`；`npm start` 不会自动构建前端。
- 生产页面来自 `app/dist/`，该目录不提交 Git。
- 不提交 `node_modules/`、SQLite 数据库、上传图片、日志或密钥。
- 默认开发数据位于 `app/data/`；生产部署把持久化数据固定在 `/var/lib/artdatabase/`（由 `/etc/artdatabase/env` 配置，`scripts/setup-server.sh` 初始化）。不要混淆这两个运行场景。
- 示例数据只在开发模式（`--dev`）或显式设置 `SEED_DEMO=1` 时写入；生产环境空库启动即为空库，不得为“看起来有数据”而重新开启示例数据写入。
- 素材文件与项目相互独立；项目只保存素材引用，不复制图片。
- 全局 Metadata 修改会影响该素材在所有项目中的展示。
- 标签存于 `tags`/`asset_tags` 标签字典（`assets.tags` 旧列已随迁移删除）；单素材标签上限 50 个（人工与 AI 统一），AI 单次最多返回 30 个。
- 项目维度数量不限；一次维度预览最多选择三个维度。
- 维度值以整数 `0～1000` 存储，对应界面上的 `0.00～10.00`。
- 软删除只更新 `deleted_at`；只有彻底删除才能移除磁盘文件。
- 保持现有 `/api/*` URL 契约，除非需求明确要求破坏性变更。

## 文档维护

- 产品规则发生变化：直接更新 `requirements/CURRENT.md`。
- 完成一次有意义的需求变更：在 `requirements/CHANGELOG.md` 顶部增加一行摘要；只有需要保留完整决策过程时才新增 archive 文档。
- 不要把实现日志、测试过程或已失效规则写回 `CURRENT.md`。
- 架构、命令或入口变化时，同步更新本文件；部署流程变化时同步更新 `BUILD.md`。
- 根 `README.md` 只作为快速入口，不复制完整需求或部署说明。
