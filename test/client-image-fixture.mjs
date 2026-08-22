#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sharp from "sharp";
import { z } from "zod";

const server = new McpServer({ name: "labnana-client-image-fixture", version: "1.0.0" });

const outputShape = {
  schemaVersion: z.literal(1),
  status: z.literal("succeeded"),
  images: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      mimeType: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      preview: z.object({ included: z.literal(true) }),
    }),
  ),
  testMarker: z.literal("LABNANA_CLIENT_IMAGE_FIXTURE_V1"),
};

server.registerTool(
  "render_test_image",
  {
    title: "返回客户端图片兼容测试图",
    description:
      "返回一张左红右蓝、中央写有 MCP IMAGE OK 的 PNG，用于验证 MCP 客户端是否真正接收并理解 ImageContent。",
    outputSchema: outputShape,
  },
  async () => {
    const svg = Buffer.from(`
      <svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
        <rect width="320" height="360" fill="#e63946"/>
        <rect x="320" width="320" height="360" fill="#2563eb"/>
        <rect x="115" y="125" width="410" height="110" rx="18" fill="#111827" fill-opacity="0.88"/>
        <text x="320" y="195" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="46" font-weight="700" fill="white">MCP IMAGE OK</text>
        <circle cx="72" cy="72" r="34" fill="#facc15"/>
        <path d="M560 45 L605 110 L515 110 Z" fill="#22c55e"/>
      </svg>
    `);
    const image = await sharp(svg).png().toBuffer();
    const envelope = {
      schemaVersion: 1,
      status: "succeeded",
      images: [
        {
          index: 0,
          mimeType: "image/png",
          width: 640,
          height: 360,
          preview: { included: true },
        },
      ],
      testMarker: "LABNANA_CLIENT_IMAGE_FIXTURE_V1",
    };

    return {
      content: [
        {
          type: "image",
          data: image.toString("base64"),
          mimeType: "image/png",
          annotations: { audience: ["user", "assistant"], priority: 1 },
        },
        { type: "text", text: JSON.stringify(envelope, null, 2) },
      ],
      structuredContent: envelope,
    };
  },
);

await server.connect(new StdioServerTransport());
