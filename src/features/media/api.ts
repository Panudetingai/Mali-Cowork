import { invoke } from "@tauri-apps/api/core";
import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";

export type MediaKind = "image" | "video";

export type MediaRequest = {
  prompt: string;
  /** Provider id as Settings → Models knows it. */
  provider: string;
  model: string;
  kind: MediaKind;
  apiKey?: string | null;
  baseUrl?: string | null;
  /** Cowork saves into the working folder; Chat uses the app's media folder. */
  outputDir?: string | null;
  count?: number;
  aspectRatio?: string | null;
};

/**
 * Call a picture or video model straight over its provider's API.
 *
 * No agent and no connector in between: a model that only draws has nothing
 * to say and no tools to call, so an agent would only be a second model paid
 * to forward the prompt — and a second place to keep the same API key.
 */
export function mediaGenerateStream(request: MediaRequest, handlers: ChatStreamHandlers) {
  return invoke<void>("media_generate", {
    request,
    onEvent: createStreamChannel(handlers),
  });
}
