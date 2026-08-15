import { ensureDatabase, getD1 } from "@/db/bootstrap";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { projectId?: unknown; projectIds?: unknown; assetId?: unknown };
    const projectIds = Array.isArray(payload.projectIds)
      ? [...new Set(payload.projectIds.map(clean).filter(Boolean))]
      : [clean(payload.projectId)].filter(Boolean);
    const assetId = clean(payload.assetId);
    if (!projectIds.length || !assetId) return Response.json({ error: "参数不完整" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    const asset = await db.prepare("SELECT id FROM assets WHERE id = ? AND deleted_at IS NULL").bind(assetId).first();
    if (!asset) return Response.json({ error: "素材不存在" }, { status: 404 });
    const projects = await db.prepare(`SELECT id FROM projects WHERE id IN (${projectIds.map(() => "?").join(",")})`)
      .bind(...projectIds).all<{ id: string }>();
    if (projects.results.length !== projectIds.length) {
      return Response.json({ error: "部分项目不存在，请刷新后重试" }, { status: 404 });
    }
    const dimensionResults = await Promise.all(projectIds.map((projectId) =>
      db.prepare("SELECT id FROM project_dimensions WHERE project_id = ?").bind(projectId).all<{ id: string }>(),
    ));
    const statements = projectIds.flatMap((projectId, index) => [
      db.prepare("INSERT OR IGNORE INTO project_assets (project_id, asset_id) VALUES (?, ?)").bind(projectId, assetId),
      ...dimensionResults[index].results.map(({ id }) => db.prepare(`INSERT OR IGNORE INTO asset_dimension_values
        (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, 500)`).bind(projectId, assetId, id)),
      db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId),
    ]);
    await db.batch(statements);
    return Response.json({ ok: true, projectCount: projectIds.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "添加失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get("projectId"));
    const assetId = clean(url.searchParams.get("assetId"));
    if (!projectId || !assetId) return Response.json({ error: "参数不完整" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    await db.batch([
      db.prepare("DELETE FROM project_assets WHERE project_id = ? AND asset_id = ?").bind(projectId, assetId),
      db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "移除失败" }, { status: 500 });
  }
}
