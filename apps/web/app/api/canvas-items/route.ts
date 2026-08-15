import { ensureDatabase, getD1 } from "@/db/bootstrap";

const clean = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 80) : "";
const number = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

async function bumpRevision(db: D1Database, canvasId: string) {
  const revision = Date.now();
  await db.prepare("UPDATE canvases SET revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(revision, canvasId).run();
  return revision;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const canvasId = clean(payload.canvasId);
    const assetId = clean(payload.assetId);
    if (!canvasId || !assetId) return Response.json({ error: "参数不完整" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    const membership = await db.prepare(`SELECT 1 FROM canvases c
      INNER JOIN project_assets pa ON pa.project_id = c.project_id
      WHERE c.id = ? AND pa.asset_id = ?`).bind(canvasId, assetId).first();
    if (!membership) return Response.json({ error: "素材不属于当前项目" }, { status: 409 });
    const count = await db.prepare("SELECT COUNT(*) AS count FROM canvas_items WHERE canvas_id = ?")
      .bind(canvasId).first<{ count: number }>();
    if ((count?.count ?? 0) >= 200) return Response.json({ error: "单个画板最多放置 200 个元素" }, { status: 409 });
    const id = crypto.randomUUID();
    const item = {
      id,
      canvasId,
      assetId,
      x: number(payload.x, 120, 0, 1880),
      y: number(payload.y, 100, 0, 1080),
      width: number(payload.width, 220, 80, 800),
      height: number(payload.height, 170, 60, 800),
      zIndex: number(payload.zIndex, (count?.count ?? 0) + 1, 0, 10000),
      rotation: number(payload.rotation, 0, -180, 180),
    };
    await db.prepare(`INSERT INTO canvas_items
      (id, canvas_id, asset_id, x, y, width, height, z_index, rotation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(item.id, item.canvasId, item.assetId, item.x, item.y, item.width, item.height, item.zIndex, item.rotation).run();
    const revision = await bumpRevision(db, canvasId);
    return Response.json({ item, revision }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "元素添加失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const id = clean(payload.id);
    const canvasId = clean(payload.canvasId);
    if (!id || !canvasId) return Response.json({ error: "参数不完整" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    const result = await db.prepare(`UPDATE canvas_items SET
      x = ?, y = ?, width = ?, height = ?, z_index = ?, rotation = ?
      WHERE id = ? AND canvas_id = ?`)
      .bind(
        number(payload.x, 0, 0, 1920), number(payload.y, 0, 0, 1120),
        number(payload.width, 220, 80, 900), number(payload.height, 170, 60, 900),
        number(payload.zIndex, 1, 0, 10000), number(payload.rotation, 0, -180, 180),
        id, canvasId,
      ).run();
    if (!result.meta.changes) return Response.json({ error: "元素不存在" }, { status: 404 });
    const revision = await bumpRevision(db, canvasId);
    return Response.json({ ok: true, revision });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "元素保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = clean(url.searchParams.get("id"));
    const canvasId = clean(url.searchParams.get("canvasId"));
    if (!id || !canvasId) return Response.json({ error: "参数不完整" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    await db.prepare("DELETE FROM canvas_items WHERE id = ? AND canvas_id = ?").bind(id, canvasId).run();
    const revision = await bumpRevision(db, canvasId);
    return Response.json({ ok: true, revision });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "元素删除失败" }, { status: 500 });
  }
}
