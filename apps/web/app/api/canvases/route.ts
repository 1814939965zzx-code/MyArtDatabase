import { ensureDatabase, getD1 } from "@/db/bootstrap";

type CanvasRow = { id: string; projectId: string; name: string; revision: number; itemCount: number };
const clean = (value: unknown, max = 80) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function GET(request: Request) {
  try {
    const projectId = clean(new URL(request.url).searchParams.get("projectId"));
    if (!projectId) return Response.json({ error: "缺少项目 ID" }, { status: 400 });
    await ensureDatabase();
    const rows = await getD1().prepare(`SELECT c.id, c.project_id AS projectId, c.name, c.revision,
      COUNT(ci.id) AS itemCount FROM canvases c
      LEFT JOIN canvas_items ci ON ci.canvas_id = c.id
      WHERE c.project_id = ? GROUP BY c.id ORDER BY c.updated_at DESC`)
      .bind(projectId).all<CanvasRow>();
    return Response.json({ canvases: rows.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "画板载入失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { projectId?: unknown; name?: unknown };
    const projectId = clean(payload.projectId);
    const name = clean(payload.name, 50) || "未命名画板";
    if (!projectId) return Response.json({ error: "缺少项目 ID" }, { status: 400 });
    await ensureDatabase();
    const db = getD1();
    const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
    if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
    const id = crypto.randomUUID();
    const revision = Date.now();
    await db.prepare("INSERT INTO canvases (id, project_id, name, revision) VALUES (?, ?, ?, ?)")
      .bind(id, projectId, name, revision).run();
    return Response.json({ canvas: { id, projectId, name, revision, itemCount: 0 } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "画板创建失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as { id?: unknown; name?: unknown };
    const id = clean(payload.id);
    const name = clean(payload.name, 50);
    if (!id || !name) return Response.json({ error: "参数不完整" }, { status: 400 });
    await ensureDatabase();
    const revision = Date.now();
    const result = await getD1().prepare("UPDATE canvases SET name = ?, revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(name, revision, id).run();
    if (!result.meta.changes) return Response.json({ error: "画板不存在" }, { status: 404 });
    return Response.json({ canvas: { id, name, revision } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "画板保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = clean(new URL(request.url).searchParams.get("id"));
    if (!id) return Response.json({ error: "缺少画板 ID" }, { status: 400 });
    await ensureDatabase();
    const result = await getD1().prepare("DELETE FROM canvases WHERE id = ?").bind(id).run();
    if (!result.meta.changes) return Response.json({ error: "画板不存在" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "画板删除失败" }, { status: 500 });
  }
}
