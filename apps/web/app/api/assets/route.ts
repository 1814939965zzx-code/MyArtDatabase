import { ensureDatabase, getD1 } from "@/db/bootstrap";
import { permanentlyDeleteResourceSpaceAsset, softDeleteResourceSpaceAsset, updateResourceSpaceMetadata } from "@/db/resourcespace";
import { getMediaBucket } from "@/db/storage";

const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const id = clean(payload.id, 80);
    if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
    const name = clean(payload.name, 120);
    const tags = clean(payload.tags, 800).split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20).join(",");
    const description = clean(payload.description, 2000);
    const notes = clean(payload.notes, 2000);
    const sourceUrl = clean(payload.sourceUrl, 1000);
    await ensureDatabase();
    const db = getD1();
    const current = await db.prepare(`SELECT external_id AS externalId, name, tags, description, notes,
      source_url AS sourceUrl FROM assets WHERE id = ? AND deleted_at IS NULL`).bind(id).first<{
        externalId: string | null; name: string; tags: string; description: string; notes: string; sourceUrl: string;
      }>();
    if (!current) return Response.json({ error: "素材不存在" }, { status: 404 });
    if (current.externalId) {
      await updateResourceSpaceMetadata(current.externalId, { name, tags, description, notes, sourceUrl });
    }
    const result = await db.prepare(`UPDATE assets SET name = ?, tags = ?, description = ?, notes = ?, source_url = ?
      WHERE id = ? AND deleted_at IS NULL`).bind(name, tags, description, notes, sourceUrl, id).run();
    if (!result.meta.changes && current.externalId) {
      await updateResourceSpaceMetadata(current.externalId, current).catch(() => undefined);
      return Response.json({ error: "素材保存失败" }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = clean(url.searchParams.get("id"), 80);
    const permanent = url.searchParams.get("mode") === "permanent";
    const force = url.searchParams.get("force") === "true";
    if (!id) return Response.json({ error: "缺少素材 ID" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    if (!permanent) {
      const asset = await db.prepare("SELECT external_id AS externalId FROM assets WHERE id = ? AND deleted_at IS NULL")
        .bind(id).first<{ externalId: string | null }>();
      if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
      if (asset.externalId) await softDeleteResourceSpaceAsset(asset.externalId);
      const result = await db.prepare("UPDATE assets SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").bind(id).run();
      if (!result.meta.changes) return Response.json({ error: "素材删除失败" }, { status: 500 });
      return Response.json({ ok: true, trashed: true });
    }
    const asset = await db.prepare(`SELECT external_id AS externalId, storage_key AS storageKey, thumbnail_key AS thumbnailKey,
      (SELECT COUNT(*) FROM project_assets WHERE asset_id = assets.id) AS referenceCount
      FROM assets WHERE id = ?`).bind(id).first<{ externalId: string | null; storageKey: string | null; thumbnailKey: string | null; referenceCount: number }>();
    if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
    if (asset.referenceCount > 0 && !force) return Response.json({ error: "素材仍被项目引用，不能彻底删除" }, { status: 409 });
    if (asset.externalId) await permanentlyDeleteResourceSpaceAsset(asset.externalId);
    await db.prepare("DELETE FROM assets WHERE id = ?").bind(id).run();
    if (!asset.externalId) {
      const bucket = getMediaBucket();
      const keys = [...new Set([asset.storageKey, asset.thumbnailKey].filter(Boolean) as string[])];
      await Promise.all(keys.map((key) => bucket.delete(key)));
    }
    return Response.json({ ok: true, permanent: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 });
  }
}
