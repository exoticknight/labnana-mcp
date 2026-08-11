# labnana-mcp

[![npm version](https://img.shields.io/npm/v/%40exoticknight%2Flabnana-mcp)](https://www.npmjs.com/package/@exoticknight/labnana-mcp)
[![npm downloads](https://img.shields.io/npm/dm/%40exoticknight%2Flabnana-mcp)](https://www.npmjs.com/package/@exoticknight/labnana-mcp)
[![CI](https://github.com/exoticknight/labnana-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/exoticknight/labnana-mcp/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40exoticknight%2Flabnana-mcp)](package.json)
[![License](https://img.shields.io/npm/l/%40exoticknight%2Flabnana-mcp)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server for the [Labnana OpenAPI](https://labnana.com/docs/openapi/guide). It enables Claude, Claude Code, and other MCP clients to generate and edit images with Labnana.

Supported model families include:

- Gemini image models (Nano Banana Pro / 2)
- GPT-Image-2
- Wan2.7 Image / Pro
- Seedream 5.0 Pro, including precise editing

[GitHub](https://github.com/exoticknight/labnana-mcp) · [npm](https://www.npmjs.com/package/@exoticknight/labnana-mcp) · [中文文档](README.zh-CN.md)

## Installation

### Claude Code

1. Create an API key in the [Labnana API Keys](https://labnana.com/api-keys) console.
2. Make `LABNANA_API_KEY` available in the environment used by Claude Code.
3. Add the server:

```bash
claude mcp add labnana -- npx -y @exoticknight/labnana-mcp
```

The package can also be started directly with:

```bash
npx -y @exoticknight/labnana-mcp
```

### Cursor and VS Code

One-click install (replace the placeholder API key after installing):

[![Install in Cursor](https://img.shields.io/badge/Cursor-Install_MCP_Server-black?logo=cursor)](https://cursor.com/install-mcp?name=labnana&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBleG90aWNrbmlnaHQvbGFibmFuYS1tY3AiXSwiZW52Ijp7IkxBQk5BTkFfQVBJX0tFWSI6ImxoX3h4eHh4eHh4eCJ9fQ==)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-0098FF?logo=githubcopilot)](https://vscode.dev/redirect/mcp/install?name=labnana&config=%7B%22name%22%3A%22labnana%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40exoticknight%2Flabnana-mcp%22%5D%2C%22env%22%3A%7B%22LABNANA_API_KEY%22%3A%22lh_xxxxxxxxx%22%7D%7D)

### Claude Desktop and other MCP clients

Use an equivalent `mcpServers` configuration:

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

### Local source checkout

```bash
npm install
npm run build
```

Then configure the server with the generated `dist/index.js`:

```bash
claude mcp add labnana -- node <path-to-repo>/dist/index.js
```

On Windows, use an absolute path such as:

```powershell
claude mcp add labnana -- node C:/path/to/labnana-mcp/dist/index.js
```

## Configuration

The server reads the following environment variable:

| Variable | Required | Description |
| --- | --- | --- |
| `LABNANA_API_KEY` | Yes | Labnana API key. |
| `LABNANA_OUTPUT_DIR` | No | Default directory for saved images. Falls back to `labnana-images/` under the working directory. |

The command-line options below are also supported:

| Option | Description |
| --- | --- |
| `--api-key <key>` | Provide the API key for a local process. |
| `--base-url <url>` | Override the default API endpoint, `https://api.labnana.com`. |
| `--output-dir <dir>` | Default directory for saved images. |

Environment variables are recommended because command-line arguments may be visible in the local process list.

## Tools

| Tool | Description |
| --- | --- |
| `generate_image` | One-stop text-to-image / image-to-image / editing. Saves the image to disk and returns the file path by default; 4K requests transparently run as async tasks with internal polling. |
| `estimate_credits` | Estimate the credits required for a generation without generating an image. |
| `get_subscription` | Get subscription status, credit balances, and free usage information. |
| `list_generation_tasks` | List generation task history with pagination and optional status filtering. |
| `get_generation_task` | Get task details and public image URLs (useful after a `generate_image` timeout). |

## Usage

### Generate an image

```json
{
  "name": "generate_image",
  "arguments": {
    "model": "gemini-3-pro-image",
    "prompt": "Change the background of the image to the grasslands of Inner Mongolia",
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

By default the generated image is saved to disk and the tool returns the file path. Pass `"outputMode": "inline"` to receive the image as MCP image content instead (useful in Claude Desktop for instant preview), and `"saveDir"` to choose the target directory.

Use `referenceImages` for image-to-image generation and editing. `fileData.fileUri` supports `gs://` and `https://`; small images can be passed as base64 through `inlineData.data`.

4K requests automatically run as asynchronous tasks: the server creates the task, polls until completion (with rate-limit backoff), downloads the result, and saves it — no manual polling needed. If the wait exceeds `timeoutSeconds` (default 300), the tool returns the `taskId` so the result can be fetched later with `get_generation_task`.

### Credit estimation

```json
{
  "name": "estimate_credits",
  "arguments": {
    "prompt": "A Shiba Inu running through a snowy landscape",
    "imageConfig": {
      "imageSize": "4K"
    }
  }
}
```

## Parameters

- `model` (default: `gemini-3-pro-image`): `gemini-3-pro-image`, `gemini-3.1-flash-image`, `gpt-image-2`, `wan2.7-image-pro`, `wan2.7-image`, or `seedream-5-0-pro`. The provider is derived from the model automatically.
- `imageConfig.imageSize`: `1K`, `2K`, or `4K`. `wan2.7-image` does not support 4K; `seedream-5-0-pro` supports only 1K and 2K.
- `imageConfig.aspectRatio`: `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9`, `1:4`, `4:1`, `1:8`, or `8:1`. GPT-Image-2 may omit this field and let the service choose; Wan2.7 supports only `1:1`, `16:9`, `9:16`, `4:3`, and `3:4`.
- `referenceImages`: up to 14 for Gemini, 4 for GPT-Image-2, 9 for Wan2.7, and 10 for Seedream.
- `outputMode` (`generate_image` only): `file` (default, save to disk and return the path) or `inline` (return MCP image content).
- `saveDir` / `timeoutSeconds` (`generate_image` only): target directory for `file` mode, and the maximum wait for async (4K) generations.

### Credit summary

| Model | 1K | 2K | 4K |
| --- | ---: | ---: | ---: |
| `gemini-3-pro-image` | 15 | 15 | 30 |
| `gemini-3.1-flash-image` | 10 | 10 | 20 |
| `gpt-image-2` | 4 | 6 | 10 |
| `wan2.7-image-pro` | 6 | 8 | 12 (text-to-image only) |
| `wan2.7-image` | 4 | 6 | Not supported |
| `seedream-5-0-pro` | 6 | 15 | Not supported |

## Errors

API errors are returned as `{ code, message }` and exposed as MCP results with `isError: true`.

| Code | Meaning | Recommendation |
| --- | --- | --- |
| 21007 | Invalid API key | Check `LABNANA_API_KEY`. |
| 26004 | Insufficient credits | Check the subscription or upgrade the plan. |
| 29003 | Invalid parameters | Check required fields and model-specific limits. |
| 29998 | Too many requests | Retry with a 20–30 second backoff. |

## Migrating from 1.x

Version 2.0 redesigns the tool surface around agent workflows:

- `generate_image_async` and `wait_for_generation_task` were removed; `generate_image` now handles async tasks and polling internally (4K requests).
- The `provider` parameter was removed everywhere; it is derived from `model`.
- `generate_image` now saves images to disk by default and returns the file path; the 1.x behavior is available via `"outputMode": "inline"`.

## Development

```bash
npm install
npm run typecheck
npm test
```

## Links

- [Labnana integration guide](https://labnana.com/docs/openapi/guide)
- [Labnana OpenAPI reference](https://docs.marswave.ai/openapi-labnana.html)
- [Credit guide](https://labnana.com/docs/pricing/credits)
- [GitHub repository](https://github.com/exoticknight/labnana-mcp)
- Technical support: support@marswave.ai

## License

[Apache-2.0](LICENSE)
