import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contentSource = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const backgroundSource = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const noop = () => {};
const rect = (left = 431, top = 288, width = 468, height = 468) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});
class FixtureElement {
  constructor(tagName, bounds = rect()) {
    this.tagName = tagName;
    this.bounds = bounds;
    this.isConnected = true;
    this.style = {};
    this.parentElement = null;
    this.children = [];
    this.attrs = {};
    this.css = { opacity: '1', display: 'block', visibility: 'visible', overflowX: 'visible', overflowY: 'visible' };
  }
  getBoundingClientRect() { return this.bounds; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  querySelectorAll() { return []; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest() { return null; }
}
function list(children, bounds = rect()) {
  const parent = new FixtureElement('UL', bounds);
  parent.children = children;
  for (const child of children) child.parentElement = parent;
  return parent;
}

function loadContent({ pathname = '/', search = '', carousel = [], beforeReply = noop, hitStack = [], documentRoot = null, documentBody = null } = {}) {
  const root = documentRoot || new FixtureElement('HTML');
  root.innerHTML = '"appId":"123"';
  root.appendChild = noop;
  const context = vm.createContext({
    window: { addEventListener: noop },
    chrome: { runtime: { onMessage: { addListener: noop } } },
    document: {
      documentElement: root,
      body: documentBody,
      scrollingElement: root,
      createElement: () => ({ remove: noop }),
      elementsFromPoint: () => hitStack,
    },
    Element: FixtureElement,
    getComputedStyle: (element) => element.css,
    location: { hostname: 'www.instagram.com', pathname, search, href: `https://www.instagram.com${pathname}${search}` },
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async () => {
      beforeReply();
      return { ok: true, json: async () => ({ items: [{ carousel_media: carousel }] }) };
    },
  });
  vm.runInContext(contentSource.replace(/\}\)\(\);\s*$/, `globalThis.api = {
    instagramShortcode, instagramCarouselTarget, instagramCarouselIndex, resolveInstagramVideo,
    mediaFromPoint, mediaContainsPoint, preferInstagramVideo, rememberPointer, resolveMedia
  }; })();`), context);
  return context.api;
}

function video({ poster = '', href = '/p/ABC/', slide = null, buttons = [], bounds = rect() } = {}) {
  const element = new FixtureElement('VIDEO', bounds);
  element.poster = poster;
  element.currentSrc = 'blob:https://www.instagram.com/example';
  element.src = element.currentSrc;
  element.parentElement = slide;
  element.closest = (selector) => selector === 'li' ? slide
    : selector === 'img, video, picture' ? element
    : selector === 'a[href]' ? null
    : { querySelector: () => ({ getAttribute: () => href }), querySelectorAll: () => buttons };
  return element;
}
function slide(hasMedia = true, { x = 431, transform = '' } = {}) {
  const element = new FixtureElement('LI', rect(x));
  element.style.transform = transform;
  element.querySelectorAll = () => hasMedia ? [{}] : [];
  return element;
}
function media(name, isVideo = true) {
  return {
    image_versions2: { candidates: [{ url: `https://cdn.example/${name}.jpg?signature=api` }] },
    video_versions: isVideo ? [{ url: `https://cdn.example/${name}.mp4`, width: 720, height: 1280 }] : [],
  };
}

test('主页轮播：按右键视频封面匹配，忽略虚拟化列表中的局部序号', async () => {
  const api = loadContent({ carousel: [media('first'), media('second'), media('third')] });
  const current = slide();
  list([slide(false), current, slide()]);
  const result = await api.resolveInstagramVideo(video({ poster: 'https://other-cdn.example/third.jpg?signature=dom', slide: current }));
  assert.equal(result, 'https://cdn.example/third.mp4');
});

test('完整轮播 DOM 排除占位 li，不能把第一项算成第二项', async () => {
  const api = loadContent({ carousel: [media('first'), media('second')] });
  const current = slide();
  list([slide(false), current, slide()]);
  assert.equal(await api.resolveInstagramVideo(video({ slide: current })), 'https://cdn.example/first.mp4');
});

test('无法定位时拒绝，不能默认第一项或取整组第一个视频', async () => {
  const api = loadContent({ carousel: [media('image', false), media('second')] });
  await assert.rejects(api.resolveInstagramVideo(video()), /无法确定.*位置/);
});

test('目标项没有视频时拒绝，不能保存下一项视频', async () => {
  const api = loadContent({ carousel: [media('first', false), media('second')] });
  await assert.rejects(api.resolveInstagramVideo(video({ poster: 'https://cdn.example/first.jpg' })), /选中的轮播项没有/);
});

test('详情页 img_index 仍可定位', async () => {
  const api = loadContent({ pathname: '/p/ABC/', search: '?img_index=2', carousel: [media('first'), media('second')] });
  assert.equal(await api.resolveInstagramVideo(video()), 'https://cdn.example/second.mp4');
});

test('封面匹配优先于陈旧的详情页页码', async () => {
  const api = loadContent({ pathname: '/p/ABC/', search: '?img_index=2', carousel: [media('first'), media('second')] });
  assert.equal(await api.resolveInstagramVideo(video({ poster: 'https://cdn.example/first.jpg' })), 'https://cdn.example/first.mp4');
});

test('右键所属帖子优先于当前页面路径，不能用其他帖子的页码', async () => {
  const api = loadContent({ pathname: '/p/XYZ/', search: '?img_index=2', carousel: [media('first'), media('second')] });
  assert.equal(api.instagramShortcode(video()), 'ABC');
  await assert.rejects(api.resolveInstagramVideo(video()), /无法确定/);
});

test('等待接口期间 DOM 切换不会改变已捕获的位置', async () => {
  const current = slide();
  const other = slide();
  list([current, other]);
  const api = loadContent({ carousel: [media('first'), media('second')], beforeReply: () => {
    current.parentElement.children = [other, current];
  } });
  assert.equal(await api.resolveInstagramVideo(video({ slide: current })), 'https://cdn.example/first.mp4');
});

function loadBackground(reply) {
  const requests = [];
  const context = vm.createContext({
    URL,
    chrome: {
      runtime: { onInstalled: { addListener: noop }, onStartup: { addListener: noop }, onMessage: { addListener: noop } },
      contextMenus: { removeAll: noop, onClicked: { addListener: noop } },
      tabs: { sendMessage: async (_, message) => { requests.push(message.type); return reply; } },
    },
  });
  vm.runInContext(backgroundSource, context);
  vm.runInContext('fetchAndDetect = async () => { throw new Error("download failed"); };', context);
  return { capture: (info) => context.captureFromContext(info, 1), requests };
}

for (const reply of [null, { ok: false, stopFallback: true }, { ok: true, kind: 'video', srcUrl: 'https://cdn.example/selected.mp4' }]) {
  test(`Instagram 目标解析/下载失败不能扫描整页视频：${JSON.stringify(reply)}`, async () => {
    const { capture, requests } = loadBackground(reply);
    const result = await capture({ pageUrl: 'https://www.instagram.com/', srcUrl: 'blob:example', mediaType: 'video' });
    assert.equal(result.capture, null);
    assert.deepEqual(requests, ['resolve-media']);
  });
}

// 2026-11-06 用户 Chrome 主页实测：无 poster，ul 宽 1px，前置占位 li，
// 第二项 left=431，ul left=-37，项宽468，只挂载第一和第二项，总项数4。
test('真实主页结构：无封面、4项仅挂载2项，按布局保存右键的第二个视频', async () => {
  const first = slide(true, { x: -37, transform: 'translateX(0px)' });
  const second = slide(true, { x: 431, transform: 'translateX(468px)' });
  list([slide(false, { x: 1834, transform: 'translateX(1871px)' }), first, second], rect(-37, 288, 1));
  const api = loadContent({ carousel: ['first', 'second', 'third', 'fourth'].map(name => media(name)) });
  assert.equal(await api.resolveInstagramVideo(video({ slide: second })), 'https://cdn.example/second.mp4');
});

test('真实主页结构：占位项在最前，第一项无封面也能保存，不会偏移到第二项', async () => {
  const first = slide(true, { x: 431, transform: 'translateX(0px)' });
  const next = slide(true, { x: 899, transform: 'translateX(468px)' });
  list([slide(false, { x: 3238, transform: 'translateX(2807px)' }), first, next], rect(431, 288, 1));
  const api = loadContent({ carousel: Array.from({ length: 6 }, (_, i) => media(`video-${i}`)) });
  assert.equal(await api.resolveInstagramVideo(video({ slide: first })), 'https://cdn.example/video-0.mp4');
});

test('后续项的全局位置不依赖只挂载的相邻项序号', async () => {
  const current = slide(true, { x: 431, transform: 'translateX(1872px)' });
  list([slide(false), slide(), current, slide()], rect(-1441, 288, 1));
  const api = loadContent({ carousel: Array.from({ length: 8 }, (_, i) => media(`video-${i}`)) });
  assert.equal(await api.resolveInstagramVideo(video({ slide: current })), 'https://cdn.example/video-4.mp4');
});

test('主页缺少布局信息时，读取所属帖子的 aria-current 分页标记', async () => {
  const buttons = [1, 2, 3, 4].map(i => ({
    getAttribute: (name) => name === 'aria-label' ? `Go to slide ${i}` : i === 3 ? 'step' : null,
  }));
  const api = loadContent({ carousel: ['first', 'second', 'third', 'fourth'].map(name => media(name)) });
  assert.equal(await api.resolveInstagramVideo(video({ buttons })), 'https://cdn.example/third.mp4');
});

function image(url, bounds = rect()) {
  const element = new FixtureElement('IMG', bounds);
  element.currentSrc = url;
  element.attrs.src = url;
  element.closest = selector => selector === 'img, video, picture' ? element : null;
  return element;
}

test('图片：祖先容器含视频时优先命中栈中的图片，不跨项选择视频', () => {
  const selected = image('https://cdn.example/current.jpg');
  const otherVideo = video();
  const overlay = new FixtureElement('DIV');
  overlay.querySelectorAll = () => [otherVideo, selected];
  const api = loadContent({ hitStack: [overlay, selected] });
  assert.equal(api.mediaFromPoint(650, 500), selected);
});

test('图片：被祖先裁切的相邻项，即使 bounding rect 覆盖右键点也不能被选中', () => {
  const selected = image('https://cdn.example/current.jpg');
  const clipped = image('https://cdn.example/neighbor.jpg');
  const viewport = new FixtureElement('DIV', rect(0, 0, 100, 100));
  viewport.css.overflowX = 'hidden';
  viewport.css.overflowY = 'hidden';
  clipped.parentElement = viewport;
  const overlay = new FixtureElement('DIV');
  overlay.querySelectorAll = () => [clipped, selected];
  const api = loadContent({ hitStack: [overlay] });
  assert.equal(api.mediaFromPoint(650, 500), selected);
});

test('图片：右键后页面切换轮播，仍保存右键时的图片地址', async () => {
  const selected = image('https://cdn.example/first.jpg');
  const api = loadContent({ hitStack: [selected] });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  selected.currentSrc = 'https://cdn.example/second.jpg';
  const result = await api.resolveMedia();
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'image');
  assert.equal(result.srcUrl, 'https://cdn.example/first.jpg');
});

test('视频：右键时固定布局，菜单点击前轮播切换也不改变采集项', async () => {
  const first = slide(true, { x: 431, transform: 'translateX(0px)' });
  const next = slide(true, { x: 899, transform: 'translateX(468px)' });
  list([slide(false), first, next], rect(431, 288, 1));
  const selected = video({ slide: first });
  const api = loadContent({ hitStack: [selected], carousel: [media('first'), media('second'), media('third')] });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  first.bounds = rect(899);
  first.style.transform = 'translateX(468px)';
  const result = await api.resolveMedia();
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'video');
  assert.equal(result.srcUrl, 'https://cdn.example/first.mp4');
});

test('图片轮播项不能被其他项的视频替换', () => {
  const selected = image('https://cdn.example/current.jpg');
  const ownSlide = slide();
  ownSlide.querySelectorAll = () => [];
  selected.closest = selector => selector === 'li' ? ownSlide : selected;
  assert.equal(loadContent().preferInstagramVideo(selected, 650, 500), selected);
});

test('同一轮播项的可见视频封面仍解析为视频', () => {
  const selected = image('https://cdn.example/poster.jpg');
  const ownSlide = slide();
  const ownVideo = video({ slide: ownSlide });
  ownSlide.querySelectorAll = () => [ownVideo];
  selected.closest = selector => selector === 'li' ? ownSlide : selected;
  assert.equal(loadContent().preferInstagramVideo(selected, 650, 500), ownVideo);
});


// 用户主页实际数值：HTML rect.top=-2271、bottom=-1329，视频仍在 y=110..695。
// 根节点滚动裁切采用视口，而不是 HTML 自身已经移出屏幕的边界。
test('滚动后的主页：根节点 rect 已移出视口，可见视频仍能从右键解析', async () => {
  const root = new FixtureElement('HTML', rect(0, -2271, 1713, 942));
  root.css.overflowX = 'auto';
  root.css.overflowY = 'scroll';
  const selected = video({ poster: 'https://cdn.example/selected.jpg', bounds: rect(431, 110, 468, 585) });
  selected.parentElement = root;
  const api = loadContent({ documentRoot: root, hitStack: [selected], carousel: [media('selected')] });
  assert.equal(api.mediaFromPoint(665, 402), selected);
  api.rememberPointer({ target: selected, clientX: 665, clientY: 402 });
  const result = await api.resolveMedia();
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'video');
  assert.equal(result.srcUrl, 'https://cdn.example/selected.mp4');
});

test('body 的视口 overflow 也不按滚动后的元素 rect 裁切视频', () => {
  const body = new FixtureElement('BODY', rect(0, -2271, 1713, 942));
  body.css.overflowY = 'auto';
  const selected = video();
  selected.parentElement = body;
  const api = loadContent({ documentBody: body, hitStack: [selected] });
  assert.equal(api.mediaFromPoint(650, 500), selected);
});

test('跳过根节点滚动边界后，仍拒绝真正被轮播容器裁切的视频', () => {
  const root = new FixtureElement('HTML', rect(0, -2271, 1713, 942));
  root.css.overflowY = 'scroll';
  const viewport = new FixtureElement('DIV', rect(431, 100, 468, 585));
  viewport.css.overflowX = 'hidden';
  viewport.parentElement = root;
  const neighbor = video({ bounds: rect(899, 100, 468, 585) });
  neighbor.parentElement = viewport;
  const api = loadContent({ documentRoot: root });
  assert.equal(api.mediaContainsPoint(neighbor, 1133, 392), false);
});

function postImage({ href = '/p/POST_A/', currentSlide = null } = {}) {
  const selected = image('https://cdn.example/selected.jpg');
  const article = {
    querySelector: () => ({ getAttribute: () => href }),
    querySelectorAll: () => [],
  };
  selected.parentElement = currentSlide;
  selected.closest = selector => selector === 'img, video, picture' ? selected
    : selector === 'li' ? currentSlide
    : selector === 'a[href]' ? null
    : selector === 'article, div[role="dialog"]' ? article : null;
  return selected;
}

test('主页图片来源使用所属帖子 URL，无需额外接口请求', async () => {
  const selected = postImage({ href: '/p/POST_A/?utm_source=feed' });
  const api = loadContent({ hitStack: [selected], beforeReply: () => { throw new Error('图片不应增加接口请求'); } });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  assert.equal((await api.resolveMedia()).pageUrl, 'https://www.instagram.com/p/POST_A/');
});

test('主页轮播图片来源带右键项的 img_index', async () => {
  const current = slide(true, { x: 431, transform: 'translateX(468px)' });
  list([slide(false), slide(), current], rect(-37, 288, 1));
  const selected = postImage({ currentSlide: current });
  const api = loadContent({ hitStack: [selected] });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  assert.equal((await api.resolveMedia()).pageUrl, 'https://www.instagram.com/p/POST_A/?img_index=2');
});

test('主页 blob 视频来源使用当前项的帖子 URL 和解析后的轮播页码', async () => {
  const selected = video({ href: '/p/VIDEO_POST/', poster: 'https://cdn.example/second.jpg' });
  const api = loadContent({ hitStack: [selected], carousel: [media('first'), media('second')] });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  const result = await api.resolveMedia();
  assert.equal(result.srcUrl, 'https://cdn.example/second.mp4');
  assert.equal(result.pageUrl, 'https://www.instagram.com/p/VIDEO_POST/?img_index=2');
});

test('Reel 直链视频也保存具体 Reel 地址，不能回退成主页', async () => {
  const selected = video({ href: '/reels/REEL_POST/' });
  selected.currentSrc = selected.src = 'https://cdn.example/selected.mp4';
  const api = loadContent({ hitStack: [selected] });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  assert.equal((await api.resolveMedia()).pageUrl, 'https://www.instagram.com/reel/REEL_POST/');
});

test('详情页路径与素材所属帖子不同时，来源指向右键所属帖子', async () => {
  const selected = postImage({ href: '/p/SELECTED_POST/' });
  const api = loadContent({ pathname: '/p/OTHER_POST/', search: '?img_index=3', hitStack: [selected] });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  assert.equal((await api.resolveMedia()).pageUrl, 'https://www.instagram.com/p/SELECTED_POST/');
});

test('菜单打开后帖子容器变化，不改变右键时记录的图片来源', async () => {
  const selected = postImage({ href: '/p/ORIGINAL/' });
  const api = loadContent({ hitStack: [selected] });
  api.rememberPointer({ target: selected, clientX: 650, clientY: 500 });
  const originalClosest = selected.closest;
  selected.closest = selector => selector === 'article, div[role="dialog"]'
    ? { querySelector: () => ({ getAttribute: () => '/p/CHANGED/' }), querySelectorAll: () => [] }
    : originalClosest(selector);
  assert.equal((await api.resolveMedia()).pageUrl, 'https://www.instagram.com/p/ORIGINAL/');
});
