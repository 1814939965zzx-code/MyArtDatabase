import { ensureDatabase, getD1 } from "@/db/bootstrap";

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

type DimensionRow = {
  id: string;
  projectId: string;
  leftLabel: string;
  rightLabel: string;
  sortOrder: number;
};

type AssetRow = {
  id: string;
  name: string;
  fileName: string;
  thumbnailUrl: string | null;
  tags: string;
  description: string;
  notes: string;
  sourceUrl: string;
  fileSize: number;
  width: number;
  height: number;
  mimeType: string;
  createdAt: string;
};

type ValueRow = { assetId: string; dimensionId: string; value: number };

export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (!projectId) {
      return Response.json({ error: "缺少项目 ID" }, { status: 400 });
    }
    await ensureDatabase();
    const db = getD1();
    const [project, dimensions, assets, values] = await Promise.all([
      db.prepare(`SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt
        FROM projects WHERE id = ?`).bind(projectId).first<ProjectRow>(),
      db.prepare(`SELECT id, project_id AS projectId, left_label AS leftLabel,
        right_label AS rightLabel, sort_order AS sortOrder
        FROM project_dimensions WHERE project_id = ? ORDER BY sort_order`)
        .bind(projectId).all<DimensionRow>(),
      db.prepare(`SELECT a.id, a.name, a.file_name AS fileName,
        CASE WHEN a.external_id IS NOT NULL OR a.thumbnail_key IS NOT NULL
          THEN '/api/media?id=' || a.id || '&variant=thumbnail' ELSE a.thumbnail_url END AS thumbnailUrl,
        a.tags, a.description, a.notes, a.source_url AS sourceUrl,
        a.file_size AS fileSize, a.width, a.height, a.mime_type AS mimeType,
        a.created_at AS createdAt
        FROM assets a
        INNER JOIN project_assets pa ON pa.asset_id = a.id
        WHERE pa.project_id = ? AND a.deleted_at IS NULL ORDER BY pa.created_at DESC, a.id`)
        .bind(projectId).all<AssetRow>(),
      db.prepare(`SELECT asset_id AS assetId, dimension_id AS dimensionId, value
        FROM asset_dimension_values WHERE project_id = ?`)
        .bind(projectId).all<ValueRow>(),
    ]);
    if (!project) {
      return Response.json({ error: "项目不存在" }, { status: 404 });
    }

    const valueMap = new Map<string, Record<string, number>>();
    values.results.forEach((row) => {
      const current = valueMap.get(row.assetId) ?? {};
      current[row.dimensionId] = row.value;
      valueMap.set(row.assetId, current);
    });
    return Response.json({
      project,
      dimensions: dimensions.results,
      assets: assets.results.map((asset) => ({
        ...asset,
        tags: asset.tags ? asset.tags.split(",") : [],
        dimensionValues: valueMap.get(asset.id) ?? {},
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
