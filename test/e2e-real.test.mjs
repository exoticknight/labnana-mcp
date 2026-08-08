/**
 * 真实 API 端到端测试（可选）：读取仓库根目录 .env 中的 LABNANA_API_KEY，
 * 以 stdio 方式启动 dist/index.js 走完整 MCP 协议调用真实 https://api.labnana.com。
 * 仅调用不扣积分的接口（get_subscription、estimate_credits）。
 * 未配置 .env 或没有 LABNANA_API_KEY 时自动跳过。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SERVER_ENTRY = join(ROOT, "dist", "index.js");

function loadApiKey() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return null;
  const content = readFileSync(envPath, "utf8");
  const match = content.match(/^\s*LABNANA_API_KEY\s*=\s*(.+?)\s*$/m);
  if (!match || !match[1]) return null;
  return match[1].trim();
}

const apiKey = loadApiKey();
const hasKey = Boolean(apiKey && apiKey.length >= 8);

let serverProcess;
let rl;
let nextId = 1;

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`请求超时: ${method}`)), 60000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      const msg = JSON.parse(line);
      if (msg.id === id) resolve(msg);
    });
    serverProcess.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

before(async () => {
  if (!hasKey) return;
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, LABNANA_API_KEY: apiKey },
    stdio: ["pipe", "pipe", "pipe"],
  });
  rl = readline.createInterface({ input: serverProcess.stdout });
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e-real", version: "1.0.0" },
  });
  assert.equal(init.result?.serverInfo?.name, "labnana-mcp");
  serverProcess.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
  );
});

after(() => {
  serverProcess?.kill();
});

test("真实 API：get_subscription 返回订阅与积分数据", { skip: !hasKey && "未配置 LABNANA_API_KEY（.env）" }, async () => {
  const res = await request("tools/call", { name: "get_subscription", arguments: {} });
  assert.equal(res.error, undefined, `RPC 错误：${JSON.stringify(res.error)}`);
  assert.ok(res.result, "应返回 result");
  assert.equal(res.result?.isError, undefined, `调用失败：${JSON.stringify(res.result)}`);
  const data = JSON.parse(res.result.content[0].text);
  assert.equal(typeof data.totalAvailableCredits, "number");
  assert.equal(typeof data.paidStatus, "boolean");
  assert.ok(data.freeUsages, "应包含 freeUsages");
  console.error(`[e2e] 订阅：paidStatus=${data.paidStatus} 总积分=${data.totalAvailableCredits} 免费额度键=${Object.keys(data.freeUsages ?? {}).length}`);
});

test("真实 API：estimate_credits 预估不扣积分", { skip: !hasKey && "未配置 LABNANA_API_KEY（.env）" }, async () => {
  const res = await request("tools/call", {
    name: "estimate_credits",
    arguments: {
      provider: "google",
      model: "gemini-3-pro-image",
      prompt: "a red fox in the snow",
      imageConfig: { imageSize: "1K", aspectRatio: "1:1" },
    },
  });
  assert.equal(res.error, undefined, `RPC 错误：${JSON.stringify(res.error)}`);
  assert.ok(res.result, "应返回 result");
  assert.equal(res.result?.isError, undefined, `调用失败：${JSON.stringify(res.result)}`);
  const data = JSON.parse(res.result.content[0].text);
  assert.equal(typeof data.credits, "number");
  assert.equal(typeof data.canGenerate, "boolean");
  console.error(`[e2e] 预估：credits=${data.credits} canGenerate=${data.canGenerate}`);
});
