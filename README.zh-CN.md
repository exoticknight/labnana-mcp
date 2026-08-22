# labnana-mcp

[![npm version](https://img.shields.io/npm/v/%40exoticknight%2Flabnana-mcp)](https://www.npmjs.com/package/@exoticknight/labnana-mcp)
[![npm downloads](https://img.shields.io/npm/dm/%40exoticknight%2Flabnana-mcp)](https://www.npmjs.com/package/@exoticknight/labnana-mcp)
[![CI](https://github.com/exoticknight/labnana-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/exoticknight/labnana-mcp/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40exoticknight%2Flabnana-mcp)](package.json)
[![License](https://img.shields.io/npm/l/%40exoticknight%2Flabnana-mcp)](LICENSE)

这是一个面向 [Labnana OpenAPI](https://labnana.com/docs/openapi/guide) 的 [MCP](https://modelcontextprotocol.io) 服务器，可让 Claude、Claude Code 及其他 MCP 客户端通过 Labnana 生成和编辑图片。

支持的模型系列包括：

- Gemini 图片模型（Nano Banana Pro / 2）
- GPT-Image-2
- Wan2.7 Image / Pro
- Seedream 5.0 Pro，包含精准编辑

[GitHub](https://github.com/exoticknight/labnana-mcp) · [npm](https://www.npmjs.com/package/@exoticknight/labnana-mcp) · [English documentation](README.md)

## 安装

### Claude Code

1. 在 [Labnana API Keys](https://labnana.com/api-keys) 控制台创建 API Key。
2. 确保 Claude Code 运行环境可以读取 `LABNANA_API_KEY`。
3. 添加 MCP 服务器：

```bash
claude mcp add labnana -- npx -y @exoticknight/labnana-mcp
```

也可以直接运行：

```bash
npx -y @exoticknight/labnana-mcp
```

### DeepSeek Harness（DSH）

通过 DSH 官方 MCP client 插件接入。若要用 `initialize` 返回的版本明确识别支持 MCP Apps 的构建，可固定到 `3.1.0`：

```yaml
- id: mcp-labnana
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: labnana
    transport: stdio
    command: npx
    args: ['-y', '@exoticknight/labnana-mcp@3.1.0']
    env:
      LABNANA_API_KEY: !!js process.env.LABNANA_API_KEY
```

DSH 的 MCP bridge 能把受支持的 `ImageContent` 投影给本次调用的视觉模型。3.1 同时为 `generate_image` 和 `get_generation_task` 发布标准 MCP Apps 单文件 View；支持 MCP Apps 的 DSH Web host 会在对话中直接显示预览。stock DSH 通用工具卡仍可能只显示 JSON 兜底，即使模型已经收到图片——这是客户端展示能力限制，不代表生成结果丢失。

本地源码测试时，使用同一配置，把 `command` 改为 `node`，`args` 改为本仓库 `dist/index.js` 的绝对路径，并把 `cwd` 指向本仓库。当前 stock DSH 只桥接 MCP 工具，通用工具卡不会消费 MCP resource；要在对话中内嵌显示，需要 MCP Apps host，或单独的 `dsh-labnana` 原生 keyed tool view。没有这些客户端扩展时，模型视觉仍可收到图片，卡片则回退为 JSON。

### Cursor 与 VS Code

一键安装（安装后请替换占位 API Key）：

[![Install in Cursor](https://img.shields.io/badge/Cursor-Install_MCP_Server-black?logo=cursor)](https://cursor.com/install-mcp?name=labnana&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBleG90aWNrbmlnaHQvbGFibmFuYS1tY3AiXSwiZW52Ijp7IkxBQk5BTkFfQVBJX0tFWSI6ImxoX3h4eHh4eHh4eCJ9fQ==)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-0098FF?logo=githubcopilot)](https://vscode.dev/redirect/mcp/install?name=labnana&config=%7B%22name%22%3A%22labnana%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40exoticknight%2Flabnana-mcp%22%5D%2C%22env%22%3A%7B%22LABNANA_API_KEY%22%3A%22lh_xxxxxxxxx%22%7D%7D)

### Claude Desktop 及其他 MCP 客户端

使用等效的 `mcpServers` 配置：

```json
{
  "mcpServers": {
    "labnana": {
      "command": "npx",
      "args": ["-y", "@exoticknight/labnana-mcp"],
      "env": {
        "LABNANA_API_KEY": "lh_xxxxxxxxx"
      }
    }
  }
}
```

### 本地源码

```bash
npm install
npm run build
```

然后使用生成的 `dist/index.js` 配置 MCP 服务器：

```bash
claude mcp add labnana -- node <path-to-repo>/dist/index.js
```

Windows 下请使用绝对路径，例如：

```powershell
claude mcp add labnana -- node C:/path/to/labnana-mcp/dist/index.js
```

## 配置

服务器读取以下环境变量：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `LABNANA_API_KEY` | 是 | Labnana API Key。 |
| `LABNANA_OUTPUT_DIR` | 否 | 图片保存的默认目录，未设置时为工作目录下的 `labnana-images/`。 |

同时支持以下命令行参数：

| 参数 | 说明 |
| --- | --- |
| `--api-key <key>` | 为本地进程传入 API Key。 |
| `--base-url <url>` | 覆盖默认接口地址 `https://api.labnana.com`。 |
| `--output-dir <dir>` | 图片保存的默认目录。 |

由于命令行参数可能会显示在本机进程列表中，推荐使用环境变量。

## 工具

| 工具 | 说明 |
| --- | --- |
| `generate_image` | 文生图 / 图生图 / 改图一站式工具。默认保存完整原图，同时返回有界 MCP 图片预览、结构化元数据和 JSON 文本兜底；4K 请求自动异步轮询。 |
| `estimate_credits` | 预估生成所需积分，不实际生成图片。 |
| `get_subscription` | 获取订阅状态、积分余额和免费额度信息。 |
| `list_generation_tasks` | 分页获取生成任务历史，可按状态筛选。 |
| `get_generation_task` | 获取任务详情与公开图片链接（`generate_image` 等待超时后可在这里取回结果）。 |

## 使用

### 生成图片

```json
{
  "name": "generate_image",
  "arguments": {
    "model": "gemini-3-pro-image",
    "prompt": "将图片背景改为内蒙古大草原",
    "referenceImages": [
      {
        "fileData": {
          "fileUri": "https://cdn.labnana.com/xxx.png",
          "mimeType": "image/png"
        }
      }
    ],
    "imageConfig": {
      "imageSize": "2K",
      "aspectRatio": "16:9"
    }
  }
}
```

默认 `outputMode=hybrid`：完整原图保存到本地，同时返回有大小上限的 MCP 图片预览、`structuredContent` 和等值 JSON 文本。这种模式兼顾 Codex、Claude Code、Claude Desktop 等不同客户端。`saveDir` 可指定保存目录。

结果使用统一 envelope，1K、2K、4K 和 `get_generation_task` 的字段语义一致：

```json
{
  "schemaVersion": 1,
  "status": "succeeded",
  "taskId": "task-123",
  "images": [
    {
      "index": 0,
      "mimeType": "image/png",
      "width": 4096,
      "height": 4096,
      "byteLength": 18442231,
      "sha256": "...",
      "url": "https://.../original.png",
      "filePath": "C:\\...\\labnana.png",
      "preview": { "included": true, "mimeType": "image/jpeg", "width": 1600, "height": 1600 }
    }
  ]
}
```

图片 base64 只存在于标准 MCP `ImageContent` 中，不会复制进文本或结构化元数据。4K 原图不会直接内联；内联的是长边不超过 1600 像素、目标不超过 2 MiB 的预览，原图通过 `filePath`/`url` 取回。

图生图或改图时，把源图放入 `referenceImages`。`fileData.fileUri` 支持 `gs://` 和 `https://`；小图片也可以通过 `inlineData.data` 传入 base64。

4K 请求会自动走异步任务：服务器内部创建任务、轮询等待（含限流退避）、下载原图、保存并生成预览。等待超过 `timeoutSeconds`（默认 300 秒）时返回 `status=pending` 和 `taskId`，这不算生成失败；稍后可用 `get_generation_task` 取回统一格式的预览与原图链接。

### 预估积分

```json
{
  "name": "estimate_credits",
  "arguments": {
    "prompt": "一只柴犬在雪地里奔跑",
    "imageConfig": {
      "imageSize": "4K"
    }
  }
}
```

## 参数

- `model`（默认：`gemini-3-pro-image`）：`gemini-3-pro-image`、`gemini-3.1-flash-image`、`gpt-image-2`、`wan2.7-image-pro`、`wan2.7-image` 或 `seedream-5-0-pro`。提供商由模型自动推导，无需指定。
- `imageConfig.imageSize`：`1K`、`2K` 或 `4K`。`wan2.7-image` 不支持 4K；`seedream-5-0-pro` 仅支持 1K 和 2K。
- `imageConfig.aspectRatio`：`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`9:16`、`16:9`、`21:9`、`1:4`、`4:1`、`1:8` 或 `8:1`。GPT-Image-2 可以不传此字段，由服务端自动选择；Wan2.7 仅支持 `1:1`、`16:9`、`9:16`、`4:3` 和 `3:4`。
- `referenceImages`：Gemini 最多 14 张，GPT-Image-2 最多 4 张，Wan2.7 最多 9 张，Seedream 最多 10 张。
- `outputMode`（仅 `generate_image`）：`hybrid`（默认，保存原图并内联有界预览）、`file`（只保存原图和返回元数据）或 `inline`（不保存到 `saveDir`；始终返回有界预览，仅当上游没有原图 URL 时才把原图保存到默认恢复目录）。
- `saveDir` / `timeoutSeconds`（仅 `generate_image`）：`hybrid`/`file` 模式的保存目录，以及异步（4K）生成的最长等待秒数。

### 积分消耗摘要

| 模型 | 1K | 2K | 4K |
| --- | ---: | ---: | ---: |
| `gemini-3-pro-image` | 15 | 15 | 30 |
| `gemini-3.1-flash-image` | 10 | 10 | 20 |
| `gpt-image-2` | 4 | 6 | 10 |
| `wan2.7-image-pro` | 6 | 8 | 12（仅文生图） |
| `wan2.7-image` | 4 | 6 | 不支持 |
| `seedream-5-0-pro` | 6 | 15 | 不支持 |

## 错误

API 错误会以 `{ code, message }` 返回，并通过带有 `isError: true` 的 MCP 结果暴露。

| 错误码 | 含义 | 建议 |
| --- | --- | --- |
| 21007 | API Key 无效 | 检查 `LABNANA_API_KEY`。 |
| 26004 | 积分不足 | 查看订阅状态或升级套餐。 |
| 29003 | 参数错误 | 检查必填字段和模型限制。 |
| 29998 | 请求过于频繁 | 等待 20–30 秒后重试。 |

## 从 2.x 迁移

3.0 将图片结果统一为跨客户端的 artifact envelope：

- 默认模式从 `file` 改为 `hybrid`，成功时同时保存原图并返回有界图片预览。
- 成功、失败和等待中的结果均提供版本化 JSON envelope；成功/任务查询结果声明 `outputSchema` 并返回等值 `structuredContent`。
- `outputMode=inline` 对 4K 也会返回实际图片预览，不再只返回 URL 文本。
- 需要旧版纯文件行为时显式传 `outputMode=file`；原先直接读取顶层 `filePath` 的调用方应改读 `images[0].filePath`。
- 最低 Node.js 版本提升到 20.9。

## 从 3.0 迁移到 3.1

3.1 在不改变 3.0 结果 envelope 的前提下增加渐进式 MCP Apps 展示。`generate_image` 与 `get_generation_task` 现在通过新旧两种 MCP Apps 元数据键发布 `ui://` 单文件图片 View；不支持 MCP Apps 的客户端仍会收到顺序不变的 `ImageContent`、JSON 文本与 `structuredContent` 兜底。

## 从 1.x 迁移到 2.0

2.0 围绕 agent 工作流重新设计了工具接口：

- 移除了 `generate_image_async` 和 `wait_for_generation_task`；`generate_image` 内部自动处理异步任务与轮询（4K 请求）。
- 所有工具移除了 `provider` 参数，由 `model` 自动推导。
- 2.x 的 `generate_image` 默认保存图片到本地并返回文件路径；在 3.0 中请使用上面的统一 envelope。

## 开发

```bash
npm install
npm run typecheck
npm test
```

如需在完全不调用 Labnana、不消耗积分的情况下检查真实单文件 MCP App，可运行 `npm run test:ui`，再打开 `http://127.0.0.1:4173/test/mcp-app-host.html`。本地 host 会通过官方 AppBridge 发送一张动态生成的 640×360 PNG，用于目视检查图片、状态与元数据。

## 相关链接

- [Labnana 接入指南](https://labnana.com/docs/openapi/guide)
- [Labnana OpenAPI 文档](https://docs.marswave.ai/openapi-labnana.html)
- [积分指南](https://labnana.com/docs/pricing/credits)
- [GitHub 仓库](https://github.com/exoticknight/labnana-mcp)
- 技术支持：support@marswave.ai

## 许可证

[Apache-2.0](LICENSE)
