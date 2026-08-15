import { ensureDatabase, getD1 } from "@/db/bootstrap";

type CanvasRow = { id: string; projectId: string; name: string; revision: number };
type CanvasItemRow = {
  id: string;
  canvasId: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation: number;
  name: string;
  thumbnailUrl: string | null;
};

export async function GET(request: Request) {
  try {
    const canvasId = new URL(request.url).searchParams.get("canvasId")?.trim();
    if (!canvasId) return Response.json({ error: "缺少画板 ID" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    const [canvas, items] = await Promise.all([
      db.prepare("SELECT id, project_id AS projectId, name, revision FROM canvases WHERE id = ?")
        .bind(canvasId).first<CanvasRow>(),
      db.prepare(`SELECT ci.id, ci.canvas_id AS canvasId, ci.asset_id AS assetId,
        ci.x, ci.y, ci.width, ci.height, ci.z_index AS zIndex, ci.rotation,
        a.name, CASE WHEN a.external_id IS NOT NULL OR a.thumbnail_key IS NOT NULL
          THEN '/api/media?id=' || a.id || '&variant=thumbnail' ELSE a.thumbnail_url END AS thumbnailUrl
        FROM canvas_items ci INNER JOIN assets a ON a.id = ci.asset_id
        WHERE ci.canvas_id = ? AND a.deleted_at IS NULL ORDER BY ci.z_index, ci.id`)
        .bind(canvasId).all<CanvasItemRow>(),
    ]);
    if (!canvas) return Response.json({ error: "画板不存在" }, { status: 404 });
    return Response.json({ canvas, items: items.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "画板载入失败" }, { status: 500 });
  }
}
