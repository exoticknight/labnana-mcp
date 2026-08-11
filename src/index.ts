#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LabnanaClient } from "./client.js";
import { registerTools } from "./tools.js";

const SERVER_NAME = "labnana-mcp";
const SERVER_VERSION = "2.0.0";

function parseArgs(argv: string[]): { apiKey?: string; baseUrl?: string; outputDir?: string } {
  const args: { apiKey?: string; baseUrl?: string; outputDir?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`参数 ${arg} 缺少值`);
      }
      return argv[++i];
    };
    if (arg === "--api-key" || arg === "-k") args.apiKey = next();
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--output-dir") args.outputDir = next();
    else if (arg.startsWith("--api-key=")) args.apiKey = arg.slice("--api-key=".length);
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--output-dir=")) args.outputDir = arg.slice("--output-dir=".length);
    else throw new Error(`未知参数：${arg}（支持 --api-key、--base-url、--output-dir）`);
  }
  return args;
}

async function main(): Promise<void> {
  let cli: { apiKey?: string; baseUrl?: string; outputDir?: string };
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const apiKey = cli.apiKey ?? process.env.LABNANA_API_KEY;

  if (!apiKey) {
    console.error(
      "错误：未配置 Labnana API Key。\n" +
        "请设置环境变量 LABNANA_API_KEY，或通过 --api-key 参数传入。\n" +
        "获取 API Key：https://labnana.com/api-keys",
    );
    process.exit(1);
  }

  let client: LabnanaClient;
  try {
    client = new LabnanaClient({ apiKey, baseUrl: cli.baseUrl });
  } catch (error) {
    console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server, client, {
    outputDir: cli.outputDir ?? process.env.LABNANA_OUTPUT_DIR,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} 已启动（stdio）`);
}

main().catch((error) => {
  console.error(`启动失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
