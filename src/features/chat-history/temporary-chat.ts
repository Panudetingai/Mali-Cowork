import type { ChatSession } from "./store";
import type { ViewMode } from "@/pages/chat/components/work-mode-toggle";

/** Query flag for a new chat that won't be saved to history. */
export const TEMPORARY_CHAT_QUERY = "temporary";

export function isTemporaryChat(session: ChatSession | undefined) {
  return !!session?.ephemeral;
}

export function isTemporaryChatIntent(search: URLSearchParams, session?: ChatSession) {
  if (session) return isTemporaryChat(session);
  return search.get(TEMPORARY_CHAT_QUERY) === "1";
}

/** Home URL for a new chat; `temporary` skips SQLite and the sidebar list. */
export function newChatHomeUrl(mode: ViewMode, options?: { projectId?: string; temporary?: boolean }) {
  const view = mode === "code" ? "code" : mode === "cowork" ? "cowork" : "chat";
  const params = new URLSearchParams({ mode: view });
  if (options?.projectId) params.set("project", options.projectId);
  if (options?.temporary) params.set(TEMPORARY_CHAT_QUERY, "1");
  return `/?${params.toString()}`;
}
