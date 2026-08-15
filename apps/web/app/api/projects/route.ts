import { ensureDatabase, getD1 } from "@/db/bootstrap";

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  dimensionCount: number;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    await ensureDatabase();
    const result = await getD1().prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        COUNT(DISTINCT a.id) AS assetCount,
        COUNT(DISTINCT pd.id) AS dimensionCount
      FROM projects p
      LEFT JOIN project_assets pa ON pa.project_id = p.id
      LEFT JOIN assets a ON a.id = pa.asset_id AND a.deleted_at IS NULL
      LEFT JOIN project_dimensions pd ON pd.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, assetCount DESC, p.created_at DESC
    `).all<ProjectRow>();
    return Response.json({ projects: result.results });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { name?: unknown; description?: unknown };
    const name = cleanText(payload.name, 50);
    const description = cleanText(payload.description, 240);
    if (!name) {
      return Response.json({ error: "项目名称不能为空" }, { status: 400 });
    }

    await ensureDatabase();
    const id = crypto.randomUUID();
    await getD1()
      .prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)")
      .bind(id, name, description)
      .run();
    return Response.json({ project: { id, name, description } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as { id?: unknown; name?: unknown; description?: unknown };
    const id = cleanText(payload.id, 80);
    const name = cleanText(payload.name, 50);
    const description = cleanText(payload.description, 240);
    if (!id || !name) {
      return Response.json({ error: "缺少项目 ID 或名称" }, { status: 400 });
    }

    await ensureDatabase();
    const result = await getD1()
      .prepare("UPDATE projects SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(name, description, id)
      .run();
    if (!result.meta.changes) {
      return Response.json({ error: "项目不存在" }, { status: 404 });
    }
    return Response.json({ project: { id, name, description } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = cleanText(new URL(request.url).searchParams.get("id"), 80);
    if (!id) {
      return Response.json({ error: "缺少项目 ID" }, { status: 400 });
    }

    await ensureDatabase();
    const result = await getD1().prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
    if (!result.meta.changes) {
      return Response.json({ error: "项目不存在" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
