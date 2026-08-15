import { ensureDatabase, getD1 } from "@/db/bootstrap";

function cleanId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      projectId?: unknown;
      assetId?: unknown;
      dimensionId?: unknown;
      value?: unknown;
    };
    const projectId = cleanId(payload.projectId);
    const assetId = cleanId(payload.assetId);
    const dimensionId = cleanId(payload.dimensionId);
    const numericValue = typeof payload.value === "number" ? payload.value : Number.NaN;
    const value = Math.round(numericValue);
    if (!projectId || !assetId || !dimensionId || !Number.isFinite(value)) {
      return Response.json({ error: "维度值参数不完整" }, { status: 400 });
    }
    if (value < 0 || value > 1000) {
      return Response.json({ error: "维度值必须在 0 到 1000 之间" }, { status: 400 });
    }

    await ensureDatabase();
    const result = await getD1()
      .prepare(`UPDATE asset_dimension_values SET value = ?
        WHERE project_id = ? AND asset_id = ? AND dimension_id = ?`)
      .bind(value, projectId, assetId, dimensionId)
      .run();
    if (!result.meta.changes) {
      return Response.json({ error: "该素材没有对应的维度值" }, { status: 404 });
    }
    return Response.json({ value });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
