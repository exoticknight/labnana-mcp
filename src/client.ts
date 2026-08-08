import type {
  AsyncTaskCreatedData,
  CreditEstimateData,
  GenerationRequest,
  GenerationResponse,
  SubscriptionData,
  TaskDetailData,
  TaskListData,
  TaskStatus,
} from "./types.js";

/** Labnana API 业务错误（HTTP 400 时响应体含 code/message） */
export class LabnanaError extends Error {
  readonly code: number;
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, code: number, message: string, detail?: unknown) {
    super(message);
    this.name = "LabnanaError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const DEFAULT_BASE_URL = "https://api.labnana.com";
const MAX_REQUEST_BODY_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeBaseUrl(rawBaseUrl?: string): string {
  const value = rawBaseUrl?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("baseUrl 不是合法 URL");
  }

  const hostname = url.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("baseUrl 必须使用 HTTPS（HTTP 仅允许 localhost 或 loopback 地址）");
  }
  if (url.username || url.password) {
    throw new Error("baseUrl 不得包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new Error("baseUrl 不得包含 query 或 hash");
  }
  return url.toString().replace(/\/+$/, "");
}

/** 字符串级凭据脱敏：Bearer/Token/Api-Key 后接的凭据、lh_ 前缀 API key */
export function sanitizeMessage(message: string): string {
  return message
    .replace(/\b(Bearer|Token|Api[- ]?Key)\s+[A-Za-z0-9._\-]{4,}/gi, "$1 [REDACTED]")
    .replace(/lh_[A-Za-z0-9._\-]{4,}/gi, "lh_[REDACTED]");
}

export interface LabnanaClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Labnana OpenAPI 客户端。
 * 文档：https://docs.marswave.ai/openapi-labnana.html
 */
export class LabnanaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: LabnanaClientOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new Error("LABNANA_API_KEY 未配置：请设置环境变量 LABNANA_API_KEY");
    }
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs 必须是大于 0 的有限数值");
    }
  }

  /** 获取订阅详情与积分余额 */
  async getSubscription(): Promise<SubscriptionData> {
    return this.request<SubscriptionData>("/openapi/v1/user/subscription", { method: "GET" });
  }

  /** 预估图片生成所需积分（不实际生成、不扣积分） */
  async estimateCredits(req: GenerationRequest): Promise<CreditEstimateData> {
    return this.request<CreditEstimateData>("/openapi/v1/images/generation/estimate-credits", {
      method: "POST",
      body: req,
    });
  }

  /** 同步生成图片，返回 base64 图片数据 */
  async generateImage(req: GenerationRequest): Promise<GenerationResponse> {
    return this.request<GenerationResponse>("/openapi/v1/images/generation", {
      method: "POST",
      body: req,
    });
  }

  /** 异步创建图片生成任务，返回 taskId */
  async generateImageAsync(req: GenerationRequest): Promise<AsyncTaskCreatedData> {
    return this.request<AsyncTaskCreatedData>("/openapi/v1/images/generation/async", {
      method: "POST",
      body: req,
    });
  }

  /** 获取图片生成任务列表（按创建时间倒序） */
  async listTasks(params?: {
    page?: number;
    pageSize?: number;
    status?: TaskStatus;
  }): Promise<TaskListData> {
    const qs = new URLSearchParams();
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.pageSize != null) qs.set("pageSize", String(params.pageSize));
    if (params?.status != null) qs.set("status", params.status);
    const query = qs.toString();
    return this.request<TaskListData>(
      `/openapi/v1/images/generation/tasks${query ? `?${query}` : ""}`,
      { method: "GET" },
    );
  }

  /** 获取图片生成任务详情 */
  async getTask(taskId: string, options?: { timeoutMs?: number }): Promise<TaskDetailData> {
    return this.request<TaskDetailData>(
      `/openapi/v1/images/generation/tasks/${encodeURIComponent(taskId)}`,
      { method: "GET", timeoutMs: options?.timeoutMs },
    );
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown; timeoutMs?: number },
  ): Promise<T> {
    const requestTimeoutMs = init.timeoutMs ?? this.timeoutMs;
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error("timeoutMs 必须是大于 0 的有限数值");
    }
    const serializedBody = init.body !== undefined ? JSON.stringify(init.body) : undefined;
    if (
      serializedBody !== undefined &&
      new TextEncoder().encode(serializedBody).byteLength > MAX_REQUEST_BODY_BYTES
    ) {
      throw new LabnanaError(0, -3, "请求体超过 20 MB 上限");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(init.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: serializedBody,
        signal: controller.signal,
      });

      const text = await response.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }

      if (!response.ok) {
        const code =
          json && typeof json === "object" && "code" in json
            ? Number((json as { code: unknown }).code)
            : NaN;
        const message =
          json && typeof json === "object" && "message" in json
            ? String((json as { message: unknown }).message)
            : `HTTP ${response.status} ${response.statusText}`;
        throw new LabnanaError(response.status, Number.isNaN(code) ? -1 : code, message, json);
      }

      // 2xx 但响应体不是 JSON：本 API 所有端点都返回 JSON，视为异常而非静默 null
      if (!text) {
        throw new LabnanaError(response.status, -1, "响应体为空（预期 JSON）");
      }
      if (json === null) {
        throw new LabnanaError(
          response.status,
          -1,
          `响应不是合法 JSON：${sanitizeMessage(text.length > 200 ? `${text.slice(0, 200)}...` : text)}`,
        );
      }

      // 成功响应可能直接返回业务数据（如生成接口的 candidates），也可能带 code/message/data 信封；
      // 纯错误信封（{code, message}，无 data）同样按错误处理
      if (typeof json === "object" && json !== null && "code" in json) {
        const envelope = json as { code: unknown; message?: string; data?: T };
        const code = Number(envelope.code);
        if (!Number.isNaN(code) && code !== 0) {
          throw new LabnanaError(response.status, code, envelope.message || "未知错误", json);
        }
        if ("data" in json) {
          return envelope.data as T;
        }
      }
      return json as T;
    } catch (error) {
      if (error instanceof LabnanaError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new LabnanaError(0, -2, `请求超时（${requestTimeoutMs}ms）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
