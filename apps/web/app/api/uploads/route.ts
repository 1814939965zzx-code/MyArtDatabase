import { ensureDatabase, getD1 } from "@/db/bootstrap";
import { createResourceSpaceAsset, permanentlyDeleteResourceSpaceAsset } from "@/db/resourcespace";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  let externalId = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !allowedTypes.has(file.type)) {
      return Response.json({ error: "仅支持 JPEG、PNG 和 WebP 图片" }, { status: 400 });
    }
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) {
      return Response.json({ error: "图片不能超过 50MB" }, { status: 400 });
    }

    const projectId = cleanText(form.get("projectId"), 80);
    const name = cleanText(form.get("name"), 120) || file.name.slice(0, 120);
    const description = cleanText(form.get("description"), 2000);
    const notes = cleanText(form.get("notes"), 2000);
    const sourceUrl = cleanText(form.get("sourceUrl"), 1000);
    const tags = cleanText(form.get("tags"), 800)
      .split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20).join(",");
    const allowDuplicate = form.get("allowDuplicate") === "true";
    const width = Math.max(0, Math.round(Number(form.get("width")) || 0));
    const height = Math.max(0, Math.round(Number(form.get("height")) || 0));
    const rawDimensionValues = cleanText(form.get("dimensionValues"), 4000);
    const dimensionValues = rawDimensionValues
      ? JSON.parse(rawDimensionValues) as Record<string, number>
      : {};
    if (!projectId) {
      return Response.json({ error: "缺少目标项目" }, { status: 400 });
    }

    await ensureDatabase();
    const db = getD1();
    const project = await db.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
    if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });

    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    const duplicate = await db.prepare("SELECT id, name FROM assets WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1")
      .bind(sha256).first<{ id: string; name: string }>();
    if (duplicate && !allowDuplicate) {
      return Response.json({ error: "发现完全相同的素材", duplicate }, { status: 409 });
    }

    const id = crypto.randomUUID();
    externalId = await createResourceSpaceAsset(file, { name, tags, description, notes, sourceUrl });

    const dimensions = await db.prepare("SELECT id FROM project_dimensions WHERE project_id = ? ORDER BY sort_order")
      .bind(projectId).all<{ id: string }>();
    const statements = [
      db.prepare(`INSERT INTO assets (
        id, external_id, name, file_name, sha256, file_size,
        width, height, mime_type, tags, description, notes, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, externalId, name, file.name, sha256, file.size,
          width, height, file.type, tags, description, notes, sourceUrl),
      db.prepare("INSERT INTO project_assets (project_id, asset_id) VALUES (?, ?)").bind(projectId, id),
      ...dimensions.results.map(({ id: dimensionId }) => {
        const candidate = Math.round(Number(dimensionValues[dimensionId] ?? 500));
        const value = Number.isFinite(candidate) ? Math.min(1000, Math.max(0, candidate)) : 500;
        return db.prepare("INSERT INTO asset_dimension_values (project_id, asset_id, dimension_id, value) VALUES (?, ?, ?, ?)")
          .bind(projectId, id, dimensionId, value);
      }),
      db.prepare("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(projectId),
    ];
    try {
      await db.batch(statements);
    } catch (error) {
      await permanentlyDeleteResourceSpaceAsset(externalId).catch(() => undefined);
      throw error;
    }
    return Response.json({ asset: { id, externalId, name, fileName: file.name, sha256 } }, { status: 201 });
  } catch (error) {
    if (externalId) await permanentlyDeleteResourceSpaceAsset(externalId).catch(() => undefined);
    const message = error instanceof Error ? error.message : "上传失败";
    return Response.json({ error: message }, { status: 500 });
  }
}
