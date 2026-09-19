import { generateStream } from "./api/router";
import { estimateTokens } from "./context-usage";
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

/** Ask `modelId` for a summary of `messages`, answering in Chat mode with no tools. */
export async function summarizeConversation(
  messages: ChatMessage[],
  { modelId, runId, maxTokens }: { modelId: string; runId: string; maxTokens: number },
): Promise<string> {
  // Leave room for the instructions and the answer.
  const text = transcript(messages, Math.max(2_000, Math.floor(maxTokens * 0.6)));
  if (!text) return "";

  let summary = "";
  let failure: string | undefined;
  await generateStream(
    {
      prompt: `${INSTRUCTIONS}\n\n<conversation>\n${text}\n</conversation>`,
      modelId,
      mode: "chat",
      runId,
      history: [],
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
