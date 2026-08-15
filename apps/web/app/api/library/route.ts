import { ensureDatabase, getD1 } from "@/db/bootstrap";

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

type ReferenceRow = { assetId: string; projectId: string; projectName: string };

export async function GET() {
  try {
    await ensureDatabase();
    const db = getD1();
    const [assets, references] = await Promise.all([
      db.prepare(`SELECT a.id, a.name, a.file_name AS fileName,
        CASE WHEN a.external_id IS NOT NULL OR a.thumbnail_key IS NOT NULL
          THEN '/api/media?id=' || a.id || '&variant=thumbnail' ELSE a.thumbnail_url END AS thumbnailUrl,
        a.tags, a.description, a.notes, a.source_url AS sourceUrl,
        a.file_size AS fileSize, a.width, a.height, a.mime_type AS mimeType,
        a.created_at AS createdAt
        FROM assets a
        WHERE a.deleted_at IS NULL
        ORDER BY a.created_at DESC, a.id`).all<AssetRow>(),
      db.prepare(`SELECT pa.asset_id AS assetId, p.id AS projectId, p.name AS projectName
        FROM project_assets pa
        INNER JOIN projects p ON p.id = pa.project_id
        INNER JOIN assets a ON a.id = pa.asset_id
        WHERE a.deleted_at IS NULL
        ORDER BY p.name, p.id`).all<ReferenceRow>(),
    ]);
    const projectMap = new Map<string, Array<{ id: string; name: string }>>();
    references.results.forEach((reference) => {
      const current = projectMap.get(reference.assetId) ?? [];
      current.push({ id: reference.projectId, name: reference.projectName });
      projectMap.set(reference.assetId, current);
    });
    return Response.json({
      assets: assets.results.map((asset) => ({
        ...asset,
        tags: asset.tags ? asset.tags.split(",") : [],
        projects: projectMap.get(asset.id) ?? [],
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "素材库载入失败" }, { status: 500 });
  }
}
