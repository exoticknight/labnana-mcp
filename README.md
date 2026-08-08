# labnana-mcp

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
claude mcp add labnana -- npx -y @exoticknight/labnana-mcp@1.0.0
```

The package can also be started directly with:

```bash
npx -y @exoticknight/labnana-mcp@1.0.0
```

### Claude Desktop and other MCP clients

Use an equivalent `mcpServers` configuration:

```json
{
  "mcpServers": {
    "labnana": {
      "command": "npx",
      "args": ["-y", "@exoticknight/labnana-mcp@1.0.0"],
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

The command-line options below are also supported:

| Option | Description |
| --- | --- |
| `--api-key <key>` | Provide the API key for a local process. |
| `--base-url <url>` | Override the default API endpoint, `https://api.labnana.com`. |

Environment variables are recommended because command-line arguments may be visible in the local process list.

## Tools

| Tool | Description |
| --- | --- |
| `get_subscription` | Get subscription status, credit balances, and free usage information. |
| `estimate_credits` | Estimate the credits required for a generation without generating an image. |
| `generate_image` | Generate an image synchronously and return it as MCP image content with metadata. |
| `generate_image_async` | Create an asynchronous generation task and return its `taskId`. |
| `list_generation_tasks` | List generation tasks with pagination and optional status filtering. |
| `get_generation_task` | Get task details and public image URLs after completion. |
| `wait_for_generation_task` | Poll until a task succeeds or fails. |

## Usage

### Synchronous generation

```json
{
  "name": "generate_image",
  "arguments": {
    "provider": "google",
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

Use `referenceImages` for image-to-image generation and editing. `fileData.fileUri` supports `gs://` and `https://`; small images can be passed as base64 through `inlineData.data`.

### Asynchronous generation

For large images or batch jobs, use:

```text
generate_image_async -> wait_for_generation_task
```

The completed task returns a public image URL.

### Credit estimation

```json
{
  "name": "estimate_credits",
  "arguments": {
    "provider": "google",
    "prompt": "A Shiba Inu running through a snowy landscape",
    "imageConfig": {
      "imageSize": "4K"
    }
  }
}
```

## Parameters

- `provider`: `google`, `openai`, `alibaba`, or `bytedance`; routing follows `model`.
- `model` (default: `gemini-3-pro-image`): `gemini-3-pro-image`, `gemini-3.1-flash-image`, `gpt-image-2`, `wan2.7-image-pro`, `wan2.7-image`, or `seedream-5-0-pro`.
- `imageConfig.imageSize`: `1K`, `2K`, or `4K`. `wan2.7-image` does not support 4K; `seedream-5-0-pro` supports only 1K and 2K.
- `imageConfig.aspectRatio`: `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9`, `1:4`, `4:1`, `1:8`, or `8:1`. GPT-Image-2 may omit this field and let the service choose; Wan2.7 supports only `1:1`, `16:9`, `9:16`, `4:3`, and `3:4`.
- `referenceImages`: up to 14 for Gemini, 4 for GPT-Image-2, 9 for Wan2.7, and 10 for Seedream.

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

## Links

- [Labnana integration guide](https://labnana.com/docs/openapi/guide)
- [Labnana OpenAPI reference](https://docs.marswave.ai/openapi-labnana.html)
- [Credit guide](https://labnana.com/docs/pricing/credits)
- [GitHub repository](https://github.com/exoticknight/labnana-mcp)
- Technical support: support@marswave.ai

## License

[Apache-2.0](LICENSE)
