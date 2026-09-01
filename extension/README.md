# 右键保存到素材库（Chrome 扩展）

在网页图片上右键，一键保存到 artDatabase 素材库。本目录为 Manifest V3 原生 JS 扩展，零构建链，本地 unpacked 加载即用。

## 安装（zip 安装包方式，推荐）

1. 拿到 `extension/release/artdb-extension-v0.1.0.zip`（或用 `extension/build.ps1` 重新打包）；
2. 解压到任意目录（如 `D:\artdb-extension`），确认该目录下有 `manifest.json`；
3. 打开 Chrome 访问 `chrome://extensions/`，右上角开启「开发者模式」；
4. 点「加载已解压的扩展程序」，选择**解压出的那个目录**（不是 zip）；
5. 点扩展的「详细信息 → 扩展程序选项」，填写服务器地址与插件令牌，测试连接后保存。

> 说明：Chrome 出于安全限制，**不允许双击安装非商店的 .crx/zip**（拖入 .crx 也会被拒绝）。zip 解压 + 「加载已解压的扩展程序」是本地/团队分发唯一可靠的安装方式；想要"双击即装、自动更新"只能上架 Chrome 网上应用店（需 $5 开发者账号 + 审核），或公司域内用组策略（GPO）静默部署。

## 使用

1. 在任意网页的图片上**右键** → 点「保存到素材库」；
2. 若素材库已有相同图片（SHA-256 完全重复）→ 页面角落 toast「已存在，未保存」，直接跳过；
3. 否则弹出确认面板：预览、选项目（记住上次）、编辑名称/标签/来源/备注，可选「AI 打标」；
4. 点「保存」→ 上传成功 toast「已保存到项目X」。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | MV3 声明：右键菜单、activeTab/scripting、`<all_urls>` 主机权限 |
| `background.js` | Service Worker：菜单注册与点击处理、图片下载/魔数校验/SHA-256/查重、全部网络请求代理（Bearer 令牌） |
| `content.js` | 内容脚本：确认面板与 toast（Shadow DOM 隔离样式）、blob: 图片代为获取、默认名称计算 |
| `options.html` / `options.js` | 设置页：服务器地址 + 令牌 + 测试连接 |

## 依赖的服务端能力

- 鉴权：`Authorization: Bearer <令牌>` 与 Cookie 会话等效（服务端需实现 `api_tokens` 体系，见 `requirements/EXTENSION.md`）；
- `POST /api/uploads/check`：查重（扩展以 `{sha256}` 调用，服务端 projectId 已放宽为可选）；
- `POST /api/uploads`：multipart 上传（file/projectId/name/tags/sourceUrl/notes）；
- `POST /api/uploads/ai-tags`：AI 打标建议（multipart file）；
- `GET /api/projects`、`GET /api/tags`：项目列表与标签字典。

## 边界

- 仅 `<img>` 元素可采集（右键菜单 `contexts: ["image"]`）；CSS 背景图、canvas、内嵌 SVG 不支持；
- 仅 JPEG / PNG / WebP，≤50MB（服务端硬限制一致）；GIF/SVG/AVIF 会提示不支持；
- `http(s):`、`data:`、`blob:` 图片均可采集；懒加载图片（`src` 为空）无法获取；
- 视频素材不在本次范围。
