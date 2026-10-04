import type { AgentUsage, ChatMessage } from "./types";

/** System prompt and per-message framing the providers add on top of the text. */
const OVERHEAD_TOKENS = 200;
const PER_MESSAGE_TOKENS = 4;

/**
 * Rough token count when the provider reports none. Latin text averages about
 * four characters a token; Thai and other scripts closer to one or two.
 */
export function estimateTokens(text: string) {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other / 1.5);
}

export type ContextUsage = {
  usedTokens: number;
  /** Totals across the chat, for the breakdown. */
  totals: Required<Pick<AgentUsage, "inputTokens" | "outputTokens" | "reasoningTokens" | "cacheReadTokens">> & {
    cost: number;
  };
  /** False when the numbers are estimates only. */
  reported: boolean;
};

/** Size of the context the next request will carry. */
export function contextUsage(messages: ChatMessage[], pendingPrompt = ""): ContextUsage {
  const totals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cost: 0 };
  let lastReported = -1;
  let lastSize = 0;

  messages.forEach((message, index) => {
    const usage = message.usage;
    if (!usage) return;
    totals.inputTokens += usage.inputTokens ?? 0;
    totals.outputTokens += usage.outputTokens ?? 0;
    totals.reasoningTokens += usage.reasoningTokens ?? 0;
    totals.cacheReadTokens += usage.cacheReadTokens ?? 0;
    totals.cost += usage.cost ?? 0;
    const size = reportedContextSize(usage);
    if (size > 0) {
      lastReported = index;
      lastSize = size;
    }
  });

  // The last reported step already covers everything before it, including
  // files the agent read from any folder; only later turns need estimating.
  const unreported = messages.slice(lastReported + 1);
  const estimated =
    unreported.reduce((sum, m) => sum + messageTokens(m), 0) +
    (pendingPrompt ? estimateTokens(pendingPrompt) + PER_MESSAGE_TOKENS : 0);

  return {
    usedTokens: (lastReported >= 0 ? lastSize : OVERHEAD_TOKENS) + estimated,
    totals,
    reported: lastReported >= 0,
  };
}

function reportedContextSize(usage: AgentUsage) {
  // An agent's counts add up every step of the turn; its last step's size is the real one.
  if (usage.contextTokens) return usage.contextTokens;
  const input = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  return input > 0 ? input + (usage.outputTokens ?? 0) : 0;
}

function messageTokens(message: ChatMessage) {
  if (message.role === "error") return 0;
  const activity = (message.activities ?? []).reduce(
    (sum, a) => sum + estimateTokens(a.title) + estimateTokens(a.detail ?? ""),
    0,
  );
  return estimateTokens(message.content) + activity + PER_MESSAGE_TOKENS;
}
