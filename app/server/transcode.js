import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";

/**
 * 视频转码队列：上传/替换视频后异步把原文件统一压为低码率 H.264 MP4。
 *
 * 约定：
 * - 单进程内单并发串行执行，避免 CPU 打满拖慢其他请求；
 * - 转码产物与封面以「改名提交」覆盖原文件同名存储键（storage.commitVideo），
 *   只有转码成功且数据库已切换到产物后才算完成，原文件随之被覆盖删除；
 * - 失败/中断保留原文件并置 transcode_status='failed'，可调用方重新入队；
 * - ffmpeg 日志写入临时文件而非管道（spawn 的 stderr 用已打开的文件描述符，
 *   不依赖管道，进程与沙箱环境都更稳），便于排查。
 */

const MAX_CONCURRENCY = 1;

/** 转码规格：最长边 ≤1280（720p 级）、码率上限 2Mbps、faststart；音轨有则转 AAC 128k，无则不生成。 */
const VIDEO_ARGS = [
  "-map", "0:v:0",
  "-map", "0:a?",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "28",
  "-maxrate", "2000k",
  "-bufsize", "4000k",
  "-vf", "scale='min(1280,iw)':-2",
  "-c:a", "aac",
  "-b:a", "128k",
  "-movflags", "+faststart",
];

const pending = [];
let active = 0;

/** 把视频素材加入转码队列（调用方保证素材存在且 storage_key 有效）。 */
export function enqueueVideoTranscode({ db, store, assetId }) {
  pending.push({ db, store, assetId });
  pump();
}

/**
 * 启动时重置遗留的 processing 记录为 failed（进程中断时原文件仍在，
 * 置为 failed 后用户可重新转码），并清理同名转码临时文件。
 */
export function resetStaleTranscodes(db, store) {
  const stale = db.prepare("SELECT storage_key AS storageKey FROM assets WHERE transcode_status = 'processing'").all();
  db.prepare("UPDATE assets SET transcode_status = 'failed', transcode_progress = 0 WHERE transcode_status = 'processing'").run();
  for (const { storageKey } of stale) {
    if (!storageKey) continue;
    rm(store.tempDir(storageKey), { recursive: true, force: true }).catch(() => {});
  }
}

function pump() {
  while (active < MAX_CONCURRENCY && pending.length > 0) {
    const job = pending.shift();
    active += 1;
    runJob(job)
      .catch(() => {})
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

/**
 * 执行一次转码：探测时长 → 转码（进度 2~80）→ 抽帧封面（82~92）→ 提交（100）→ 更新数据库。
 * 任何失败都保留原文件；进度写入 assets.transcode_progress 供前端轮询展示。
 */
async function runJob({ db, store, assetId }) {
  const asset = db.prepare("SELECT id, storage_key AS storageKey FROM assets WHERE id = ? AND deleted_at IS NULL").get(assetId);
  if (!asset?.storageKey) return;

  const inputPath = store.resolvePath(asset.storageKey, "original");
  const videoTemp = store.tempPath(asset.storageKey, "video");
  const thumbTemp = store.tempPath(asset.storageKey, "thumb");
  const logPath = store.tempPath(asset.storageKey, "log");
  const progressPath = store.tempPath(asset.storageKey, "progress");
  const tempDir = store.tempDir(asset.storageKey);
  const setProgress = (percent) => {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    db.prepare("UPDATE assets SET transcode_progress = ? WHERE id = ?").run(clamped, assetId);
  };
  try {
    await mkdir(tempDir, { recursive: true });

    // 先探测输入时长，用于把 ffmpeg 的 out_time 映射成 0~80% 的真实进度；探测失败退化为相位进度。
    let durationUs = 0;
    try {
      const probe = await probeVideo(inputPath, logPath);
      durationUs = probe.durationMs * 1000;
    } catch { /* 保留 0，转码阶段按相位推进 */ }

    setProgress(2);
    await runFfmpeg(["-y", "-i", inputPath, "-progress", progressPath, ...VIDEO_ARGS, videoTemp], logPath, {
      onProgress: (fraction) => setProgress(2 + fraction * 78),
      progressPath,
      progressDurationUs: durationUs,
    });
    setProgress(82);

    // 封面从转码产物抽帧（不依赖原文件），最长边 ≤900，与图片缩略图规格一致。
    await runFfmpeg(["-y", "-i", videoTemp, "-ss", "0.1", "-frames:v", "1", "-vf", "scale='min(900,iw)':-2", "-c:v", "libwebp", "-quality", "80", thumbTemp], logPath);
    setProgress(92);

    const probe = await probeVideo(videoTemp, logPath);
    const committed = await store.commitVideo({ id: asset.storageKey, videoTempPath: videoTemp, thumbTempPath: thumbTemp });
    db.prepare(
      "UPDATE assets SET transcode_status = 'ready', duration = ?, width = ?, height = ?, file_size = ?, mime_type = ?, thumbnail_key = ?, transcode_progress = 100 WHERE id = ?",
    ).run(probe.durationMs, probe.width, probe.height, committed.size, committed.mimeType, asset.storageKey, assetId);
  } catch (error) {
    // 失败必须保留原文件：只清理临时目录，数据库回置 failed。
    db.prepare("UPDATE assets SET transcode_status = 'failed', transcode_progress = 0 WHERE id = ?").run(assetId);
    console.error(`[artdatabase] 视频转码失败 asset=${assetId}:`, error instanceof Error ? error.message : String(error));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 运行 ffmpeg。stderr 重定向到已打开的文件描述符（不依赖管道，更稳）；
 * 提供 progressPath 时每 300ms 解析 `-progress` 输出文件并回调进度（0~1）。
 */
function runFfmpeg(args, logPath, options = {}) {
  return new Promise((resolve, reject) => {
    const { onProgress, progressPath, progressDurationUs } = options;
    const fd = openSync(logPath, "w");
    let child;
    try {
      child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", fd] });
    } catch (error) {
      try { closeSync(fd); } catch { /* 忽略 */ }
      reject(error);
      return;
    }
    let timer = null;
    if (onProgress && progressPath) {
      timer = setInterval(() => {
        const fraction = readProgress(progressPath, progressDurationUs);
        if (fraction > 0) onProgress(fraction);
      }, 300);
    }
    const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
    child.on("error", (error) => {
      stopTimer();
      try { closeSync(fd); } catch { /* 忽略 */ }
      reject(error);
    });
    child.on("close", (code) => {
      stopTimer();
      let log = "";
      try {
        closeSync(fd);
        log = readFileSync(logPath, "utf8");
      } catch { /* 日志文件已被清理时忽略 */ }
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}: ${log.slice(-600)}`));
    });
  });
}

/** 解析 ffmpeg -progress 输出文件，取最后一个 out_time_us 相对总时长的占比。 */
function readProgress(progressPath, durationUs) {
  try {
    const content = readFileSync(progressPath, "utf8");
    let last = 0;
    for (const line of content.split("\n")) {
      const match = /^out_time_us=(\d+)$/.exec(line.trim());
      if (match) last = Number(match[1]);
    }
    if (!durationUs || last <= 0) return 0;
    return Math.min(0.95, last / durationUs);
  } catch {
    return 0;
  }
}

/** 用 `ffmpeg -i` 探测转码产物的时长与分辨率（解析日志，ffmpeg 无输出参数时退出码 1 属正常）。 */
function probeVideo(filePath, logPath) {
  return new Promise((resolve, reject) => {
    const fd = openSync(logPath, "w");
    let child;
    try {
      child = spawn(ffmpegPath, ["-i", filePath], { stdio: ["ignore", "ignore", fd] });
    } catch (error) {
      try { closeSync(fd); } catch { /* 忽略 */ }
      reject(error);
      return;
    }
    child.on("error", (error) => {
      try { closeSync(fd); } catch { /* 忽略 */ }
      reject(error);
    });
    child.on("close", () => {
      let stderr = "";
      try {
        closeSync(fd);
        stderr = readFileSync(logPath, "utf8");
      } catch { /* 忽略 */ }
      const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      const videoLine = stderr.split("\n").find((line) => line.includes("Video:"));
      const sizeMatch = videoLine ? /(\d{2,5})x(\d{2,5})/.exec(videoLine) : null;
      if (!durationMatch || !sizeMatch) {
        reject(new Error(`无法解析视频信息：${stderr.slice(0, 300)}`));
        return;
      }
      const [, h, m, s] = durationMatch;
      const durationMs = Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000);
      resolve({ durationMs, width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) });
    });
  });
}
