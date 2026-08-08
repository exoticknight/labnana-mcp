/**
 * 类型定义：Labnana OpenAPI（https://docs.marswave.ai/openapi-labnana.html）
 * 接入指南：https://labnana.com/docs/openapi/guide
 */

export const PROVIDERS = ["google", "openai", "alibaba", "bytedance"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const MODELS = [
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gpt-image-2",
  "wan2.7-image-pro",
  "wan2.7-image",
  "seedream-5-0-pro",
] as const;
export type Model = (typeof MODELS)[number];

export const IMAGE_SIZES = ["1K", "2K", "4K"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const TASK_STATUSES = ["pending", "generating", "success", "fail"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ReferenceImageFileData {
  /** 图片地址：gs://、https:// 均可；大图建议用 fileUri */
  fileUri: string;
  mimeType?: string;
}

export interface ReferenceImageInlineData {
  /** base64 编码的图片数据（适合小图，整体请求体上限 20 MB） */
  data: string;
  mimeType?: string;
}

export interface ReferenceImage {
  fileData?: ReferenceImageFileData;
  inlineData?: ReferenceImageInlineData;
}

export interface ImageConfig {
  /** 分辨率：1K / 2K / 4K（wan2.7-image 不支持 4K；seedream-5-0-pro 仅 1K/2K） */
  imageSize?: ImageSize;
  /** 宽高比；GPT-Image-2 可不传由服务端自动选择 */
  aspectRatio?: AspectRatio;
  /** 质量档位（透传给服务端） */
  quality?: string;
}

export interface GenerationRequest {
  provider: Provider;
  model?: Model;
  prompt: string;
  referenceImages?: ReferenceImage[];
  imageConfig?: ImageConfig;
}

export interface GenerationResponse {
  candidates: Array<{
    content: {
      role?: string;
      parts: Array<{
        inlineData?: { mimeType: string; data: string };
        thoughtSignature?: string;
      }>;
    };
    finishReason?: string;
    safetyRatings?: Array<{ category: string; probability: string }>;
  }>;
  promptFeedback?: { safetyRatings: unknown } | null;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
  responseId?: string;
}

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface SubscriptionData {
  subscriptionStartedAt?: number;
  subscriptionExpiresAt?: number;
  usageAvailableMonthlyCredits?: number;
  usageTotalMonthlyCredits?: number;
  usageAvailablePermanentCredits?: number;
  usageTotalPermanentCredits?: number;
  usageAvailableLimitedTimeCredits?: number;
  totalAvailableCredits?: number;
  resetAt?: number;
  platform?: string;
  renewStatus?: boolean;
  paidStatus?: boolean;
  subscriptionPlan?: { name?: string; duration?: string; platform?: string };
  freeUsages?: Record<
    string,
    {
      remaining?: number;
      unlimited?: boolean;
      resourceType?: string;
      resourceKey?: string;
      unit?: string;
    }
  >;
}

export interface CreditEstimateData {
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
  quality?: string;
  pixels?: { width?: number; height?: number; size?: string };
  credits?: number;
  canGenerate?: boolean;
  requiresSubscription?: boolean;
  pricing?: Record<string, unknown>;
  warnings?: string[];
}

export interface AsyncTaskCreatedData {
  taskId: string;
  status: TaskStatus;
}

export interface TaskImage {
  url: string;
  mimeType?: string;
}

export interface TaskItem {
  taskId: string;
  status: TaskStatus;
  images?: TaskImage[];
  failMsg?: string;
  createdAt?: number;
  completedAt?: number;
}

export interface TaskListData {
  items: TaskItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TaskDetailData {
  taskId: string;
  status: TaskStatus;
  images?: TaskImage[];
  failMsg?: string;
  createdAt?: number;
  completedAt?: number;
}
