import { env } from "cloudflare:workers";

export function getMediaBucket() {
  if (!env.MEDIA) {
    throw new Error("素材存储尚未绑定，请检查 .openai/hosting.json 中的 r2 配置。");
  }
  return env.MEDIA;
}
