import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { GenerationResultEnvelope } from "../src/generation-result.js";
import "./image-result.css";

type GenerationEnvelope = Partial<GenerationResultEnvelope>;

const statusEl = requiredElement("status");
const galleryEl = requiredElement("gallery");
const messageEl = requiredElement("message");
const detailsEl = requiredElement("details");
const metadataEl = requiredElement("metadata");

const app = new App({ name: "Labnana Image Result", version: "1.0.0" });

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function envelopeFrom(result: CallToolResult): GenerationEnvelope {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as GenerationEnvelope;
  }
  const text = result.content?.find((block) => block.type === "text");
  if (text?.type !== "text") return {};
  try {
    return JSON.parse(text.text) as GenerationEnvelope;
  } catch {
    return { message: text.text };
  }
}

function imageSources(result: CallToolResult): string[] {
  return (result.content ?? [])
    .filter((block) => block.type === "image")
    .map((block) => {
      if (block.type !== "image" || !block.mimeType.startsWith("image/")) return "";
      return `data:${block.mimeType};base64,${block.data}`;
    })
    .filter(Boolean);
}

function formatBytes(bytes?: number): string | undefined {
  if (!bytes || bytes < 1) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function addDetail(label: string, value?: string): void {
  if (!value) return;
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  metadataEl.append(term, description);
}

function addOpenButton(url: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "open-button";
  button.textContent = "打开原图";
  button.addEventListener("click", () => void app.openLink({ url }));
  return button;
}

function applyHostContext(context?: McpUiHostContext): void {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

function render(result: CallToolResult): void {
  const envelope = envelopeFrom(result);
  const sources = imageSources(result);
  const artifacts = envelope.images ?? [];

  galleryEl.replaceChildren();
  metadataEl.replaceChildren();

  sources.forEach((source, index) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    const caption = document.createElement("figcaption");
    const artifact = artifacts[index];
    image.src = source;
    image.alt = `Labnana 生成图片 ${index + 1}`;
    caption.textContent = [
      `图片 ${index + 1}`,
      artifact?.mimeType,
      formatBytes(artifact?.byteLength),
    ].filter(Boolean).join(" · ");
    figure.append(image, caption);
    if (artifact?.url && /^https?:\/\//i.test(artifact.url)) {
      figure.append(addOpenButton(artifact.url));
    }
    galleryEl.append(figure);
  });

  const status = result.isError ? "failed" : envelope.status;
  statusEl.className = `status ${status ?? "pending"}`;
  statusEl.textContent =
    status === "succeeded" ? "生成成功" : status === "failed" ? "生成失败" : "处理中";

  const fallbackMessage =
    sources.length > 0
      ? `已收到 ${sources.length} 张图片预览`
      : status === "pending"
        ? "图片仍在生成，可稍后再次查询任务"
        : "客户端未收到可内联显示的图片预览，请查看原图位置";
  messageEl.textContent = envelope.error?.message ?? envelope.message ?? fallbackMessage;

  addDetail("任务 ID", envelope.taskId);
  artifacts.forEach((artifact, index) => {
    addDetail(`图片 ${index + 1} 原图`, artifact.filePath ?? artifact.url);
  });
  if (envelope.warnings?.length) addDetail("提示", envelope.warnings.join("；"));
  detailsEl.hidden = metadataEl.childElementCount === 0;
}

app.ontoolresult = render;
app.onhostcontextchanged = applyHostContext;
void app
  .connect()
  .then(() => applyHostContext(app.getHostContext()))
  .catch(() => {
    statusEl.className = "status failed";
    statusEl.textContent = "加载失败";
    messageEl.textContent = "客户端未能启动 MCP Apps 图片视图，请使用标准图片或 JSON 结果。";
  });
