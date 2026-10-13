import { useMemo } from "react";
import { sessionMode, useChatRuns, useChatSessions, type ChatRun, type ChatSession } from "./store";

export function runNeedsYou(run?: ChatRun) {
  if (!run) return false;
  return run.permissions.length > 0 || run.questions.length > 0;
}

export type ChatAttention = {
  /** Chats waiting on permission or an answer. */
  chatCount: number;
  /** Pending items (permissions + questions) across those chats. */
  pendingCount: number;
  byChatId: Record<string, { permissions: number; questions: number }>;
  /** Chats in Chat mode that need you. */
  chatModeCount: number;
  /** Chats in Cowork (or Code) mode that need you. */
  coworkModeCount: number;
  /** First chat to open, most recently updated. */
  firstChatId?: string;
};

function summarize(sessions: ChatSession[], runs: Record<string, ChatRun>): ChatAttention {
  const byChatId: ChatAttention["byChatId"] = {};
  let pendingCount = 0;
  let chatModeCount = 0;
  let coworkModeCount = 0;

  for (const [id, run] of Object.entries(runs)) {
    const permissions = run.permissions.length;
    const questions = run.questions.length;
    if (permissions + questions === 0) continue;
    byChatId[id] = { permissions, questions };
    pendingCount += permissions + questions;
    const session = sessions.find((s) => s.id === id);
    const mode = sessionMode(session);
    if (mode === "chat") chatModeCount += 1;
    else coworkModeCount += 1;
  }

  const waitingIds = Object.keys(byChatId);
  const firstChatId = sessions
    .filter((s) => waitingIds.includes(s.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;

  return {
    chatCount: waitingIds.length,
    pendingCount,
    byChatId,
    chatModeCount,
    coworkModeCount,
    firstChatId,
  };
}

export function useChatAttention(): ChatAttention {
  const sessions = useChatSessions();
  const runs = useChatRuns();
  return useMemo(() => summarize(sessions, runs), [sessions, runs]);
}
