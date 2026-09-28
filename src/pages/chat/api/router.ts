import { agentGenerateStream, loadCommandSandbox } from "@/features/agent";
import { buildAttachmentAppendix, type Attachment } from "@/features/attachments";
import type { Skill } from "@/features/instructions";
import { codexGenerateStream } from "@/features/codex";
import { cursorGenerateStream } from "@/features/cursor";
import { antigravityGenerateStream } from "@/features/antigravity";
import { hasHubMcp, hubMcpServers } from "@/features/mcp";
import {
    getOpencodeModels,
    loadOpencodeSettings,
    opencodeGenerateStream,
    type FolderGrantInput,
    type WorkMode,
} from "@/features/opencode";
import { mediaGenerateStream } from "@/features/media";
import { requestConfigFor } from "@/features/providers";
import { recordUsage } from "@/features/usage/ledger";
import type { AgentUsage } from "../types";
import {
    apiModelOf,
    codexModelOf,
    cursorModelOf,
    antigravityModelOf,
    isCodexModel,
    isCursorModel,
    isAntigravityModel,
    isOpencodeModel,
    mediaKindForId,
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
  /**
   * Earlier turns of this chat the agent's session hasn't seen, as a
   * transcript: another model answered them. Agents that keep their own
   * session hear it once; provider APIs get `history` instead.
   */
  handoff?: string;
  /** Summary of the chat this one continues. */
  summary?: string;
  /** Skills the user called with `/name` in this prompt. */
  skills?: Skill[];
  /** The context budget the chat runs with, in tokens. */
  maxTokens?: number;
  /**
   * How hard the model should think, as one of its own levels. Derived from
   * the picked model rather than passed in, so a resend on a different model
   * uses that model's setting and never a level it would reject.
   */
  effort?: string;
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

/** Turns another model had in this chat, so a session picked up mid-chat can carry on. */
function withHandoff(prompt: string, request: GenerateRequest) {
  const handoff = request.handoff?.trim();
  if (!handoff) return prompt;
  return `<earlier_conversation>\nThis chat was answered by other models before you. What was said, which you can't see in your own session:\n\n${handoff}\n</earlier_conversation>\n\nContinue the conversation from here.\n\n${prompt}`;
}

const NO_IMAGES = (name: string) =>
  `${name} can't look at pictures here. Remove the picture, or pick an OpenCode or Codex model.`;

/**
 * The model id a prompt actually runs on. An API model stays on the user's
 * own key: connectors reach it through Mali's own agent (see
 * `runsOnMaliAgent`), never by moving it onto OpenCode.
 */
export function runModelIdFor(modelId: string, _mode?: WorkMode): string {
  return modelId;
}

/**
 * Mali's own agent runs an API model in Cowork (files, commands, connectors),
 * and in Chat while connectors are on (connectors only). Otherwise a chat
 * reply is a plain API call.
 */
export function runsOnMaliAgent(modelId: string, mode: WorkMode) {
  const api = apiModelOf(modelId);
  if (!api || mediaKindForId(modelId, getOpencodeModels())) return false;
  return mode === "cowork" || hasHubMcp();
}

/**
 * Run a prompt on whichever backend its model lives on. Every reply — chats,
 * the Quick bar, the Inbox — passes through here, so this is where its
 * tokens go into the usage ledger, which outlives the chat.
 */
export async function generateStream(
  request: GenerateRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const started = performance.now();
  let firstTokenMs: number | undefined;
  let usage: AgentUsage | undefined;
  let recorded = false;
  const record = () => {
    if (recorded || !usage) return;
    recorded = true;
    recordUsage({
      modelId: request.modelId,
      chatId: request.runId,
      prompt: request.prompt,
      usage,
      durationMs: performance.now() - started,
      firstTokenMs,
    });
  };
  const firstToken = () => {
    firstTokenMs ??= performance.now() - started;
  };
  try {
    await routeStream(request, {
      ...handlers,
      onChunk: (text) => {
        firstToken();
        handlers.onChunk(text);
      },
      onReasoning: (reasoning) => {
        firstToken();
        handlers.onReasoning?.(reasoning);
      },
      onMetadata: (data) => {
        // Later reports refine earlier ones, as on the message (`withMetadata`).
        if (data.usage) usage = { ...usage, ...data.usage };
        handlers.onMetadata?.(data);
      },
      onDone: (doneModelId) => {
        record();
        handlers.onDone(doneModelId);
      },
      // A failed or stopped reply still spent what it reported.
      onError: (message) => {
        record();
        handlers.onError(message);
      },
    });
  } finally {
    record();
  }
}

async function routeStream(
  request: GenerateRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const { modelId } = request;

  // A picture model, which the chat picker does not offer — the Visual page
  // does. A selection stored before that change would otherwise be sent to a
  // chat endpoint that answers with a validation error, so it is drawn here
  // instead of failing.
  const api = apiModelOf(modelId);
  const media = mediaKindForId(modelId, getOpencodeModels());
  if (media && api) {
    return mediaGenerateStream(
      {
        prompt: withCalledSkills(request.prompt, request.skills),
        provider: api.provider,
        model: api.model,
        kind: media,
        ...requestConfigFor(api.provider),
        // Pictures attached in the chat are what to draw from.
        references: (request.attachments ?? []).filter((a) => a.kind === "image").map((a) => a.path),
        // Cowork works in a folder, so the file belongs there; Chat has none.
        outputDir: request.mode === "cowork" ? request.cwd ?? null : null,
      },
      handlers,
    );
  }

  const attachments = request.attachments ?? [];
  const images = attachments.filter((a) => a.kind === "image").map((a) => a.path);
  const videos = attachments.filter((a) => a.kind === "video").map((a) => a.path);
  const pdfs = attachments.filter((a) => a.mime === "application/pdf").map((a) => a.path);

  // Only ever a level the picked model listed (see `efforts`), so it is safe
  // to hand to whichever backend ends up running: an api model that moves
  // onto OpenCode keeps the same levels, because both read the same metadata.
  const { effort } = request;

  const opencode = isOpencodeModel(modelId);
  // OpenCode takes PDFs as files; elsewhere their path is mentioned instead.
  const withFiles =
    withCalledSkills(request.prompt, request.skills) +
    (await buildAttachmentAppendix(attachments, { filesInline: opencode }));
  // Provider APIs get the summary through the history instead.
  const prompt = api && !opencode ? withFiles : withEarlierSummary(withHandoff(withFiles, request), request);

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
        files: [...images, ...pdfs, ...videos],
        instructions: request.instructions,
        effort,
      },
      handlers,
    );
  }

  // An API key on Mali's own agent, which keeps its own session and reaches
  // the connectors through Mali's MCP hub. A plain chat reply only carries
  // text, so a prompt with pictures goes to the agent too.
  if (api && !opencode && (runsOnMaliAgent(modelId, request.mode) || images.length > 0)) {
    if (request.mode === "cowork" && !request.cwd) return handlers.onError("Pick the folder Cowork works in first.");
    return agentGenerateStream(
      {
        prompt: withEarlierSummary(withHandoff(withFiles, request), request),
        provider: api.provider,
        model: api.model,
        ...requestConfigFor(api.provider),
        sessionId: request.sessionId,
        mode: request.mode,
        cwd: request.mode === "cowork" ? request.cwd : undefined,
        folders: request.mode === "cowork" ? (request.folders ?? []) : [],
        instructions: request.instructions,
        effort,
        autoApprove: loadOpencodeSettings().autoApprove,
        sandbox: loadCommandSandbox(),
        runId: request.runId,
        mcp: await hubMcpServers(request.mode === "cowork" ? request.cwd : undefined),
        images,
        contextLimit: request.maxTokens,
        vision: !!getOpencodeModels()
          ?.models.find((m) => m.id === `${api.provider}/${api.model}`)
          ?.input?.includes("image"),
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
        effort,
      },
      handlers,
    );
  }

  // Antigravity CLI: antigravity:<model>
  if (isAntigravityModel(modelId)) {
    // Headless `agy -p` takes text only; pictures are a TUI paste feature.
    if (images.length) return handlers.onError(NO_IMAGES("Antigravity"));
    return antigravityGenerateStream(
      {
        prompt: withInstructions(prompt, request),
        model: antigravityModelOf(modelId),
        cwd: request.cwd,
        sessionId: request.sessionId,
        mode: request.mode,
        folders: request.folders,
        runId: request.runId,
        effort,
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
      effort,
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
