import { readFile } from "node:fs/promises";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const IMAGE_RESULT_UI_URI = "ui://labnana/image-result.html";

export const IMAGE_RESULT_UI_META = {
  ui: { resourceUri: IMAGE_RESULT_UI_URI },
} as const;

export function registerImageResultUi(server: McpServer): void {
  registerAppResource(
    server,
    "Labnana 图片结果",
    IMAGE_RESULT_UI_URI,
    {
      title: "Labnana 图片结果",
      description: "显示 Labnana 生成的图片预览、状态和原图位置。",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: IMAGE_RESULT_UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(new URL("./image-result.html", import.meta.url), "utf8"),
        },
      ],
    }),
  );
}
