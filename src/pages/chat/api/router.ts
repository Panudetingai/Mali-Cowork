import {
  loadOpencodeSettings,
  opencodeGenerateStream,
  type FolderGrantInput,
  type WorkMode,
} from "@/features/opencode";
import { cursorGenerateStream } from "@/features/cursor";
import { requestConfigFor } from "@/features/providers";
import {
  apiModelOf,
  cursorModelOf,
  isCursorModel,
  isOpencodeModel,
  opencodeModelOf,
} from "../models";
import { chatGenerateStream, type ChatStreamHandlers, type HistoryMessage } from "./chat";
import { cliGenerateStream } from "./cli";

export type GenerateRequest = {
  prompt: string;
  modelId: string;
  /** Agent session to continue, when the backend supports it. */
  sessionId?: string;
  /** Earlier turns, for providers that don't keep their own session. */
  history?: HistoryMessage[];
  mode: WorkMode;
  /** Identifies the run so it can be stopped. */
  runId: string;
  /** Cowork: the folder the agent works in. */
  cwd?: string;
  /** Cowork: every folder the user granted for this chat, `cwd` first. */
  folders?: FolderGrantInput[];
};

export async function generateStream(
  request: GenerateRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const { prompt, modelId } = request;

  // OpenCode: opencode:<provider/model>
  if (isOpencodeModel(modelId)) {
    const settings = loadOpencodeSettings();
    return opencodeGenerateStream(
      {
        prompt,
        model: opencodeModelOf(modelId),
        cwd: request.cwd,
        sessionId: request.sessionId,
        thinking: settings.thinking,
        // Chat mode has no file tools, so there is nothing to approve.
        autoApprove: request.mode === "cowork" && settings.autoApprove,
        mode: request.mode,
        folders: request.folders,
      },
      handlers,
    );
  }

  // Cursor Agent CLI: cursor:<model>
  if (isCursorModel(modelId)) {
    return cursorGenerateStream(
      {
        prompt,
        model: cursorModelOf(modelId),
        cwd: request.cwd,
        sessionId: request.sessionId,
        mode: request.mode,
        folders: request.folders,
        runId: request.runId,
      },
      handlers,
    );
  }

  // Other local CLIs: cli:<agent>
  if (modelId.startsWith("cli:")) {
    return cliGenerateStream({ prompt, agent: modelId.slice(4), cwd: request.cwd }, handlers);
  }

  // Provider API: api:<provider>/<model>
  const api = apiModelOf(modelId);
  if (!api) {
    handlers.onError(`Unknown model: ${modelId}. Pick another model or configure one in Settings.`);
    return;
  }
  return chatGenerateStream(
    {
      prompt,
      provider: api.provider,
      model: api.model,
      ...requestConfigFor(api.provider),
      history: request.history ?? [],
    },
    handlers,
  );
}
