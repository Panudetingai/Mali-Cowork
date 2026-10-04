import { createStreamChannel, type ChatStreamHandlers } from "@/pages/chat/api/chat";
import { invoke } from "@tauri-apps/api/core";
import type { CursorCheckResult, CursorModel, CursorRequest } from "./types";

export function cursorCheck() {
  return invoke<CursorCheckResult>("cursor_check");
}

/** Opens the browser; resolves with the status once sign-in finishes. */
export function cursorLogin() {
  return invoke<CursorCheckResult>("cursor_login");
}

export function cursorListModels() {
  return invoke<CursorModel[]>("cursor_list_models");
}

export function cursorAbort(runId: string) {
  return invoke<void>("cursor_abort", { runId });
}

export async function cursorGenerateStream(
  request: CursorRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  await invoke("cursor_generate", {
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
