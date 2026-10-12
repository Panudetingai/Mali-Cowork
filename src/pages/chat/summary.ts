import { getOpencodeModels, type FolderGrantInput, type WorkMode } from "@/features/opencode";
import { getTeam } from "@/features/team/store";
import { generateStream, runModelIdFor } from "./api/router";
import { estimateTokens } from "./context-usage";
import { chatIssueOf, loadSelectedModelId, mediaKindForId, modelMetaFromId } from "./models";
import type { ChatMessage } from "./types";

const INSTRUCTIONS = `Summarize the conversation below so that a new assistant, who can't see it, can carry on seamlessly.

Write in the language the conversation mostly uses. Keep names, numbers, file paths, commands and decisions exact. Use these headings, skipping any that would be empty:
- Goal: what the user is trying to achieve
- Key facts and decisions
- Work done: files, changes, results
- Open questions and next steps

Stay under 400 words. Reply with the summary only.`;

const MAX_MESSAGE_CHARS = 6000;

/**
 * The conversation as plain text, newest turns first to keep, trimmed to
 * `maxTokens`. The first request is always kept: it usually states the goal.
 */
export function transcript(messages: ChatMessage[], maxTokens: number): string {
  const turns = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
    .map((m) => {
      const text = m.content.trim();
      const clipped = text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)} …` : text;
      return `${m.role === "user" ? "User" : "Assistant"}: ${clipped}`;
    });
  if (turns.length === 0) return "";

  const [first, ...rest] = turns;
  const kept: string[] = [];
  let used = estimateTokens(first);
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rest[i]);
    if (used + cost > maxTokens) break;
    kept.unshift(rest[i]);
    used += cost;
  }
  const skipped = rest.length - kept.length;
  return [first, ...(skipped > 0 ? [`(… ${skipped} earlier messages left out …)`] : []), ...kept].join("\n\n");
}

/** Where a summary is written: which model, and in which mode. */
export type SummaryRun = { modelId: string; mode: WorkMode; cwd?: string; folders?: FolderGrantInput[] };

/** Whether a model can answer a plain prompt in Chat mode (OpenCode Zen's free tier can't; picture models don't write). */
export function answersInChat(modelId: string): boolean {
  const opencode = getOpencodeModels();
  if (mediaKindForId(modelId, opencode)) return false;
  return !chatIssueOf(modelMetaFromId(modelId, opencode));
}

/**
 * How to summarize a chat that runs on `modelId`:
 * 1. that model, in Chat mode, when it answers there;
 * 2. else, in a Cowork chat, that same model in Cowork with the chat's
 *    folder read-only — a free Zen model still costs nothing, and can't
 *    change a file;
 * 3. else another model that answers in Chat: the one picked for Chat, or
 *    the team's coach.
 * Undefined when there is none; `cannotSummarize` says what to do.
 */
export function summaryRunFor(
  modelId: string,
  chat: { mode?: WorkMode; cwd?: string } = {},
  { answers = answersInChat, others = [loadSelectedModelId("chat"), getTeam().coachModelId] }: { answers?: (id: string) => boolean; others?: (string | undefined)[] } = {},
): SummaryRun | undefined {
  if (answers(modelId)) return { modelId, mode: "chat" };
  if (chat.mode === "cowork" && chat.cwd) {
    return { modelId, mode: "cowork", cwd: chat.cwd, folders: [{ path: chat.cwd, access: "read" }] };
  }
  const other = others
    .filter((id): id is string => !!id)
    .map((id) => runModelIdFor(id))
    .find((id) => id !== modelId && answers(id));
  return other ? { modelId: other, mode: "chat" } : undefined;
}

export function cannotSummarize(modelId: string): string {
  const name = modelMetaFromId(modelId, getOpencodeModels()).name;
  return `${name} can't write a summary in Chat (OpenCode Zen's free models only answer coding sessions). Open this chat in Cowork, or pick a model for Chat — an API key or a paid Zen model — and summarize again.`;
}

/** Ask for a summary of `messages`: in Chat mode with no tools, or in Cowork with folders it may only read. */
export async function summarizeConversation(
  messages: ChatMessage[],
  { modelId, runId, maxTokens, mode = "chat", cwd, folders }: { runId: string; maxTokens: number } & Omit<SummaryRun, "mode"> & { mode?: WorkMode },
): Promise<string> {
  // Leave room for the instructions and the answer.
  const text = transcript(messages, Math.max(2_000, Math.floor(maxTokens * 0.6)));
  if (!text) return "";

  let summary = "";
  let failure: string | undefined;
  await generateStream(
    {
      // In Cowork the agent has tools; it's told not to use them, and the folder is read-only anyway.
      prompt: `${INSTRUCTIONS}${mode === "cowork" ? "\n\nDon't use any tools and don't open files: everything you need is below." : ""}\n\n<conversation>\n${text}\n</conversation>`,
      modelId,
      mode,
      ...(mode === "cowork" ? { cwd, folders } : {}),
      runId,
      history: [],
      helper: true,
    },
    {
      onChunk: (chunk) => {
        summary += chunk;
      },
      onDone: () => {},
      onError: (message) => {
        failure = message;
      },
    },
  );
  if (failure) throw new Error(failure);
  return summary.trim();
}

/** How an agent that keeps its own session first hears the summary. */
export function withSummary(prompt: string, summary: string) {
  return `<previous_conversation_summary>\n${summary}\n</previous_conversation_summary>\n\nContinue from the summary above.\n\n${prompt}`;
}
