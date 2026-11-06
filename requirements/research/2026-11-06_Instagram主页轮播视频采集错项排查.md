# Instagram 主页图片/视频采集错项排查

用户目标：直接在 Instagram 主页右键图片或视频，保存右键选中的那一项到素材库项目，不必先打开详情页。

## 现场证据（2026-11-06）

读取用户 Chrome 主页的实际 DOM，确认：

- 轮播 `ul` 自身宽度为 1px，前置一个无媒体的 1px 占位 `li`。
- 实际媒体项的 `li` 使用 `transform: translateX(index * width)` 定位，只挂载部分相邻项，不是完整列表。
- 例如 `/p/DfVD430CC1_/` 共4项，只挂载前2项：`ul.left=-37`、项宽468、第一项 `left=-37` / `translateX(0px)`、第二项 `left=431` / `translateX(468px)`。占位项为 `translateX(1871px); width:1px`。
- 主页视频 `src` 为 blob，`poster` 为空；因此第一版修复的封面匹配无法命中。
- 分页按钮有 `aria-label="Go to slide N"`，当前项有 `aria-current="step"`。
- 图像帖子也采用相同的占位、平移和部分挂载结构。视频封面 `<img>` 可能与 `<video>` 共存于同一项。

## 本机 Eagle 3.1.29 对照

只读检查本机已安装扩展 `lieogkinebikhdchceieedcigeafdkid/3.1.29_0`，没有修改 Eagle：

- `js/lib/context-saver.js` 记录右键目标；`js/lib/api/element-inspector.js` 优先从 `elementsFromPoint` 命中栈选媒体，支持临时覆盖 `pointer-events`。
- `plugins/instagram/instagram.js` 将视频标为可采集，通过所属 article / main 中的帖子链接获得短链，再调用 Instagram `/api/v1/media/{id}/info/`。
- 取 `items[0].video_versions[0].url`；轮播则使用 URL `img_index`，缺省为第一项。该版本并没有从主页布局推算任意轮播项的通用逻辑，不能简单照抄就保证用户目标。

## 原因与两轮修复

原实现直接将所有兄弟 `li` 的序号当作媒体序号，占位项会把第一项偏移到第二项；部分挂载列表也不能用局部序号代替全局位置。目标项没有视频时还会遍历其他项，失败后可能读整页元信息或扫描整页视频，导致串项。

第一版只排除了占位项、优先匹配 poster，并在证据不足时停止。它阻止了串项，但未覆盖真实主页中“无 poster + 部分挂载”的结构，用户因此遇到“无法确定位置”。第一轮模拟测试不足以代表真实主页可用。

当前修复：

- 以目标项相对列表原点的布局偏移 / 项宽计算全局序号，并验证接近整数；此路径针对现场确认的 translateX 布局，不依赖列表挂载项数。
- 缺少布局证据时可使用所属帖子的当前分页标记；仍保留封面、显式位置、完整列表及同帖详情页页码路径。
- 右键发生时固定目标、图片/视频直链及轮播证据，菜单点击或接口请求期间 DOM 变化不再重新选择相邻项。
- 命中栈里的媒体优先于容器后代；检查祖先 overflow 裁切和隐藏状态，排除不可见相邻项；只在同一项内把视频封面切换为视频。
- 无可靠定位或目标项无视频时继续明确失败，不恢复跨项回退。

## 验证与交付限制

扩展测试 `node --test extension/test/instagram-capture.test.mjs` 共24项通过。新增用例采用上述真实布局数值，覆盖无封面、部分挂载、占位、后续轮播项、分页标记、图片命中、祖先裁切、封面视频及右键后轮播切换。内容脚本和后台脚本通过语法检查。

已读取真实主页 DOM，但尚未在 Chrome 加载此次新版本后执行真实采集/上传。浏览器工具禁止访问 `chrome://extensions/`，没有绕过该限制。提供 0.1.3 安装包；需用户更新扩展文件、重新加载扩展并刷新 Instagram 后实测。

本会话没有可用 AOCI 工具，认知索引未同步。


## 0.1.3：滚动后视频被误判为不可采集

用户反馈图片可采集，视频提示“这里没有可保存的图片或视频”。再次读取真实 Chrome 主页，确认屏幕中的视频 `rect.top=110.25, bottom=695.25`，`elementsFromPoint` 包含该视频；但滚动根节点 HTML 的 `rect.top=-2271, bottom=-1329`。0.1.2 新增的祖先裁切检查把 HTML 的滚动后边界当成视口，因此排除了实际可见的视频。

修复仅跳过 `document.documentElement`、`document.body` 和 `document.scrollingElement` 的元素边界裁切判断，仍检查其隐藏状态以及普通祖先的轮播裁切。新增3项回归，覆盖真实滚动数值下从右键到视频解析、body 视口 overflow，以及仍拒绝被轮播容器裁切的相邻视频。该问题是新增过滤造成的回归，先前测试未覆盖滚动根节点。
