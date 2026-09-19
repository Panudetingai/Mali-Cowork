import { invoke } from "@tauri-apps/api/core";
import {
  createStreamChannel,
  type ChatStreamHandlers,
} from "@/pages/chat/api/chat";
import type {
  FolderGrantInput,
  OpencodeCheckResult,
  OpencodeModelsResult,
  OpencodeRequest,
  PermissionReply,
  WorkMode,
} from "./types";

export function opencodeCheck() {
  return invoke<OpencodeCheckResult>("opencode_check");
}

export function opencodeListModels(cwd?: string) {
  return invoke<OpencodeModelsResult>("opencode_list_models", {
    cwd: cwd || null,
  });
}

export function opencodeDefaultCwd() {
  return invoke<string>("opencode_default_cwd");
}

export function opencodeReplyPermission(
  id: string,
  directory: string,
  reply: PermissionReply,
  /** Also allow this folder for the rest of the running prompt. */
  grant?: { sessionId: string; folder: FolderGrantInput },
) {
  return invoke<void>("opencode_permission_reply", {
    request: {
      id,
      directory,
      reply,
      sessionId: grant?.sessionId ?? null,
      grant: grant?.folder ?? null,
    },
  });
}

const warmed = new Set<string>();

/** Load a folder's OpenCode instance ahead of the first prompt (once per folder). */
export function opencodeWarm(cwd: string | undefined, mode: WorkMode) {
  const key = `${mode}:${cwd ?? ""}`;
  if (warmed.has(key)) return;
  warmed.add(key);
  invoke<void>("opencode_warm", { cwd: cwd || null, mode }).catch(() => warmed.delete(key));
}

type SessionTarget = { sessionId: string; cwd?: string; mode?: WorkMode };

export function opencodeAbort({ sessionId, cwd, mode }: SessionTarget) {
  return invoke<void>("opencode_abort", { sessionId, cwd: cwd || null, mode: mode ?? null });
}

export function opencodeDeleteSession({ sessionId, cwd, mode }: SessionTarget) {
  return invoke<void>("opencode_delete_session", { sessionId, cwd: cwd || null, mode: mode ?? null });
}

export function opencodeSetAuth(providerId: string, key: string) {
  return invoke<void>("opencode_set_auth", { request: { providerId, key } });
}

export async function opencodeGenerateStream(
  request: OpencodeRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  await invoke("opencode_generate", {
    request: {
      prompt: request.prompt,
      model: request.model ?? null,
      cwd: request.cwd ?? null,
      sessionId: request.sessionId ?? null,
      thinking: request.thinking ?? false,
      autoApprove: request.autoApprove ?? false,
      mode: request.mode ?? "cowork",
      folders: request.folders ?? [],
      files: request.files ?? [],
      instructions: request.instructions || null,
    },
    onEvent: createStreamChannel(handlers),
  });
}
