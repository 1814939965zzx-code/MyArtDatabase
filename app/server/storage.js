import { createHash, randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export class StorageError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

/**
 * 可插拔存储后端接口：
 *   put(buffer, mimeType)  -> 元数据对象
 *   open(id, variant)      -> { stream, size, mtimeMs } | null
 *   remove(id)             -> void（幂等）
 */
export function createLocalDiskStore({ root, thumbMax = 900, thumbQuality = 82 }) {
  const blobsDir = path.join(root, "blobs");
  const thumbsDir = path.join(root, "thumbs");
  const blobPath = (id) => path.join(blobsDir, id);
  const thumbPath = (id) => path.join(thumbsDir, id);

  async function ensureDirs() {
    await mkdir(blobsDir, { recursive: true });
    await mkdir(thumbsDir, { recursive: true });
  }

  async function put(buffer, mimeType) {
    await ensureDirs();
    const id = randomUUID();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const metadata = await sharp(buffer).metadata();
    const original = blobPath(id);
    const thumbnail = thumbPath(id);
    try {
      await writeFile(original, buffer);
      const thumbInfo = await sharp(buffer)
        .resize({ width: thumbMax, height: thumbMax, fit: "inside", withoutEnlargement: true })
        .webp({ quality: thumbQuality })
        .toFile(thumbnail);
      return {
        id,
        sha256,
        size: buffer.length,
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        mimeType: mimeType || "application/octet-stream",
        thumbnailWidth: thumbInfo.width,
        thumbnailHeight: thumbInfo.height,
      };
    } catch (error) {
      await unlink(original).catch(() => {});
      await unlink(thumbnail).catch(() => {});
      throw new StorageError(`图片处理失败：${error instanceof Error ? error.message : String(error)}`, 422);
    }
  }

  async function open(id, variant) {
    const file = variant === "thumbnail" ? thumbPath(id) : blobPath(id);
    try {
      const info = await stat(file);
      return { stream: createReadStream(file), size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function remove(id) {
    await unlink(blobPath(id)).catch(() => {});
    await unlink(thumbPath(id)).catch(() => {});
  }

  return { put, open, remove };
}
