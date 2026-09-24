/**
 * Runs a Quick bar prompt in this window, in Chat mode (no files, no tools
 * that touch the disk). Keys load on the first send, not at open, so the bar
 * appears instantly.
 */
import { antigravityAbort } from "@/features/antigravity";
import { codexAbort } from "@/features/codex";
import { cursorAbort } from "@/features/cursor";
import { buildInstructions } from "@/features/instructions";
import { loadOpencodeSettings, opencodeAbort } from "@/features/opencode";
import { loadVault } from "@/features/secrets";
import { normalizeFolder } from "@/features/workspace";
import type { HistoryMessage } from "@/pages/chat/api/chat";
import { generateStream } from "@/pages/chat/api/router";
import {
  isAntigravityModel,
  isCodexModel,
  isCursorModel,
  isOpencodeModel,
  loadSelectedModelId,
} from "@/pages/chat/models";
import { buildQuickPrompt } from "./actions";
import { getQuickConfig } from "./settings";
import type { QuickEvent, QuickRequest } from "./types";

let vault: Promise<unknown> | undefined;

/** The Quick bar's own pick, else the model the Chat page uses. */
export function quickModelId(request?: Pick<QuickRequest, "modelId">) {
  return request?.modelId ?? getQuickConfig().modelId ?? loadSelectedModelId("chat");
}

export type QuickThread = {
  /** Earlier exchanges, for providers that don't keep a session. */
  history: HistoryMessage[];
  /** OpenCode / CLI agent session from the first answer, to continue it. */
  sessionId?: string;
};

/** Stream the answer; resolves when done, failed or aborted. */
export async function runQuickPrompt(
  request: QuickRequest,
  onEvent: (event: QuickEvent) => void,
  { signal, thread }: { signal?: AbortSignal; thread?: QuickThread } = {},
): Promise<{ sessionId?: string }> {
  const prompt = buildQuickPrompt(request);
  if (!prompt && request.attachments.length === 0) {
    onEvent({ type: "error", message: "พิมพ์ข้อความ หรือเลือก action ก่อน" });
    return {};
  }
  vault ??= loadVault().catch(() => undefined);
  await vault;

  const modelId = quickModelId(request);
  const runId = `quick-${crypto.randomUUID()}`;
  const cwd = normalizeFolder(loadOpencodeSettings().cwd) || undefined;
  let sessionId = thread?.sessionId;
  let text = "";
  let finished = false;

  const abort = () => {
    if (finished) return;
    finished = true;
    if (isCursorModel(modelId)) void cursorAbort(runId).catch(() => undefined);
    else if (isCodexModel(modelId)) void codexAbort(runId).catch(() => undefined);
    else if (isAntigravityModel(modelId)) void antigravityAbort(runId).catch(() => undefined);
    else if (isOpencodeModel(modelId) && sessionId)
      void opencodeAbort({ sessionId, cwd, mode: "chat" }).catch(() => undefined);
  };
  if (signal?.aborted) return { sessionId };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    await generateStream(
      {
        prompt,
        modelId,
        sessionId,
        history: thread?.history,
        mode: "chat",
        runId,
        cwd,
        attachments: request.attachments,
        instructions: buildInstructions(undefined, undefined, "chat"),
      },
      {
        onChunk: (delta) => {
          if (finished) return;
          text += delta;
          onEvent({ type: "text", delta });
        },
        onMetadata: (data) => {
          if (data.sessionId) sessionId = data.sessionId;
        },
        onDone: () => {
          if (finished) return;
          finished = true;
          onEvent({ type: "done", text });
        },
        onError: (message) => {
          if (finished) return;
          finished = true;
          onEvent({ type: "error", message });
        },
      },
    );
  } catch (error) {
    if (!finished) onEvent({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    finished = true;
    signal?.removeEventListener("abort", abort);
  }
  return { sessionId };
}
