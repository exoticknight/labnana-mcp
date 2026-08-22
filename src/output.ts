import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/tiff": "tiff",
};

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_PREVIEW_EDGE = 1600;
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MIN_PREVIEW_EDGE = 320;
const MAX_INPUT_PIXELS = 100_000_000;

const MIME_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  tiff: "image/tiff",
};

export interface ImageDescription {
  mimeType: string;
  width?: number;
  height?: number;
  byteLength: number;
  sha256: string;
}

export interface ImagePreview {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
}

function normalizedImageMime(mimeType?: string): string | undefined {
  if (!mimeType) return undefined;
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return normalized.startsWith("image/") ? normalized : undefined;
}

/** 读取图片元数据，并用实际解码格式校正上游 MIME。 */
export async function describeImage(
  data: Buffer,
  fallbackMimeType?: string,
): Promise<ImageDescription> {
  const metadata = await sharp(data, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();
  return {
    mimeType:
      (metadata.format && MIME_BY_FORMAT[metadata.format]) ??
      normalizedImageMime(fallbackMimeType) ??
      "image/png",
    width: metadata.width,
    height: metadata.height,
    byteLength: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

/**
 * 生成适合 MCP 内联传输的有界预览。
 * 小型 PNG/JPEG 原样返回；大图按长边和字节预算逐步缩小。
 */
export async function createImagePreview(
  data: Buffer,
  fallbackMimeType?: string,
): Promise<ImagePreview> {
  const metadata = await sharp(data, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();
  const sourceMimeType =
    (metadata.format && MIME_BY_FORMAT[metadata.format]) ??
    normalizedImageMime(fallbackMimeType) ??
    "image/png";
  const width = metadata.width;
  const height = metadata.height;

  if (
    width !== undefined &&
    height !== undefined &&
    width <= MAX_PREVIEW_EDGE &&
    height <= MAX_PREVIEW_EDGE &&
    data.byteLength <= MAX_PREVIEW_BYTES &&
    (sourceMimeType === "image/png" || sourceMimeType === "image/jpeg")
  ) {
    return {
      data,
      mimeType: sourceMimeType,
      width,
      height,
      byteLength: data.byteLength,
    };
  }

  let edge = MAX_PREVIEW_EDGE;
  for (;;) {
    let pipeline = sharp(data, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    })
      .autoOrient()
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      });

    pipeline = metadata.hasAlpha
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline.jpeg({ quality: 82, mozjpeg: true });
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    const previewMimeType = MIME_BY_FORMAT[result.info.format] ?? "image/png";
    if (result.data.byteLength <= MAX_PREVIEW_BYTES || edge <= MIN_PREVIEW_EDGE) {
      return {
        data: result.data,
        mimeType: previewMimeType,
        width: result.info.width,
        height: result.info.height,
        byteLength: result.data.byteLength,
      };
    }
    edge = Math.max(MIN_PREVIEW_EDGE, Math.floor(edge * 0.8));
  }
}

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
