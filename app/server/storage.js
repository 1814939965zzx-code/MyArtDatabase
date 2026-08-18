import { createHash, randomUUID } from "node:crypto";
import { mkdir, open as openFile, unlink, writeFile } from "node:fs/promises";
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
  const safePath = (directory, id) => {
    // 存储键是服务端生成的 UUID；仅允许单一文件名，绝不允许路径分隔符或点号。
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new StorageError("非法存储键", 400);
    }
    const file = path.resolve(directory, id);
    if (path.dirname(file) !== path.resolve(directory)) {
      throw new StorageError("非法存储路径", 400);
    }
    return file;
  };
  const blobPath = (id) => safePath(blobsDir, id);
  const thumbPath = (id) => safePath(thumbsDir, id);

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
    let handle;
    try {
      // 先等待 open 成功再创建流，权限错误会被 try/catch 捕获，不会变成未处理的 stream error 导致进程崩溃。
      handle = await openFile(file, "r");
      const info = await handle.stat();
      return { stream: handle.createReadStream(), size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      await handle?.close().catch(() => {});
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
