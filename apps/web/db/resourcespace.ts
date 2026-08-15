import { env } from "cloudflare:workers";

type ResourceSpaceBindings = {
  RS_BASE_URL?: string;
  RS_API_USER?: string;
  RS_API_KEY?: string;
};

type ResourceMetadata = {
  name: string;
  tags: string;
  description: string;
  notes: string;
  sourceUrl: string;
};

type ResourceData = {
  archive?: number;
  file_extension?: string;
};

function getConfig() {
  const bindings = env as unknown as ResourceSpaceBindings;
  const baseUrl = bindings.RS_BASE_URL?.trim().replace(/\/+$/, "");
  const user = bindings.RS_API_USER?.trim();
  const apiKey = bindings.RS_API_KEY?.trim();
  if (!baseUrl || !user || !apiKey) {
    throw new Error("ResourceSpace 尚未配置，请设置 RS_BASE_URL、RS_API_USER 和 RS_API_KEY。");
  }
  return { baseUrl, user, apiKey };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function apiCall<T>(
  functionName: string,
  params: Record<string, string | number> = {},
  init: { method?: "GET" | "POST"; body?: BodyInit } = {},
): Promise<T> {
  const { baseUrl, user, apiKey } = getConfig();
  const query = new URLSearchParams({ user, function: functionName });
  Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
  const unsignedQuery = query.toString();
  const sign = await sha256Hex(`${apiKey}${unsignedQuery}`);
  const response = await fetch(`${baseUrl}/api/?${unsignedQuery}&sign=${sign}`, {
    method: init.method ?? "GET",
    body: init.body,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const payload = JSON.parse(text) as { data?: { message?: string }; error?: { detail?: string } };
      detail = payload.data?.message || payload.error?.detail || text;
    } catch {
      // Keep the plain response body when ResourceSpace did not return JSON.
    }
    throw new Error(`ResourceSpace 请求失败（${response.status}）${detail ? `：${detail}` : ""}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

function assertResourceRef(value: unknown): number {
  const ref = Number(value);
  if (!Number.isInteger(ref) || ref <= 0) throw new Error("ResourceSpace 未返回有效素材 ID。");
  return ref;
}

function assertSucceeded(value: unknown, operation: string) {
  if (value !== true) throw new Error(`ResourceSpace ${operation}失败。`);
}

export async function updateResourceSpaceMetadata(ref: string | number, metadata: ResourceMetadata) {
  const fields: Array<[string, string]> = [
    ["title", metadata.name],
    ["keywords", metadata.tags],
    ["caption", metadata.description],
    ["notes", metadata.notes],
    ["artdatabasesourceurl", metadata.sourceUrl],
  ];
  for (const [field, value] of fields) {
    const result = await apiCall<boolean>("update_field", { resource: ref, field, value }, { method: "POST" });
    assertSucceeded(result, `更新字段 ${field}`);
  }
}

export async function createResourceSpaceAsset(file: File, metadata: ResourceMetadata) {
  const ref = assertResourceRef(await apiCall<number>(
    "create_resource",
    { resource_type: 1, archive: 0 },
    { method: "POST" },
  ));
  try {
    const form = new FormData();
    form.set("file", file, file.name);
    await apiCall<void>("upload_multipart", {
      ref,
      no_exif: 1,
      revert: 0,
      previewonly: 0,
      alternative: 0,
      autorotate: 1,
    }, { method: "POST", body: form });
    await updateResourceSpaceMetadata(ref, metadata);
    return String(ref);
  } catch (error) {
    await permanentlyDeleteResourceSpaceAsset(ref).catch(() => undefined);
    throw error;
  }
}

export async function softDeleteResourceSpaceAsset(ref: string | number) {
  assertSucceeded(
    await apiCall<boolean>("delete_resource", { resource: ref }, { method: "POST" }),
    "移入回收站",
  );
}

export async function restoreResourceSpaceAsset(ref: string | number) {
  assertSucceeded(
    await apiCall<boolean>("put_resource_data", {
      resource: ref,
      data: JSON.stringify({ archive: 0 }),
    }, { method: "POST" }),
    "恢复素材",
  );
}

export async function permanentlyDeleteResourceSpaceAsset(ref: string | number) {
  const first = await apiCall<boolean | ResourceData>("get_resource_data", { resource: ref });
  if (first === false) return;
  assertSucceeded(
    await apiCall<boolean>("delete_resource", { resource: ref }, { method: "POST" }),
    "删除素材",
  );
  const remaining = await apiCall<boolean | ResourceData>("get_resource_data", { resource: ref });
  if (remaining !== false) {
    assertSucceeded(
      await apiCall<boolean>("delete_resource", { resource: ref }, { method: "POST" }),
      "彻底删除素材",
    );
  }
}

export async function fetchResourceSpaceMedia(ref: string | number, variant: "original" | "thumbnail") {
  const resource = await apiCall<ResourceData | false>("get_resource_data", { resource: ref });
  if (!resource) return null;
  const extension = variant === "original" ? resource.file_extension || "jpg" : "jpg";
  const mediaUrl = await apiCall<string>("get_resource_path", {
    ref,
    size: variant === "thumbnail" ? "thm" : "",
    generate: 1,
    extension,
  });
  if (!mediaUrl) return null;
  const response = await fetch(mediaUrl);
  if (!response.ok || !response.body) {
    throw new Error(`ResourceSpace 文件读取失败（${response.status}）。`);
  }
  return response;
}
