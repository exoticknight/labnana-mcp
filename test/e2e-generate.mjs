/**
 * 真实图片生成验证脚本（会扣积分，不纳入 npm test）：
 * 读取 .env 的 LABNANA_API_KEY，走 MCP stdio 调用 generate_image，
 * 验证 2.1 统一 envelope、图片预览和本地原图路径。
 * 用法：node test/e2e-generate.mjs
 */
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
  return match ? match[1].trim() : null;
}

const apiKey = loadApiKey();
if (!apiKey || apiKey.length < 8) {
  console.error("未找到有效的 LABNANA_API_KEY（请检查 .env）");
  process.exit(1);
}

let nextId = 1;
function makeRequest(process, rl, method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`请求超时: ${method}`)), 180000);
    rl.once("line", (line) => {
      clearTimeout(timer);
      const msg = JSON.parse(line);
      if (msg.id === id) resolve(msg);
    });
    process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function main() {
  const server = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, LABNANA_API_KEY: apiKey },
  });
  server.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[server] 进程异常退出（code=${code}），请确认已先运行 npm run build`);
    }
  });
  const rl = readline.createInterface({ input: server.stdout });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  const req = (m, p) => makeRequest(server, rl, m, p);

  try {
    const init = await req("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e-generate", version: "1.0.0" },
    });
    console.log(`已连接：${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    const existingTaskId = process.argv[2];
    const response = existingTaskId
      ? await req("tools/call", {
          name: "get_generation_task",
          arguments: { taskId: existingTaskId },
        })
      : await req("tools/call", {
          name: "generate_image",
          arguments: {
            model: "gemini-3-pro-image",
            prompt: "一只红色狐狸在雪地里奔跑，阳光洒在雪面上，摄影风格",
            imageConfig: { imageSize: "1K", aspectRatio: "1:1" },
          },
        });
    if (response.result?.isError) {
      console.error("生成失败：", response.result.content.at(-1)?.text);
      process.exitCode = 1;
      return;
    }
    const envelope = response.result.structuredContent;
    console.log(`状态：${envelope.status}`);
    console.log(`图片预览块：${response.result.content.filter((item) => item.type === "image").length}`);
    for (const image of envelope.images ?? []) {
      console.log(`  [${image.mimeType}] ${image.filePath ?? image.url ?? "无原图定位符"}`);
    }
    if (envelope.status === "pending") {
      console.log(`任务仍在运行，稍后重新执行：node test/e2e-generate.mjs ${envelope.taskId}`);
    } else {
      console.log("生成链路验证成功 ✅");
    }
  } catch (error) {
    console.error("验证失败：", error.message);
    process.exitCode = 1;
  } finally {
    server.kill();
  }
}

main();
