import { createHash, randomUUID } from "node:crypto";
import { mkdir, open as openFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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

  async function open(id, variant, range) {
    const file = variant === "thumbnail" ? thumbPath(id) : blobPath(id);
    let handle;
    try {
      // 先等待 open 成功再创建流，权限错误会被 try/catch 捕获，不会变成未处理的 stream error 导致进程崩溃。
      handle = await openFile(file, "r");
      const info = await handle.stat();
      if (range && typeof range.start === "number" && typeof range.end === "number") {
        // end 为包含式，与 Node ReadStream 语义一致；调用方已保证 start <= end < size。
        const start = Math.max(0, range.start);
        const end = Math.min(range.end, info.size - 1);
        return { stream: handle.createReadStream({ start, end }), size: end - start + 1, mtimeMs: info.mtimeMs };
      }
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

  /**
   * 视频原文件：只写入 blobs，不做 sharp 处理（sharp 无法解析视频）。
   * 返回的 id 同时作为后续转码产物的存储键。
   */
  async function putVideoOriginal(buffer, mimeType) {
    await ensureDirs();
    const id = randomUUID();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    await writeFile(blobPath(id), buffer);
    return {
      id,
      sha256,
      size: buffer.length,
      mimeType: mimeType || "video/mp4",
    };
  }

  /**
   * 返回存储键对应的磁盘绝对路径（受目录边界约束），供 ffmpeg 直接读写。
   */
  function resolvePath(id, variant) {
    return variant === "thumbnail" ? thumbPath(id) : blobPath(id);
  }

  /**
   * 转码临时目录与文件路径：位于 blobs 同目录下（保证改名提交原子、不跨盘），
   * 临时文件带正确扩展名以便 ffmpeg 推断输出格式；job 结束后整个目录清理。
   */
  function tempDir(id) {
    return path.join(blobsDir, `.${id}.tmp`);
  }
  function tempPath(id, kind) {
    const name = kind === "video" ? "out.mp4" : kind === "thumb" ? "thumb.webp" : kind === "progress" ? "progress.txt" : "ffmpeg.log";
    return path.join(tempDir(id), name);
  }

  /**
   * 转码成功后原子提交：临时视频/封面改名进 blobs/thumbs（覆盖原文件同名键），
   * 返回转码产物的元数据。调用方必须保证此时数据库已可切换到该存储键。
   */
  async function commitVideo({ id, videoTempPath, thumbTempPath }) {
    const finalVideo = blobPath(id);
    const finalThumb = thumbPath(id);
    await rename(videoTempPath, finalVideo);
    await rename(thumbTempPath, finalThumb);
    const info = await stat(finalVideo);
    return { size: info.size, mimeType: "video/mp4" };
  }

  return { put, putVideoOriginal, open, remove, resolvePath, tempDir, tempPath, commitVideo };
}
