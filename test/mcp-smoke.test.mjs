import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(__dirname, "..", "dist", "index.js");

const SUBSCRIPTION_DATA = {
  code: 0,
  message: "",
  data: {
    usageAvailableMonthlyCredits: 80,
    usageTotalMonthlyCredits: 100,
    totalAvailableCredits: 150,
    resetAt: 1721005200000,
    platform: "web",
    paidStatus: true,
    subscriptionPlan: { name: "pro", duration: "monthly", platform: "web" },
    freeUsages: {
      "image:gpt-image-2:generation": {
        remaining: 3,
        unlimited: false,
        resourceType: "image",
        resourceKey: "gpt-image-2",
        unit: "generation",
      },
    },
  },
};

const GENERATION_RESPONSE = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: "aGVsbG8taW1hZ2U=" } },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 1290, totalTokenCount: 1390 },
  modelVersion: "gemini-3-pro-image",
  responseId: "test-response-1",
};

const ESTIMATE_DATA = {
  code: 0,
  message: "",
  data: {
    model: "gemini-3-pro-image",
    imageSize: "2K",
    aspectRatio: "16:9",
    credits: 15,
    canGenerate: true,
    requiresSubscription: false,
    warnings: [],
  },
};

const TASK_CREATED = { code: 0, message: "", data: { taskId: "task-123", status: "pending" } };
const TASK_DETAIL = {
  code: 0,
  message: "",
  data: {
    taskId: "task-123",
    status: "success",
    images: [{ url: "https://assets.listenhub.ai/.../0.png", mimeType: "image/png" }],
    createdAt: 1718230400000,
    completedAt: 1718230460000,
  },
};

/** 记录收到的请求，供断言 */
const received = [];

const mockServer = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const url = new URL(req.url, "http://localhost");
    const record = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      auth: req.headers.authorization ?? null,
      body: body ? JSON.parse(body) : null,
    };
    received.push(record);

    const json = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.method === "GET" && url.pathname === "/openapi/v1/user/subscription") {
      return json(200, SUBSCRIPTION_DATA);
    }
    if (req.method === "POST" && url.pathname === "/openapi/v1/images/generation/estimate-credits") {
      return json(200, ESTIMATE_DATA);
    }
    if (req.method === "POST" && url.pathname === "/openapi/v1/images/generation") {
      const bodyJson = body ? JSON.parse(body) : null;
      if (bodyJson?.prompt === "__insufficient__") {
        return json(200, { code: 26004, message: "积分不足" });
      }
      if (bodyJson?.prompt === "__notjson__") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("boom, not json");
      }
      if (bodyJson?.prompt === "__no_image__") {
        return json(200, {
          candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }],
        });
      }
      if (bodyJson?.prompt === "__echo_key__") {
        return json(400, {
          code: 29003,
          message: "bad request",
          detail: { requestId: "r-1", authorization: "Bearer test-key-123" },
        });
      }
      if (bodyJson?.prompt === "__echo_password__") {
        return json(400, {
          code: 29003,
          message: "bad request",
          detail: { requestId: "r-2", password: "s3cret-pwd", nested: { passwd: "nested-pwd" } },
        });
      }
      if (bodyJson?.prompt === "__echo_camel__") {
        return json(400, {
          code: 29003,
          message: "bad request",
          detail: { apiKey: "camel-api-key", accessKey: "camel-access-key" },
        });
      }
      if (bodyJson?.prompt === "__echo_token__") {
        return json(400, {
          code: 29003,
          message: "bad request",
          detail: {
            access_token: "tok-1",
            auth_token: "tok-2",
            sessionId: "sess-1",
            cookie: "sid=abc123",
          },
        });
      }
      if (bodyJson?.prompt === "__echo_msg_key__") {
        return json(400, { code: 21007, message: "invalid key: lh_super_secret_api_key_123" });
      }
      if (bodyJson?.prompt === "__notjson_key__") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("gateway error, authorization: Bearer lh_leaked_in_body_999");
      }
      return json(200, GENERATION_RESPONSE);
    }
    if (req.method === "POST" && url.pathname === "/openapi/v1/images/generation/async") {
      return json(202, TASK_CREATED);
    }
    if (req.method === "GET" && url.pathname === "/openapi/v1/images/generation/tasks") {
      return json(200, {
        code: 0,
        message: "",
        data: { items: [TASK_DETAIL.data], page: 1, pageSize: 20, total: 1 },
      });
    }
    if (req.method === "GET" && url.pathname === "/openapi/v1/images/generation/tasks/task-123") {
      return json(200, TASK_DETAIL);
    }
    if (req.method === "GET" && url.pathname === "/openapi/v1/images/generation/tasks/task-fail") {
      return json(200, {
        code: 0,
        message: "",
        data: { taskId: "task-fail", status: "fail", failMsg: "busy" },
      });
    }
    if (req.method === "GET" && url.pathname === "/openapi/v1/images/generation/tasks/task-fail-secret") {
      return json(200, {
        code: 0,
        message: "",
        data: {
          taskId: "task-fail-secret",
          status: "fail",
          failMsg: "upstream Authorization: Bearer lh_secret_in_fail_msg",
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/openapi/v1/images/generation/tasks/task-slow") {
      return setTimeout(
        () =>
          json(200, {
            code: 0,
            message: "",
            data: { taskId: "task-slow", status: "pending" },
          }),
        2000,
      );
    }
    if (req.method === "GET" && url.pathname === "/openapi/v1/images/generation/tasks/task-rate-limit") {
      return json(400, { code: 29998, message: "请求过于频繁" });
    }
    if (req.method === "POST" && url.pathname === "/openapi/v1/images/generation/bad-request") {
      return json(400, { code: 26004, message: "积分不足" });
    }
    return json(404, { code: 29003, message: "not found" });
  });
});

let mockPort;
let serverProcess;
let rl;
let nextId = 1;

function startMockServer() {
  return new Promise((resolve) => {
    mockServer.listen(0, "127.0.0.1", () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });
}

function startMcpServer() {
  serverProcess = spawn(process.execPath, [
    SERVER_ENTRY,
    "--base-url",
    `http://127.0.0.1:${mockPort}`,
    "--api-key",
    "test-key-123",
  ]);
  rl = readline.createInterface({ input: serverProcess.stdout });
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`请求超时: ${method}`)), 10000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      const msg = JSON.parse(line);
      if (msg.id === id) resolve(msg);
    });
    serverProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function initialize() {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "1.0.0" },
  });
  assert.equal(init.result?.serverInfo?.name, "labnana-mcp");
  serverProcess.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
  );
}

before(async () => {
  await startMockServer();
  startMcpServer();
  await new Promise((resolve) => {
    serverProcess.stderr.once("data", resolve);
    serverProcess.stderr.once("error", resolve);
  });
  await initialize();
});

after(() => {
  serverProcess?.kill();
  mockServer.close();
});

test("tools/list 返回全部 7 个工具", async () => {
  const res = await request("tools/list", {});
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "estimate_credits",
    "generate_image",
    "generate_image_async",
    "get_generation_task",
    "get_subscription",
    "list_generation_tasks",
    "wait_for_generation_task",
  ]);
});

test("get_subscription 返回订阅数据并携带 Authorization 头", async () => {
  const res = await request("tools/call", {
    name: "get_subscription",
    arguments: {},
  });
  assert.equal(res.result.isError, undefined);
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.totalAvailableCredits, 150);
  const req = received.find((r) => r.path === "/openapi/v1/user/subscription");
  assert.equal(req.auth, "Bearer test-key-123");
});

test("generate_image 返回图片 content block 与元数据", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: {
      provider: "google",
      model: "gemini-3-pro-image",
      prompt: "A sunset over the sea",
      imageConfig: { imageSize: "2K", aspectRatio: "16:9" },
    },
  });
  assert.equal(res.result.isError, undefined);
  const imageBlock = res.result.content.find((c) => c.type === "image");
  assert.ok(imageBlock, "应包含 image content block");
  assert.equal(imageBlock.data, "aGVsbG8taW1hZ2U=");
  assert.equal(imageBlock.mimeType, "image/jpeg");
  const meta = JSON.parse(res.result.content.find((c) => c.type === "text").text);
  assert.equal(meta.modelVersion, "gemini-3-pro-image");
  assert.equal(meta.finishReason, "STOP");
  const req = received.find((r) => r.path === "/openapi/v1/images/generation");
  assert.deepEqual(req.body, {
    provider: "google",
    model: "gemini-3-pro-image",
    prompt: "A sunset over the sea",
    imageConfig: { imageSize: "2K", aspectRatio: "16:9" },
  });
});

test("generate_image 没有图片数据时返回 isError", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__no_image__" },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /未返回图片/);
  assert.match(res.result.content[0].text, /SAFETY/);
});

test("estimate_credits 正确传参并解析信封", async () => {
  const res = await request("tools/call", {
    name: "estimate_credits",
    arguments: { provider: "google", prompt: "test", imageConfig: { imageSize: "1K" } },
  });
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.credits, 15);
  const req = received.find((r) => r.path === "/openapi/v1/images/generation/estimate-credits");
  assert.equal(req.body.imageConfig.imageSize, "1K");
  assert.equal(req.body.model, undefined, "未传 model 时不应发送");
});

test("generate_image_async 创建任务并返回 taskId", async () => {
  const res = await request("tools/call", {
    name: "generate_image_async",
    arguments: { provider: "alibaba", model: "wan2.7-image-pro", prompt: "poster" },
  });
  const text = res.result.content[0].text;
  assert.match(text, /task-123/);
  const req = received.find((r) => r.path === "/openapi/v1/images/generation/async");
  assert.equal(req.body.provider, "alibaba");
});

test("list_generation_tasks 传分页与状态过滤参数", async () => {
  const res = await request("tools/call", {
    name: "list_generation_tasks",
    arguments: { page: 2, pageSize: 10, status: "success" },
  });
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.total, 1);
  const req = received.find((r) => r.path === "/openapi/v1/images/generation/tasks");
  assert.deepEqual(req.query, { page: "2", pageSize: "10", status: "success" });
});

test("get_generation_task 返回任务详情", async () => {
  const res = await request("tools/call", {
    name: "get_generation_task",
    arguments: { taskId: "task-123" },
  });
  const payload = JSON.parse(res.result.content[0].text);
  assert.equal(payload.status, "success");
  assert.equal(payload.images[0].mimeType, "image/png");
});

test("get_generation_task 的 failMsg 会脱敏", async () => {
  const res = await request("tools/call", {
    name: "get_generation_task",
    arguments: { taskId: "task-fail-secret" },
  });
  const output = res.result.content[0].text;
  assert.doesNotMatch(output, /lh_secret_in_fail_msg/);
  assert.match(output, /Bearer \[REDACTED\]/);
});

test("wait_for_generation_task 轮询到 success", async () => {
  const res = await request("tools/call", {
    name: "wait_for_generation_task",
    arguments: { taskId: "task-123", timeoutSeconds: 10, pollIntervalMs: 500 },
  });
  assert.equal(res.result.isError, undefined);
  const text = res.result.content[0].text;
  assert.match(text, /success/);
  assert.match(text, /assets\.listenhub\.ai/);
});

test("wait_for_generation_task 遇到 fail 返回 isError", async () => {
  const res = await request("tools/call", {
    name: "wait_for_generation_task",
    arguments: { taskId: "task-fail", timeoutSeconds: 10, pollIntervalMs: 500 },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /失败/);
});

test("wait_for_generation_task 的 failMsg 会脱敏", async () => {
  const res = await request("tools/call", {
    name: "wait_for_generation_task",
    arguments: { taskId: "task-fail-secret", timeoutSeconds: 10, pollIntervalMs: 500 },
  });
  assert.equal(res.result.isError, true);
  const output = res.result.content[0].text;
  assert.doesNotMatch(output, /lh_secret_in_fail_msg/);
  assert.match(output, /Bearer \[REDACTED\]/);
});

test("wait_for_generation_task 不会让单次请求突破 timeoutSeconds", async () => {
  const started = Date.now();
  const res = await request("tools/call", {
    name: "wait_for_generation_task",
    arguments: { taskId: "task-slow", timeoutSeconds: 1, pollIntervalMs: 500 },
  });
  const elapsed = Date.now() - started;
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /等待超时/);
  assert.ok(elapsed < 1800, `等待了 ${elapsed}ms，超过 timeoutSeconds 预期`);
});

test("wait_for_generation_task 遇到限流时退避而不是立即暴露 API 错误", async () => {
  const res = await request("tools/call", {
    name: "wait_for_generation_task",
    arguments: { taskId: "task-rate-limit", timeoutSeconds: 1, pollIntervalMs: 500 },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /等待超时/);
  assert.doesNotMatch(res.result.content[0].text, /29998/);
});

test("参数校验失败返回 isError", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "" },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /prompt/);
});

test("参考图片支持 fileData 与 inlineData 透传", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: {
      provider: "google",
      prompt: "edit",
      referenceImages: [
        { fileData: { fileUri: "gs://bucket/a.png", mimeType: "image/png" } },
        { inlineData: { data: "base64-data", mimeType: "image/jpeg" } },
      ],
    },
  });
  assert.equal(res.result.isError, undefined);
  const req = received.find(
    (r) => r.path === "/openapi/v1/images/generation" && r.body.prompt === "edit",
  );
  assert.equal(req.body.referenceImages.length, 2);
  assert.equal(req.body.referenceImages[0].fileData.fileUri, "gs://bucket/a.png");
  assert.equal(req.body.referenceImages[1].inlineData.data, "base64-data");
});

test("非法 provider 枚举被拒绝", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "microsoft", prompt: "x" },
  });
  assert.equal(res.result.isError, true);
});

test("模型级参考图、尺寸和宽高比限制在本地拒绝", async () => {
  const referenceImages = Array.from({ length: 5 }, (_, index) => ({
    inlineData: { data: `image-${index}`, mimeType: "image/png" },
  }));
  const cases = [
    {
      provider: "openai",
      model: "gpt-image-2",
      prompt: "too many references",
      referenceImages,
    },
    {
      provider: "alibaba",
      model: "wan2.7-image",
      prompt: "unsupported ratio",
      imageConfig: { aspectRatio: "21:9" },
    },
    {
      provider: "bytedance",
      model: "seedream-5-0-pro",
      prompt: "unsupported size",
      imageConfig: { imageSize: "4K" },
    },
  ];

  for (const args of cases) {
    const res = await request("tools/call", { name: "generate_image", arguments: args });
    assert.equal(res.result.isError, true, JSON.stringify(args));
  }
});

test("不支持的参考图片 URI scheme 被拒绝", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: {
      provider: "google",
      prompt: "bad uri",
      referenceImages: [{ fileData: { fileUri: "file:///etc/passwd" } }],
    },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /fileUri/);
});

test("2xx 但业务 code 非 0 时按错误处理", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__insufficient__" },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /26004/);
  assert.match(res.result.content[0].text, /积分不足/);
});

test("2xx 但响应非 JSON 时返回可读错误", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__notjson__" },
  });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /不是合法 JSON/);
});

test("错误详情中的敏感字段被脱敏", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__echo_key__" },
  });
  assert.equal(res.result.isError, true);
  const output = res.result.content[0].text;
  assert.match(output, /29003/);
  assert.doesNotMatch(output, /test-key-123/);
  assert.match(output, /REDACTED/);
});

test("错误详情中的 password 类字段也被脱敏（含嵌套）", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__echo_password__" },
  });
  assert.equal(res.result.isError, true);
  const output = res.result.content[0].text;
  assert.doesNotMatch(output, /s3cret-pwd/);
  assert.doesNotMatch(output, /nested-pwd/);
  assert.match(output, /REDACTED/);
});

test("错误详情中的 camelCase 键（apiKey/accessKey）也被脱敏", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__echo_camel__" },
  });
  assert.equal(res.result.isError, true);
  const output = res.result.content[0].text;
  assert.doesNotMatch(output, /camel-api-key/);
  assert.doesNotMatch(output, /camel-access-key/);
  assert.match(output, /REDACTED/);
});

test("错误详情中的 snake_case token 键与 session/cookie 也被脱敏", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__echo_token__" },
  });
  assert.equal(res.result.isError, true);
  const output = res.result.content[0].text;
  assert.doesNotMatch(output, /tok-1/);
  assert.doesNotMatch(output, /tok-2/);
  assert.doesNotMatch(output, /sess-1/);
  assert.doesNotMatch(output, /abc123/);
  assert.match(output, /REDACTED/);
});

test("error.message 内嵌的 lh_ API key 被脱敏", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__echo_msg_key__" },
  });
  assert.equal(res.result.isError, true);
  const output = res.result.content[0].text;
  assert.match(output, /21007/);
  assert.doesNotMatch(output, /lh_super_secret_api_key_123/);
  assert.match(output, /lh_\[REDACTED\]/);
});

test("非 JSON 响应体中内嵌的凭据被脱敏", async () => {
  const res = await request("tools/call", {
    name: "generate_image",
    arguments: { provider: "google", prompt: "__notjson_key__" },
  });
  assert.equal(res.result.isError, true);
  const output = res.result.content[0].text;
  assert.match(output, /不是合法 JSON/);
  assert.doesNotMatch(output, /lh_leaked_in_body_999/);
  assert.match(output, /Bearer \[REDACTED\]/);
});

test("baseUrl 空串或空白时回退默认 https://api.labnana.com", async () => {
  const { LabnanaClient } = await import("../dist/client.js");
  let calledUrl = null;
  const client = new LabnanaClient({
    apiKey: "k",
    baseUrl: "   ",
    fetchImpl: async (url) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ code: 0, message: "", data: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await client.getSubscription();
  assert.equal(calledUrl, "https://api.labnana.com/openapi/v1/user/subscription");
});

test("非 loopback 的 HTTP baseUrl 被拒绝", async () => {
  const { LabnanaClient } = await import("../dist/client.js");
  assert.throws(
    () => new LabnanaClient({ apiKey: "k", baseUrl: "http://example.com" }),
    /HTTPS/,
  );
});

test("超过 20 MB 的请求体在 fetch 前被拒绝", async () => {
  const { LabnanaClient } = await import("../dist/client.js");
  let fetchCalled = false;
  const client = new LabnanaClient({
    apiKey: "k",
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("fetch 不应被调用");
    },
  });
  const imageData = "a".repeat(20 * 1024 * 1024);
  await assert.rejects(
    () =>
      client.generateImage({
        provider: "google",
        prompt: "large",
        referenceImages: [{ inlineData: { data: imageData, mimeType: "image/png" } }],
      }),
    (error) => error?.code === -3 && /20 MB/.test(error.message),
  );
  assert.equal(fetchCalled, false);
});
