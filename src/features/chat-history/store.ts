import { agentAbort } from "@/features/agent";
import { opencodeAbort, opencodeDeleteSession, type WorkMode } from "@/features/opencode";
import { syncToDatabase } from "@/lib/db-sync";
import { loadHistorySnapshot, type HistorySnapshot } from "@/lib/history-db";
import { createStore } from "@/lib/local-store";
import { invoke } from "@tauri-apps/api/core";
import type { PermissionRequest, QuestionRequest } from "@/pages/chat/api/chat";
import type { ChatMessage } from "@/pages/chat/types";

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  pinned?: boolean;
  /** The project this chat belongs to, if any. */
  projectId?: string;
  /** Plain conversation or agent work; older chats are inferred. */
  mode?: WorkMode;
  /** Code mode: a Cowork chat shown beside an editor for its folder. */
  view?: "code";
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
  /** Antigravity conversation id, so `agy --conversation <id>` keeps the thread. */
  antigravitySessionId?: string;
  /** Mali's own agent (Cowork on an API key): its saved conversation. */
  maliSessionId?: string;
  /** A background task's chat (Inbox): listed there, not in the sidebar. */
  inboxTask?: boolean;
  /** For a background task: the chat it was started from. */
  taskFrom?: { id: string; title: string };
  /**
   * This chat began in Chat mode and moved to Cowork; the conversation came
   * along. The thread shows a divider after `afterMessageId`.
   */
  movedToCowork?: { at: number; afterMessageId?: string; folder: string };
  /** A reply whose "continue in Cowork" hint the user closed. */
  coworkHintDismissed?: string;
  /** Chat this one continues after the context limit was reached. */
  continuedFrom?: {
    id: string;
    title: string;
    /** What the earlier chat covered; the model gets it as context. */
    summary?: string;
    /** True while the summary is being written. */
    summarizing?: boolean;
  };
};

type NewChat = Pick<ChatSession, "mode" | "view" | "cwd" | "continuedFrom" | "projectId" | "taskFrom" | "inboxTask"> & {
  /** Chosen by the caller when another window already refers to the chat (Quick bar). */
  id?: string;
};

/** In-flight state for a chat; never persisted. */
export type ChatRun = {
  /** Identifies this run, so a late cleanup can't end a newer one. */
  token: string;
  modelId: string;
  agentSessionId?: string;
  permissions: PermissionRequest[];
  /** Questions the agent asked; the prompt waits until they are answered. */
  questions: QuestionRequest[];
  /** Cowork: snapshot taken before this turn, so it can be undone. */
  checkpointId?: string;
};

const TITLE_MAX = 60;

/** Where older versions kept the history; read once, then moved to SQLite. */
const LEGACY_KEY = "mali_chat_sessions";

// Held in memory; saved to SQLite (see `loadChatHistory`).
const sessionStore = createStore<ChatSession[]>([]);
const runStore = createStore<Record<string, ChatRun>>({});
const database = syncToDatabase(sessionStore, "chats");

/**
 * Load the history from SQLite before the app renders. The first time, chats
 * from localStorage (older versions) are copied in and then removed there.
 */
export async function loadChatHistory() {
  try {
    let snapshot = await loadHistorySnapshot<ChatSession, unknown>();
    if (!snapshot.legacyImported) {
      await invoke("history_import_legacy", { chats: readLegacy() });
      snapshot = await invoke<HistorySnapshot<ChatSession>>("history_load");
      localStorage.removeItem(LEGACY_KEY);
    }
    const chats = snapshot.chats.filter(isChat);
    // Replies cut off by a quit are settled, and saved again as settled.
    database.start(chats);
    sessionStore.set(chats.map(settleInterruptedReplies));
  } catch (error) {
    // Outside the desktop app (or if the database can't open) keep using localStorage.
    console.error("[chat-history] SQLite unavailable, using localStorage", error);
    sessionStore.set(readLegacy().map(settleInterruptedReplies));
    let timer: ReturnType<typeof setTimeout> | undefined;
    sessionStore.subscribe(() => {
      timer ??= setTimeout(() => {
        timer = undefined;
        try {
          localStorage.setItem(LEGACY_KEY, JSON.stringify(sessionStore.get()));
        } catch {
          // Storage full; the chats still live for this session.
        }
      }, 400);
    });
  }
}

function readLegacy(): ChatSession[] {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isChat) : [];
  } catch {
    return [];
  }
}

function isChat(value: unknown): value is ChatSession {
  const chat = value as ChatSession;
  return !!chat && typeof chat.id === "string" && Array.isArray(chat.messages);
}

export const useChatSessions = sessionStore.use;
export const useChatRuns = runStore.use;
/** Every active run by chat id; for code outside React (the Task Inbox queue). */
export const getRuns = runStore.get;
export const subscribeToRuns = runStore.subscribe;

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
    title: titleFrom(firstPrompt),
    createdAt: now,
    updatedAt: now,
    messages: [],
    ...options,
    id: options.id ?? crypto.randomUUID(),
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

export function editMessage(chatId: string, messageId: string, content: string) {
  updateChatMessages(chatId, (messages) =>
    messages.map((m) => (m.id === messageId ? { ...m, content: content.trim() } : m)),
  );
}

export function renameChat(id: string, title: string) {
  const trimmed = title.trim();
  if (trimmed) updateChat(id, (s) => ({ ...s, title: trimmed }));
}

/** Put a chat in a project, or with `undefined` take it out. */
export function moveChatToProject(id: string, projectId: string | undefined) {
  updateChat(id, (s) => ({ ...s, projectId }));
}

/** Chats of a project that was deleted go back to the plain history. */
export function releaseProjectChats(projectId: string) {
  sessionStore.set((prev) =>
    prev.some((s) => s.projectId === projectId)
      ? prev.map((s) => (s.projectId === projectId ? { ...s, projectId: undefined } : s))
      : prev,
  );
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

/** Drop stored agent session ids so the next prompt opens a fresh backend session. */
export function clearAgentSessions(chatId?: string) {
  const strip = (s: ChatSession): ChatSession => ({
    ...s,
    opencodeSessionId: undefined,
    cursorSessionId: undefined,
    codexSessionId: undefined,
    antigravitySessionId: undefined,
    maliSessionId: undefined,
  });
  if (chatId) {
    updateChat(chatId, strip);
    return;
  }
  sessionStore.set((prev) => prev.map(strip));
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

  // Mali's own agent: stop it; its saved conversation is only a file.
  if (run?.agentSessionId?.startsWith("mali_")) {
    void agentAbort(id).catch(() => undefined);
    return;
  }
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

/** Remove many chats at once. */
export function deleteChats(ids: string[]) {
  for (const id of ids) deleteChat(id);
}

/** Returns the run's token for `endRun`. */
export function startRun(id: string, modelId: string) {
  const token = crypto.randomUUID();
  runStore.set((prev) => ({ ...prev, [id]: { token, modelId, permissions: [], questions: [] } }));
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
