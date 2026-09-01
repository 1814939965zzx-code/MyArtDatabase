# 右键保存到素材库（Chrome 扩展）

在网页图片/视频上右键，一键保存到 artDatabase 素材库。本目录为 Manifest V3 原生 JS 扩展，零构建链，本地 unpacked 加载即用。

## 安装（zip 安装包方式，推荐）

1. 拿到 `extension/release/artdb-extension-v0.1.0.zip`（或用 `extension/build.ps1` 重新打包）；
2. 解压到任意目录（如 `D:\artdb-extension`），确认该目录下有 `manifest.json`；
3. 打开 Chrome 访问 `chrome://extensions/`，右上角开启「开发者模式」；
4. 点「加载已解压的扩展程序」，选择**解压出的那个目录**（不是 zip）；
5. 点扩展的「详细信息 → 扩展程序选项」，填写服务器地址与插件令牌，测试连接后保存。

> 说明：Chrome 出于安全限制，**不允许双击安装非商店的 .crx/zip**（拖入 .crx 也会被拒绝）。zip 解压 + 「加载已解压的扩展程序」是本地/团队分发唯一可靠的安装方式；想要"双击即装、自动更新"只能上架 Chrome 网上应用店（需 $5 开发者账号 + 审核），或公司域内用组策略（GPO）静默部署。

## 使用

1. 在任意网页的**图片或视频**上**右键** → 点「保存到素材库」；
2. 若素材库已有相同文件（SHA-256 完全重复）→ 页面角落 toast「已存在，未保存」，直接跳过；
3. 否则弹出确认面板：图片显示预览（视频显示占位与大小）、选项目（记住上次）、编辑名称/标签/来源/备注，图片可选「AI 打标」（视频隐藏）；
4. 点「保存」→ 上传成功 toast「已保存到项目X」；视频上传后服务端自动转码为低码率 MP4（转码期间状态为"处理中"）。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | MV3 声明：右键菜单（图片/视频）、activeTab/scripting、`<all_urls>` 主机权限 |
| `background.js` | Service Worker：菜单注册与点击处理、图片/视频下载与魔数校验、SHA-256/查重、全部网络请求代理（Bearer 令牌） |
| `content.js` | 内容脚本：确认面板与 toast（Shadow DOM 隔离样式；图片预览/视频占位）、blob: 素材代为获取、默认名称计算 |
| `options.html` / `options.js` | 设置页：服务器地址 + 令牌 + 测试连接 |

## 依赖的服务端能力

- 鉴权：`Authorization: Bearer <令牌>` 与 Cookie 会话等效（服务端需实现 `api_tokens` 体系，见 `requirements/EXTENSION.md`）；
- `POST /api/uploads/check`：查重（扩展以 `{sha256}` 调用，服务端 projectId 已放宽为可选）；
- `POST /api/uploads`：multipart 上传（file/projectId/name/tags/sourceUrl/notes）；
- `POST /api/uploads/ai-tags`：AI 打标建议（multipart file）；
- `GET /api/projects`、`GET /api/tags`：项目列表与标签字典。

## 边界

- 仅 `<img>` 与 `<video>` 元素可采集（右键菜单 `contexts: ["image", "video"]`）；CSS 背景图、canvas、内嵌 SVG 不支持；
- 图片：JPEG/PNG/WebP/GIF/SVG/TIFF/HEIC/HEIF，≤50MB（魔数判定，与服务端 IMAGE_TYPES 一致）；
- 视频：mp4/webm/mov/mkv/avi/mpeg/3gp，≤200MB（魔数判定，与服务端 VIDEO_TYPES 一致）；上传后服务端异步转码；
- `http(s):`、`data:`、`blob:` 素材均可采集；懒加载元素（`src` 为空）无法获取；
- 视频不支持 AI 打标（与服务端一致）。
