import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { requestConfigFor } from "@/features/providers";
import { invoke } from "@tauri-apps/api/core";
import type { GeminiCheckResult, GeminiModel, GeminiRequest } from "./types";

/**
 * The Gemini key from Settings → Models. Headless `gemini` reads its key only
 * from `GEMINI_API_KEY`, so the backend hands this one over.
 */
function settingsApiKey() {
  return requestConfigFor("google").apiKey;
}

export function geminiCheck() {
  return invoke<GeminiCheckResult>("gemini_check", { apiKey: settingsApiKey() });
}

export function geminiListModels() {
  return invoke<GeminiModel[]>("gemini_list_models");
}

export function geminiAbort(runId: string) {
  return invoke<void>("gemini_abort", { runId });
}

export async function geminiGenerateStream(
  request: GeminiRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  await invoke("gemini_generate", {
    request: {
      prompt: request.prompt,
      model: request.model ?? null,
      cwd: request.cwd ?? null,
      sessionId: request.sessionId ?? null,
      mode: request.mode ?? "cowork",
      folders: request.folders ?? [],
      runId: request.runId,
      apiKey: settingsApiKey(),
    },
    onEvent: createStreamChannel(handlers),
  });
}
