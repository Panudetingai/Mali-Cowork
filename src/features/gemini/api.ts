import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { invoke } from "@tauri-apps/api/core";
import type { GeminiCheckResult, GeminiModel, GeminiRequest } from "./types";

export function geminiCheck() {
  return invoke<GeminiCheckResult>("gemini_check");
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
    },
    onEvent: createStreamChannel(handlers),
  });
}
