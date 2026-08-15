import { ensureDatabase, getD1 } from "@/db/bootstrap";
import { restoreResourceSpaceAsset } from "@/db/resourcespace";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { id?: unknown };
    const id = typeof payload.id === "string" ? payload.id.trim().slice(0, 80) : "";
    if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    const asset = await db.prepare("SELECT external_id AS externalId FROM assets WHERE id = ? AND deleted_at IS NOT NULL")
      .bind(id).first<{ externalId: string | null }>();
    if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
    if (asset.externalId) await restoreResourceSpaceAsset(asset.externalId);
    const result = await db.prepare("UPDATE assets SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL").bind(id).run();
    if (!result.meta.changes) return Response.json({ error: "素材不存在" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "恢复失败" }, { status: 500 });
  }
}
