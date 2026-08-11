import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export function extensionForMime(mimeType?: string): string {
  if (!mimeType) return "png";
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return EXT_BY_MIME[normalized] ?? "png";
}

function buildFileName(mimeType?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = randomBytes(3).toString("hex");
  return `labnana-${stamp}-${rand}.${extensionForMime(mimeType)}`;
}

/** 将图片数据写入目录（自动建目录、自动生成不冲突文件名），返回绝对路径 */
export async function saveImageFile(
  dir: string,
  data: Buffer,
  mimeType?: string,
): Promise<string> {
  const resolvedDir = path.resolve(dir);
  await mkdir(resolvedDir, { recursive: true });
  const filePath = path.join(resolvedDir, buildFileName(mimeType));
  await writeFile(filePath, data);
  return filePath;
}

// 与 client 的 baseUrl 策略一致：https，或仅 loopback 的 http（本地调试）
function isAllowedDownloadUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "http:" &&
    (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]")
  );
}

/** 下载任务产出的公开图片 URL */
export async function downloadImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: Buffer; mimeType?: string }> {
  if (!isAllowedDownloadUrl(url)) {
    throw new Error(`不支持的图片下载地址（仅 https 或 loopback http）：${url}`);
  }
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`下载图片失败（HTTP ${res.status}）`);
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("下载图片超过 100 MB 上限");
  }
  const contentType = res.headers.get("content-type")?.split(";")[0].trim();
  return {
    data,
    mimeType: contentType?.startsWith("image/") ? contentType : undefined,
  };
}
