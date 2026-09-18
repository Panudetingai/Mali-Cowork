import { opencodeAbort, opencodeDeleteSession, type WorkMode } from "@/features/opencode";
import { createStore } from "@/lib/local-store";
import type { PermissionRequest } from "@/pages/chat/api/chat";
import type { ChatMessage } from "@/pages/chat/types";

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  pinned?: boolean;
  /** Plain conversation or agent work; older chats are inferred. */
  mode?: WorkMode;
  /** Cowork: the folder the agent session was opened in. */
  cwd?: string;
  /** Cowork: other granted folders attached to this chat. */
  folders?: string[];
  /** OpenCode session, so the agent keeps context across prompts and restarts. */
  opencodeSessionId?: string;
  /** Cursor chat id, so `cursor-agent --resume` keeps the conversation. */
  cursorSessionId?: string;
  /** Codex thread id, so `codex exec resume <id>` keeps the conversation. */
  codexSessionId?: string;
  /** Gemini session id, so `gemini -r <id>` keeps the conversation. */
  geminiSessionId?: string;
  /** Chat this one continues after the context limit was reached. */
  continuedFrom?: { id: string; title: string };
};

type NewChat = Pick<ChatSession, "mode" | "cwd" | "continuedFrom">;

/** In-flight state for a chat; never persisted. */
export type ChatRun = {
  /** Identifies this run, so a late cleanup can't end a newer one. */
  token: string;
  modelId: string;
  agentSessionId?: string;
  permissions: PermissionRequest[];
};

const TITLE_MAX = 60;

const sessionStore = createStore<ChatSession[]>([], {
  key: "mali_chat_sessions",
  throttleMs: 400,
  revive: (sessions) =>
    Array.isArray(sessions) ? sessions.map(settleInterruptedReplies) : [],
});
const runStore = createStore<Record<string, ChatRun>>({});

export const useChatSessions = sessionStore.use;
export const useChatRuns = runStore.use;

export function getChat(id: string) {
  return sessionStore.get().find((s) => s.id === id);
}

export function sessionMode(session: ChatSession | undefined): WorkMode {
  if (session?.mode) return session.mode;
  const agentReply = session?.messages.some(
    (m) => m.modelId?.startsWith("opencode:") || m.modelId?.startsWith("cli:"),
  );
  return agentReply ? "cowork" : "chat";
}

export function createChat(firstPrompt: string, options: NewChat = {}): ChatSession {
  const now = Date.now();
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title: titleFrom(firstPrompt),
    createdAt: now,
    updatedAt: now,
    messages: [],
    ...options,
  };
  sessionStore.set((prev) => [session, ...prev]);
  return session;
}

export function updateChat(id: string, fn: (session: ChatSession) => ChatSession) {
  sessionStore.set((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
}

export function updateChatMessages(id: string, fn: (messages: ChatMessage[]) => ChatMessage[]) {
  updateChat(id, (s) => ({ ...s, messages: fn(s.messages), updatedAt: Date.now() }));
}

export function renameChat(id: string, title: string) {
  const trimmed = title.trim();
  if (trimmed) updateChat(id, (s) => ({ ...s, title: trimmed }));
}

export function togglePinChat(id: string) {
  updateChat(id, (s) => ({ ...s, pinned: !s.pinned }));
}

export function attachFolder(id: string, folder: string) {
  updateChat(id, (s) =>
    s.cwd === folder || s.folders?.includes(folder)
      ? s
      : { ...s, folders: [...(s.folders ?? []), folder] },
  );
}

export function detachFolder(id: string, folder: string) {
  updateChat(id, (s) => ({ ...s, folders: s.folders?.filter((f) => f !== folder) }));
}

/** Remove a chat and, for agent chats, its OpenCode session on the server. */
export function deleteChat(id: string) {
  const session = getChat(id);
  const run = getRun(id);
  sessionStore.set((prev) => prev.filter((s) => s.id !== id));
  endRun(id);

  const sessionId = session?.opencodeSessionId ?? run?.agentSessionId;
  if (!sessionId) return;
  const target = { sessionId, cwd: session?.cwd, mode: sessionMode(session) };
  const abort = run ? opencodeAbort(target).catch(() => undefined) : Promise.resolve();
  void abort.then(() =>
    opencodeDeleteSession(target).catch((error) =>
      console.warn("[chat-history] could not delete OpenCode session", error),
    ),
  );
}

/** Returns the run's token for `endRun`. */
export function startRun(id: string, modelId: string) {
  const token = crypto.randomUUID();
  runStore.set((prev) => ({ ...prev, [id]: { token, modelId, permissions: [] } }));
  return token;
}

export function updateRun(id: string, fn: (run: ChatRun) => ChatRun) {
  runStore.set((prev) => (prev[id] ? { ...prev, [id]: fn(prev[id]) } : prev));
}

export function getRun(id: string): ChatRun | undefined {
  return runStore.get()[id];
}

/** End a chat's run; with `token`, only if it is still that run. */
export function endRun(id: string, token?: string) {
  runStore.set((prev) => {
    const run = prev[id];
    if (!run || (token && run.token !== token)) return prev;
    const { [id]: _ended, ...rest } = prev;
    return rest;
  });
}

function titleFrom(prompt: string) {
  const line = prompt.replace(/\s+/g, " ").trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line || "New chat";
}

/** A reply that was streaming when the app closed can never finish. */
function settleInterruptedReplies(session: ChatSession): ChatSession {
  if (!session.messages.some((m) => m.isStreaming)) return session;
  return {
    ...session,
    messages: session.messages
      .filter((m) => !(m.isStreaming && !m.content && !m.reasoning))
      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
  };
}
