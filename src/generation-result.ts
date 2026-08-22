export interface ImagePreviewResult {
  included: boolean;
  mimeType?: string;
  width?: number;
  height?: number;
  byteLength?: number;
}

export interface ImageArtifactResult {
  index: number;
  mimeType: string;
  width?: number;
  height?: number;
  byteLength?: number;
  sha256?: string;
  url?: string;
  filePath?: string;
  preview: ImagePreviewResult;
}

export interface GenerationResultEnvelope extends Record<string, unknown> {
  schemaVersion: 1;
  status: "succeeded" | "pending" | "failed";
  retryable?: boolean;
  message?: string;
  taskId?: string;
  images: ImageArtifactResult[];
  generation?: {
    finishReason?: string;
    modelVersion?: string;
    responseId?: string;
  };
  warnings?: string[];
  error?: {
    message: string;
    details?: unknown;
  };
}
