import { buildAttachmentAppendix, type Attachment } from "@/features/attachments";
import type { Skill } from "@/features/instructions";
import { codexGenerateStream } from "@/features/codex";
import { cursorGenerateStream } from "@/features/cursor";
import { geminiGenerateStream } from "@/features/gemini";
import { hasEnabledMcp } from "@/features/mcp";
import {
    getOpencodeModels,
    loadOpencodeSettings,
    opencodeGenerateStream,
    type FolderGrantInput,
    type WorkMode,
} from "@/features/opencode";
import { requestConfigFor } from "@/features/providers";
import {
    apiModelOf,
    codexModelOf,
    cursorModelOf,
    geminiModelOf,
    isCodexModel,
    isCursorModel,
    isGeminiModel,
    isOpencodeModel,
    OPENCODE_PREFIX,
    opencodeModelOf,
} from "../models";
import { withSummary } from "../summary";
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
  /** Files and pictures attached to this prompt. */
  attachments?: Attachment[];
  /** Custom instructions and enabled skills (Settings → Instructions). */
  instructions?: string;
  /** Summary of the chat this one continues. */
  summary?: string;
  /** Skills the user called with `/name` in this prompt. */
  skills?: Skill[];
};

/** Skills called with `/name` travel with this one prompt, for every backend. */
function withCalledSkills(prompt: string, skills: Skill[] = []) {
  if (skills.length === 0) return prompt;
  const blocks = skills.map((k) => `<skill name="${k.name}">\n${k.instructions.trim()}\n</skill>`);
  const names = skills.map((k) => k.name).join(", ");
  return `${blocks.join("\n\n")}\n\nThe user called the skill${skills.length > 1 ? "s" : ""} ${names}: follow ${skills.length > 1 ? "them" : "it"} for this request.\n\n${prompt}`;
}

/** Agents that keep their own session: instructions go into its first prompt. */
function withInstructions(prompt: string, request: GenerateRequest) {
  const instructions = request.instructions?.trim();
  if (!instructions || request.sessionId) return prompt;
  return `<instructions>\n${instructions}\n</instructions>\n\n${prompt}`;
}

/** The earlier chat's summary, heard once by agents that keep a session. */
function withEarlierSummary(prompt: string, request: GenerateRequest) {
  return request.summary && !request.sessionId ? withSummary(prompt, request.summary) : prompt;
}

const NO_IMAGES = (name: string) =>
  `${name} can't look at pictures here. Remove the picture, or pick an OpenCode, Codex or Gemini model.`;

/**
 * The model id a prompt actually runs on. Provider API models only stream
 * text, so while MCP servers are on they run through OpenCode instead, which
 * holds the same provider key (see `syncCliProviders`) and the MCP tools.
 * Falls back to the direct API when OpenCode can't serve the model.
 */
export function runModelIdFor(modelId: string): string {
  const api = apiModelOf(modelId);
  if (!api || !hasEnabledMcp()) return modelId;
  const agentId = `${api.provider}/${api.model}`;
  const agentModel = getOpencodeModels()?.models.find((m) => m.id === agentId);
  if (!agentModel?.connected || agentModel.toolCall === false) return modelId;
  return `${OPENCODE_PREFIX}${agentId}`;
}

export async function generateStream(
  request: GenerateRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  let { modelId } = request;
  const attachments = request.attachments ?? [];
  const images = attachments.filter((a) => a.kind === "image").map((a) => a.path);
  const pdfs = attachments.filter((a) => a.mime === "application/pdf").map((a) => a.path);

  // Provider APIs here only take text; OpenCode can send the same model a picture.
  const api = apiModelOf(modelId);
  if (api && images.length > 0) {
    const agentId = `${api.provider}/${api.model}`;
    const agentModel = getOpencodeModels()?.models.find((m) => m.id === agentId);
    if (!agentModel?.connected) return handlers.onError(NO_IMAGES(api.model));
    modelId = `${OPENCODE_PREFIX}${agentId}`;
  }

  const opencode = isOpencodeModel(modelId);
  // OpenCode takes PDFs as files; elsewhere their path is mentioned instead.
  const withFiles =
    withCalledSkills(request.prompt, request.skills) +
    (await buildAttachmentAppendix(attachments, { filesInline: opencode }));
  // Provider APIs get the summary through the history instead.
  const prompt = api && !opencode ? withFiles : withEarlierSummary(withFiles, request);

  // OpenCode: opencode:<provider/model>
  if (opencode) {
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
        files: [...images, ...pdfs],
        instructions: request.instructions,
      },
      handlers,
    );
  }

  // Cursor Agent CLI: cursor:<model>
  if (isCursorModel(modelId)) {
    if (images.length) return handlers.onError(NO_IMAGES("Cursor"));
    return cursorGenerateStream(
      {
        prompt: withInstructions(prompt, request),
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

  // Codex CLI: codex:<model>
  if (isCodexModel(modelId)) {
    return codexGenerateStream(
      {
        prompt: withInstructions(prompt, request),
        model: codexModelOf(modelId),
        cwd: request.cwd,
        sessionId: request.sessionId,
        mode: request.mode,
        folders: request.folders,
        runId: request.runId,
        images,
      },
      handlers,
    );
  }

  // Gemini CLI: gemini:<model>
  if (isGeminiModel(modelId)) {
    return geminiGenerateStream(
      {
        prompt: withInstructions(prompt, request),
        model: geminiModelOf(modelId),
        cwd: request.cwd,
        sessionId: request.sessionId,
        mode: request.mode,
        folders: request.folders,
        runId: request.runId,
        images,
      },
      handlers,
    );
  }

  // Other local CLIs: cli:<agent>
  if (modelId.startsWith("cli:")) {
    if (images.length) return handlers.onError(NO_IMAGES(modelId.slice(4)));
    return cliGenerateStream(
      { prompt: withInstructions(prompt, request), agent: modelId.slice(4), cwd: request.cwd },
      handlers,
    );
  }

  // Provider API: api:<provider>/<model>
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
      history: [
        ...(request.summary
          ? ([
              { role: "user", content: withSummary("(The chat continues below.)", request.summary) },
              { role: "assistant", content: "Understood. I have the context from the earlier conversation." },
            ] satisfies HistoryMessage[])
          : []),
        ...(request.history ?? []),
      ],
      system: request.instructions || null,
    },
    handlers,
  );
}
