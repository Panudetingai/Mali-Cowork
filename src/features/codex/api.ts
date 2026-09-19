import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { invoke } from "@tauri-apps/api/core";
import type { CodexCheckResult, CodexModel, CodexRequest } from "./types";

export function codexCheck() {
  return invoke<CodexCheckResult>("codex_check");
}

export function codexListModels() {
  return invoke<CodexModel[]>("codex_list_models");
}

export function codexAbort(runId: string) {
  return invoke<void>("codex_abort", { runId });
}

export async function codexGenerateStream(
  request: CodexRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  await invoke("codex_generate", {
    request: {
      prompt: request.prompt,
      model: request.model ?? null,
      cwd: request.cwd ?? null,
      sessionId: request.sessionId ?? null,
      mode: request.mode ?? "cowork",
      folders: request.folders ?? [],
      runId: request.runId,
      images: request.images ?? [],
    },
    onEvent: createStreamChannel(handlers),
  });
}
