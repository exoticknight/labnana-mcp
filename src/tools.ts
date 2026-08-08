import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ImageContent, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LabnanaClient, LabnanaError, sanitizeMessage } from "./client.js";
import {
  ASPECT_RATIOS,
  IMAGE_SIZES,
  MODELS,
  PROVIDERS,
  TASK_STATUSES,
} from "./types.js";
import type {
  GenerationRequest,
  TaskDetailData,
  TaskItem,
  TaskListData,
  TaskStatus,
} from "./types.js";

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

/** 与 POST /openapi/v1/images/generation 一致的请求参数 */
const generationArgsSchema = z
  .object({
    provider: z.enum(PROVIDERS, {
      description: "图片模型提供商：google / openai / alibaba / bytedance",
    }),
    model: z
      .enum(MODELS, {
        description: "图片生成模型，默认 gemini-3-pro-image",
      })
      .optional(),
    prompt: z.string().min(1, "prompt 不能为空"),
    referenceImages: z
      .array(referenceImageSchema)
      .max(14, "参考图片最多 14 张（GPT-Image-2 最多 4 张，Wan2.7 最多 9 张，Seedream 最多 10 张）")
      .optional(),
    imageConfig: imageConfigSchema,
  })
  .superRefine((args, ctx) => {
    const model = args.model ?? "gemini-3-pro-image";
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
  });

type GenerationArgs = z.infer<typeof generationArgsSchema>;

function toGenerationRequest(args: GenerationArgs): GenerationRequest {
  return {
    provider: args.provider,
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

export function registerTools(server: McpServer, client: LabnanaClient): void {
  const genArgs = generationArgsSchema;

  server.registerTool(
    "get_subscription",
    {
      title: "获取订阅信息与积分余额",
      description:
        "获取当前 API Key 账户的订阅状态、可用积分（月度/永久/限时）、免费额度（freeUsages）与重置时间。对应 GET /openapi/v1/user/subscription。",
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
        "根据 provider、模型、尺寸、宽高比等参数预估生成图片所需的积分。同步返回，不实际生成图片、不扣除积分。对应 POST /openapi/v1/images/generation/estimate-credits。",
      inputSchema: genArgs,
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
      title: "生成图片（同步）",
      description:
        "同步生成图片，直接返回 base64 图片数据与生成元数据。支持 Gemini 系列、GPT-Image-2、Wan2.7、Seedream 5.0 Pro。可传参考图片（fileUri 或 base64 inlineData）做图生图、改图。对应 POST /openapi/v1/images/generation。注意：同步接口返回体积大，4K 图片建议改用 generate_image_async。",
      inputSchema: genArgs,
    },
    async (args: GenerationArgs) => {
      try {
        const resp = await client.generateImage(toGenerationRequest(args));
        const image = extractImage(resp);
        const content: Array<TextContent | ImageContent> = [];
        const meta: Record<string, unknown> = {
          finishReason: resp.candidates?.[0]?.finishReason,
          modelVersion: resp.modelVersion,
          responseId: resp.responseId,
          usageMetadata: resp.usageMetadata,
          safetyRatings: resp.candidates?.[0]?.safetyRatings,
          promptFeedback: resp.promptFeedback,
          hasInlineImage: Boolean(image),
        };
        if (!image) {
          return {
            content: [
              text(
                `图片生成未返回图片数据：\n${JSON.stringify(meta, null, 2)}`,
              ),
            ],
            isError: true,
          };
        }
        content.push({ type: "image", data: image.data, mimeType: image.mimeType });
        content.push(text(JSON.stringify(meta, null, 2)));
        return { content };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "generate_image_async",
    {
      title: "生成图片（异步任务）",
      description:
        "创建图片生成任务并立即返回 taskId，不阻塞等待。任务成功后图片为公开链接，可用 get_generation_task 查询详情，或用 wait_for_generation_task 等待完成。适合大图、批量生成。对应 POST /openapi/v1/images/generation/async。",
      inputSchema: genArgs,
    },
    async (args: GenerationArgs) => {
      try {
        const data = await client.generateImageAsync(toGenerationRequest(args));
        return {
          content: [
            text(
              `任务已创建：\n${JSON.stringify(data, null, 2)}\n\n` +
                `使用 get_generation_task 查询状态（taskId=${data.taskId}），或用 wait_for_generation_task 等待完成。`,
            ),
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_generation_tasks",
    {
      title: "获取图片生成任务列表",
      description:
        "按创建时间倒序返回当前 API Key 用户的图片生成任务列表。对应 GET /openapi/v1/images/generation/tasks。",
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
        "查询图片生成任务状态。任务成功后 images 字段为公开图片链接数组，可直接下载。对应 GET /openapi/v1/images/generation/tasks/{taskId}。",
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

  server.registerTool(
    "wait_for_generation_task",
    {
      title: "等待图片生成任务完成",
      description:
        "轮询等待异步生成任务完成（success / fail），返回公开图片链接或失败原因。适合在 generate_image_async 之后直接调用，避免手动多次轮询。",
      inputSchema: {
        taskId: z.string().min(1, "taskId 不能为空"),
        timeoutSeconds: z.number().int().min(1).max(3600).default(300).describe("最长等待秒数，默认 300"),
        pollIntervalMs: z.number().int().min(500).max(30000).default(5000).describe("轮询间隔毫秒，默认 5000"),
      },
    },
    async (args: { taskId: string; timeoutSeconds?: number; pollIntervalMs?: number }) => {
      const deadline = Date.now() + (args.timeoutSeconds ?? 300) * 1000;
      const interval = args.pollIntervalMs ?? 5000;
      let lastStatus: TaskStatus | "unknown" = "unknown";
      let rateLimitRetryMs = 20_000;
      const timeoutResult = () => ({
        content: [
          text(
            `等待超时：任务仍处于 ${lastStatus} 状态，taskId=${args.taskId}。` +
              `可继续调用 get_generation_task 或再次 wait_for_generation_task 查询。`,
          ),
        ],
        isError: true,
      });
      try {
        for (;;) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) return timeoutResult();

          let data: TaskDetailData;
          try {
            data = await client.getTask(args.taskId, { timeoutMs: remainingMs });
          } catch (error) {
            if (error instanceof LabnanaError && error.code === 29998) {
              const sleepMs = Math.min(rateLimitRetryMs, Math.max(0, deadline - Date.now()));
              if (sleepMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, sleepMs));
              }
              rateLimitRetryMs = Math.min(30_000, rateLimitRetryMs + 10_000);
              continue;
            }
            if (
              error instanceof LabnanaError &&
              error.code === -2 &&
              Date.now() >= deadline
            ) {
              return timeoutResult();
            }
            return errorResult(error);
          }

          lastStatus = data.status;
          rateLimitRetryMs = 20_000;
          const safeData = sanitizeTaskDetail(data);
          if (data.status === "success") {
            return {
              content: [
                text(
                  `任务完成（success）：\n${JSON.stringify(safeData, null, 2)}`,
                ),
              ],
            };
          }
          if (data.status === "fail") {
            return {
              content: [
                text(
                  `任务失败（fail）：\n${JSON.stringify(safeData, null, 2)}`,
                ),
              ],
              isError: true,
            };
          }
          const sleepMs = Math.min(interval, Math.max(0, deadline - Date.now()));
          if (sleepMs <= 0) return timeoutResult();
          await new Promise((resolve) => setTimeout(resolve, sleepMs));
        }
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
