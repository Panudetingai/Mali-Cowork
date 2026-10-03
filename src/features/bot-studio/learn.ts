import { getChats, type ChatSession } from "@/features/chat-history";
import { absorbKnowledge } from "./knowledge";
import type { CustomBot } from "./types";

/** Pull patterns from recent chats into a bot (manual refresh). */
export function distillFromRecentChats(bot: CustomBot, limit = 6): CustomBot {
  const sessions = getChats()
    .filter((s: ChatSession) => s.messages.some((m) => m.role === "user"))
    .slice(0, limit);

  let next = bot;
  for (const session of sessions) {
    const lastUser = [...session.messages].reverse().find((m) => m.role === "user");
    const lastAssistant = [...session.messages].reverse().find((m) => m.role === "assistant" && m.content?.trim());
    if (!lastUser || !lastAssistant) continue;
    const prompt = typeof lastUser.content === "string" ? lastUser.content : "";
    const summary = lastAssistant.content.slice(0, 400);
    const result = absorbKnowledge(next, {
      title: prompt.replace(/\s+/g, " ").trim().slice(0, 72) || session.title,
      body: summary,
      tags: [session.mode ?? "chat"],
    });
    next = result.bot;
  }
  return next;
}
