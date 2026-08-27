# labnana-mcp

[![npm version](https://img.shields.io/npm/v/%40exoticknight%2Flabnana-mcp)](https://www.npmjs.com/package/@exoticknight/labnana-mcp)
[![npm downloads](https://img.shields.io/npm/dm/%40exoticknight%2Flabnana-mcp)](https://www.npmjs.com/package/@exoticknight/labnana-mcp)
[![CI](https://github.com/exoticknight/labnana-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/exoticknight/labnana-mcp/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40exoticknight%2Flabnana-mcp)](package.json)
[![License](https://img.shields.io/npm/l/%40exoticknight%2Flabnana-mcp)](LICENSE)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-5A45FF)](https://registry.modelcontextprotocol.io/?q=io.github.exoticknight%2Flabnana-mcp)
[![labnana-mcp MCP server](https://glama.ai/mcp/servers/exoticknight/labnana-mcp/badges/score.svg)](https://glama.ai/mcp/servers/exoticknight/labnana-mcp)

An [MCP](https://modelcontextprotocol.io) server for the [Labnana OpenAPI](https://labnana.com/docs/openapi/guide). It enables Claude, Claude Code, and other MCP clients to generate and edit images with Labnana.

Current OpenAPI models (product names mapped to the `model` parameter):

| Product name | `model` | Provider | Resolutions | Best for |
| --- | --- | --- | --- | --- |
| Nano Banana Pro | `gemini-3-pro-image` | Google | 1K / 2K / 4K | In-image text, character consistency, high-fidelity output |
| Nano Banana 2 | `gemini-3.1-flash-image` | Google | 1K / 2K / 4K | Fast iteration and extreme aspect ratios |
| GPT-Image-2 | `gpt-image-2` | OpenAI | 1K / 2K / 4K | Spec-driven generation, layout control, illustration |
| Wan2.7 Image Pro | `wan2.7-image-pro` | Alibaba | 1K / 2K / 4K¹ | Photoreal and poster-style images |
| Wan2.7 Image | `wan2.7-image` | Alibaba | 1K / 2K | Lower-cost everyday generation |
| Seedream 5.0 Pro | `seedream-5-0-pro` | ByteDance | 1K / 2K | Coordinate-driven region editing and Chinese instructions |

¹ `wan2.7-image-pro` supports 4K only for text-to-image; generations with reference images are limited to 2K. Treat the [Labnana OpenAPI guide](https://labnana.com/docs/openapi/guide) as authoritative for model IDs.

[GitHub](https://github.com/exoticknight/labnana-mcp) · [npm](https://www.npmjs.com/package/@exoticknight/labnana-mcp) · [MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.exoticknight%2Flabnana-mcp) · [Glama](https://glama.ai/mcp/servers/exoticknight/labnana-mcp) · [中文文档](README.zh-CN.md)

## Installation

Requires Node.js 20.9 or later.

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

### DeepSeek Harness (DSH)

Add the server through DSH's official MCP client plugin. Pin `2.1.1` when you want the version shown by `initialize` to identify this MCP Apps-capable build:

```yaml
- id: mcp-labnana
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: labnana
    transport: stdio
    command: npx
    args: ['-y', '@exoticknight/labnana-mcp@2.1.1']
    env:
      LABNANA_API_KEY: !!js process.env.LABNANA_API_KEY
```

DSH's MCP bridge can project supported `ImageContent` into the calling vision model. Version 2.1 also publishes a standard MCP Apps single-file View for `generate_image` and `get_generation_task`. An MCP Apps-capable DSH Web host renders the preview inline; a stock generic DSH tool card may still show the JSON fallback even though the model received the image. This is a client presentation limitation, not a lost generation result.

For a local source checkout, use the same row with `command: node`, an absolute `args` path to `dist/index.js`, and `cwd` set to this repository. Current stock DSH builds bridge MCP tools but do not consume MCP resources in the generic tool card. Without an MCP Apps host, model vision still works and the card falls back to JSON.

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
| `generate_image` | One-stop text-to-image / image-to-image / editing. Saves the original and returns a bounded MCP image preview, structured metadata, and JSON fallback by default; 4K requests poll internally. |
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

The default is `outputMode=hybrid`: the full original is saved to disk while a bounded MCP image preview, `structuredContent`, and equivalent JSON text are returned together. This provides progressive compatibility across Codex, Claude Code, Claude Desktop, and other MCP clients. Use `saveDir` to choose the target directory.

All 1K, 2K, 4K, and `get_generation_task` results use the same envelope:

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

Image base64 appears only in standard MCP `ImageContent`, never duplicated into text or structured metadata. Full 4K originals are not inlined; previews have a maximum 1600-pixel edge and target a 2 MiB byte ceiling, while `filePath`/`url` locate the original.

Use `referenceImages` for image-to-image generation and editing. `fileData.fileUri` supports `gs://` and `https://`; small images can be passed as base64 through `inlineData.data`.

4K requests automatically run as asynchronous tasks: the server creates the task, polls with rate-limit backoff, downloads and saves originals, and creates previews. If the wait exceeds `timeoutSeconds` (default 300), the result has `status=pending` and a `taskId`; this is not treated as generation failure. Fetch the final preview and original URL later with `get_generation_task`.

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
- `imageConfig.imageSize`: `1K`, `2K`, or `4K`. `wan2.7-image` and `seedream-5-0-pro` do not support 4K; `wan2.7-image-pro` also disallows 4K when reference images are present.
- `imageConfig.aspectRatio`: `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9`, `1:4`, `4:1`, `1:8`, or `8:1`. GPT-Image-2 may omit this field and let the service choose; Wan2.7 supports only `1:1`, `16:9`, `9:16`, `4:3`, and `3:4`.
- `referenceImages`: OpenAPI allows up to 14 for Gemini, 4 for GPT-Image-2, 9 for Wan2.7, and 10 for Seedream. These are API limits, not the separate upload limits of the web generator.
- Seedream precise editing: put the source image in `referenceImages` and describe the target region and change in `prompt` using absolute coordinates from the top-left origin. OpenAPI has no separate `mask` or `region` parameter.
- `outputMode` (`generate_image` only): `hybrid` (default, save originals and inline bounded previews), `file` (save originals and return metadata only), or `inline` (do not save to `saveDir`; return a bounded preview, and persist the original to the default recovery directory only when the upstream response has no original URL).
- `saveDir` / `timeoutSeconds` (`generate_image` only): target directory for `hybrid`/`file` mode, and the maximum wait for async (4K) generations.

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

## Development

```bash
npm install
npm run typecheck
npm test
```

To inspect the real single-file MCP App without calling Labnana or spending credits, run `npm run test:ui` and open `http://127.0.0.1:4173/test/mcp-app-host.html`. The local host sends a generated 640×360 PNG fixture through the official AppBridge so the image, status, and metadata can be checked visually.

## Links

- [Labnana integration guide](https://labnana.com/docs/openapi/guide)
- [Labnana OpenAPI reference](https://docs.marswave.ai/openapi-labnana.html)
- [Credit guide](https://labnana.com/docs/pricing/credits)
- [GitHub repository](https://github.com/exoticknight/labnana-mcp)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.exoticknight%2Flabnana-mcp)
- [Glama directory](https://glama.ai/mcp/servers/exoticknight/labnana-mcp)
- Technical support: support@marswave.ai

## License

[Apache-2.0](LICENSE)


## Community

- [LINUX DO](https://linux.do/)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.exoticknight%2Flabnana-mcp)
- [Glama](https://glama.ai/mcp/servers/exoticknight/labnana-mcp)
- [GitHub Issues](https://github.com/exoticknight/labnana-mcp/issues)
