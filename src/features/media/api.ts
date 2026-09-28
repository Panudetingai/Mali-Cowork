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
  /** Video only: `1080P`, `720P`, `480P`. */
  resolution?: string | null;
  /** Video only: how long the clip should be. */
  durationSeconds?: number;
  /** Pictures to start from: attachment paths (the backend reads no others). */
  references?: string[];
};

/**
 * How many reference pictures a provider takes for a kind; 0 = none. Mirrors
 * `max_references` in media/providers.rs, which enforces it.
 */
export function maxReferencesFor(provider: string, model: string, kind: MediaKind) {
  if (provider === "xai") return 0;
  if (kind === "image") return model.includes("imagen") ? 0 : 3;
  // Veo and Wan animate from one picture: the first frame.
  return provider === "google" || provider === "alibaba" ? 1 : 0;
}

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
