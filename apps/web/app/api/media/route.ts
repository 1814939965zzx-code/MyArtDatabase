import { ensureDatabase, getD1 } from "@/db/bootstrap";
import { fetchResourceSpaceMedia } from "@/db/resourcespace";
import { getMediaBucket } from "@/db/storage";

type MediaRow = { externalId: string | null; storageKey: string | null; thumbnailKey: string | null; mimeType: string };

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim();
    const variant = url.searchParams.get("variant") === "thumbnail" ? "thumbnail" : "original";
    if (!id) return new Response("Missing asset id", { status: 400 });
    await ensureDatabase();
    const asset = await getD1().prepare(`SELECT external_id AS externalId, storage_key AS storageKey,
      thumbnail_key AS thumbnailKey, mime_type AS mimeType
      FROM assets WHERE id = ? AND deleted_at IS NULL`).bind(id).first<MediaRow>();
    if (!asset) return new Response("Not found", { status: 404 });
    if (asset.externalId) {
      const media = await fetchResourceSpaceMedia(asset.externalId, variant);
      if (!media?.body) return new Response("Not found", { status: 404 });
      const headers = new Headers(media.headers);
      headers.set("cache-control", "private, max-age=3600");
      return new Response(media.body, { headers });
    }
    const key = variant === "thumbnail" ? asset.thumbnailKey || asset.storageKey : asset.storageKey;
    if (!key) return new Response("Not found", { status: 404 });
    const object = await getMediaBucket().get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=3600");
    headers.set("content-type", headers.get("content-type") || asset.mimeType);
    return new Response(object.body, { headers });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Media error", { status: 500 });
  }
}
