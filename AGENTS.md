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

- 产品：团队使用的图片/视频素材库，按项目引用全局素材，并通过项目维度和自由画板组织素材。
- 运行时：单个原生 Node.js 进程，同时提供 React 页面、`/api/*` 接口、SQLite 数据库和本地图片/视频存储。
- 账号：两级角色（管理员/成员）；除健康检查与登录相关接口外，全部 `/api/*` 需要登录（HttpOnly Cookie Session）；首次启动在界面引导创建管理员。
- 前端：React 19、TypeScript、Vite、Tailwind CSS v4。
- 后端：`node:http`、Node 内置 `node:sqlite`、`sharp`、`ffmpeg-static`（视频转码与抽帧）。
- 环境要求：Node.js `>=23.4.0`，建议 Node.js 24。
- 默认开发地址：`http://localhost:3000`。

## 代码入口

| 位置 | 职责 |
| --- | --- |
| `app/src/AuthGate.tsx` | 登录页 / 首次设置管理员页、会话状态与 401 事件监听 |
| `app/src/ArtDatabaseApp.tsx` | 页面状态与主要应用流程（主页/全部素材/回收站/项目工作区导航、顶部用户菜单、账号设置、成员管理入口） |
| `app/src/HomeView.tsx` | 主页（Figma 式项目卡片网格：封面拼图、重命名/删除、进入项目） |
| `app/src/AllAssetsView.tsx` | 全局素材库 |
| `app/src/DimensionPreview.tsx` | 一维、二维、三维预览与拖动交互 |
| `app/src/BoardView.tsx` | 自由画板 |
| `app/src/UploadModal.tsx` | 上传与重复素材处理 |
| `app/src/AssetMetadataEditor.tsx` | 素材详情与 Metadata 编辑 |
| `app/src/TagFilterBar.tsx` | 素材标签筛选模块（全部素材页与项目素材页共用） |
| `app/src/AiConfigModal.tsx` | AI 服务配置页（key 服务端保存、测试连接；仅管理员可见入口） |
| `app/src/UserManagerModal.tsx` | 成员管理面板（仅管理员：创建/停用/重置密码/删除/改角色/登录审计） |
| `app/src/AccountSettingsModal.tsx` | 账号设置（改显示名/密码） |
| `app/server/routes.js` | 全部 `/api/*` 路由（含登录、用户管理、权限校验） |
| `app/server/auth.js` | 密码哈希（scrypt）、会话创建/解析、cookie 与登录审计 |
| `app/server/db.js` | SQLite 表结构、迁移与示例数据（含 users/sessions/login_logs） |
| `app/server/tags.js` | 标签字典与素材-标签关联的共享读写 |
| `app/server/ai.js` | AI 打标：配置读取、OpenAI 兼容调用、两轮标签复用裁决 |
| `app/server/storage.js` | 原图/原视频和缩略图存储（图片走 sharp；视频原文件与转码产物共用存储键） |
| `app/server/transcode.js` | 视频转码队列（上传后异步压码率、抽帧封面、状态推进） |
| `app/src/TagManager.tsx` | 标签管理面板（全局：重命名/合并/删除/清理/AI 配置；项目：该项目标签，重命名/删除） |
| `app/test/api-smoke.mjs` | API 全链路冒烟测试（含账号系统用例） |
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
- 视频统一转码为低码率 H.264 MP4（最长边 ≤1280、码率上限 2Mbps）；**转码成功且数据库已切换到转码产物后才删除原文件**，失败/中断/切换失败必须保留原文件。
- 视频转码异步单并发执行（不阻塞上传）；`processing` 不可播放，`ready` 才可播放，`failed` 保留原文件供重新转码。
- 保持现有 `/api/*` URL 契约，除非需求明确要求破坏性变更。

## 文档维护

- 产品规则发生变化：直接更新 `requirements/CURRENT.md`。
- 完成一次有意义的需求变更：在 `requirements/CHANGELOG.md` 顶部增加一行摘要；只有需要保留完整决策过程时才新增 archive 文档。
- 不要把实现日志、测试过程或已失效规则写回 `CURRENT.md`。
- 调研类文档统一放入 `requirements/research/`，文件名按“日期_主题”命名（如 `2026-08-18_AI识图打标签服务调研.md`）；用户要求调查某事时按此格式新增或更新该目录下的文档。
- 架构、命令或入口变化时，同步更新本文件；部署流程变化时同步更新 `BUILD.md`。
- 根 `README.md` 只作为快速入口，不复制完整需求或部署说明。
