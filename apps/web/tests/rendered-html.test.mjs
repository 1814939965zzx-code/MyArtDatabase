import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Art Database application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Art Database · 视觉素材工作台<\/title>/i);
  assert.match(html, /Art Database/);
  assert.match(html, /视觉素材工作台/);
  assert.match(html, /正在整理素材库/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("wires upload, preview, board, and server persistence capabilities", async () => {
  const [schema, dimensionRoute, preview, hosting, packageJson, resourceSpace, uploadRoute, mediaRoute, app, nextConfig] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dimensions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/DimensionPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../db/resourcespace.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/uploads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ArtDatabaseApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /value.*>= 0 AND.*<= 1000/s);
  assert.match(schema, /export const canvases/);
  assert.match(schema, /export const canvasItems/);
  assert.doesNotMatch(dimensionRoute, /sortOrder >= 3|最多设置 3 个维度/);
  assert.match(preview, /current\.length >= 3/);
  assert.match(preview, /最多同时使用 3 个/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "MEDIA"/);
  assert.match(resourceSpace, /RS_BASE_URL/);
  assert.match(resourceSpace, /createResourceSpaceAsset/);
  assert.match(resourceSpace, /permanentlyDeleteResourceSpaceAsset/);
  assert.match(uploadRoute, /createResourceSpaceAsset/);
  assert.match(uploadRoute, /external_id/);
  assert.match(mediaRoute, /fetchResourceSpaceMedia/);
  assert.match(uploadRoute, /50 \* 1024 \* 1024/);
  assert.match(app, /50 \* 1024 \* 1024/);
  assert.match(nextConfig, /bodySizeLimit: "55mb"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
  await access(new URL("../drizzle/0000_sticky_malice.sql", import.meta.url));
  await access(new URL("../drizzle/0001_amazing_post.sql", import.meta.url));
  await access(new URL("../app/api/uploads/route.ts", import.meta.url));
  await access(new URL("../app/api/canvas-items/route.ts", import.meta.url));
  await access(appRoot);
});

test("supports camera-facing 3D assets and direct coordinate editing", async () => {
  const [preview, app, css] = await Promise.all([
    readFile(new URL("../app/DimensionPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ArtDatabaseApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(preview, /event\.button !== 1/);
  assert.match(preview, /wrapRotation\(active\.rotateZ - dx \* \.24\)/);
  assert.match(preview, /min="0" max="360"/);
  assert.match(preview, /Math\.max\(0, Math\.min\(180, active\.rotateX - dy \* \.24\)\)/);
  assert.match(preview, /min="0" max="180"/);
  assert.match(preview, /onUpdateAssetDimensions/);
  assert.match(preview, /event\.shiftKey/);
  assert.match(preview, /coordinate-axis-z/);
  assert.match(preview, /--billboard-rx/);
  assert.match(preview, /focusMode/);
  assert.doesNotMatch(preview, /requestFullscreen|exitFullscreen|fullscreenElement/);
  assert.match(preview, /onWheel=\{zoomWithWheel\}/);
  assert.match(preview, /unprojectPointerToPlane/);
  assert.match(preview, /grabOffsetX/);
  assert.match(preview, /gridTicks/);
  assert.match(preview, /xy-grid-plane/);
  assert.match(app, /sidebarCollapsed/);
  assert.match(css, /\.preview-asset-face[^}]*rotateZ\(var\(--billboard-rz\)\)[^}]*rotateX\(var\(--billboard-rx\)\)/s);
  assert.match(css, /\.scene-plane[^}]*background:\s*transparent/s);
  assert.match(css, /\.scene-plane[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.preview-asset[^}]*pointer-events:\s*auto/s);
  assert.match(css, /\.scene-plane[^}]*--scene-size:\s*min\(76cqw, 70cqh\)[^}]*width:\s*var\(--scene-size\)[^}]*height:\s*var\(--scene-size\)/s);
  assert.match(css, /\.coordinate-axis-z[^}]*rotateY\(90deg\)/s);
  assert.match(css, /\.xy-grid-plane/);
  assert.match(css, /\.grid-line-x/);
  assert.match(css, /\.preview-layout\.focus-mode/);
  assert.match(css, /\.app-shell\.sidebar-hidden \.sidebar/);
});

test("supports global asset management and multi-project references", async () => {
  const [libraryView, libraryRoute, assetRoute, projectAssetRoute, app] = await Promise.all([
    readFile(new URL("../app/AllAssetsView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/library/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/project-assets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ArtDatabaseApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(app, /全部素材/);
  assert.match(app, /activeArea === "library"/);
  assert.match(libraryView, /全局素材预览/);
  assert.match(libraryView, /mode=permanent&force=true/);
  assert.match(libraryView, /projectIds: selectedProjectIds/);
  assert.match(libraryRoute, /FROM assets a/);
  assert.match(libraryRoute, /FROM project_assets pa/);
  assert.match(assetRoute, /referenceCount > 0 && !force/);
  assert.match(projectAssetRoute, /Array\.isArray\(payload\.projectIds\)/);
});
