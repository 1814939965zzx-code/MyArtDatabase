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

- 产品：团队使用的图片/视频素材库，按项目引用全局素材，并通过独立维度 Page 和自由画板组织素材。
- 运行时：单个原生 Node.js 进程，同时提供 React 页面、`/api/*` 接口、SQLite 数据库和本地图片/视频存储。
- 账号：两级角色（管理员/成员），另有无需账号的游客只读浏览；除健康检查与登录相关接口外，全部 `/api/*` 需要登录（HttpOnly Cookie Session、插件令牌 Bearer 或游客 cookie）；游客会话只允许 GET，写请求一律 403；首次启动在界面引导创建管理员。
- 前端：React 19、TypeScript、Vite、Tailwind CSS v4。
- 浏览器采集：`extension/` 目录是独立的 Chrome 扩展（Manifest V3、原生 JS 零构建、unpacked 加载），右键保存网页图片/视频到素材库（含 Instagram 覆盖层穿透与视频直链解析），经「插件令牌」（顶部用户菜单 → 插件令牌面板生成）认证。
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
| `app/src/DimensionPages.tsx` | 维度 Page 切换、增删改、项目素材多选加入 |
| `app/src/DimensionPreview.tsx` | 单个 Page 的一维、二维、三维预览与拖动交互 |
| `app/src/AiDimensionDialog.tsx` | AI 维度标记确认框（单图/批量共用：维度多选、all/zero、数量与限制） |
| `app/src/AiDimensionStatus.tsx` | 维度预览左下角批量 AI 进度胶囊（进度、超时、停止） |
| `app/src/useAiDimensionTag.ts` | 批量 AI 维度任务：创建、轮询、增量应用、停止、刷新/切页 adopt |
| `app/src/DimensionControlsEditor.tsx` | 素材详情里的维度滑块与单图 AI 标记入口 |
| `app/src/BoardView.tsx` | 自由画板 |
| `app/src/UploadModal.tsx` | 上传与重复素材处理 |
| `app/src/AssetMetadataEditor.tsx` | 素材详情与 Metadata 编辑 |
| `app/src/TagFilterBar.tsx` | 素材标签筛选模块（全部素材页与项目素材页共用） |
| `app/src/AiConfigModal.tsx` | AI 服务配置页（key 服务端保存、测试连接；仅管理员可见入口） |
| `app/src/UserManagerModal.tsx` | 成员管理面板（仅管理员：创建/停用/重置密码/删除/改角色/登录审计） |
| `app/src/AccountSettingsModal.tsx` | 账号设置（改显示名/密码） |
| `app/src/TokenSettingsModal.tsx` | 插件令牌面板（生成/吊销/复制令牌、浏览器扩展下载与使用说明） |
| `app/server/routes.js` | 全部 `/api/*` 路由（含登录、用户管理、权限校验、插件令牌 CRUD） |
| `app/server/auth.js` | 密码哈希（scrypt）、会话创建/解析、cookie、登录审计与插件令牌（创建/列表/吊销/Bearer 解析） |
| `app/server/preview-pages.js` | 维度 Page 独立数据模型、v9 迁移与 Page/维度/素材引用/数值接口 |
| `app/server/preview-ai.js` | 单图/批量 AI 维度标记：提示词、单图视觉请求、条件写库、2 路并发任务、超时与停止 |
| `app/server/db.js` | SQLite 表结构、迁移与示例数据（含 users/sessions/login_logs/api_tokens） |
| `app/server/tags.js` | 标签字典与素材-标签关联的共享读写 |
| `app/server/ai.js` | AI 打标：配置读取、OpenAI 兼容调用、两轮标签复用裁决 |
| `app/server/storage.js` | 原图/原视频和缩略图存储（图片走 sharp；视频原文件与转码产物共用存储键） |
| `app/server/transcode.js` | 视频转码队列（上传后异步压码率、抽帧封面、状态推进） |
| `app/src/TagManager.tsx` | 标签管理面板（全局：重命名/合并/删除/清理/AI 配置；项目：该项目标签，重命名/删除） |
| `app/test/api-smoke.mjs` | API 全链路冒烟测试（含账号系统用例） |
| `extension/manifest.json` | Chrome 扩展 MV3 声明（全上下文右键菜单、全站常驻内容脚本、Instagram 兼容 CSS、activeTab/scripting、`<all_urls>` 主机权限） |
| `extension/background.js` | 扩展 Service Worker（右键菜单、右键目标解析、素材下载与魔数校验/查重、对 artDatabase 的请求代理与 Bearer 令牌） |
| `extension/content.js` | 扩展内容脚本（右键目标记录与覆盖层穿透、srcset 最高清、Instagram 视频直链解析、确认面板[图片预览/视频占位]与 toast，Shadow DOM 隔离样式；blob: 素材代为获取） |
| `extension/instagram.css` | Instagram 图片右键兼容样式（取消透明覆盖层的 `inset`，让图片可被命中） |
| `extension/options.html` / `extension/options.js` | 扩展设置页（服务器地址 + 插件令牌 + 测试连接） |
| `scripts/deploy.sh` | 服务器部署与版本校验 |
| `scripts/install-deps.mjs` | 首次安装/部署共享依赖安装器：临时目录安装、ffmpeg 缓存、验证后替换 |
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
- 每个维度 Page 的维度和素材维度值独立；维度数量不限，一次预览最多选择三个。新上传素材不自动加入 Page。
- 维度值以整数 `0～1000` 存储，对应界面上的 `-100～100`（中点 `500` 对应 `0`）。
- 软删除只更新 `deleted_at`；只有彻底删除才能移除磁盘文件。
- 视频统一转码为低码率 H.264 MP4（最长边 ≤1280、码率上限 2Mbps）；**转码成功且数据库已切换到转码产物后才删除原文件**，失败/中断/切换失败必须保留原文件。
- 视频转码异步单并发执行（不阻塞上传）；`processing` 不可播放、界面显示进度（`transcode_progress` 0～100），`ready` 才可播放，`failed` 保留原文件供重新转码。
- 图片格式白名单：JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC/HEIF/AVIF（服务端、网页端与 `extension/` 扩展魔数校验保持一致；HEIC/AVIF 与 MP4 同为 `ftyp` 容器，扩展必须按图片品牌区分，绝不当作视频）；浏览器不支持原图显示时回退到 WebP 缩略图。
- 保持现有 `/api/*` URL 契约，除非需求明确要求破坏性变更。

## 文档维护

- 产品规则发生变化：直接更新 `requirements/CURRENT.md`。
- 完成一次有意义的需求变更：在 `requirements/CHANGELOG.md` 顶部增加一行摘要；只有需要保留完整决策过程时才新增 archive 文档。
- 不要把实现日志、测试过程或已失效规则写回 `CURRENT.md`。
- 调研类文档统一放入 `requirements/research/`，文件名按“日期_主题”命名（如 `2026-08-18_AI识图打标签服务调研.md`）；用户要求调查某事时按此格式新增或更新该目录下的文档。
- 架构、命令或入口变化时，同步更新本文件；部署流程变化时同步更新 `BUILD.md`。
- 根 `README.md` 只作为快速入口，不复制完整需求或部署说明。

<!-- aoci:begin -->
## AOCI 仓库认知

AOCI 为本仓库维护一个稳定、可版本化、可增量更新的仓库级认知层，供模型跨任务复用对系统的理解。

`aoci.txt` 是面向模型的结构化认知索引。它以每个受管理文件、数据库表或其他受管理对象一条独立 Entry 的方式，用符号标签与 F/R/A/S 语义表达对象的核心职责、重要关系、对外契约，以及理解或修改系统时必须知道的非显然约束和设计决策。

Header、目录段和全部 Entry 共同组成完整仓库索引，可以覆盖前端、后端、配置、数据库结构及其他受管理内容。受管理内容发生变化时，通常只需维护受影响的认知条目，不需要重新生成整个索引。

AOCI 提供系统架构、对象职责、重要关系、对外契约和关键约束的高密度视图。

### 工作原理

AOCI 采用“模型生成、模型读取”的认知闭环。

Header、Entry 和 Curation 语义的创作只按当前机器签发的 Plan 与实时 Guide 执行；由 Host 模型基于当前绑定证据独立完成。

Entry 的语义必须来自模型对真实证据的理解。不得仅依据路径、文件名、扩展名、AST、符号列表、依赖扫描、正则、固定模板或规则引擎推导、预填、拼接或改写索引语义。

对 Fresh Bootstrap，只按当前机器签发的 Plan 和实时 Guide 执行。当它们要求创作时，Host 模型创作 Root、Meta、Tag 和 F/R/A/S，提供 authoring-run 声明，并把它绑定到 Plan、Evidence 与完整 Candidate。不得要求 AOCI 填写 `origin=host_model`、制造 Receipt 或把程序生成的 Framework 当作语义。本文件不自行重建 Onboarding 流程。内部批次不是用户决策；只有遇到既有批准边界或真实的安全、漂移、CAS、Recovery 条件才停止。

### 最小使用入口

- `aoci_rules`：取得当前AOCI版本的会话运行合同。
- `aoci_overview`：建立或恢复本仓库的完整认知。
- `aoci_maintain`：受管理对象达到最终稳定状态后检查认知是否需要维护。
- `aoci_update_entry`：提交与当前证据和源码摘要绑定的完整语义更新批次。
- `aoci_report`：仅当当前布局和工具状态支持时，在证据不足、无法可靠生成语义时登记待办，不猜写。

其他MCP工具、CLI命令、参数和专项流程，以当前工具说明、Guide和 `--help` 返回内容为准，不在本文件中重复完整手册。

本区块只规定仓库接入、认知使用和收尾原则。`aoci_rules` 承载当前会话合同，Guide实时输出承载当前Plan的执行顺序与停点，工具Schema、Spec和Validator承载机器结构与判据；Prompt、Description、README和静态文档不能覆盖这些机器事实。

### 建立、生成和恢复认知

1. 每个新的 Agent Run 开始时，应先判断：

   - 本仓库是否已经存在可用的完整AOCI索引；
   - 当前上下文中是否已有与本仓库根、当前索引版本和当前AOCI服务相匹配，并且模型仍可可靠使用的完整仓库认知。

2. 仓库已经存在可用的完整索引，但当前Run没有可靠完整认知时，先调用 `aoci_rules`，再调用 `aoci_overview`。

   完整认知仍可靠时直接复用。局部不确定本身不要求机械重读系统全貌。

   本Run从已知Host上下文压缩恢复时（包括宿主注入的压缩摘要），必须把此前模型认知视为不可靠。压缩handoff不得保留或摘要正式Whole-Index，也不得保留或摘要任何Overview Header、Entry、Chunk、Challenge或Attestation正文；只能保留安全续接所需的receipt身份、未完成write或Recovery状态，以及立即重载指令。复制进handoff的Whole-Index语义或receipt不能证明恢复后模型的当前认知可靠。若当前上下文已无法可靠保留运行合同，先调用 `aoci_rules`。继续业务任务前，使用 `refresh_reasons=["context_compaction"]` 和新的 `refresh_event_id` 调用普通完整Whole-Index `aoci_overview`（不设置 `check_only` 或设为false）；不得使用 `check_only` 或认知probe。原样跟随每个 `next_cursor` 直到 `completed=true`，确认交付，并且只基于新交付正文提交一次Attestation。完成这次新的完整传输后，即使Attestation为partial或fail也消费该generation，并按既有合同继续source-bound任务，不再自动调用第二次Overview。

   AOCI可以针对 `context_compaction`、项目 `cognition_refresh_threshold` 下的机器 `semantic_threshold` 或主要 `phase_transition` 提供checkpoint与认知状态事实。只需要这些紧凑事实时使用 `check_only=true`；这些事实只向Agent提供建议，不替模型决定是否需要系统全貌。

   Agent显式调用普通 `aoci_overview`（未设置 `check_only` 或为false）时，只要能形成一致的CognitionSet，AOCI必须完整交付请求scope。不得因为已有receipt、阈值未达到或没有待处理刷新原因而抑制正文。正式认知Dirty或Stale时仍交付正文，但必须标记不可靠。存在未决恢复或无法形成一致snapshot时失败关闭，不返回混合正文。

   普通Overview返回 `continuation_required=true` 时，必须原样提交 `next_cursor` 并自动继续到 `completed=true`。不得询问用户、开始业务任务或给出阶段性系统结论。Host截断、缺块、重复、乱序、cursor失败、Index变化或`chunk_tokens`变化时停止本次认知链。Attestation完成前不得用Memory、源码、Spec、`aoci.txt`、历史会话、scope、search或Entry读取修补或补充Whole-Index认知。Challenge ordinal是正式Entry序列中的1-based位置；Header内容、注释、空行、Section/Overview/Chunk Marker、Receipt与Metadata均不计数，Chunk Receipt ordinal使用同一序列。Attestation必须原样回绑本次Challenge发布的当前`index_sha256`、`entry_sequence_sha256`与`entry_count`；旧Index、旧Entry序列、旧数量或旧Attestation均无效。完整链结束后只正式提交一次既有模型认知Attestation；同一响应只允许一次不改变语义答案的JSON Schema或字段格式修正。对象、Tag或F不匹配即失败且认知吸收不确定，不得语义重试或旁路补答。首次认知失败时还不得执行Root/Meta、Migration、全局布局或其他未重新绑定的系统级决策。上下文压缩刷新若传输完整、认知身份不变、治理对齐且没有Recovery或第三方冲突，即使Attestation为partial或fail也消耗该refresh generation，并继续原任务，不再自动重读Overview。`system_mastery_percent`只自评系统框架——架构、职责、强关系、稳定外部契约以及高熵安全和维护约束——不表示完整实现或运行实况知识；机器索引覆盖率必须分开。默认只向用户输出由本次真实覆盖率、Challenge、块数、Token和掌握度生成的规定成功或失败一句话。Host截断时提示用户把 `overview_delivery.chunk_tokens` 设置为更小的合法值后重新开始，不得自动修改。

   加法认知等级必须与严格证明字段分开解释。`delivery_verified`表示已加载Index且Host交付已确认，但完整认知验证仍未完成；应表达为“已加载且交付已验证”，不得描述为“没有认知”或“没有理解系统”。`cognition_verified`要求Attestation通过（Challenge至少80%的ordinal完全正确且对象身份至多失手一处），`cognition_governed`还要求治理对齐。通用完整读取失败句只用于真实交付故障。

   当Overview响应包含可选`cognition-state/v2`投影时，必须分别解释各维度。其Level止于`model_cognition_usable`；`strict_attestation_verified`、`governance_aligned`与`current_system_cognition_reliable`都是独立状态，绝不参与该Level。ordinal、对象身份、Tag或核心F不匹配可以导致严格Attestation失败，而模型认知仍然可用；不得仅凭这种不匹配就宣称模型没有理解系统。只有`current_system_cognition_reliable=true`允许无保留地声称当前完整系统认知可靠。投影缺失时继续使用上述Legacy解释。

   普通的只读审计、分析、检查、不修改代码或不提交、不push，不自动等于严格零写入，也不改变上述认知有效性判断。Codex Memory和历史Skill只能辅助恢复经验、用户偏好与调查方向，不能替代与当前仓库根、索引摘要、AOCI服务身份和认知范围匹配的当前认知收据；项目AGENTS和当前AOCI身份在AOCI状态上优先于历史Memory。

   只有用户明确禁止Ledger、元数据、`.aoci`运行资产及任何文件写入时，才按严格零写入处理。若必要的认知建立与该边界冲突，必须报告冲突并请求用户裁决或建议使用隔离副本，不得静默以Memory替代当前仓库认知。

3. 仓库没有可用的完整索引，或当前只有最小骨架、Header不完整、Entries未完成、必要Curation尚未裁决时，如果需要建立正式完整AOCI索引，先取得 `aoci_rules`，然后进入当前AOCI Guide。由Guide依据仓库真实状态决定下一阶段并完成必要安全步骤。

   `aoci_maintain` 不替代索引建立流程。

   不在本文件中自行重建或硬编码完整索引生成状态机。

4. 在长程任务中，模型负责保留当前认知收据并正确使用刷新门禁：

   - Host报告上下文压缩或模型已知系统全貌丢失时，执行上述强制 `context_compaction` 重载规则；AOCI不能自行推断Host事件；
   - 进入真正的主要阶段时声明 `phase_transition`，不得把函数、测试运行或小步骤当作阶段；
   - 在有用的稳定检查点通过 `check_only=true` 取得机器语义计数；
   - 除已知压缩的强制重载外，由Agent判断当前任务是否需要再次显式获取指定scope或完整Overview；
   - 在维护和对齐完成前，保留AOCI报告的Dirty或Stale可靠性状态。

### 任务收尾与认知维护

5. 纯只读问答、分析、版本核验，或没有产生受AOCI管理对象变化的任务，不需要调用维护工具。当前AOCI版本是任意`aoci_overview` check_only或`aoci_maintain`响应里的`cognition_receipt.mcp_service_version`；二进制路径是项目`.mcp.json`里的`command`，CLI不必在PATH上。

6. 发生受AOCI管理对象变化时，待其达到本次任务的最终稳定状态后，只调用一次 `aoci_maintain`。不要在每次中间修改后逐文件维护。

7. 若维护结果返回真实语义候选，Host 模型必须基于每个候选绑定的对象和必要证据，独立创作完整标签与F/R/A/S更新。通过 `aoci_update_entry` 一次提交当前机器签发批次的完整候选集合，同时原样保留每项 `source_sha256`、`candidate_id` 与对应domain批次身份。`max_entries`只限制单次请求和原子事务，不限制logical plan、Whole-Index或Managed Scope。`remaining`非零时，在当前批次成功Apply后重新调用Maintain并从新preimage继续；绝不能为满足transport上限缩减Index覆盖或自行截取返回批次。

   没有足够证据且当前布局支持 `aoci_report` 时，使用它而不猜测、套用模板或为消除待办而生成缺乏证据的认知。

8. 必须遵守工具返回的结构化状态和安全边界：

   - `repair_required`：只修复明确命中的候选，再重新提交当前机器签发的完整批次；
   - `stopped`：结束当前写入尝试并检查 `failed_step`、错误、正式写入证据与Recovery。auto模式下，已证明零写入则记录closure并重新Plan；完整Intent和可证明postimage则Resume；策略要求Rollback且preimage可证明则精确恢复后重新Plan。只有证据不足、第三方正式字节冲突、需要审批或外部动作，或命中其他真实安全边界时，才停止整个用户任务；
   - 冲突、审批、人工裁决、权限和安全信号不得忽略；
   - 已经对齐后不得重复维护或重复写入；`refresh_ready_for_overview` 是checkpoint事实，由Agent决定是否为下一阶段请求普通完整Overview。

   维护完成后如果又修改了任何受管理对象，之前的维护结果失效，应在新的最终稳定状态重新完成收尾。

9. 用户只限制业务文件范围，但没有明确禁止仓库托管资产时，AOCI托管资产可以在收尾阶段为保持认知一致而更新，并应在审计和提交中与业务文件区分。

   用户明确禁止修改 `aoci.txt`、`.aoci`、元数据或任何额外文件时，以用户限制为准，不得写入，并如实报告剩余不一致。

### 专项流程

初始化、完整索引生成、Header生成、Entries生成、数据库结构索引、Curation、人工评审和故障恢复，只按当前AOCI Guide或工具在对应阶段返回的指令、命令和安全停点执行。

不预加载、不猜测，也不自行重建这些专项流程。平台调用方式、请求格式、批次上限、审批规则、索引格式细节和恢复步骤由对应Guide、工具说明、模型Prompt和CLI帮助按需提供。
<!-- aoci:end -->
