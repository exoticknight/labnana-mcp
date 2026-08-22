import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { IMAGE_RESULT_UI_META } from "./image-result-ui.js";
import type { GenerationResultEnvelope } from "./generation-result.js";
import { LabnanaClient, LabnanaError, sanitizeMessage } from "./client.js";
import {
  createImagePreview,
  describeImage,
  downloadImage,
  saveImageFile,
} from "./output.js";
import type { ImagePreview } from "./output.js";
import {
  ASPECT_RATIOS,
  IMAGE_SIZES,
  MODELS,
  TASK_STATUSES,
} from "./types.js";
import type {
  GenerationRequest,
  Provider,
  TaskDetailData,
  TaskItem,
  TaskImage,
  TaskListData,
  TaskStatus,
} from "./types.js";

const DEFAULT_MODEL = "gemini-3-pro-image" as const;

/** provider 由 model 唯一决定，不需要调用方传入 */
const MODEL_PROVIDERS: Record<(typeof MODELS)[number], Provider> = {
  "gemini-3-pro-image": "google",
  "gemini-3.1-flash-image": "google",
  "gpt-image-2": "openai",
  "wan2.7-image-pro": "alibaba",
  "wan2.7-image": "alibaba",
  "seedream-5-0-pro": "bytedance",
};

const MODEL_REFERENCE_LIMITS: Record<(typeof MODELS)[number], number> = {
  "gemini-3-pro-image": 14,
  "gemini-3.1-flash-image": 14,
  "gpt-image-2": 4,
  "wan2.7-image-pro": 9,
  "wan2.7-image": 9,
  "seedream-5-0-pro": 10,
};

const MODEL_ASPECT_RATIOS: Record<(typeof MODELS)[number], readonly (typeof ASPECT_RATIOS)[number][]> = {
  "gemini-3-pro-image": ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
  "gemini-3.1-flash-image": [...ASPECT_RATIOS],
  "gpt-image-2": ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
  "wan2.7-image-pro": ["1:1", "3:4", "4:3", "9:16", "16:9"],
  "wan2.7-image": ["1:1", "3:4", "4:3", "9:16", "16:9"],
  "seedream-5-0-pro": [...ASPECT_RATIOS],
};

const MODEL_DESCRIPTION =
  "图片生成模型，默认 gemini-3-pro-image。选择建议：" +
  "gemini-3-pro-image 综合最强、指令遵循和文字渲染好（15 积分/1K-2K）；" +
  "gemini-3.1-flash-image 快速便宜的日常生成（10 积分）；" +
  "gpt-image-2 性价比最高（4 积分起）；" +
  "wan2.7-image-pro / wan2.7-image 写实与海报风格；" +
  "seedream-5-0-pro 擅长精准局部编辑（配合参考图使用）";

function isSupportedFileUri(value: string): boolean {
  if (value.startsWith("gs://")) return value.length > "gs://".length;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

const referenceImageSchema = z
  .object({
    fileData: z
      .object({
        fileUri: z
          .string()
          .min(1, "fileUri 不能为空")
          .refine(isSupportedFileUri, "fileUri 必须是 gs:// 或不含凭据的 https:// URL"),
        mimeType: z.string().optional(),
      })
      .optional(),
    inlineData: z
      .object({
        data: z.string().min(1, "base64 数据不能为空"),
        mimeType: z.string().optional(),
      })
      .optional(),
  })
  .refine(
    (img) => img.fileData !== undefined || img.inlineData !== undefined,
    "referenceImages 中的每项必须包含 fileData 或 inlineData",
  );

const imageConfigSchema = z
  .object({
    imageSize: z.enum(IMAGE_SIZES).optional(),
    aspectRatio: z.enum(ASPECT_RATIOS).optional(),
    quality: z.string().optional(),
  })
  .optional();

const generationFields = {
  model: z.enum(MODELS, { description: MODEL_DESCRIPTION }).optional(),
  prompt: z.string().min(1, "prompt 不能为空"),
  referenceImages: z
    .array(referenceImageSchema)
    .max(14, "参考图片最多 14 张（GPT-Image-2 最多 4 张，Wan2.7 最多 9 张，Seedream 最多 10 张）")
    .optional()
    .describe("图生图 / 改图的参考图片，支持 fileUri（gs:// 或 https://）或 base64 inlineData"),
  imageConfig: imageConfigSchema,
};

interface GenerationLimitArgs {
  model?: (typeof MODELS)[number];
  referenceImages?: unknown[];
  imageConfig?: { imageSize?: (typeof IMAGE_SIZES)[number]; aspectRatio?: (typeof ASPECT_RATIOS)[number] };
}

function validateModelLimits(args: GenerationLimitArgs, ctx: z.RefinementCtx): void {
  const model = args.model ?? DEFAULT_MODEL;
  const referenceCount = args.referenceImages?.length ?? 0;
  const referenceLimit = MODEL_REFERENCE_LIMITS[model];
  if (referenceCount > referenceLimit) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: referenceLimit,
      type: "array",
      inclusive: true,
      path: ["referenceImages"],
      message: `${model} 最多支持 ${referenceLimit} 张参考图片`,
    });
  }

  const imageSize = args.imageConfig?.imageSize;
  if (
    imageSize === "4K" &&
    (model === "wan2.7-image" || model === "seedream-5-0-pro" ||
      (model === "wan2.7-image-pro" && referenceCount > 0))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["imageConfig", "imageSize"],
      message: `${model} 在当前请求中不支持 4K`,
    });
  }

  const aspectRatio = args.imageConfig?.aspectRatio;
  if (aspectRatio && !MODEL_ASPECT_RATIOS[model].includes(aspectRatio)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["imageConfig", "aspectRatio"],
      message: `${model} 不支持宽高比 ${aspectRatio}`,
    });
  }
}

// MCP SDK 需要最外层保持 ZodObject，才能在 tools/list 中发布完整 JSON Schema。
// 跨字段约束会把 ZodObject 包装成 ZodEffects，因此单独在工具处理器内执行。
const generationArgsSchema = z.object(generationFields);
const validatedGenerationArgsSchema = generationArgsSchema.superRefine(validateModelLimits);

const generateImageArgsSchema = z
  .object({
    ...generationFields,
    outputMode: z
      .enum(["hybrid", "file", "inline"])
      .optional()
      .describe(
          "结果返回方式：hybrid（默认）保存原图并内联有界预览，跨客户端兼容性最好；" +
          "file 只保存原图并返回定位信息；inline 不保存到 saveDir，有 URL 时返回有界预览，" +
          "无 URL 时把原图保存到默认恢复目录并返回有界预览",
      ),
    saveDir: z
      .string()
      .min(1)
      .optional()
      .describe("hybrid/file 模式下的保存目录，默认取 LABNANA_OUTPUT_DIR 或当前目录下的 labnana-images/"),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .optional()
      .describe("生成总超时秒数，默认 300（仅 4K 等异步路径需要等待时生效）"),
  });
const validatedGenerateImageArgsSchema = generateImageArgsSchema.superRefine(validateModelLimits);

type GenerationArgs = z.infer<typeof generationArgsSchema>;
type GenerateImageArgs = z.infer<typeof generateImageArgsSchema>;

const previewResultSchema = z.object({
  included: z.boolean(),
  mimeType: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  byteLength: z.number().int().nonnegative().optional(),
});

const imageArtifactResultSchema = z.object({
  index: z.number().int().nonnegative(),
  mimeType: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  byteLength: z.number().int().nonnegative().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  url: z.string().url().optional(),
  filePath: z.string().min(1).optional(),
  preview: previewResultSchema,
});

const generationResultOutputShape = {
  schemaVersion: z.literal(1),
  status: z.enum(["succeeded", "pending", "failed"]),
  retryable: z.boolean().optional(),
  message: z.string().optional(),
  taskId: z.string().optional(),
  images: z.array(imageArtifactResultSchema),
  generation: z
    .object({
      finishReason: z.string().optional(),
      modelVersion: z.string().optional(),
      responseId: z.string().optional(),
    })
    .optional(),
  warnings: z.array(z.string()).optional(),
  error: z
    .object({
      message: z.string(),
      details: z.unknown().optional(),
    })
    .optional(),
};

const generationResultSchema = z.object(generationResultOutputShape);
type OutputMode = NonNullable<GenerateImageArgs["outputMode"]>;

interface GeneratedImageSource {
  data?: Buffer;
  mimeType?: string;
  url?: string;
}

interface PreparedImages {
  artifacts: GenerationResultEnvelope["images"];
  previews: ImagePreview[];
  warnings: string[];
  unrecoverableOriginals: number[];
}

function toGenerationRequest(args: GenerationArgs): GenerationRequest {
  return {
    provider: MODEL_PROVIDERS[args.model ?? DEFAULT_MODEL],
    ...(args.model ? { model: args.model } : {}),
    prompt: args.prompt,
    ...(args.referenceImages && args.referenceImages.length > 0
      ? { referenceImages: args.referenceImages }
      : {}),
    ...(args.imageConfig && Object.keys(args.imageConfig).length > 0
      ? { imageConfig: args.imageConfig }
      : {}),
  };
}

function text(text: string): TextContent {
  return { type: "text", text };
}

function toGenerationToolResult(
  envelope: GenerationResultEnvelope,
  previews: ImagePreview[] = [],
  isError = false,
): CallToolResult {
  const parsed: GenerationResultEnvelope = generationResultSchema.parse(envelope);
  const content: Array<TextContent | ImageContent> = previews.map((preview) => ({
    type: "image",
    data: preview.data.toString("base64"),
    mimeType: preview.mimeType,
    annotations: { audience: ["user", "assistant"], priority: 1 },
  }));
  content.push(text(JSON.stringify(parsed, null, 2)));
  return {
    content,
    structuredContent: parsed,
    ...(isError ? { isError: true } : {}),
  };
}

async function prepareImages(
  sources: GeneratedImageSource[],
  outputMode: OutputMode,
  saveDir: string,
  recoveryDir: string,
): Promise<PreparedImages> {
  const artifacts: PreparedImages["artifacts"] = [];
  const previews: ImagePreview[] = [];
  const warnings: string[] = [];
  const unrecoverableOriginals: number[] = [];
  const shouldSave = outputMode !== "inline";
  const shouldPreview = outputMode !== "file";

  for (const [index, source] of sources.entries()) {
    let mimeType = source.mimeType ?? "image/png";
    let width: number | undefined;
    let height: number | undefined;
    let byteLength: number | undefined;
    let sha256: string | undefined;
    let filePath: string | undefined;
    let preview: ImagePreview | undefined;

    if (source.data) {
      byteLength = source.data.byteLength;
      try {
        const description = await describeImage(source.data, source.mimeType);
        mimeType = description.mimeType;
        width = description.width;
        height = description.height;
        byteLength = description.byteLength;
        sha256 = description.sha256;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        warnings.push(`图片 ${index + 1} 元数据读取失败：${sanitizeMessage(reason)}`);
      }

      const mustPersist = shouldSave || !source.url;
      if (mustPersist) {
        const targets = [
          ...(shouldSave ? [saveDir] : []),
          recoveryDir,
          path.join(tmpdir(), "labnana-mcp-recovery"),
        ].filter((target, targetIndex, all) => all.indexOf(target) === targetIndex);
        const failures: string[] = [];
        for (const target of targets) {
          try {
            filePath = await saveImageFile(target, source.data, mimeType);
            if (!shouldSave || target !== saveDir) {
              warnings.push(`图片 ${index + 1} 原图已保存到恢复目录：${filePath}`);
            }
            break;
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            failures.push(`${target}（${sanitizeMessage(reason)}）`);
          }
        }
        if (!filePath) {
          warnings.push(`图片 ${index + 1} 原图保存失败：${failures.join("；")}`);
          if (!source.url) unrecoverableOriginals.push(index);
        }
      }

      if (shouldPreview || (!filePath && !source.url)) {
        try {
          preview = await createImagePreview(source.data, mimeType);
          previews.push(preview);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          warnings.push(`图片 ${index + 1} 预览生成失败：${sanitizeMessage(reason)}`);
        }
      }
    }

    artifacts.push({
      index,
      mimeType,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(byteLength !== undefined ? { byteLength } : {}),
      ...(sha256 ? { sha256 } : {}),
      ...(source.url ? { url: source.url } : {}),
      ...(filePath ? { filePath } : {}),
      preview: preview
        ? {
            included: true,
            mimeType: preview.mimeType,
            width: preview.width,
            height: preview.height,
            byteLength: preview.byteLength,
          }
        : { included: false },
    });
  }

  return { artifacts, previews, warnings, unrecoverableOriginals };
}

// 无边界子串匹配以覆盖 snake_case（access_token）、camelCase（apiKey）、kebab-case（api-key）；
// 误伤（如 monkey、sessionStart）方向安全，宁可多脱敏
const SENSITIVE_KEY = /(auth|token|secret|credential|password|passwd|pwd|session|cookie|sid|key)/i;
const BINARY_CONTAINER_KEY = /^(inlineData|imageData|binaryData|blob)$/i;
const BINARY_DATA_KEY = /^(data|base64|bytes|content)$/i;
const MAX_DETAIL_CHARS = 2000;

function looksLikeBase64(value: string): boolean {
  if (/^data:[^;]+;base64,/i.test(value)) return true;
  const compact = value.replace(/\s/g, "");
  return (
    compact.length >= 32 &&
    compact.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  );
}

/** 递归脱敏错误详情：敏感键整值替换，其余字符串值再过字符串级凭据脱敏 */
function sanitizeDetail(value: unknown, depth = 0, redactData = false): unknown {
  if (depth > 5) return "[深度截断]";
  if (typeof value === "string") {
    return redactData && looksLikeBase64(value)
      ? "[BINARY_DATA_REDACTED]"
      : sanitizeMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetail(item, depth + 1, redactData));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k)
        ? "[REDACTED]"
        : sanitizeDetail(
            v,
            depth + 1,
            redactData || BINARY_CONTAINER_KEY.test(k) || BINARY_DATA_KEY.test(k),
          );
    }
    return out;
  }
  return value;
}

function sanitizeTaskItem(item: TaskItem): TaskItem {
  return item.failMsg === undefined
    ? item
    : { ...item, failMsg: sanitizeMessage(item.failMsg) };
}

function sanitizeTaskDetail(data: TaskDetailData): TaskDetailData {
  return sanitizeTaskItem(data);
}

function sanitizeTaskList(data: TaskListData): TaskListData {
  return { ...data, items: data.items.map(sanitizeTaskItem) };
}

function errorResult(error: unknown): CallToolResult {
  if (error instanceof LabnanaError) {
    let detail = "";
    if (error.detail !== undefined && error.detail !== null) {
      detail = `\n详情：${JSON.stringify(sanitizeDetail(error.detail)).slice(0, MAX_DETAIL_CHARS)}`;
    }
    return {
      content: [
        text(
          `Labnana API 错误（HTTP ${error.status}，业务码 ${error.code}）：${sanitizeMessage(
            error.message,
          )}${detail}`,
        ),
      ],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [text(`错误：${sanitizeMessage(message)}`)], isError: true };
}

function generationErrorResult(error: unknown, taskId?: string): CallToolResult {
  if (error instanceof LabnanaError) {
    const details =
      error.detail === undefined || error.detail === null
        ? undefined
        : sanitizeDetail(error.detail);
    return toGenerationToolResult(
      {
        schemaVersion: 1,
        status: "failed",
        retryable:
          error.status === 408 ||
          error.status === 429 ||
          error.status >= 500 ||
          error.code === -2 ||
          error.code === 29998,
        ...(taskId ? { taskId } : {}),
        images: [],
        error: {
          message: `Labnana API 错误（HTTP ${error.status}，业务码 ${error.code}）：${sanitizeMessage(error.message)}`,
          ...(details !== undefined ? { details } : {}),
        },
      },
      [],
      true,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return toGenerationToolResult(
    {
      schemaVersion: 1,
      status: "failed",
      retryable: true,
      ...(taskId ? { taskId } : {}),
      images: [],
      error: { message: `错误：${sanitizeMessage(message)}` },
    },
    [],
    true,
  );
}

async function downloadTaskImages(
  images: TaskImage[],
): Promise<{ sources: GeneratedImageSource[]; warnings: string[] }> {
  const sources: GeneratedImageSource[] = [];
  const warnings: string[] = [];
  for (const [index, image] of images.entries()) {
    if (!image.url) {
      warnings.push(`图片 ${index + 1} 未返回 URL`);
      continue;
    }
    try {
      const downloaded = await downloadImage(image.url);
      sources.push({
        data: downloaded.data,
        mimeType: downloaded.mimeType ?? image.mimeType,
        url: image.url,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`图片 ${index + 1} 下载失败：${sanitizeMessage(reason)}`);
      sources.push({ mimeType: image.mimeType, url: image.url });
    }
  }
  return { sources, warnings };
}

/** 从生成响应中提取全部图片 */
function extractImages(resp: {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
  }>;
}): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  for (const candidate of resp.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        images.push({
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType ?? "image/png",
        });
      }
    }
  }
  return images;
}

type PollOutcome =
  | { kind: "success" | "fail"; data: TaskDetailData }
  | { kind: "timeout"; lastStatus: TaskStatus | "unknown" }
  | { kind: "error"; error: unknown };

/** 轮询任务直到 success / fail / 超时；限流时退避而非直接失败 */
async function pollTask(
  client: LabnanaClient,
  taskId: string,
  timeoutSeconds: number,
  pollIntervalMs = 5000,
): Promise<PollOutcome> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastStatus: TaskStatus | "unknown" = "unknown";
  let rateLimitRetryMs = 20_000;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { kind: "timeout", lastStatus };

    let data: TaskDetailData;
    try {
      data = await client.getTask(taskId, { timeoutMs: remainingMs });
    } catch (error) {
      if (error instanceof LabnanaError && error.code === 29998) {
        const sleepMs = Math.min(rateLimitRetryMs, Math.max(0, deadline - Date.now()));
        if (sleepMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
        }
        rateLimitRetryMs = Math.min(30_000, rateLimitRetryMs + 10_000);
        continue;
      }
      if (error instanceof LabnanaError && error.code === -2 && Date.now() >= deadline) {
        return { kind: "timeout", lastStatus };
      }
      return { kind: "error", error };
    }

    lastStatus = data.status;
    rateLimitRetryMs = 20_000;
    if (data.status === "success") return { kind: "success", data };
    if (data.status === "fail") return { kind: "fail", data };

    const sleepMs = Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()));
    if (sleepMs <= 0) return { kind: "timeout", lastStatus };
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
}

export interface RegisterToolsOptions {
  /** file 模式的默认输出目录；未指定时为 cwd 下的 labnana-images/ */
  outputDir?: string;
}

export function registerTools(
  server: McpServer,
  client: LabnanaClient,
  options: RegisterToolsOptions = {},
): void {
  const defaultOutputDir =
    options.outputDir ?? path.join(process.cwd(), "labnana-images");

  server.registerTool(
    "get_subscription",
    {
      title: "获取订阅信息与积分余额",
      description:
        "获取当前 API Key 账户的订阅状态、可用积分（月度/永久/限时）、免费额度（freeUsages）与重置时间。",
    },
    async () => {
      try {
        const data = await client.getSubscription();
        return { content: [text(JSON.stringify(data, null, 2))] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "estimate_credits",
    {
      title: "预估图片生成所需积分",
      description:
        "根据模型、尺寸、宽高比等参数预估生成图片所需的积分。同步返回，不实际生成图片、不扣除积分。适合在批量生成或使用 4K 前先确认成本。",
      inputSchema: generationArgsSchema,
    },
    async (unvalidatedArgs: GenerationArgs) => {
      try {
        const args = validatedGenerationArgsSchema.parse(unvalidatedArgs);
        const data = await client.estimateCredits(toGenerationRequest(args));
        return { content: [text(JSON.stringify(data, null, 2))] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "generate_image",
    {
      title: "生成图片",
      description:
        "文生图 / 图生图 / 改图的一站式工具：默认保存完整原图，同时返回有大小上限的 MCP 图片预览、结构化元数据和 JSON 文本兜底。" +
        "大图（4K）会自动走异步任务并在内部等待完成，无需手动轮询。" +
        "支持 Gemini 系列、GPT-Image-2、Wan2.7、Seedream 5.0 Pro，模型由 model 参数选择，无需指定提供商。",
      inputSchema: generateImageArgsSchema,
      outputSchema: generationResultOutputShape,
      _meta: IMAGE_RESULT_UI_META,
    },
    async (unvalidatedArgs: GenerateImageArgs) => {
      try {
        const args = validatedGenerateImageArgsSchema.parse(unvalidatedArgs);
        const outputMode = args.outputMode ?? "hybrid";
        const saveDir = args.saveDir ?? defaultOutputDir;
        const request = toGenerationRequest(args);

        // 4K 响应体过大，走异步任务 + 内部轮询；其余走同步接口
        if (args.imageConfig?.imageSize === "4K") {
          const created = await client.generateImageAsync(request);
          const outcome = await pollTask(client, created.taskId, args.timeoutSeconds ?? 300);

          if (outcome.kind === "timeout") {
            return toGenerationToolResult({
              schemaVersion: 1,
              status: "pending",
              retryable: true,
              taskId: created.taskId,
              images: [],
              message:
                `任务仍在运行（最后状态 ${outcome.lastStatus}）。` +
                "可稍后调用 get_generation_task 获取图片预览和原图链接。",
            });
          }
          if (outcome.kind === "error") return generationErrorResult(outcome.error, created.taskId);
          if (outcome.kind === "fail") {
            const detail = sanitizeTaskDetail(outcome.data);
            return toGenerationToolResult(
              {
                schemaVersion: 1,
                status: "failed",
                retryable: false,
                taskId: created.taskId,
                images: [],
                error: {
                  message: `图片生成失败${detail.failMsg ? `：${detail.failMsg}` : ""}`,
                  details: detail,
                },
              },
              [],
              true,
            );
          }

          const images = outcome.data.images ?? [];
          if (images.length === 0 || images.every((image) => !image.url)) {
            return toGenerationToolResult(
              {
                schemaVersion: 1,
                status: "failed",
                retryable: true,
                taskId: created.taskId,
                images: [],
                error: { message: "任务成功但未返回图片链接" },
              },
              [],
              true,
            );
          }

          const downloaded = await downloadTaskImages(images);
          const prepared = await prepareImages(
            downloaded.sources,
            outputMode,
            saveDir,
            defaultOutputDir,
          );
          const warnings = [...downloaded.warnings, ...prepared.warnings];
          return toGenerationToolResult(
            {
              schemaVersion: 1,
              status: "succeeded",
              taskId: created.taskId,
              images: prepared.artifacts,
              ...(warnings.length > 0 ? { warnings } : {}),
            },
            prepared.previews,
          );
        }

        const resp = await client.generateImage(request);
        const images = extractImages(resp);
        const generation = {
          ...(resp.candidates?.[0]?.finishReason
            ? { finishReason: resp.candidates[0].finishReason }
            : {}),
          ...(resp.modelVersion ? { modelVersion: resp.modelVersion } : {}),
          ...(resp.responseId ? { responseId: resp.responseId } : {}),
        };
        if (images.length === 0) {
          return toGenerationToolResult(
            {
              schemaVersion: 1,
              status: "failed",
              retryable: false,
              images: [],
              ...(Object.keys(generation).length > 0 ? { generation } : {}),
              error: {
                message: "图片生成未返回图片数据",
                details: {
                  safetyRatings: resp.candidates?.[0]?.safetyRatings,
                  promptFeedback: resp.promptFeedback,
                },
              },
            },
            [],
            true,
          );
        }
        const prepared = await prepareImages(
          images.map((image) => ({
            data: Buffer.from(image.data, "base64"),
            mimeType: image.mimeType,
          })),
          outputMode,
          saveDir,
          defaultOutputDir,
        );
        if (prepared.unrecoverableOriginals.length > 0) {
          return toGenerationToolResult(
            {
              schemaVersion: 1,
              status: "failed",
              retryable: false,
              images: prepared.artifacts,
              ...(Object.keys(generation).length > 0 ? { generation } : {}),
              ...(prepared.warnings.length > 0 ? { warnings: prepared.warnings } : {}),
              error: {
                message: "图片已生成，但原图无法保存且上游未提供可恢复链接",
                details: { imageIndexes: prepared.unrecoverableOriginals },
              },
            },
            prepared.previews,
            true,
          );
        }
        return toGenerationToolResult(
          {
            schemaVersion: 1,
            status: "succeeded",
            images: prepared.artifacts,
            ...(Object.keys(generation).length > 0 ? { generation } : {}),
            ...(prepared.warnings.length > 0 ? { warnings: prepared.warnings } : {}),
          },
          prepared.previews,
        );
      } catch (error) {
        return generationErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_generation_tasks",
    {
      title: "获取图片生成任务列表",
      description: "按创建时间倒序返回当前 API Key 用户的图片生成任务历史，可按状态过滤。",
      inputSchema: {
        page: z.number().int().min(1).default(1).describe("页码，默认 1"),
        pageSize: z.number().int().min(1).max(100).default(20).describe("每页数量，默认 20"),
        status: z.enum(TASK_STATUSES).optional().describe("按状态过滤：pending / generating / success / fail"),
      },
    },
    async (args: { page?: number; pageSize?: number; status?: (typeof TASK_STATUSES)[number] }) => {
      try {
        const data = await client.listTasks({
          page: args.page,
          pageSize: args.pageSize,
          status: args.status,
        });
        return { content: [text(JSON.stringify(sanitizeTaskList(data), null, 2))] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  registerAppTool(
    server,
    "get_generation_task",
    {
      title: "获取图片生成任务详情",
      description:
        "查询图片生成任务状态与结果。任务成功时返回统一结构化 envelope、有界 MCP 图片预览和原图 URL。" +
        "generate_image 等待超时后可用返回的 taskId 在这里取回结果。",
      inputSchema: {
        taskId: z.string().min(1, "taskId 不能为空"),
      },
      outputSchema: generationResultOutputShape,
      _meta: IMAGE_RESULT_UI_META,
    },
    async (args: { taskId: string }) => {
      try {
        const data = sanitizeTaskDetail(await client.getTask(args.taskId));
        if (data.status === "fail") {
          return toGenerationToolResult(
            {
              schemaVersion: 1,
              status: "failed",
              retryable: false,
              taskId: data.taskId,
              images: [],
              error: {
                message: `图片生成失败${data.failMsg ? `：${data.failMsg}` : ""}`,
                details: data,
              },
            },
            [],
            true,
          );
        }
        if (data.status !== "success") {
          return toGenerationToolResult({
            schemaVersion: 1,
            status: "pending",
            retryable: true,
            taskId: data.taskId,
            images: (data.images ?? []).map((image, index) => ({
              index,
              mimeType: image.mimeType ?? "image/png",
              url: image.url,
              preview: { included: false },
            })),
            message: `任务当前状态：${data.status}`,
          });
        }

        const downloaded = await downloadTaskImages(data.images ?? []);
        if (downloaded.sources.length === 0) {
          return toGenerationToolResult(
            {
              schemaVersion: 1,
              status: "failed",
              retryable: true,
              taskId: data.taskId,
              images: [],
              error: { message: "任务成功但未返回图片链接", details: data },
            },
            [],
            true,
          );
        }
        const prepared = await prepareImages(
          downloaded.sources,
          "inline",
          defaultOutputDir,
          defaultOutputDir,
        );
        const allWarnings = [...downloaded.warnings, ...prepared.warnings];
        return toGenerationToolResult(
          {
            schemaVersion: 1,
            status: "succeeded",
            taskId: data.taskId,
            images: prepared.artifacts,
            ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
          },
          prepared.previews,
        );
      } catch (error) {
        return generationErrorResult(error, args.taskId);
      }
    },
  );
}
