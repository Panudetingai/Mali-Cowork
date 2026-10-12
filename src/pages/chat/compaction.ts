/**
 * "Summarize and keep going", in the same chat. A summary takes the place of
 * everything up to the message it was written after: the model hears the
 * summary and only what came since, while the user still sees the whole
 * chat, with the summary shown where it was written. An agent that keeps its
 * own session starts a fresh one that hears the summary, so the weight is
 * really gone, not just hidden.
 */
import { clearAgentSessions, getChat, sessionMode, updateChat, type ChatCompaction, type ChatSession } from "@/features/chat-history";
import { estimateTokens } from "./context-usage";
import { cannotSummarize, summarizeConversation, summaryRunFor } from "./summary";
import type { ChatMessage } from "./types";

/**
 * The latest finished summary in the chat. One whose message was edited or
 * retried away no longer stands: what it covered changed.
 */
export function lastCompaction(chat: Pick<ChatSession, "compactions" | "messages"> | undefined): ChatCompaction | undefined {
  return [...(chat?.compactions ?? [])]
    .reverse()
    .find((c) => c.summary && !c.summarizing && chat!.messages.some((m) => m.id === c.afterMessageId));
}

/** The messages the model still hears: those after the latest summary. */
export function liveMessages(chat: Pick<ChatSession, "messages" | "compactions">): ChatMessage[] {
  const last = lastCompaction(chat);
  if (!last) return chat.messages;
  return chat.messages.slice(chat.messages.findIndex((m) => m.id === last.afterMessageId) + 1);
}

/** What the model hears in place of what was summarized: this chat's latest summary, or the chat it continues. */
export function carriedSummary(chat: Pick<ChatSession, "compactions" | "continuedFrom" | "messages"> | undefined): string | undefined {
  return lastCompaction(chat)?.summary ?? chat?.continuedFrom?.summary;
}

/** Whether there's anything new to summarize. */
export function canCompact(chat: Pick<ChatSession, "messages" | "compactions"> | undefined): boolean {
  if (!chat || chat.compactions?.some((c) => c.summarizing)) return false;
  return liveMessages(chat).some((m) => (m.role === "user" || m.role === "assistant") && m.content.trim());
}

/**
 * Summarize the chat so far, in place. The card shows while it's written;
 * a summary that fails leaves the chat as it was and says why.
 */
export async function compactChat(chatId: string, modelId: string, maxTokens: number): Promise<ChatCompaction> {
  const chat = getChat(chatId);
  if (!chat || !canCompact(chat)) throw new Error("There's nothing new to summarize yet.");
  // A model that can't answer in Chat (OpenCode Zen's free tier) summarizes in Cowork, or another model does.
  const run = summaryRunFor(modelId, { mode: sessionMode(chat), cwd: chat.cwd });
  if (!run) throw new Error(cannotSummarize(modelId));
  const live = liveMessages(chat);
  const last = chat.messages.at(-1)!;
  const compaction: ChatCompaction = {
    id: crypto.randomUUID(),
    afterMessageId: last.id,
    summarizing: true,
    messages: live.filter((m) => m.role === "user" || m.role === "assistant").length,
    tokensBefore: live.reduce((sum, m) => sum + estimateTokens(m.content + (m.context ?? "")), 0),
    at: Date.now(),
  };
  updateChat(chatId, (s) => ({ ...s, compactions: [...(s.compactions ?? []), compaction] }));
  const settle = (patch: Partial<ChatCompaction> | null) =>
    updateChat(chatId, (s) => ({
      ...s,
      compactions: patch === null
        ? (s.compactions ?? []).filter((c) => c.id !== compaction.id)
        : (s.compactions ?? []).map((c) => (c.id === compaction.id ? { ...c, ...patch } : c)),
    }));
  try {
    // The summary before this one is part of what the chat knew.
    const earlier = carriedSummary(chat);
    const messages: ChatMessage[] = earlier
      ? [{ id: "earlier", role: "assistant", content: `Summary of the conversation before this point:\n${earlier}` }, ...live]
      : live;
    const summary = (await summarizeConversation(messages, { ...run, runId: `${chatId}:summary`, maxTokens })).trim();
    if (!summary) throw new Error("The model didn't write a summary. Try again, or pick another model.");
    settle({ summary, summarizing: false });
    // Agents that keep their own session start a fresh one, which hears the summary.
    clearAgentSessions(chatId);
    return { ...compaction, summary, summarizing: false };
  } catch (error) {
    settle(null);
    throw error;
  }
}

/** Whether `messageId` is covered by a summary (the model no longer hears it as written). */
export function summarizedAway(chat: Pick<ChatSession, "messages" | "compactions">, messageId: string): boolean {
  const last = lastCompaction(chat);
  if (!last) return false;
  const cut = chat.messages.findIndex((m) => m.id === last.afterMessageId);
  const at = chat.messages.findIndex((m) => m.id === messageId);
  return cut >= 0 && at >= 0 && at <= cut;
}
