import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { requestConfigFor } from "@/features/providers";
import { invoke } from "@tauri-apps/api/core";
import type { AntigravityCheckResult, AntigravityModel, AntigravityRequest } from "./types";

/**
 * The Google key from Settings → Models. Antigravity CLI normally signs in with
 * a Google account; a key is only used when the user set
 * `"modelProvider": "gemini"` in `~/.gemini/antigravity-cli/settings.json`,
 * where the CLI reads it from `GEMINI_API_KEY`.
 */
function settingsApiKey() {
  return requestConfigFor("google").apiKey;
}

export function antigravityCheck() {
  return invoke<AntigravityCheckResult>("antigravity_check", { apiKey: settingsApiKey() });
}

export function antigravityListModels() {
  return invoke<AntigravityModel[]>("antigravity_list_models", { apiKey: settingsApiKey() });
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
      apiKey: settingsApiKey(),
    },
    onEvent: createStreamChannel(handlers),
  });
}
