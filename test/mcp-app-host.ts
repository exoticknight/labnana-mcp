import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

function fixturePng(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.fillStyle = "#e63946";
  context.fillRect(0, 0, 320, 360);
  context.fillStyle = "#2563eb";
  context.fillRect(320, 0, 320, 360);
  context.fillStyle = "rgba(17, 24, 39, .88)";
  context.fillRect(110, 125, 420, 110);
  context.fillStyle = "white";
  context.font = "700 46px Arial";
  context.textAlign = "center";
  context.fillText("MCP IMAGE OK", 320, 194);
  return canvas.toDataURL("image/png").split(",", 2)[1];
}

const iframe = document.querySelector<HTMLIFrameElement>("#app");
if (!iframe) throw new Error("Missing test iframe");

iframe.addEventListener("load", async () => {
  if (!iframe.contentWindow) throw new Error("Missing iframe window");
  const bridge = new AppBridge(
    null,
    { name: "Labnana Visual Test Host", version: "1.0.0" },
    { openLinks: {} },
    {
      hostContext: {
        theme: "light",
        platform: "desktop",
        containerDimensions: { width: 900, maxHeight: 680 },
      },
    },
  );
  bridge.onopenlink = async () => ({});
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: { prompt: "MCP Apps UI fixture" } });
    await bridge.sendToolResult({
      content: [
        { type: "image", mimeType: "image/png", data: fixturePng() },
        { type: "text", text: "Labnana MCP Apps visual fixture" },
      ],
      structuredContent: {
        schemaVersion: 1,
        status: "succeeded",
        taskId: "visual-test-task",
        images: [
          {
            index: 0,
            mimeType: "image/png",
            byteLength: 16384,
            filePath: "C:\\labnana-images\\mcp-image-ok.png",
            preview: { included: true, byteLength: 16384 },
          },
        ],
      },
    });
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
});
