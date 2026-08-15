import { ensureDatabase, getD1 } from "@/db/bootstrap";

type DuplicateRow = {
  id: string;
  name: string;
  fileName: string;
  thumbnailUrl: string | null;
  inProject: number;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { sha256?: unknown; projectId?: unknown };
    const sha256 = typeof payload.sha256 === "string" ? payload.sha256.trim().toLowerCase() : "";
    const projectId = typeof payload.projectId === "string" ? payload.projectId.trim() : "";
    if (!/^[a-f0-9]{64}$/.test(sha256) || !projectId) {
      return Response.json({ error: "文件哈希或项目参数无效" }, { status: 400 });
    }
    await ensureDatabase();
    const duplicates = await getD1().prepare(`
      SELECT a.id, a.name, a.file_name AS fileName,
        CASE WHEN a.external_id IS NOT NULL OR a.thumbnail_key IS NOT NULL THEN '/api/media?id=' || a.id || '&variant=thumbnail'
          ELSE a.thumbnail_url END AS thumbnailUrl,
        EXISTS(SELECT 1 FROM project_assets pa WHERE pa.asset_id = a.id AND pa.project_id = ?) AS inProject
      FROM assets a
      WHERE a.sha256 = ? AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC
    `).bind(projectId, sha256).all<DuplicateRow>();
    return Response.json({ duplicates: duplicates.results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重复检查失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
