# Chrome 扩展「右键保存到素材库」需求确认书

> 状态：已实现（2026-09-01 起，图片 + 视频）。
> 本文档是扩展功能的唯一需求入口；实现完成后把生效规则并入 `CURRENT.md`，并在 `CHANGELOG.md` 顶部加一行摘要。
> 实现事实与本文档冲突时，以可运行代码为准并回写本文档。

## 1. 产品定位

类似 Eagle 的浏览器采集能力，但**只做右键菜单采集**这一个入口：

- **做**：网页图片/视频上右键 →「保存到素材库」→ 确认面板（选项目、填标签等）→ 上传到 artDatabase（视频上传后服务端异步转码）。
- **明确不做**（用户拍板）：拖拽采集（与 Eagle 桌面端冲突，暂缓）、悬停元素出现保存按钮、框选区域截图、保存页面全部素材（批量）、多服务器配置、系统通知、Chrome 商店上架（本地 unpacked 加载）。

## 2. 用户流程

```
网页图片/视频上右键
  → 菜单「保存到素材库」（仅图片/视频元素上出现）
  → 扩展下载素材（Service Worker 侧 fetch，绕过页面 CORS）
  → 魔数校验格式与大小（图片 ≤50MB / 视频 ≤200MB）
  → POST /api/uploads/check（SHA-256）查重
      ├─ 重复 → 页面内 toast「已存在，未保存」，流程结束（不弹面板）
      └─ 不重复 → 当前页面注入浮动确认面板
            → 用户选项目、编辑标签/名称/来源/备注、（图片可）AI 打标
            → 保存 → POST /api/uploads（multipart，带 Bearer 令牌）
                  ├─ 成功 → toast「已保存到项目X」，关闭面板
                  ├─ 409 重复（竞态兜底）→ toast「已存在，未保存」
                  └─ 失败 → toast 失败原因
```

## 3. 确认面板规格

- **形态**：内容脚本注入的浮动面板（Shadow DOM 隔离样式），展示在右键素材附近/页面中央，可关闭（取消/关闭/遮罩/Esc 均可）。
- **必选字段**：项目下拉（数据来自 `GET /api/projects`，默认记住上次使用的项目 `lastProjectId`，存 chrome.storage.local；加载失败显示错误并可点重试）。
- **可编辑字段**（全部可改，默认值自动填充）：
  - 名称：默认取图片 `alt` → `title` → 文件名（去扩展名）→「未命名-时间戳」；截断 120 字符（服务端上限）。
  - 标签：逗号分隔输入框；从 `GET /api/tags` 拉标签字典做联想；上限 50 个。
  - 来源链接：默认当前页面 URL，可编辑（仅允许 http/https）。
  - 备注：空。
- **预览**：图片显示缩略预览（字节经消息通道由后台下发，本地构建 Blob）；视频只显示占位（🎬 + 大小 + "上传后自动转码"），**不跨上下文传大字节**。
- **AI 打标按钮**：仅图片显示（调用 `POST /api/uploads/ai-tags`，建议标签合并进标签框，不提前落库）；**视频隐藏**（服务端拒绝视频打标）。
- 取消/关闭面板 = 放弃本次采集，不产生任何记录，并通知后台释放会话。

## 4. 认证方案（服务端 + 扩展）

**背景**：现有会话为 HttpOnly + SameSite=Lax Cookie，扩展从任意网页向服务器发请求属跨站，Cookie 不会自动携带且扩展读不到 HttpOnly cookie，故必须令牌认证。

**服务端改动**：

- 新表 `api_tokens`：`id`、`user_id`、`name`（备注，可空）、`token_hash`（只存哈希，不存明文）、`created_at`、`last_used_at`、`revoked_at`。
- 登录用户（管理员与成员均可，令牌绑定本人账号）在「账号设置」新增「插件令牌」管理：生成（明文仅展示一次，可填备注）、列表（备注/创建时间/最后使用时间）、吊销。
- 新增接口（沿用 `/api/auth/*` 命名空间，走 Cookie 会话鉴权）：列出 / 生成 / 吊销令牌。
- 鉴权层：除公开接口（health/announcement/auth/status 等）外，`Authorization: Bearer <token>` 与 Cookie 会话等效；令牌校验通过后，请求身份为该令牌所属用户（上传 `created_by` 正确落账），并在 `last_used_at` 打点。已吊销/失效令牌返回 401。
- 令牌无过期时间，只能吊销（MVP 从简）。

**扩展侧**：

- 设置页（options）：服务器地址（默认 `http://localhost:3000`，可改局域网地址）+ 令牌输入 +「测试连接」按钮。
- 令牌与地址存 `chrome.storage.local`。
- 未配置地址/令牌时点击右键菜单 → toast 提示去设置页（toast 内「去设置」按钮可直接打开设置页）。

## 5. 服务端 API 契约（扩展实际使用的现有接口）

| 接口 | 方法 | 请求 | 响应要点 |
| --- | --- | --- | --- |
| `/api/uploads/check` | POST | JSON `{ sha256 }`（projectId 可选） | `{ duplicates: [{ id, name, fileName, thumbnailUrl, inProject }] }` |
| `/api/uploads` | POST | multipart `file/projectId/name/description/notes/sourceUrl/tags/allowDuplicate/dimensionValues` | 201 `{ asset }`；409 `{ error, duplicate }`；400 格式/大小不符；视频返回 `transcodeStatus: "processing"` |
| `/api/uploads/ai-tags` | POST | multipart `file` | `{ ok, ...建议标签 }`（仅图片） |
| `/api/projects` | GET | — | `{ projects: [{ id, name, description, assetCount, dimensionCount, thumbnails }] }` |
| `/api/tags` | GET | — | `{ tags: [...] }`（标签字典，按使用次数排序） |

## 6. 扩展架构（Manifest V3，原生 JS 零构建）

放在当前仓库 `extension/` 目录：

- `manifest.json`：MV3；`permissions: ["contextMenus", "storage", "activeTab", "scripting"]`；`host_permissions: ["<all_urls>"]`（下载任意网页素材 + 访问任意服务器地址）；`background.service_worker`；`options_page`。
- `background.js`（Service Worker）：
  - 注册右键菜单（`contexts: ["image", "video"]`，单选项「保存到素材库」）；
  - 点击处理：从 `info.srcUrl` 取素材 → fetch 下载 → 魔数校验（图片 JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC/HEIF ≤50MB；视频 mp4/webm/mov/mkv/avi/mpeg/3gp ≤200MB）→ SHA-256（WebCrypto）→ 查重 → 不重复则派发确认面板；
  - **采集会话**：图片/视频字节保留在 SW 内存会话表（10 分钟 TTL，关面板或上传后释放），内容脚本只收元数据（图片附带字节做预览），**不经消息通道传 Blob**（Blob 跨上下文传递不可靠）；
  - 上传、AI 打标、拉取项目/标签列表等全部网络请求都在 SW 发起（带 Bearer 令牌），内容脚本不直接碰网络。
- `content.js`：注入 Shadow DOM 确认面板与 toast；协助获取 blob: 素材；与 SW 用 `chrome.runtime.sendMessage` 通信（带 12 秒超时兜底）。
- `options.js` / `options.html`：服务器地址 + 令牌 + 测试连接。
- 所有通信均带令牌；内容脚本 UI 不接触网络。

**数据流要点**：素材只下载一次——SW 持有字节（查重/上传/AI 打标都从 SW 会话取），图片预览字节随 show-panel 下发，视频不传大字节只显示占位。

## 7. 边界与限制

- **仅 `<img>` / `<video>` 元素**：`contexts: ["image", "video"]` 天然限定；CSS 背景图、`<canvas>`、内嵌 SVG 不支持。
- **图片格式**：JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC/HEIF，≤50MB（魔数判定，与服务端 `IMAGE_TYPES` 一致）。
- **视频格式**：mp4/webm/mov/mkv/avi/mpeg/3gp，≤200MB（魔数判定，与服务端 `VIDEO_TYPES` 一致）；上传后服务端异步转码为低码率 MP4（`processing` → `ready`/`failed`）；视频不支持 AI 打标。
- **URL 形态**：`http(s):`、`blob:`、`data:` 都尽力支持（SW fetch；blob: 由内容脚本代为获取）；懒加载元素（`src` 为空）无法获取。
- **下载失败**（防盗链/跨域/网络）→ toast 原因。
- **竞态兜底**：上传时仍可能 409（查重与上传之间被他人抢先），按重复处理 toast「已存在，未保存」。
- **多用户**：令牌绑定个人账号，上传归属本人；任何登录用户均可生成自己的令牌。

## 8. 交付顺序

1. **服务端令牌体系**：`api_tokens` 表 + CRUD 接口 + 鉴权层支持 Bearer + 账号设置 UI（含 `npm run typecheck` / `npm test` 覆盖）。✅ 已完成（2026-09-01，v7 迁移）
2. **扩展骨架**：manifest + SW 右键菜单 + options 页（地址/令牌/测试连接）。✅ 已完成
3. **采集闭环（图片）**：下载 → 查重 → toast 跳过 / 面板 → 上传 → 成功 toast。✅ 已完成
4. **面板完善**：项目记忆、标签联想、AI 打标、字段编辑、预览。✅ 已完成
5. **扩展图片格式与视频**：GIF/SVG/TIFF/HEIC/HEIF 魔数校验（随服务端 37d2e95 同步）+ 视频采集（`contexts:["video"]`、视频魔数、200MB 上限、面板占位、隐藏 AI 打标）。✅ 已完成（2026-09-01）
6. 跨层验证：`npm run typecheck` ✅ / `npm test` ✅ / `npm run build` ✅，扩展手工验收（见下）。

## 9. 扩展手工验收清单

- [ ] `chrome://extensions` 开发者模式加载 `extension/`，无 manifest 报错；
- [ ] 设置页填 `http://localhost:3000` + 令牌，「测试连接」显示当前身份；
- [ ] 网页端「账号设置 → 插件令牌」：生成（明文仅显示一次）→ 列表出现 → 吊销后列表消失；
- [ ] 在任意网页图片上右键 →「保存到素材库」→ 面板弹出，预览正确；
- [ ] 重复采集同一张图：不弹面板，toast「已存在，未保存」；
- [ ] 选择项目 + 填标签 + 改名称/来源/备注 → 保存 → toast「已保存到项目X」，素材库出现该图且来源链接=页面 URL；
- [ ] 下次打开面板默认选中上次项目；
- [ ] 点「AI 打标」→ 建议标签合并进标签框（未配置 AI 服务时显示明确错误）；
- [ ] 右键 GIF/SVG/TIFF/HEIC 图片 → 正常进入面板并可保存；
- [ ] 在网页 `<video>` 上右键 →「保存到素材库」→ 面板显示视频占位（🎬 + 大小），无 AI 打标按钮；
- [ ] 保存视频 → 上传成功 toast；素材库中该视频转码完成后可播放（转码期间显示"处理中"）；
- [ ] 视频 >200MB / 图片 >50MB → toast 超限提示；
- [ ] 篡改令牌后右键 → toast「令牌无效或已过期」且可点「去设置」；
- [ ] 网页端登录过期/退出不影响扩展（令牌独立）——令牌仍可用；吊销后 401。
