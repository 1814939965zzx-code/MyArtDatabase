import { ensureDatabase, getD1 } from "@/db/bootstrap";

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return Response.json({ error: message }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      projectId?: unknown;
      leftLabel?: unknown;
      rightLabel?: unknown;
    };
    const projectId = cleanText(payload.projectId, 80);
    const leftLabel = cleanText(payload.leftLabel, 24);
    const rightLabel = cleanText(payload.rightLabel, 24);
    if (!projectId || !leftLabel || !rightLabel) {
      return Response.json({ error: "请填写维度两端的名称" }, { status: 400 });
    }
    if (leftLabel === rightLabel) {
      return Response.json({ error: "维度两端不能相同" }, { status: 400 });
    }

    await ensureDatabase();
    const db = getD1();
    const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
    if (!project) {
      return Response.json({ error: "项目不存在" }, { status: 404 });
    }
    const current = await db
      .prepare("SELECT COUNT(*) AS count FROM project_dimensions WHERE project_id = ?")
      .bind(projectId)
      .first<{ count: number }>();
    const sortOrder = current?.count ?? 0;
    const id = crypto.randomUUID();
    const assets = await db
      .prepare("SELECT asset_id AS assetId FROM project_assets WHERE project_id = ?")
      .bind(projectId)
      .all<{ assetId: string }>();
    const statements = [
      db.prepare("INSERT INTO project_dimensions (id, project_id, left_label, right_label, sort_order) VALUES (?, ?, ?, ?, ?)")
        .bind(id, projectId, leftLabel, rightLabel, sortOrder),
      ...assets.results.map(({ assetId }) =>
        db.prepare("INSERT INTO asset_dimension_values (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, 500)")
          .bind(projectId, assetId, id),
      ),
      db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId),
    ];
    await db.batch(statements);
    return Response.json(
      { dimension: { id, projectId, leftLabel, rightLabel, sortOrder } },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = cleanText(url.searchParams.get("id"), 80);
    const projectId = cleanText(url.searchParams.get("projectId"), 80);
    if (!id || !projectId) {
      return Response.json({ error: "缺少维度或项目 ID" }, { status: 400 });
    }

    await ensureDatabase();
    const db = getD1();
    const dimension = await db
      .prepare("SELECT sort_order AS sortOrder FROM project_dimensions WHERE id = ? AND project_id = ?")
      .bind(id, projectId)
      .first<{ sortOrder: number }>();
    if (!dimension) {
      return Response.json({ error: "维度不存在" }, { status: 404 });
    }
    const result = await db
      .prepare("DELETE FROM project_dimensions WHERE id = ? AND project_id = ?")
      .bind(id, projectId)
      .run();
    if (!result.meta.changes) {
      return Response.json({ error: "维度不存在" }, { status: 404 });
    }
    await db.batch([
      db.prepare("UPDATE project_dimensions SET sort_order = sort_order - 1 WHERE project_id = ? AND sort_order > ?")
        .bind(projectId, dimension.sortOrder),
      db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
