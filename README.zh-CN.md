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
| `generate_image` | 文生图 / 图生图 / 改图一站式工具。默认把图片保存到本地并返回文件路径；4K 请求自动走异步任务并在内部轮询等待。 |
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

默认会把生成的图片保存到本地并返回文件路径。传 `"outputMode": "inline"` 可改为以 MCP 图片内容内联返回（适合 Claude Desktop 直接预览），`"saveDir"` 可指定保存目录。

图生图或改图时，把源图放入 `referenceImages`。`fileData.fileUri` 支持 `gs://` 和 `https://`；小图片也可以通过 `inlineData.data` 传入 base64。

4K 请求会自动走异步任务：服务器内部创建任务、轮询等待（含限流退避）、下载结果并保存，无需手动轮询。等待超过 `timeoutSeconds`（默认 300 秒）时会返回 `taskId`，稍后可用 `get_generation_task` 取回结果。

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
- `outputMode`（仅 `generate_image`）：`file`（默认，保存到本地并返回路径）或 `inline`（内联返回 MCP 图片内容）。
- `saveDir` / `timeoutSeconds`（仅 `generate_image`）：`file` 模式的保存目录，以及异步（4K）生成的最长等待秒数。

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

## 从 1.x 迁移

2.0 围绕 agent 工作流重新设计了工具接口：

- 移除了 `generate_image_async` 和 `wait_for_generation_task`；`generate_image` 内部自动处理异步任务与轮询（4K 请求）。
- 所有工具移除了 `provider` 参数，由 `model` 自动推导。
- `generate_image` 默认保存图片到本地并返回文件路径；1.x 的行为可通过 `"outputMode": "inline"` 获得。

## 开发

```bash
npm install
npm run typecheck
npm test
```

## 相关链接

- [Labnana 接入指南](https://labnana.com/docs/openapi/guide)
- [Labnana OpenAPI 文档](https://docs.marswave.ai/openapi-labnana.html)
- [积分指南](https://labnana.com/docs/pricing/credits)
- [GitHub 仓库](https://github.com/exoticknight/labnana-mcp)
- 技术支持：support@marswave.ai

## 许可证

[Apache-2.0](LICENSE)
