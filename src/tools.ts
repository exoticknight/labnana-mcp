import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { z } from "zod";
import { LabnanaClient, LabnanaError, sanitizeMessage } from "./client.js";
import { downloadImage, saveImageFile } from "./output.js";
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

const generationArgsSchema = z.object(generationFields).superRefine(validateModelLimits);

const generateImageArgsSchema = z
  .object({
    ...generationFields,
    outputMode: z
      .enum(["file", "inline"])
      .optional()
      .describe(
        "结果返回方式：file（默认）把图片保存到本地并返回文件路径，适合 Claude Code 等有文件系统的环境；" +
          "inline 以 MCP image content 内联返回，适合 Claude Desktop 直接预览",
      ),
    saveDir: z
      .string()
      .min(1)
      .optional()
      .describe("file 模式下的保存目录，默认取 LABNANA_OUTPUT_DIR 环境变量或当前目录下的 labnana-images/"),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .optional()
      .describe("生成总超时秒数，默认 300（仅 4K 等异步路径需要等待时生效）"),
  })
  .superRefine(validateModelLimits);

type GenerationArgs = z.infer<typeof generationArgsSchema>;
type GenerateImageArgs = z.infer<typeof generateImageArgsSchema>;

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

// 无边界子串匹配以覆盖 snake_case（access_token）、camelCase（apiKey）、kebab-case（api-key）；
// 误伤（如 monkey、sessionStart）方向安全，宁可多脱敏
const SENSITIVE_KEY = /(auth|token|secret|credential|password|passwd|pwd|session|cookie|sid|key)/i;
const MAX_DETAIL_CHARS = 2000;

/** 递归脱敏错误详情：敏感键整值替换，其余字符串值再过字符串级凭据脱敏 */
function sanitizeDetail(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[深度截断]";
  if (typeof value === "string") return sanitizeMessage(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetail(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : sanitizeDetail(v, depth + 1);
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

/** 从生成响应中提取第一张图片 */
function extractImage(resp: {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
  }>;
}): { data: string; mimeType: string } | null {
  for (const candidate of resp.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType ?? "image/png",
        };
      }
    }
  }
  return null;
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
    async (args: GenerationArgs) => {
      try {
        const data = await client.estimateCredits(toGenerationRequest(args));
        return { content: [text(JSON.stringify(data, null, 2))] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "generate_image",
    {
      title: "生成图片",
      description:
        "文生图 / 图生图 / 改图的一站式工具：传入 prompt（可带参考图片），完成后默认把图片保存到本地并返回文件路径（outputMode=inline 时内联返回图片内容）。" +
        "大图（4K）会自动走异步任务并在内部等待完成，无需手动轮询。" +
        "支持 Gemini 系列、GPT-Image-2、Wan2.7、Seedream 5.0 Pro，模型由 model 参数选择，无需指定提供商。",
      inputSchema: generateImageArgsSchema,
    },
    async (args: GenerateImageArgs) => {
      const outputMode = args.outputMode ?? "file";
      const saveDir = args.saveDir ?? defaultOutputDir;
      const request = toGenerationRequest(args);

      try {
        // 4K 响应体过大，走异步任务 + 内部轮询；其余走同步接口
        if (args.imageConfig?.imageSize === "4K") {
          const created = await client.generateImageAsync(request);
          const outcome = await pollTask(client, created.taskId, args.timeoutSeconds ?? 300);

          if (outcome.kind === "timeout") {
            return {
              content: [
                text(
                  `任务已创建但等待超时（最后状态 ${outcome.lastStatus}），taskId=${created.taskId}。` +
                    `可稍后调用 get_generation_task 获取图片链接。`,
                ),
              ],
              isError: true,
            };
          }
          if (outcome.kind === "error") return errorResult(outcome.error);
          if (outcome.kind === "fail") {
            return {
              content: [
                text(`图片生成失败：\n${JSON.stringify(sanitizeTaskDetail(outcome.data), null, 2)}`),
              ],
              isError: true,
            };
          }

          const images = outcome.data.images ?? [];
          const first = images[0];
          if (!first?.url) {
            return {
              content: [text(`任务成功但未返回图片链接，taskId=${created.taskId}`)],
              isError: true,
            };
          }
          if (outputMode === "inline") {
            return {
              content: [
                text(
                  JSON.stringify(
                    { taskId: created.taskId, images: images.map((img) => img.url) },
                    null,
                    2,
                  ),
                ),
              ],
            };
          }
          try {
            const downloaded = await downloadImage(first.url);
            const filePath = await saveImageFile(
              saveDir,
              downloaded.data,
              downloaded.mimeType ?? first.mimeType,
            );
            return {
              content: [
                text(
                  JSON.stringify(
                    {
                      filePath,
                      imageUrl: first.url,
                      taskId: created.taskId,
                      mimeType: downloaded.mimeType ?? first.mimeType,
                    },
                    null,
                    2,
                  ),
                ),
              ],
            };
          } catch (saveError) {
            const reason = saveError instanceof Error ? saveError.message : String(saveError);
            return {
              content: [
                text(
                  `图片已生成但本地保存失败（${sanitizeMessage(reason)}），可直接使用图片链接：\n` +
                    JSON.stringify({ taskId: created.taskId, images: images.map((img) => img.url) }, null, 2),
                ),
              ],
            };
          }
        }

        const resp = await client.generateImage(request);
        const image = extractImage(resp);
        const meta: Record<string, unknown> = {
          finishReason: resp.candidates?.[0]?.finishReason,
          modelVersion: resp.modelVersion,
          responseId: resp.responseId,
        };
        if (!image) {
          return {
            content: [
              text(
                `图片生成未返回图片数据：\n${JSON.stringify(
                  {
                    ...meta,
                    safetyRatings: resp.candidates?.[0]?.safetyRatings,
                    promptFeedback: resp.promptFeedback,
                  },
                  null,
                  2,
                )}`,
              ),
            ],
            isError: true,
          };
        }

        if (outputMode === "inline") {
          const content: Array<TextContent | ImageContent> = [
            { type: "image", data: image.data, mimeType: image.mimeType },
            text(JSON.stringify(meta, null, 2)),
          ];
          return { content };
        }

        try {
          const filePath = await saveImageFile(
            saveDir,
            Buffer.from(image.data, "base64"),
            image.mimeType,
          );
          return {
            content: [
              text(JSON.stringify({ filePath, mimeType: image.mimeType, ...meta }, null, 2)),
            ],
          };
        } catch (saveError) {
          // 保存失败（如目录不可写）时退回内联返回，不让已扣积分的结果丢失
          const reason = saveError instanceof Error ? saveError.message : String(saveError);
          const content: Array<TextContent | ImageContent> = [
            { type: "image", data: image.data, mimeType: image.mimeType },
            text(
              `本地保存失败（${sanitizeMessage(reason)}），已改为内联返回图片。\n` +
                JSON.stringify(meta, null, 2),
            ),
          ];
          return { content };
        }
      } catch (error) {
        return errorResult(error);
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

  server.registerTool(
    "get_generation_task",
    {
      title: "获取图片生成任务详情",
      description:
        "查询图片生成任务状态与结果。任务成功后 images 字段为公开图片链接数组，可直接下载。" +
        "generate_image 等待超时后可用返回的 taskId 在这里取回结果。",
      inputSchema: {
        taskId: z.string().min(1, "taskId 不能为空"),
      },
    },
    async (args: { taskId: string }) => {
      try {
        const data = await client.getTask(args.taskId);
        return { content: [text(JSON.stringify(sanitizeTaskDetail(data), null, 2))] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
