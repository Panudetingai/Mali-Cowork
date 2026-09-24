import type { ChatMessage } from "@/pages/chat/types";
import { transcript } from "@/pages/chat/summary";

/**
 * A background task runs in its own new chat, so "make an .md from the
 * content above" would reach an agent that never saw the content. The chat it
 * was started from travels along as hidden context (like `@`-mentions: sent
 * to the model, not shown in the message), which every backend receives.
 */
export function carriedConversation(messages: ChatMessage[], title: string, maxTokens: number) {
  const earlier = transcript(messages, Math.max(1000, Math.floor(maxTokens / 2)));
  if (!earlier) return "";
  return `\n\n<conversation_so_far>\nThe user started this task from their chat “${title}”. Use what was said there — the task refers to it:\n\n${earlier}\n</conversation_so_far>`;
}
