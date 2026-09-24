/**
 * Runs a Quick bar prompt in this window, in Chat mode (no files, no tools
 * that touch the disk). Keys load on the first send, not at open, so the bar
 * appears instantly.
 */
import { antigravityAbort } from "@/features/antigravity";
import { codexAbort } from "@/features/codex";
import { cursorAbort } from "@/features/cursor";
import { buildInstructions } from "@/features/instructions";
import { getOpencodeModels, loadOpencodeSettings, opencodeAbort, opencodeListModels } from "@/features/opencode";
import { loadVault } from "@/features/secrets";
import { normalizeFolder } from "@/features/workspace";
import type { HistoryMessage } from "@/pages/chat/api/chat";
import { generateStream } from "@/pages/chat/api/router";
import {
  chatIssueOf,
  isAntigravityModel,
  isCodexModel,
  isCursorModel,
  isMediaModelId,
  isOpencodeModel,
  apiModelOf,
  loadSelectedModelId,
  modelMetaFromId,
  OPENCODE_DEFAULT_ID,
  opencodeModelOf,
} from "@/pages/chat/models";
import { buildQuickPrompt } from "./actions";
import { getQuickConfig } from "./settings";
import type { QuickEvent, QuickRequest } from "./types";

let vault: Promise<unknown> | undefined;

/** The Quick bar's own pick, else the model the Chat page uses. Never a picture/video model. */
export function quickModelId(request?: Pick<QuickRequest, "modelId">) {
  const chosen = request?.modelId ?? getQuickConfig().modelId ?? loadSelectedModelId("chat");
  if (isMediaModelId(chosen)) return OPENCODE_DEFAULT_ID;
  return chosen;
}

export type QuickModelInfo = {
  id: string;
  /** Display name, e.g. "Claude Sonnet 5"; for Auto, the model it resolves to. */
  name: string;
  /** models.dev logo id, e.g. "anthropic". */
  provider: string;
  auto: boolean;
};

const quickCwd = () => normalizeFolder(loadOpencodeSettings().cwd) || undefined;

/**
 * The model the Quick bar will answer with, by its real name. The Quick bar
 * doesn't build the model catalog, so names come from OpenCode's list (which
 * also knows the API models) — fetched once, read-only.
 */
export async function describeQuickModel(): Promise<QuickModelInfo> {
  const id = quickModelId();
  const list = getOpencodeModels() ?? (await opencodeListModels(quickCwd()).catch(() => null));
  const meta = modelMetaFromId(id, list);
  const api = apiModelOf(id);
  // Provider API ids are raw (`claude-sonnet-5`); OpenCode lists the same model by name.
  const listed = api ? list?.models.find((m) => m.id === `${api.provider}/${api.model}`) : undefined;
  const auto = id === OPENCODE_DEFAULT_ID;
  const resolved = auto ? list?.models.find((m) => m.id === list.defaultModel) : undefined;
  return {
    id,
    name: listed?.name ?? meta.name,
    provider: resolved?.providerId ?? meta.provider,
    auto,
  };
}

/**
 * Why `modelId` can't answer in the Quick bar, or undefined. The Quick bar
 * runs in Chat mode, and OpenCode Zen's free models only answer full coding
 * sessions — including when "Auto" resolves to one. Checked before sending,
 * so the user gets a way out instead of a provider error.
 */
export async function quickModelIssue(modelId: string, cwd?: string): Promise<string | undefined> {
  if (!isOpencodeModel(modelId)) return undefined;
  const list = getOpencodeModels() ?? (await opencodeListModels(cwd).catch(() => null));
  if (!list) return undefined;
  const auto = modelId === OPENCODE_DEFAULT_ID;
  const agentId = auto ? list.defaultModel : opencodeModelOf(modelId);
  const model = list.models.find((m) => m.id === agentId);
  if (!model || !chatIssueOf({ provider: model.providerId, source: "opencode", free: model.free })) return undefined;
  return auto
    ? `"Auto" ใช้ ${model.name} ซึ่งเป็นโมเดลฟรีของ OpenCode Zen — โมเดลฟรีตอบได้เฉพาะงาน Cowork ไม่ใช่ Quick bar เลือกโมเดลอื่นใน Settings → Quick bar`
    : `${model.name} เป็นโมเดลฟรีของ OpenCode Zen ซึ่งตอบได้เฉพาะงาน Cowork ไม่ใช่ Quick bar เลือกโมเดลอื่นใน Settings → Quick bar`;
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
  const cwd = quickCwd();
  const issue = await quickModelIssue(modelId, cwd);
  if (issue) {
    onEvent({ type: "error", message: issue, fix: "pick-model" });
    return {};
  }
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
