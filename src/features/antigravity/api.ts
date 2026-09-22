import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { requestConfigFor } from "@/features/providers";
import { invoke } from "@tauri-apps/api/core";
import type { AntigravityCheckResult, AntigravityModel, AntigravityRequest } from "./types";

/**
 * The Antigravity key from Settings → Models. Headless `antigravity` reads its key only
 * from `ANTIGRAVITY_API_KEY`, so the backend hands this one over.
 */
function settingsApiKey() {
  return requestConfigFor("google").apiKey;
}

export function antigravityCheck() {
  return invoke<AntigravityCheckResult>("antigravity_check", { apiKey: settingsApiKey() });
}

export function antigravityListModels() {
  return invoke<AntigravityModel[]>("antigravity_list_models");
}

export function antigravityAbort(runId: string) {
  return invoke<void>("antigravity_abort", { runId });
}

export async function antigravityGenerateStream(
  request: AntigravityRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  await invoke("antigravity_generate", {
    request: {
      prompt: request.prompt,
      model: request.model ?? null,
      cwd: request.cwd ?? null,
      sessionId: request.sessionId ?? null,
      mode: request.mode ?? "cowork",
      folders: request.folders ?? [],
      runId: request.runId,
      images: request.images ?? [],
      apiKey: settingsApiKey(),
    },
    onEvent: createStreamChannel(handlers),
  });
}
